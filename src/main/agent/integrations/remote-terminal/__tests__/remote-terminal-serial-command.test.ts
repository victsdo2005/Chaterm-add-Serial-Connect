import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { createRequire, Module } from 'module'

const require = createRequire(import.meta.url)
const electronPath = require.resolve('electron')
const mockElectronModule = new Module(electronPath)
mockElectronModule.filename = electronPath
mockElectronModule.loaded = true
mockElectronModule.exports = {
  app: { getAppPath: () => process.cwd() },
  webContents: { getFocusedWebContents: vi.fn() }
}
require.cache[electronPath] = mockElectronModule

vi.mock('electron', () => ({
  app: { getAppPath: () => process.cwd() },
  webContents: { getFocusedWebContents: vi.fn() }
}))

vi.mock('../../../../ssh/agentHandle', () => ({
  remoteSshConnect: vi.fn(),
  remoteSshExecStream: vi.fn(),
  remoteSshDisconnect: vi.fn(),
  isRemoteConnectionAlive: vi.fn().mockReturnValue(true),
  handleRemoteExecInput: vi.fn().mockReturnValue({ success: true }),
  isWakeupSession: vi.fn().mockReturnValue(false),
  openWakeupShell: vi.fn(),
  findWakeupConnectionInfoByHost: vi.fn().mockReturnValue(null)
}))

vi.mock('../../../../ssh/capabilityRegistry', () => ({
  capabilityRegistry: { getBastion: vi.fn() },
  BastionErrorCode: {
    CAPABILITY_NOT_FOUND: 'BASTION_CAPABILITY_NOT_FOUND',
    AGENT_EXEC_UNAVAILABLE: 'BASTION_AGENT_EXEC_UNAVAILABLE'
  }
}))

vi.mock('../jumpserverHandle', () => ({
  handleJumpServerConnection: vi.fn(),
  jumpserverShellStreams: new Map(),
  jumpserverMarkedCommands: new Map()
}))

const sendDataToSerialTerminalMock = vi.fn()
/** Data listeners registered by runSerialCommand, so the test can push device output. */
let serialListeners: ((data: string) => void)[] = []

vi.mock('../../../../ssh/serialHandle', () => ({
  createSerialTerminal: vi.fn(),
  closeSerialTerminal: vi.fn(),
  isSerialTerminalAlive: vi.fn().mockReturnValue(true),
  getSerialTerminalByPath: vi.fn().mockReturnValue(null),
  sendDataToSerialTerminal: (...args: any[]) => sendDataToSerialTerminalMock(...args),
  addSerialDataListener: (_sessionId: string, listener: (data: string) => void) => {
    serialListeners.push(listener)
    return () => {
      serialListeners = serialListeners.filter((l) => l !== listener)
    }
  }
}))

const emitSerialData = (data: string) => serialListeners.forEach((l) => l(data))

// Mirrors the Promise contract of RemoteTerminalManager.runCommand(), which only
// resolves on the 'continue' event. If runSerialCommand stops emitting it, the
// agent's `await process` hangs until a fallback timeout — the bug this guards.
const runAsAgentWould = (process: any, sessionId: string, command: string) =>
  new Promise<void>((resolve, reject) => {
    process.once('continue', () => resolve())
    process.once('error', (err: Error) => reject(err))
    process.run(sessionId, command, undefined, 'serial').catch(reject)
  })

