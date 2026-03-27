// @vitest-environment node
import { describe, it, expect, afterEach, vi } from 'vitest'
import net from 'net'
import { TcpLink } from '../src/main/links/TcpLink'
import { LinkType, LinkConnectionStatus } from '../src/shared-types/ipc/LinkState'

function createConfig(port: number) {
  return { type: LinkType.TCP as const, name: 'Test TCP', host: '127.0.0.1', port }
}

/** Start a TCP server on a random port, return it and its port */
function startServer(): Promise<{ server: net.Server; port: number }> {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as net.AddressInfo
      resolve({ server, port: addr.port })
    })
  })
}

describe('TcpLink', () => {
  let link: TcpLink | null = null
  let server: net.Server | null = null

  afterEach(async () => {
    link?.disconnect()
    link = null
    if (server) {
      await new Promise<void>((r) => server!.close(() => r()))
      server = null
    }
  })

  it('connects to a TCP server and reports Connected status', async () => {
    const s = await startServer()
    server = s.server

    link = new TcpLink('tcp-test', createConfig(s.port))
    expect(link.status).toBe(LinkConnectionStatus.Disconnected)
    expect(link.isConnected).toBe(false)

    await link.connect()
    expect(link.status).toBe(LinkConnectionStatus.Connected)
    expect(link.isConnected).toBe(true)
  })

  it('emits connected event on successful connection', async () => {
    const s = await startServer()
    server = s.server

    link = new TcpLink('tcp-test', createConfig(s.port))
    const connected = vi.fn()
    link.on('connected', connected)

    await link.connect()
    expect(connected).toHaveBeenCalledTimes(1)
  })

  it('receives data from server', async () => {
    const s = await startServer()
    server = s.server

    const testData = Buffer.from([0xfd, 0x09, 0x01, 0x00, 0xff])

    // When a client connects, send test data
    server.on('connection', (socket) => {
      socket.write(testData)
    })

    link = new TcpLink('tcp-test', createConfig(s.port))
    const dataReceived = new Promise<Buffer>((resolve) => {
      link!.on('data', resolve)
    })

    await link.connect()
    const buf = await dataReceived
    expect(buf).toEqual(testData)
  })

  it('sends data to server via writeBytes', async () => {
    const s = await startServer()
    server = s.server

    const testData = Buffer.from([0x01, 0x02, 0x03])
    const serverReceived = new Promise<Buffer>((resolve) => {
      server!.on('connection', (socket) => {
        socket.on('data', resolve)
      })
    })

    link = new TcpLink('tcp-test', createConfig(s.port))
    await link.connect()

    link.writeBytes(testData)
    const received = await serverReceived
    expect(received).toEqual(testData)
  })

  it('writeBytes is a no-op when disconnected', async () => {
    const s = await startServer()
    server = s.server

    link = new TcpLink('tcp-test', createConfig(s.port))
    // Not connected — should not throw
    link.writeBytes(Buffer.from([1, 2, 3]))
  })

  it('writeBytes is a no-op after disconnect', async () => {
    const s = await startServer()
    server = s.server

    link = new TcpLink('tcp-test', createConfig(s.port))
    await link.connect()
    link.disconnect()

    // Should not throw
    link.writeBytes(Buffer.from([1, 2, 3]))
  })

  it('disconnect sets status to Disconnected and emits event', async () => {
    const s = await startServer()
    server = s.server

    link = new TcpLink('tcp-test', createConfig(s.port))
    await link.connect()

    const disconnected = new Promise<void>((resolve) => {
      link!.on('disconnected', resolve)
    })

    link.disconnect()

    await disconnected
    expect(link.status).toBe(LinkConnectionStatus.Disconnected)
    expect(link.isConnected).toBe(false)
  })

  it('rejects connect promise when server is unreachable', async () => {
    // Start and immediately close a server to get a guaranteed-free port
    const tmp = await startServer()
    const freePort = (tmp.server.address() as net.AddressInfo).port
    await new Promise<void>((r) => tmp.server.close(() => r()))

    link = new TcpLink('tcp-test', createConfig(freePort))
    // Must register error listener to prevent unhandled EventEmitter error
    link.on('error', () => {})

    await expect(link.connect()).rejects.toThrow()
    expect(link.status).toBe(LinkConnectionStatus.Error)
  }, 10_000)

  it('emits error event on connection failure', async () => {
    const tmp = await startServer()
    const freePort = (tmp.server.address() as net.AddressInfo).port
    await new Promise<void>((r) => tmp.server.close(() => r()))

    link = new TcpLink('tcp-test', createConfig(freePort))
    const errorFn = vi.fn()
    link.on('error', errorFn)

    await expect(link.connect()).rejects.toThrow()
    expect(errorFn).toHaveBeenCalled()
  }, 10_000)

  it('emits disconnected when server closes connection', async () => {
    const s = await startServer()
    server = s.server

    const serverSocketPromise = new Promise<net.Socket>((resolve) => {
      server!.on('connection', resolve)
    })

    link = new TcpLink('tcp-test', createConfig(s.port))
    await link.connect()

    const serverSocket = await serverSocketPromise

    const disconnected = new Promise<void>((resolve) => {
      link!.on('disconnected', resolve)
    })

    // Server closes the connection
    serverSocket.destroy()
    await disconnected
    expect(link.status).toBe(LinkConnectionStatus.Disconnected)
  })

  it('does not reject connect promise on post-connection errors', async () => {
    const s = await startServer()
    server = s.server

    const serverSocketPromise = new Promise<net.Socket>((resolve) => {
      server!.on('connection', resolve)
    })

    link = new TcpLink('tcp-test', createConfig(s.port))
    await link.connect()

    const serverSocket = await serverSocketPromise

    const disconnected = new Promise<void>((resolve) => {
      link!.on('disconnected', resolve)
    })

    // Server closes the connection after connect resolved
    serverSocket.destroy()
    await disconnected

    // The connect promise already resolved — no unhandled rejection
    expect(link.status).toBe(LinkConnectionStatus.Disconnected)
  })

  it('sets status to Connecting during connection attempt', async () => {
    const s = await startServer()
    server = s.server

    link = new TcpLink('tcp-test', createConfig(s.port))

    // Check status synchronously after calling connect
    const connectPromise = link.connect()
    expect(link.status).toBe(LinkConnectionStatus.Connecting)

    await connectPromise
    expect(link.status).toBe(LinkConnectionStatus.Connected)
  })

  it('stores config properties correctly', () => {
    link = new TcpLink('tcp-123', createConfig(5760))
    expect(link.id).toBe('tcp-123')
    expect(link.config.type).toBe(LinkType.TCP)
  })
})
