import { ipcMain, BrowserWindow } from 'electron'
import { SerialPort } from 'serialport'
const serialLogger = createLogger('serial')

// Serial connection parity values accepted by node-serialport
type SerialParity = 'none' | 'even' | 'odd' | 'mark' | 'space'
// Flow control preset: 'none' | 'hardware' (RTS/CTS) | 'software' (XON/XOFF) | 'both'
type SerialFlowControl = 'none' | 'hardware' | 'software' | 'both'

interface SerialTerminalConfig {
  id: string
  path: string
  baudRate?: number
  dataBits?: number
  stopBits?: number
  parity?: SerialParity
  flowControl?: SerialFlowControl
  cols?: number
  rows?: number
  termType?: string
}

interface SerialTerminal {
  id: string
  port: SerialPort
  isAlive: boolean
  path: string
  outputBuffer: {
    push: (data: string) => void
    flush: () => void
    dispose: () => void
  }
  // AI Agent data listeners — called on every chunk of serial output
  dataListeners: Set<(data: string) => void>
}

const terminals: Map<string, SerialTerminal> = new Map()

const sendToRenderer = (channel: string, data: unknown) => {
  const windows = BrowserWindow.getAllWindows()
  windows.forEach((window) => {
    window.webContents.send(channel, data)
  })
}

// Map a flow-control preset to node-serialport open options.
const resolveFlowControl = (preset: SerialFlowControl | undefined): { rtscts: boolean; xon: boolean; xoff: boolean; xany: boolean } => {
  switch (preset) {
    case 'hardware':
      return { rtscts: true, xon: false, xoff: false, xany: false }
    case 'software':
      return { rtscts: false, xon: true, xoff: true, xany: false }
    case 'both':
      return { rtscts: true, xon: true, xoff: true, xany: false }
    case 'none':
    default:
      return { rtscts: false, xon: false, xoff: false, xany: false }
  }
}

// Serial consoles expect CRLF line endings. Callers may hand us either LF
// (renderer / AI agent) or already-normalized CRLF, so match an optional CR to
// avoid emitting `\r\r\n`, which a device CLI reads as an extra Enter keypress.
const toWireData = (data: string): string => data.replace(/\r?\n/g, '\r\n')

// Coalesce raw serial chunks into batched renderer updates. At high baud rates
// the driver emits many small chunks; emitting each as a separate IPC to every
// window floods the renderer main thread. We accumulate and flush on a short
// timer (or when forced via flush()), which keeps output real-time yet cheap.
const SERIAL_FLUSH_INTERVAL_MS = 30
export const createSerialOutputBuffer = (emit: (data: string) => void) => {
  let pending = ''
  let timer: ReturnType<typeof setTimeout> | null = null
  const drain = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    if (pending) {
      const chunk = pending
      pending = ''
      emit(chunk)
    }
  }
  return {
    push: (data: string) => {
      pending += data
      if (!timer) {
        timer = setTimeout(drain, SERIAL_FLUSH_INTERVAL_MS)
        // Don't keep the Electron event loop alive solely for flushing.
        if (typeof timer.unref === 'function') timer.unref()
      }
    },
    flush: drain,
    dispose: () => {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      pending = ''
    }
  }
}

