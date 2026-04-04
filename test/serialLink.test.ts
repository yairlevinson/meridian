// @vitest-environment node
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { EventEmitter } from 'events'
import { LinkType, LinkConnectionStatus } from '../src/shared-types/ipc/LinkState'

// --- Mock serialport ---
let mockPort: EventEmitter & {
  isOpen: boolean
  close: ReturnType<typeof vi.fn>
  write: ReturnType<typeof vi.fn>
  set: ReturnType<typeof vi.fn>
  open: ReturnType<typeof vi.fn>
}
let mockListResult: Array<{ path: string }> = []

function createMockPort() {
  const port = new EventEmitter() as typeof mockPort
  port.isOpen = false
  port.close = vi.fn(() => {
    port.isOpen = false
    port.emit('close')
  })
  port.write = vi.fn()
  port.set = vi.fn((_opts: unknown, cb?: () => void) => cb?.())
  port.open = vi.fn((cb: (err?: Error) => void) => {
    // Simulate async open success by default
    setTimeout(() => {
      port.isOpen = true
      cb()
    }, 0)
  })
  return port
}

vi.mock('serialport', () => {
  const MockSerialPort = vi.fn(function () {
    return mockPort
  })
  return { SerialPort: MockSerialPort }
})

// Import after mock
import { SerialLink } from '../src/main/links/SerialLink'
import { SerialPort } from 'serialport'

const MockedSerialPort = vi.mocked(SerialPort)

function createConfig(portName = '/dev/ttyUSB0', baudRate = 115200) {
  return {
    type: LinkType.Serial as const,
    name: 'Test Serial',
    portName,
    baudRate
  }
}

