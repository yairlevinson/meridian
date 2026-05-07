// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { defineIpcModule, command, event } from '../src/shared-types/ipc/ipcModule'
import { bindRpcModule, createBrowserRpcBridge } from '../src/renderer/src/transport/rpcBridge'
import { RpcTransport } from '../src/renderer/src/transport/RpcTransport'
import {
  installBrowserRpcBridge,
  realtimeUrlFromServerUrl,
  videoWebSocketUrlFromServerUrl
} from '../src/renderer/src/transport/installBrowserBridge'
import { RpcRealtimeServer } from '../src/server/realtime/RpcRealtimeServer'
import { VideoSourceType } from '../src/shared-types/ipc/VideoTypes'
import { createServer } from 'http'
import { WebSocket, WebSocketServer } from 'ws'

const fakeModule = defineIpcModule({
  name: 'fake',
  commands: {
    getValue: command<[id: number], string>()
  },
  events: {
    changed: event<{ id: number }>()
  }
})

describe('browser RPC bridge binding', () => {
  it('generates command methods using existing bridge naming', async () => {
    const transport = {
      command: vi.fn(async () => 'ok'),
      on: vi.fn()
    }
    const bridge = bindRpcModule(fakeModule, transport as any)

    await expect(bridge.fakeGetValue(42)).resolves.toBe('ok')
    expect(transport.command).toHaveBeenCalledWith('fake', 'getValue', [42])
  })

  it('generates event methods using existing bridge naming', () => {
    const dispose = vi.fn()
    const transport = {
      command: vi.fn(),
      on: vi.fn(() => dispose)
    }
    const bridge = bindRpcModule(fakeModule, transport as any)
    const handler = vi.fn()

    expect(bridge.onFakeChanged(handler)).toBe(dispose)
    expect(transport.on).toHaveBeenCalledWith('fake:changed', handler)
  })

  it('includes the renderer log compatibility method', () => {
    const transport = {
      command: vi.fn(),
      on: vi.fn()
    }
    const bridge = bindRpcModule(fakeModule, transport as any)
    expect('log' in bridge).toBe(false)

    const fullBridge = createBrowserRpcBridge(transport as any)
    expect(() => fullBridge.log('info', 'Test', 'hello')).not.toThrow()
  })

  it('handles popout commands locally in browser mode', async () => {
    const transport = {
      command: vi.fn(),
      on: vi.fn()
    }
    const popup = {
      closed: false,
      focus: vi.fn(),
      close: vi.fn(() => {
        popup.closed = true
      })
    }
    const open = vi.fn(() => popup)
    vi.stubGlobal('window', {
      location: { href: 'http://127.0.0.1:8080/?view=fly' },
      open,
      setInterval: vi.fn(() => 1),
      clearInterval: vi.fn()
    })

    const bridge = createBrowserRpcBridge(transport as any)
    const closed = vi.fn()
    bridge.onPopoutClosed(closed)

    await bridge.popoutOpen('video')
    await bridge.popoutOpen('video')
    await bridge.popoutClose('video')

    expect(transport.command).not.toHaveBeenCalledWith(
      'popout',
      expect.anything(),
      expect.anything()
    )
    expect(open).toHaveBeenCalledTimes(1)
    expect(open.mock.calls[0]?.[0]).toBe('http://127.0.0.1:8080/?view=fly&popout=video')
    expect(popup.focus).toHaveBeenCalledTimes(1)
    expect(popup.close).toHaveBeenCalledTimes(1)
    expect(closed).toHaveBeenCalledWith({ view: 'video' })

    vi.unstubAllGlobals()
  })

  it('decorates video state with the browser server websocket URL', async () => {
    const videoState = {
      sourceType: VideoSourceType.RTSP,
      uri: 'rtsp://camera.local/live',
      streaming: true,
      recording: false,
      wsPort: 49321,
      error: null,
      pipeline: 'ffmpeg' as const
    }
    let videoStateHandler: ((state: typeof videoState) => void) | null = null
    const transport = {
      command: vi.fn(async (moduleName: string, commandName: string) => {
        if (moduleName === 'video' && commandName === 'getState') return videoState
        return null
      }),
      on: vi.fn((topic: string, cb: (state: typeof videoState) => void) => {
        if (topic === 'video:stateChanged') videoStateHandler = cb
        return vi.fn()
      })
    }

    const bridge = createBrowserRpcBridge(transport as any, {
      videoWsUrl: 'ws://server.local:8080/video/live'
    })

    await expect(bridge.videoGetState()).resolves.toMatchObject({
      wsPort: 49321,
      wsUrl: 'ws://server.local:8080/video/live'
    })

    const eventHandler = vi.fn()
    bridge.onVideoStateChanged(eventHandler)
    videoStateHandler?.(videoState)

    expect(eventHandler).toHaveBeenCalledWith({
      ...videoState,
      wsUrl: 'ws://server.local:8080/video/live'
    })
  })
})