const createTerminal = (config: SerialTerminalConfig): Promise<SerialTerminal> => {
  const path = config.path
  const baudRate = Number(config.baudRate) || 9600
  const dataBits = (Number(config.dataBits) || 8) as 5 | 6 | 7 | 8
  const stopBits = (Number(config.stopBits) || 1) as 1 | 1.5 | 2
  const parity = (config.parity || 'none') as SerialParity
  const flow = resolveFlowControl(config.flowControl)

  serialLogger.info('Creating serial terminal', {
    event: 'terminal.serial.connect.start',
    terminalId: config.id,
    path,
    baudRate,
    dataBits,
    stopBits,
    parity,
    flowControl: config.flowControl || 'none'
  })

  return new Promise<SerialTerminal>((resolve, reject) => {
    const port = new SerialPort(
      {
        path,
        baudRate,
        dataBits,
        stopBits,
        parity,
        rtscts: flow.rtscts,
        xon: flow.xon,
        xoff: flow.xoff,
        xany: flow.xany,
        autoOpen: true
      },
      (err) => {
        if (err) {
          serialLogger.error('Failed to open serial port', {
            event: 'terminal.serial.open.error',
            terminalId: config.id,
            path,
            error: err.message
          })
          sendToRenderer(`serial:error:${config.id}`, { message: err.message })
          sendToRenderer(`serial:exit:${config.id}`, { code: -1, error: err.message })
          terminals.delete(config.id)
          reject(err)
        }
      }
    )

    const terminal: SerialTerminal = {
      id: config.id,
      port,
      isAlive: false,
      path,
      outputBuffer: createSerialOutputBuffer((chunk) => sendToRenderer(`serial:data:${config.id}`, chunk)),
      dataListeners: new Set()
    }

    port.on('open', () => {
      terminal.isAlive = true
      serialLogger.info('Serial port opened', {
        event: 'terminal.serial.open.success',
        terminalId: config.id,
        path
      })
      resolve(terminal)
    })

    port.on('data', (data: Buffer) => {
      const str = data.toString('utf-8')
      terminal.outputBuffer.push(str)
      // Debug: log raw hex for troubleshooting More prompt detection
      const hexPreview = data.toString('hex').substring(0, 200)
      serialLogger.debug('Serial raw data received', {
        event: 'terminal.serial.data.raw',
        terminalId: terminal.id,
        dataLength: str.length,
        textPreview: str.substring(0, 100),
        hexPreview
      })
      // Notify AI Agent listeners
      if (terminal.dataListeners.size > 0) {
        serialLogger.debug('Notifying serial data listeners', {
          event: 'terminal.serial.data.notify',
          terminalId: terminal.id,
          listenerCount: terminal.dataListeners.size,
          dataLength: str.length
        })
        for (const listener of terminal.dataListeners) {
          try {
            listener(str)
          } catch {}
        }
      }
    })

    port.on('error', (err: Error) => {
      serialLogger.error('Serial port error', {
        event: 'terminal.serial.error',
        terminalId: config.id,
        path,
        error: err.message
      })
      sendToRenderer(`serial:error:${config.id}`, { message: err.message })
    })

    port.on('close', () => {
      serialLogger.debug('Serial terminal closed', { event: 'terminal.serial.close', terminalId: config.id, path })
      terminal.isAlive = false
      terminal.outputBuffer.flush()
      terminal.outputBuffer.dispose()
      sendToRenderer(`serial:exit:${config.id}`, { code: 0 })
      terminals.delete(config.id)
    })

    terminals.set(config.id, terminal)
    serialLogger.info('Serial terminal created', {
      event: 'terminal.serial.connect.success',
      terminalId: config.id,
      path
    })
  })
}

const closeTerminal = (terminalId: string) => {
  const terminal = terminals.get(terminalId)
  if (terminal) {
    try {
      terminal.outputBuffer.flush()
      terminal.outputBuffer.dispose()
      if (terminal.port.isOpen) {
        terminal.port.close()
      }
      terminal.isAlive = false
      terminals.delete(terminalId)
      serialLogger.info('Serial terminal closed', { event: 'terminal.serial.disconnect.success', terminalId })
      return { success: true }
    } catch (error: unknown) {
      const e = error as Error
      serialLogger.error('Failed to close serial terminal', {
        event: 'terminal.serial.disconnect.error',
        terminalId,
        error: e.message
      })
      return { success: false, message: e.message }
    }
  }
  serialLogger.warn('Attempted to close non-existent serial terminal', {
    event: 'terminal.serial.disconnect.notfound',
    terminalId
  })
  return { success: false, message: 'Terminal not found' }
}

const getAvailablePorts = async (): Promise<any[]> => {
  try {
    const ports = await SerialPort.list()
    return ports.map((p) => ({
      path: p.path,
      manufacturer: p.manufacturer || '',
      serialNumber: p.serialNumber || '',
      pnpId: p.pnpId || '',
      locationId: p.locationId || '',
      vendorId: p.vendorId || '',
      productId: p.productId || ''
    }))
  } catch (error: unknown) {
    const e = error as Error
    serialLogger.error('Failed to list serial ports', { event: 'terminal.serial.list.error', error: e.message })
    return []
  }
}