describe('RemoteTerminalProcess serial command', () => {
  // Importing ../index pulls in a very large module graph; do it once up front so
  // the transform cost is not charged against the first test's timeout.
  let RemoteTerminalProcess: any
  beforeAll(async () => {
    ;({ RemoteTerminalProcess } = await import('../index'))
  }, 60000)

  beforeEach(() => {
    vi.useFakeTimers()
    serialListeners = []
    sendDataToSerialTerminalMock.mockReset()
    sendDataToSerialTerminalMock.mockReturnValue({ success: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('emits completed and continue so the agent promise resolves', async () => {
    const process = new RemoteTerminalProcess()
    const events: string[] = []
    process.on('completed', () => events.push('completed'))
    process.on('continue', () => events.push('continue'))

    const settled = runAsAgentWould(process, 'serial-1', 'display version')

    // Device is silent → the no-output guard (5s) resolves the wait
    await vi.advanceTimersByTimeAsync(5100)
    await expect(settled).resolves.toBeUndefined()
    expect(events).toEqual(['completed', 'continue'])
  })

  it('writes the command with a trailing newline to the serial port', async () => {
    const process = new RemoteTerminalProcess()

    const settled = runAsAgentWould(process, 'serial-1', 'display version')
    await vi.advanceTimersByTimeAsync(5100)
    await settled

    expect(sendDataToSerialTerminalMock).toHaveBeenCalledWith('serial-1', 'display version\n')
  })

  it('prefixes the command with cd when a working directory is given', async () => {
    const process = new RemoteTerminalProcess()

    const settled = new Promise<void>((resolve, reject) => {
      process.once('continue', () => resolve())
      process.once('error', reject)
      process.run('serial-1', 'ls', '/tmp', 'serial').catch(reject)
    })
    await vi.advanceTimersByTimeAsync(5100)
    await settled

    expect(sendDataToSerialTerminalMock).toHaveBeenCalledWith('serial-1', 'cd /tmp && ls\n')
  })

  it('streams device output as lines and still completes', async () => {
    const process = new RemoteTerminalProcess()
    const lines: string[] = []
    process.on('line', (line: string) => lines.push(line))

    const settled = runAsAgentWould(process, 'serial-1', 'display version')

    await vi.advanceTimersByTimeAsync(10)
    emitSerialData('H3C Comware Software\nVersion 7.1.070\n')

    // Idle detection for serial waits 2s with no further data
    await vi.advanceTimersByTimeAsync(2100)
    await expect(settled).resolves.toBeUndefined()
    expect(lines).toEqual(['H3C Comware Software', 'Version 7.1.070'])
  })

  it('auto-sends a space when the device pages output with a More prompt', async () => {
    const process = new RemoteTerminalProcess()

    const settled = runAsAgentWould(process, 'serial-1', 'display current-configuration')

    await vi.advanceTimersByTimeAsync(10)
    emitSerialData('interface Vlan1\n  ---- More ----')
    await vi.advanceTimersByTimeAsync(10)

    expect(sendDataToSerialTerminalMock).toHaveBeenCalledWith('serial-1', ' ')

    emitSerialData('interface Vlan2\n')
    await vi.advanceTimersByTimeAsync(2100)
    await expect(settled).resolves.toBeUndefined()
  })

  it('detects a More prompt split across two data events and continues exactly once', async () => {
    const process = new RemoteTerminalProcess()

    const settled = runAsAgentWould(process, 'serial-1', 'display current-configuration')

    await vi.advanceTimersByTimeAsync(10)
    // H3C at 9600 baud frequently splits the prompt across data events
    emitSerialData('interface Vlan1\n  ---- Mo')
    await vi.advanceTimersByTimeAsync(10)
    emitSerialData('re ----')
    await vi.advanceTimersByTimeAsync(10)

    const spaceCalls = sendDataToSerialTerminalMock.mock.calls.filter((c: any[]) => c[1] === ' ')
    expect(spaceCalls).toHaveLength(1)

    emitSerialData('interface Vlan2\n')
    await vi.advanceTimersByTimeAsync(2100)
    await expect(settled).resolves.toBeUndefined()
  })

  it('reassembles fragmented data events into whole lines', async () => {
    const process = new RemoteTerminalProcess()
    const lines: string[] = []
    process.on('line', (line: string) => lines.push(line))

    const settled = runAsAgentWould(process, 'serial-1', 'display version')

    await vi.advanceTimersByTimeAsync(10)
    // Real 9600-baud fragmentation observed on an H3C switch: chunk boundaries
    // land mid-word and must NOT be treated as line breaks
    emitSerialData('dis')
    await vi.advanceTimersByTimeAsync(50)
    emitSerialData('play version\r\nH3C Comware S')
    await vi.advanceTimersByTimeAsync(50)
    emitSerialData('oftware, Version 7.1.070\r\n')

    await vi.advanceTimersByTimeAsync(2100)
    await expect(settled).resolves.toBeUndefined()
    expect(lines).toEqual(['display version', 'H3C Comware Software, Version 7.1.070'])
  })

  it('keeps collecting slow multi-burst output instead of truncating after a fixed delay', async () => {
    const process = new RemoteTerminalProcess()
    const lines: string[] = []
    process.on('line', (line: string) => lines.push(line))

    const settled = runAsAgentWould(process, 'serial-1', 'display interface brief')
    let settledFlag = false
    settled.then(() => {
      settledFlag = true
    })

    await vi.advanceTimersByTimeAsync(10)
    // Bursts separated by >350ms pauses — the old fixed settle timer dropped
    // everything after the first ~350ms; idle-driven completion must not
    emitSerialData('GE1/0/1  UP\n')
    await vi.advanceTimersByTimeAsync(1500)
    expect(settledFlag).toBe(false)
    emitSerialData('GE1/0/2  UP\n')
    await vi.advanceTimersByTimeAsync(1500)
    expect(settledFlag).toBe(false)
    emitSerialData('GE1/0/3  DOWN\n')

    await vi.advanceTimersByTimeAsync(2100)
    await expect(settled).resolves.toBeUndefined()
    expect(lines).toEqual(['GE1/0/1  UP', 'GE1/0/2  UP', 'GE1/0/3  DOWN'])
  })

  it('settles fast and flushes the tail when the CLI prompt appears without a newline', async () => {
    const process = new RemoteTerminalProcess()
    const lines: string[] = []
    process.on('line', (line: string) => lines.push(line))

    const settled = runAsAgentWould(process, 'serial-1', 'display cpu-usage')

    await vi.advanceTimersByTimeAsync(10)
    emitSerialData('display cpu-usage\r\n14% in last 5 seconds\r\n<QY-SW-01>')

    // Prompt tail → fast settle (300ms), well before the 2s burst idle
    await vi.advanceTimersByTimeAsync(400)
    await expect(settled).resolves.toBeUndefined()
    expect(lines).toEqual(['display cpu-usage', '14% in last 5 seconds', '<QY-SW-01>'])
  })

  it('strips ANSI cursor sequences H3C uses to erase the More prompt', async () => {
    const process = new RemoteTerminalProcess()
    const lines: string[] = []
    process.on('line', (line: string) => lines.push(line))

    const settled = runAsAgentWould(process, 'serial-1', 'display current-configuration')

    await vi.advanceTimersByTimeAsync(10)
    // Inverse-video More prompt erased via cursor-left + spaces (H3C behavior)
    emitSerialData('line one\r\n\x1B[7m---- More ----\x1B[m\x1B[16D                \x1B[16Dline two\r\n')

    await vi.advanceTimersByTimeAsync(2100)
    await expect(settled).resolves.toBeUndefined()
    expect(sendDataToSerialTerminalMock).toHaveBeenCalledWith('serial-1', ' ')
    expect(lines[0]).toBe('line one')
    expect(lines[1]).toContain('line two')
    expect(lines.join('\n')).not.toContain('More')
  })

  it('rejects without hanging when the serial write fails', async () => {
    const process = new RemoteTerminalProcess()
    sendDataToSerialTerminalMock.mockReturnValue({ success: false, message: 'port closed' })

    const settled = runAsAgentWould(process, 'serial-1', 'display version')
    // Attach the rejection handler before advancing timers, otherwise the rejection
    // is briefly unobserved and Node reports it as an unhandled rejection.
    const assertion = expect(settled).rejects.toThrow('Serial write failed: port closed')

    await vi.advanceTimersByTimeAsync(10)
    await assertion
  })

  it('does not leave any fallback timer pending after a normal completion', async () => {
    const process = new RemoteTerminalProcess()

    const settled = runAsAgentWould(process, 'serial-1', 'display version')
    await vi.advanceTimersByTimeAsync(10)
    emitSerialData('done\r\n<SW-01>')
    await vi.advanceTimersByTimeAsync(400)
    await settled

    expect(vi.getTimerCount()).toBe(0)
  })
})