describe('browser RPC store resync', () => {
  it('refreshes video state when the browser RPC connection returns', async () => {
    vi.resetModules()
    const target = new EventTarget()
    const firstState = {
      sourceType: VideoSourceType.Disabled,
      uri: '',
      streaming: false,
      recording: false,
      wsPort: null,
      error: null,
      pipeline: 'ffmpeg' as const
    }
    const reconnectedState = {
      ...firstState,
      sourceType: VideoSourceType.RTSP,
      uri: 'rtsp://camera.local/live',
      streaming: true
    }
    const videoGetState = vi.fn()
    videoGetState.mockResolvedValueOnce(firstState).mockResolvedValueOnce(reconnectedState)
    vi.stubGlobal('window', {
      bridge: {
        onVideoStateChanged: vi.fn(),
        videoGetState
      },
      addEventListener: target.addEventListener.bind(target),
      removeEventListener: target.removeEventListener.bind(target),
      dispatchEvent: target.dispatchEvent.bind(target)
    })

    const { useVideoStore } = await import('../src/renderer/src/store/videoStore')
    const { MERIDIAN_RPC_CONNECTED_EVENT } =
      await import('../src/renderer/src/transport/browserRpcEvents')

    await expect.poll(() => useVideoStore.getState().streamState).toEqual(firstState)

    target.dispatchEvent(new Event(MERIDIAN_RPC_CONNECTED_EVENT))

    await expect.poll(() => useVideoStore.getState().streamState).toEqual(reconnectedState)
    expect(videoGetState).toHaveBeenCalledTimes(2)
    vi.unstubAllGlobals()
  })
})

describe('browser RPC bridge installer', () => {
  it('builds realtime URLs from server URLs', () => {
    expect(realtimeUrlFromServerUrl('http://localhost:8080')).toBe('ws://localhost:8080/realtime')
    expect(realtimeUrlFromServerUrl('https://meridian.local/app', 'rt')).toBe(
      'wss://meridian.local/rt'
    )
    expect(realtimeUrlFromServerUrl('ws://127.0.0.1:8080/realtime')).toBe(
      'ws://127.0.0.1:8080/realtime'
    )
  })

  it('builds video websocket URLs from server URLs', () => {
    expect(videoWebSocketUrlFromServerUrl('http://localhost:8080')).toBe(
      'ws://localhost:8080/video/live'
    )
    expect(videoWebSocketUrlFromServerUrl('https://meridian.local/app', 'video')).toBe(
      'wss://meridian.local/video'
    )
    expect(videoWebSocketUrlFromServerUrl('ws://127.0.0.1:8080/realtime')).toBe(
      'ws://127.0.0.1:8080/video/live'
    )
  })

  it('installs window.bridge without replacing an existing bridge by default', () => {
    const existing = { log: vi.fn() }
    vi.stubGlobal('window', {
      bridge: existing,
      location: { origin: 'http://127.0.0.1:8080' }
    })

    const result = installBrowserRpcBridge({
      WebSocketCtor: WebSocket as unknown as typeof globalThis.WebSocket
    })

    expect(result.bridge).toBe(existing)
    expect(result.transport).toBeNull()
    vi.unstubAllGlobals()
  })
})

async function startRealtimeFixture(): Promise<{
  url: string
  port: number
  realtime: RpcRealtimeServer
  close: () => Promise<void>
}>
async function startRealtimeFixture(port?: number): Promise<{
  url: string
  port: number
  realtime: RpcRealtimeServer
  close: () => Promise<void>
}> {
  const server = createServer()
  const realtime = new RpcRealtimeServer()
  const disposeRealtime = realtime.attach(server)
  await new Promise<void>((resolve) => server.listen(port ?? 0, '127.0.0.1', resolve))
  const address = server.address()
  const boundPort = typeof address === 'object' && address ? address.port : 0
  return {
    url: `ws://127.0.0.1:${boundPort}/realtime`,
    port: boundPort,
    realtime,
    close: async () => {
      disposeRealtime()
      await realtime.close()
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()))
      })
    }
  }
}

