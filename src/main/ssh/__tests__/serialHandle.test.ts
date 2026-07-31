import { EventEmitter } from 'events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSerialOutputBuffer } from '../serialHandle'

/**
 * Fake node-serialport port. Opens asynchronously on the next tick so the
 * 'open' listener registered by createSerialTerminal is in place before it fires.
 */
class FakeSerialPort extends EventEmitter {
  static instances: FakeSerialPort[] = []
  static failPaths = new Set<string>()
  static list = vi.fn(async () => [] as any[])

  options: Record<string, any>
  isOpen = false
  written: string[] = []
  closeCalls = 0

  constructor(options: Record<string, any>, cb?: (err: Error | null) => void) {
    super()
    this.options = options
    FakeSerialPort.instances.push(this)
    process.nextTick(() => {
      if (FakeSerialPort.failPaths.has(options.path)) {
        cb?.(new Error(`cannot open ${options.path}`))
        return
      }
      this.isOpen = true
      cb?.(null)
      this.emit('open')
    })
  }

  write(data: string): boolean {
    this.written.push(data)
    return true
  }

  close(): void {
    this.closeCalls++
    this.isOpen = false
    this.emit('close')
  }
}

const loadModule = async () => {
  vi.resetModules()
  FakeSerialPort.instances = []
  FakeSerialPort.failPaths = new Set<string>()

  const ipcMainMock = { handle: vi.fn(), on: vi.fn(), once: vi.fn(), removeAllListeners: vi.fn() }
  const BrowserWindowMock = { getAllWindows: vi.fn(() => [] as any[]) }

  vi.doMock('electron', () => ({
    ipcMain: ipcMainMock,
    BrowserWindow: BrowserWindowMock,
    default: { ipcMain: ipcMainMock, BrowserWindow: BrowserWindowMock }
  }))
  vi.doMock('serialport', () => ({
    SerialPort: FakeSerialPort,
    default: { SerialPort: FakeSerialPort }
  }))

  const mod = await import('../serialHandle')
  return { mod, ipcMainMock, BrowserWindowMock }
}

const lastPort = () => FakeSerialPort.instances[FakeSerialPort.instances.length - 1]

beforeEach(() => {
  vi.clearAllMocks()
})

describe('serialHandle — open options', () => {
  it('applies node-serialport defaults when the asset omits optional params', async () => {
    const { mod } = await loadModule()

    await mod.createSerialTerminal({ id: 't1', path: 'COM3' })

    expect(lastPort().options).toMatchObject({
      path: 'COM3',
      baudRate: 9600,
      dataBits: 8,
      stopBits: 1,
      parity: 'none',
      autoOpen: true
    })
  })

  it('coerces string-typed asset params coming from SQLite into numbers', async () => {
    const { mod } = await loadModule()

    await mod.createSerialTerminal({
      id: 't1',
      path: 'COM3',
      baudRate: '115200' as unknown as number,
      dataBits: '7' as unknown as number,
      stopBits: '2' as unknown as number
    })

    expect(lastPort().options).toMatchObject({ baudRate: 115200, dataBits: 7, stopBits: 2 })
  })

  it.each([
    ['none', { rtscts: false, xon: false, xoff: false, xany: false }],
    ['hardware', { rtscts: true, xon: false, xoff: false, xany: false }],
    ['software', { rtscts: false, xon: true, xoff: true, xany: false }],
    ['both', { rtscts: true, xon: true, xoff: true, xany: false }]
  ])('maps flowControl=%s to the expected RTS/CTS + XON/XOFF flags', async (preset, expected) => {
    const { mod } = await loadModule()

    await mod.createSerialTerminal({ id: 't1', path: 'COM3', flowControl: preset as any })

    expect(lastPort().options).toMatchObject(expected)
  })

  it('falls back to no flow control for an unknown preset', async () => {
    const { mod } = await loadModule()

    await mod.createSerialTerminal({ id: 't1', path: 'COM3', flowControl: 'bogus' as any })

    expect(lastPort().options).toMatchObject({ rtscts: false, xon: false, xoff: false, xany: false })
  })

  it('rejects and forgets the terminal when the port fails to open', async () => {
    const { mod } = await loadModule()
    FakeSerialPort.failPaths.add('COM9')

    await expect(mod.createSerialTerminal({ id: 'dead', path: 'COM9' })).rejects.toThrow('cannot open COM9')
    expect(mod.getSerialTerminal('dead')).toBeUndefined()
    expect(mod.isSerialTerminalAlive('dead')).toBe(false)
  })
})

