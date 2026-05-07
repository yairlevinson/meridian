// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { defineIpcModule, command, event } from '../src/shared-types/ipc/ipcModule'
import { parseRpcClientMessage, rpcEventTopic } from '../src/shared-types/rpc'
import { RpcRealtimeServer } from '../src/server/realtime/RpcRealtimeServer'
import { createServer } from 'http'
import { WebSocket } from 'ws'

const fakeModule = defineIpcModule({
  name: 'fake',
  commands: {
    echo: command<[value: string], string>(),
    fail: command<[], void>()
  },
  events: {
    changed: event<{ value: string }>()
  }
})

function readMessage(ws: WebSocket): Promise<unknown> {
  return new Promise((resolve) => {
    ws.once('message', (data) => {
      resolve(JSON.parse(data.toString()))
    })
  })
}

async function startRealtimeFixture(): Promise<{
  url: string
  realtime: RpcRealtimeServer
  close: () => Promise<void>
}> {
  const server = createServer()
  const realtime = new RpcRealtimeServer()
  const disposeRealtime = realtime.attach(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  return {
    url: `ws://127.0.0.1:${port}/realtime`,
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

describe('RPC protocol helpers', () => {
  it('parses command messages', () => {
    expect(
      parseRpcClientMessage(
        JSON.stringify({ id: '1', type: 'command', module: 'fake', command: 'echo', args: ['hi'] })
      )
    ).toEqual({ id: '1', type: 'command', module: 'fake', command: 'echo', args: ['hi'] })
  })

  it('rejects malformed messages', () => {
    expect(() => parseRpcClientMessage(JSON.stringify({ type: 'command' }))).toThrow('missing id')
  })

  it('builds event topics with the existing module namespace style', () => {
    expect(rpcEventTopic('vehicle', 'delta')).toBe('vehicle:delta')
  })
})

describe('RpcRealtimeServer', () => {
  it('handles command replies', async () => {
    const fixture = await startRealtimeFixture()
    fixture.realtime.registerModule(fakeModule, {
      commands: {
        echo: async (value) => `echo:${value}`,
        fail: async () => {}
      }
    })

    const ws = new WebSocket(fixture.url)
    await new Promise<void>((resolve) => ws.once('open', resolve))
    const next = readMessage(ws)
    ws.send(
      JSON.stringify({ id: 'cmd-1', type: 'command', module: 'fake', command: 'echo', args: ['x'] })
    )

    expect(await next).toEqual({ id: 'cmd-1', type: 'reply', ok: true, result: 'echo:x' })
    ws.close()
    await fixture.close()
  })

  it('returns structured command errors', async () => {
    const fixture = await startRealtimeFixture()
    const ws = new WebSocket(fixture.url)
    await new Promise<void>((resolve) => ws.once('open', resolve))
    const next = readMessage(ws)
    ws.send(
      JSON.stringify({ id: 'cmd-2', type: 'command', module: 'missing', command: 'nope', args: [] })
    )

    expect(await next).toEqual({
      id: 'cmd-2',
      type: 'reply',
      ok: false,
      error: 'Unknown RPC command: missing:nope'
    })
    ws.close()
    await fixture.close()
  })

  it('fans out subscribed events only', async () => {
    const fixture = await startRealtimeFixture()
    const subscribed = new WebSocket(fixture.url)
    const unsubscribed = new WebSocket(fixture.url)
    await Promise.all([
      new Promise<void>((resolve) => subscribed.once('open', resolve)),
      new Promise<void>((resolve) => unsubscribed.once('open', resolve))
    ])
    let unsubscribedReceived = false
    unsubscribed.once('message', () => {
      unsubscribedReceived = true
    })

    subscribed.send(JSON.stringify({ type: 'subscribe', topics: ['fake:changed'] }))
    await new Promise<void>((resolve) => setTimeout(resolve, 25))
    const next = readMessage(subscribed)
    fixture.realtime.emitEvent('fake', 'changed', { value: 'new' })

    expect(await next).toEqual({
      type: 'event',
      topic: 'fake:changed',
      payload: { value: 'new' }
    })
    await new Promise<void>((resolve) => setTimeout(resolve, 10))
    expect(unsubscribedReceived).toBe(false)

    subscribed.close()
    unsubscribed.close()
    await fixture.close()
  })
})