export const createSerialTerminal = createTerminal
export const closeSerialTerminal = closeTerminal
export const getSerialTerminal = (id: string): SerialTerminal | undefined => terminals.get(id)
export const isSerialTerminalAlive = (id: string): boolean => {
  const t = terminals.get(id)
  return !!(t && t.isAlive && t.port.isOpen)
}
export const sendDataToSerialTerminal = (terminalId: string, data: string): { success: boolean; message?: string } => {
  const terminal = terminals.get(terminalId)
  if (terminal && terminal.isAlive && terminal.port.isOpen) {
    try {
      terminal.port.write(toWireData(data))
      return { success: true }
    } catch (error: unknown) {
      const e = error as Error
      return { success: false, message: e.message }
    }
  }
  return { success: false, message: 'Terminal not found or not alive' }
}

// Register a data listener for AI Agent output capture. Returns an unsubscribe function.
export const addSerialDataListener = (terminalId: string, listener: (data: string) => void): (() => void) => {
  const terminal = terminals.get(terminalId)
  if (!terminal) return () => {}
  terminal.dataListeners.add(listener)
  return () => {
    terminal.dataListeners.delete(listener)
  }
}

// Find an existing live serial terminal by COM path. Returns the terminal id or null.
export const getSerialTerminalByPath = (comPath: string): string | null => {
  for (const [id, terminal] of terminals) {
    if (terminal.path === comPath && terminal.isAlive && terminal.port.isOpen) {
      return id
    }
  }
  return null
}

export const closeSerialTerminalByPath = (comPath: string): number => {
  let closed = 0
  for (const [id, terminal] of terminals) {
    if (terminal.path === comPath) {
      try {
        if (terminal.port.isOpen) terminal.port.close()
        terminal.isAlive = false
        terminal.outputBuffer.flush()
        terminal.outputBuffer.dispose()
        terminals.delete(id)
        closed++
        serialLogger.info('Serial terminal closed by path', { event: 'terminal.serial.close.by-path', terminalId: id, path: comPath })
      } catch (e) {
        serialLogger.error('Failed to close serial terminal by path', {
          event: 'terminal.serial.close.by-path.error',
          terminalId: id,
          path: comPath,
          error: (e as Error).message
        })
      }
    }
  }
  return closed
}

export const registerSerialHandlers = () => {
  ipcMain.handle('serial:connect', async (_event, config: SerialTerminalConfig) => {
    try {
      await createTerminal(config)
      return { success: true, message: 'Serial terminal connected successfully' }
    } catch (error: unknown) {
      serialLogger.error('Serial terminal connection failed', {
        event: 'terminal.error',
        error: error instanceof Error ? error.message : String(error)
      })
      const e = error as Error
      return { success: false, message: e.message }
    }
  })

  ipcMain.handle('serial:send:data', (_event, terminalId: string, data: string) => {
    const terminal = terminals.get(terminalId)
    if (terminal && terminal.isAlive && terminal.port.isOpen) {
      try {
        terminal.port.write(toWireData(data))
        return { success: true }
      } catch (error: unknown) {
        const e = error as Error
        return { success: false, message: e.message }
      }
    }
    return { success: false, message: 'Terminal not found or not alive' }
  })

  ipcMain.handle('serial:resize', (_event, terminalId: string, _cols: number, _rows: number) => {
    // Serial connections have no pty to resize; acknowledge for API symmetry.
    const terminal = terminals.get(terminalId)
    if (terminal && terminal.isAlive) {
      return { success: true }
    }
    return { success: false, message: 'Terminal not found or not alive' }
  })

  ipcMain.handle('serial:close', (_event, terminalId: string) => {
    return closeTerminal(terminalId)
  })

  ipcMain.handle('serial:get:ports', async () => {
    return getAvailablePorts()
  })
}