describe('serialHandle — writing data', () => {
  it('converts LF to CRLF so serial consoles receive a proper line ending', async () => {
    const { mod } = await loadModule()
    await mod.createSerialTerminal({ id: 't1', path: 'COM3' })

    const result = mod.sendDataToSerialTerminal('t1', 'display version\n')

    expect(result).toEqual({ success: true })
    expect(lastPort().written).toEqual(['display version\r\n'])
  })

  it('does not double-convert data that already uses CRLF', async () => {
    const { mod } = await loadModule()
    await mod.createSerialTerminal({ id: 't1', path: 'COM3' })

    mod.sendDataToSerialTerminal('t1', 'a\r\nb\n')

    expect(lastPort().written).toEqual(['a\r\nb\r\n'])
  })

  it('reports failure instead of throwing when the terminal is unknown', async () => {
    const { mod } = await loadModule()

    expect(mod.sendDataToSerialTerminal('nope', 'x')).toEqual({
      success: false,
      message: 'Terminal not found or not alive'
    })
  })

  it('reports failure when the underlying port write throws', async () => {
    const { mod } = await loadModule()
    await mod.createSerialTerminal({ id: 't1', path: 'COM3' })
    vi.spyOn(lastPort(), 'write').mockImplementation(() => {
      throw new Error('port busy')
    })

    expect(mod.sendDataToSerialTerminal('t1', 'x')).toEqual({ success: false, message: 'port busy' })
  })
})

describe('serialHandle — COM port reuse lookup', () => {
  it('finds a live terminal by its COM path', async () => {
    const { mod } = await loadModule()
    await mod.createSerialTerminal({ id: 't1', path: 'COM3' })
    await mod.createSerialTerminal({ id: 't2', path: 'COM4' })

    expect(mod.getSerialTerminalByPath('COM3')).toBe('t1')
    expect(mod.getSerialTerminalByPath('COM4')).toBe('t2')
    expect(mod.getSerialTerminalByPath('COM5')).toBeNull()
  })

  it('does not return a terminal whose port has been closed', async () => {
    const { mod } = await loadModule()
    await mod.createSerialTerminal({ id: 't1', path: 'COM3' })

    mod.closeSerialTerminal('t1')

    expect(mod.getSerialTerminalByPath('COM3')).toBeNull()
  })
})

describe('serialHandle — closing', () => {
  it('closes every terminal bound to a path and returns the count', async () => {
    const { mod } = await loadModule()
    await mod.createSerialTerminal({ id: 't1', path: 'COM3' })
    await mod.createSerialTerminal({ id: 't2', path: 'COM3' })
    await mod.createSerialTerminal({ id: 't3', path: 'COM4' })

    expect(mod.closeSerialTerminalByPath('COM3')).toBe(2)
    expect(mod.getSerialTerminal('t1')).toBeUndefined()
    expect(mod.getSerialTerminal('t2')).toBeUndefined()
    expect(mod.getSerialTerminal('t3')).toBeDefined()
  })

  it('returns 0 when no terminal uses the given path', async () => {
    const { mod } = await loadModule()
    await mod.createSerialTerminal({ id: 't1', path: 'COM3' })

    expect(mod.closeSerialTerminalByPath('COM7')).toBe(0)
  })

  it('reports a helpful failure when closing an unknown terminal', async () => {
    const { mod } = await loadModule()

    expect(mod.closeSerialTerminal('ghost')).toEqual({ success: false, message: 'Terminal not found' })
  })
})