describe('browser RPC bridge transport integration', () => {
  it('calls commands through the realtime server', async () => {
    const fixture = await startRealtimeFixture()
    fixture.realtime.registerModule(fakeModule, {
      commands: {
        getValue: async (id) => `value:${id}`
      }
    })
    const transport = new RpcTransport({
      url: fixture.url,
      WebSocketCtor: WebSocket as unknown as typeof globalThis.WebSocket
    })
    const bridge = bindRpcModule(fakeModule, transport)

    await expect(bridge.fakeGetValue(7)).resolves.toBe('value:7')

    transport.close()
    await fixture.close()
  })

  it('receives subscribed events through the realtime server', async () => {
    const fixture = await startRealtimeFixture()
    const transport = new RpcTransport({
      url: fixture.url,
      WebSocketCtor: WebSocket as unknown as typeof globalThis.WebSocket
    })
    const bridge = bindRpcModule(fakeModule, transport)

    const received = new Promise((resolve) => {
      bridge.onFakeChanged(resolve)
    })
    await new Promise<void>((resolve) => setTimeout(resolve, 25))
    fixture.realtime.emitEvent('fake', 'changed', { id: 99 })

    await expect(received).resolves.toEqual({ id: 99 })

    transport.close()
    await fixture.close()
  })

  it('ignores malformed server frames and keeps handling later events', async () => {
    const server = createServer()
    const wss = new WebSocketServer({ noServer: true })
    server.on('upgrade', (request, socket, head) => {
      if (request.url !== '/realtime') return
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request)
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0

    wss.once('connection', (ws) => {
      ws.once('message', () => {
        ws.send('not-json')
        ws.send(
          JSON.stringify({
            type: 'event',
            topic: 'fake:changed',
            payload: { id: 5 }
          })
        )
      })
    })

    const transport = new RpcTransport({
      url: `ws://127.0.0.1:${port}/realtime`,
      WebSocketCtor: WebSocket as unknown as typeof globalThis.WebSocket
    })
    const bridge = bindRpcModule(fakeModule, transport)
    const received = new Promise((resolve) => {
      bridge.onFakeChanged(resolve)
    })

    await expect(received).resolves.toEqual({ id: 5 })

    transport.close()
    await new Promise<void>((resolve) => wss.close(() => resolve()))
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()))
    })
  })

  it('publishes connection status transitions', async () => {
    const fixture = await startRealtimeFixture()
    fixture.realtime.registerModule(fakeModule, {
      commands: {
        getValue: async (id) => `value:${id}`
      }
    })
    const transport = new RpcTransport({
      url: fixture.url,
      WebSocketCtor: WebSocket as unknown as typeof globalThis.WebSocket
    })
    const statuses: string[] = []
    transport.onStatusChange((status) => statuses.push(status))

    await transport.command('fake', 'getValue', [1])

    expect(statuses).toEqual(expect.arrayContaining(['disconnected', 'connecting', 'connected']))
    transport.close()
    expect(statuses).toContain('closed')
    await fixture.close()
  })

  it('reconnects and resubscribes event-only clients', async () => {
    const fixture = await startRealtimeFixture()
    const transport = new RpcTransport({
      url: fixture.url,
      reconnectInitialDelayMs: 10,
      reconnectMaxDelayMs: 25,
      WebSocketCtor: WebSocket as unknown as typeof globalThis.WebSocket
    })
    const statuses: string[] = []
    transport.onStatusChange((status) => statuses.push(status))
    const bridge = bindRpcModule(fakeModule, transport)

    let resolveSecondEvent: ((payload: unknown) => void) | null = null
    const firstEvent = new Promise((resolve) => {
      bridge.onFakeChanged((payload) => {
        if ((payload as { id: number }).id === 1) resolve(payload)
        if ((payload as { id: number }).id === 2) resolveSecondEvent?.(payload)
      })
    })
    const secondEvent = new Promise((resolve) => {
      resolveSecondEvent = resolve
    })
    await new Promise<void>((resolve) => setTimeout(resolve, 25))
    fixture.realtime.emitEvent('fake', 'changed', { id: 1 })
    await expect(firstEvent).resolves.toEqual({ id: 1 })

    await fixture.close()
    await expect.poll(() => statuses.includes('reconnecting'), { timeout: 1000 }).toBe(true)
    const restarted = await startRealtimeFixture(fixture.port)
    const interval = setInterval(() => {
      restarted.realtime.emitEvent('fake', 'changed', { id: 2 })
    }, 25)

    await expect(
      Promise.race([
        secondEvent,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Timed out waiting for event after reconnect')), 1000)
        )
      ])
    ).resolves.toEqual({ id: 2 })
    clearInterval(interval)

    transport.close()
    await restarted.close()
  })
})