describe('SerialLink', () => {
  let link: SerialLink | null = null

  beforeEach(() => {
    mockPort = createMockPort()
    mockListResult = [{ path: '/dev/ttyUSB0' }]
    // @ts-expect-error -- mocking static method
    MockedSerialPort.list = vi.fn(async () => mockListResult)
    vi.clearAllMocks()
  })

  afterEach(() => {
    link?.disconnect()
    link = null
    vi.restoreAllMocks()
  })

  it('connects and reports Connected status', async () => {
    link = new SerialLink('serial-1', createConfig())
    expect(link.status).toBe(LinkConnectionStatus.Disconnected)
    expect(link.isConnected).toBe(false)

    await link.connect()
    expect(link.status).toBe(LinkConnectionStatus.Connected)
    expect(link.isConnected).toBe(true)
  })

  it('emits connected event on successful open', async () => {
    link = new SerialLink('serial-1', createConfig())
    const connected = vi.fn()
    link.on('connected', connected)

    await link.connect()
    expect(connected).toHaveBeenCalledTimes(1)
  })

  it('sets status to Connecting during connection attempt', async () => {
    link = new SerialLink('serial-1', createConfig())

    const connectPromise = link.connect()
    expect(link.status).toBe(LinkConnectionStatus.Connecting)

    await connectPromise
    expect(link.status).toBe(LinkConnectionStatus.Connected)
  })

  it('emits data event when port receives data', async () => {
    link = new SerialLink('serial-1', createConfig())
    await link.connect()

    const testData = Buffer.from([0xfd, 0x09, 0x01])
    const dataReceived = new Promise<Buffer>((resolve) => {
      link!.on('data', resolve)
    })

    mockPort.emit('data', testData)
    const buf = await dataReceived
    expect(buf).toEqual(testData)
  })

  it('writeBytes sends data to port when connected', async () => {
    link = new SerialLink('serial-1', createConfig())
    await link.connect()

    const testData = Buffer.from([0x01, 0x02, 0x03])
    link.writeBytes(testData)
    expect(mockPort.write).toHaveBeenCalledWith(testData)
  })

  it('writeBytes is a no-op when disconnected', () => {
    link = new SerialLink('serial-1', createConfig())
    // Not connected — should not throw
    link.writeBytes(Buffer.from([1, 2, 3]))
  })

  it('writeBytes is a no-op after disconnect', async () => {
    link = new SerialLink('serial-1', createConfig())
    await link.connect()
    link.disconnect()

    // Should not throw
    link.writeBytes(Buffer.from([1, 2, 3]))
  })

  it('disconnect sets status to Disconnected and emits event', async () => {
    link = new SerialLink('serial-1', createConfig())
    await link.connect()

    const disconnected = new Promise<void>((resolve) => {
      link!.on('disconnected', resolve)
    })

    link.disconnect()
    await disconnected
    expect(link.status).toBe(LinkConnectionStatus.Disconnected)
    expect(link.isConnected).toBe(false)
  })

  it('rejects connect promise on open error', async () => {
    mockPort.open = vi.fn((cb: (err?: Error) => void) => {
      setTimeout(() => cb(new Error('Permission denied')), 0)
    })

    link = new SerialLink('serial-1', createConfig())
    link.on('error', () => {}) // prevent unhandled error

    await expect(link.connect()).rejects.toThrow('Permission denied')
    expect(link.status).toBe(LinkConnectionStatus.Error)
  })

  it('emits error event on open failure', async () => {
    mockPort.open = vi.fn((cb: (err?: Error) => void) => {
      setTimeout(() => cb(new Error('Device busy')), 0)
    })

    link = new SerialLink('serial-1', createConfig())
    const errorFn = vi.fn()
    link.on('error', errorFn)

    await expect(link.connect()).rejects.toThrow()
    expect(errorFn).toHaveBeenCalled()
  })

  it('error deduplication — only emits error once', async () => {
    link = new SerialLink('serial-1', createConfig())
    await link.connect()

    const errorFn = vi.fn()
    link.on('error', errorFn)

    // Simulate error followed by another error
    mockPort.emit('error', new Error('first'))
    mockPort.emit('error', new Error('second'))

    expect(errorFn).toHaveBeenCalledTimes(1)
  })

  it('applies config defaults (8N1, no flow control)', async () => {
    link = new SerialLink('serial-1', createConfig())
    await link.connect()

    expect(MockedSerialPort).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/dev/ttyUSB0',
        baudRate: 115200,
        dataBits: 8,
        stopBits: 1,
        parity: 'none',
        rtscts: false,
        autoOpen: false
      })
    )
  })

  it('applies custom config values', async () => {
    link = new SerialLink('serial-1', {
      type: LinkType.Serial,
      name: 'Custom',
      portName: '/dev/ttyS0',
      baudRate: 57600,
      dataBits: 7,
      stopBits: 2,
      parity: 'even',
      flowControl: true
    })
    await link.connect()

    expect(MockedSerialPort).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/dev/ttyS0',
        baudRate: 57600,
        dataBits: 7,
        stopBits: 2,
        parity: 'even',
        rtscts: true
      })
    )
  })

  it('stores config properties correctly', () => {
    link = new SerialLink('serial-42', createConfig())
    expect(link.id).toBe('serial-42')
    expect(link.config.type).toBe(LinkType.Serial)
  })

  it('sets DTR high after open', async () => {
    link = new SerialLink('serial-1', createConfig())
    await link.connect()

    expect(mockPort.set).toHaveBeenCalledWith({ dtr: true }, expect.any(Function))
  })

  it('availability check disconnects on port removal', async () => {
    vi.useFakeTimers()
    try {
      link = new SerialLink('serial-1', createConfig())
      // Need to advance timers past the setTimeout(0) in open mock
      const connectPromise = link.connect()
      await vi.advanceTimersByTimeAsync(1)
      await connectPromise

      const disconnected = new Promise<void>((resolve) => {
        link!.on('disconnected', resolve)
      })

      // Simulate port disappearing
      mockListResult = []
      await vi.advanceTimersByTimeAsync(1100)

      await disconnected
      expect(link.status).toBe(LinkConnectionStatus.Disconnected)
    } finally {
      vi.useRealTimers()
    }
  })

  it('disconnect is safe to call multiple times', async () => {
    link = new SerialLink('serial-1', createConfig())
    await link.connect()

    // After first disconnect, port is nulled — second call is a no-op
    link.disconnect()
    link.disconnect()
    expect(link.status).toBe(LinkConnectionStatus.Disconnected)
  })
})