describe('serialHandle — AI agent data listeners', () => {
  it('fans serial output out to every registered listener', async () => {
    const { mod } = await loadModule()
    await mod.createSerialTerminal({ id: 't1', path: 'COM3' })
    const a = vi.fn()
    const b = vi.fn()
    mod.addSerialDataListener('t1', a)
    mod.addSerialDataListener('t1', b)

    lastPort().emit('data', Buffer.from('<H3C>display version'))

    expect(a).toHaveBeenCalledWith('<H3C>display version')
    expect(b).toHaveBeenCalledWith('<H3C>display version')
  })

  it('stops delivering data after the returned unsubscribe is called', async () => {
    const { mod } = await loadModule()
    await mod.createSerialTerminal({ id: 't1', path: 'COM3' })
    const listener = vi.fn()
    const unsubscribe = mod.addSerialDataListener('t1', listener)

    unsubscribe()
    lastPort().emit('data', Buffer.from('ignored'))

    expect(listener).not.toHaveBeenCalled()
  })

  it('keeps delivering to healthy listeners when one throws', async () => {
    const { mod } = await loadModule()
    await mod.createSerialTerminal({ id: 't1', path: 'COM3' })
    const bad = vi.fn(() => {
      throw new Error('listener blew up')
    })
    const good = vi.fn()
    mod.addSerialDataListener('t1', bad)
    mod.addSerialDataListener('t1', good)

    expect(() => lastPort().emit('data', Buffer.from('ok'))).not.toThrow()
    expect(good).toHaveBeenCalledWith('ok')
  })

  it('returns a no-op unsubscribe for an unknown terminal', async () => {
    const { mod } = await loadModule()

    const unsubscribe = mod.addSerialDataListener('ghost', vi.fn())

    expect(() => unsubscribe()).not.toThrow()
  })
})

describe('serialHandle — IPC registration', () => {
  it('registers the full serial channel surface used by the renderer', async () => {
    const { mod, ipcMainMock } = await loadModule()

    mod.registerSerialHandlers()

    const channels = ipcMainMock.handle.mock.calls.map((call) => call[0])
    expect(channels).toEqual(expect.arrayContaining(['serial:connect', 'serial:send:data', 'serial:resize', 'serial:close', 'serial:get:ports']))
  })
})

describe('createSerialOutputBuffer — coalescing', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('coalesces rapid pushes into a single emit on the flush timer', () => {
    const emit = vi.fn()
    const buf = createSerialOutputBuffer(emit)

    buf.push('hello ')
    buf.push('wor')
    buf.push('ld')

    expect(emit).not.toHaveBeenCalled()
    vi.advanceTimersByTime(30)
    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit).toHaveBeenCalledWith('hello world')
  })

  it('flush() drains immediately and resets the timer', () => {
    const emit = vi.fn()
    const buf = createSerialOutputBuffer(emit)

    buf.push('abc')
    buf.flush()
    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit).toHaveBeenCalledWith('abc')

    // A later timer tick must not emit again (already drained)
    vi.advanceTimersByTime(30)
    expect(emit).toHaveBeenCalledTimes(1)
  })

  it('dispose() drops pending data without emitting', () => {
    const emit = vi.fn()
    const buf = createSerialOutputBuffer(emit)

    buf.push('leaked')
    buf.dispose()
    vi.advanceTimersByTime(30)
    expect(emit).not.toHaveBeenCalled()
  })

  it('schedules a new timer after a flush so later pushes still coalesce', () => {
    const emit = vi.fn()
    const buf = createSerialOutputBuffer(emit)

    buf.push('a')
    buf.flush()
    buf.push('b')
    vi.advanceTimersByTime(30)
    expect(emit).toHaveBeenCalledTimes(2)
    expect(emit).toHaveBeenNthCalledWith(1, 'a')
    expect(emit).toHaveBeenNthCalledWith(2, 'b')
  })
})
