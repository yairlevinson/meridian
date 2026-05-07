import { WebSocket, WebSocketServer } from 'ws'
import type { Server as HttpServer, IncomingMessage } from 'http'
import type { Duplex } from 'stream'
import type { IpcModuleSpec } from '@shared/ipc/ipcModule'
import {
  parseRpcClientMessage,
  rpcEventTopic,
  type RpcClientMessage,
  type RpcModuleImpl,
  type RpcServerMessage
} from '@shared/rpc'

interface RpcClient {
  ws: WebSocket
  subscriptions: Set<string>
}

export class RpcRealtimeServer {
  private wss = new WebSocketServer({ noServer: true })
  private clients = new Set<RpcClient>()
  private modules = new Map<string, RpcModuleImpl<IpcModuleSpec>>()

  constructor() {
    this.wss.on('connection', (ws) => {
      const client: RpcClient = { ws, subscriptions: new Set() }
      this.clients.add(client)

      ws.on('message', (data) => {
        void this.handleMessage(client, data.toString())
      })

      ws.on('close', () => {
        this.clients.delete(client)
      })

      ws.on('error', () => {
        this.clients.delete(client)
      })
    })
  }

  registerModule<M extends IpcModuleSpec>(module: M, impl: RpcModuleImpl<M>): void {
    this.modules.set(module.name, impl as RpcModuleImpl<IpcModuleSpec>)
  }

  attach(server: HttpServer, path = '/realtime'): () => void {
    const onUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer): void => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      if (url.pathname !== path) return
      this.wss.handleUpgrade(request, socket, head, (ws) => {
        this.wss.emit('connection', ws, request)
      })
    }

    server.on('upgrade', onUpgrade)
    return () => {
      server.off('upgrade', onUpgrade)
    }
  }

  emitEvent(moduleName: string, eventKey: string, payload: unknown): void {
    const topic = rpcEventTopic(moduleName, eventKey)
    const msg: RpcServerMessage = { type: 'event', topic, payload }
    this.broadcast(topic, msg)
  }

  close(): Promise<void> {
    for (const client of this.clients) {
      client.ws.close()
    }
    this.clients.clear()
    return new Promise((resolve, reject) => {
      this.wss.close((err) => {
        if (err) reject(err)
        else resolve()
      })
    })
  }

  private async handleMessage(client: RpcClient, raw: string): Promise<void> {
    let msg: RpcClientMessage
    try {
      msg = parseRpcClientMessage(raw)
    } catch (err) {
      this.send(client.ws, {
        id: 'unknown',
        type: 'reply',
        ok: false,
        error: err instanceof Error ? err.message : String(err)
      })
      return
    }

    if (msg.type === 'subscribe') {
      for (const topic of msg.topics) client.subscriptions.add(topic)
      return
    }

    if (msg.type === 'unsubscribe') {
      for (const topic of msg.topics) client.subscriptions.delete(topic)
      return
    }

    const moduleImpl = this.modules.get(msg.module)
    const command = moduleImpl?.commands[msg.command]
    if (!command) {
      this.send(client.ws, {
        id: msg.id,
        type: 'reply',
        ok: false,
        error: `Unknown RPC command: ${msg.module}:${msg.command}`
      })
      return
    }

    try {
      const result = await command(...(msg.args as never[]))
      this.send(client.ws, { id: msg.id, type: 'reply', ok: true, result })
    } catch (err) {
      this.send(client.ws, {
        id: msg.id,
        type: 'reply',
        ok: false,
        error: err instanceof Error ? err.message : String(err)
      })
    }
  }

  private broadcast(topic: string, msg: RpcServerMessage): void {
    for (const client of this.clients) {
      if (!client.subscriptions.has(topic)) continue
      this.send(client.ws, msg)
    }
  }

  private send(ws: WebSocket, msg: RpcServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg))
    }
  }
}
