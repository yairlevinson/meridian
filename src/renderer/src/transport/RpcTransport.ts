import type { RpcClientMessage, RpcEventMessage, RpcServerMessage } from '@shared/rpc'

export interface RpcTransportOptions {
  url: string
  requestTimeoutMs?: number
  WebSocketCtor?: typeof WebSocket
}

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
  timer: ReturnType<typeof setTimeout>
}

type EventHandler = (payload: unknown) => void

let nextRequestId = 0

export class RpcTransport {
  private readonly url: string
  private readonly requestTimeoutMs: number
  private readonly WebSocketCtor: typeof WebSocket
  private socket: WebSocket | null = null
  private connectPromise: Promise<void> | null = null
  private pending = new Map<string, PendingRequest>()
  private eventHandlers = new Map<string, Set<EventHandler>>()
  private subscribedTopics = new Set<string>()

  constructor(options: RpcTransportOptions) {
    this.url = options.url
    this.requestTimeoutMs = options.requestTimeoutMs ?? 10_000
    this.WebSocketCtor = options.WebSocketCtor ?? WebSocket
  }

  async command(moduleName: string, commandName: string, args: unknown[]): Promise<unknown> {
    const id = `rpc-${++nextRequestId}`
    const message: RpcClientMessage = {
      id,
      type: 'command',
      module: moduleName,
      command: commandName,
      args
    }

    await this.connect()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`RPC command timed out: ${moduleName}:${commandName}`))
      }, this.requestTimeoutMs)

      this.pending.set(id, { resolve, reject, timer })
      this.send(message)
    })
  }

  on(topic: string, handler: EventHandler): () => void {
    let handlers = this.eventHandlers.get(topic)
    const shouldSubscribe = !handlers || handlers.size === 0
    if (!handlers) {
      handlers = new Set<EventHandler>()
      this.eventHandlers.set(topic, handlers)
    }
    handlers.add(handler)

    if (shouldSubscribe) {
      this.subscribedTopics.add(topic)
      void this.connect().then(() => this.send({ type: 'subscribe', topics: [topic] }))
    }

    return () => {
      const current = this.eventHandlers.get(topic)
      if (!current) return
      current.delete(handler)
      if (current.size > 0) return

      this.eventHandlers.delete(topic)
      this.subscribedTopics.delete(topic)
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.send({ type: 'unsubscribe', topics: [topic] })
      }
    }
  }

  close(): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.reject(new Error(`RPC transport closed with pending request: ${id}`))
    }
    this.pending.clear()
    this.socket?.close()
    this.socket = null
    this.connectPromise = null
  }

  private connect(): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) return Promise.resolve()
    if (this.connectPromise) return this.connectPromise

    this.connectPromise = new Promise((resolve, reject) => {
      const socket = new this.WebSocketCtor(this.url)
      this.socket = socket

      socket.onopen = () => {
        for (const topic of this.subscribedTopics) {
          this.send({ type: 'subscribe', topics: [topic] })
        }
        resolve()
      }

      socket.onmessage = (event) => this.handleMessage(event.data)

      socket.onerror = () => {
        reject(new Error(`RPC WebSocket error: ${this.url}`))
      }

      socket.onclose = () => {
        this.socket = null
        this.connectPromise = null
        for (const [id, pending] of this.pending) {
          clearTimeout(pending.timer)
          pending.reject(new Error(`RPC transport disconnected with pending request: ${id}`))
        }
        this.pending.clear()
      }
    })

    return this.connectPromise
  }

  private handleMessage(raw: unknown): void {
    if (typeof raw !== 'string') return
    const message = JSON.parse(raw) as RpcServerMessage

    if (message.type === 'reply') {
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      clearTimeout(pending.timer)
      if (message.ok) pending.resolve(message.result)
      else pending.reject(new Error(message.error))
      return
    }

    this.dispatchEvent(message)
  }

  private dispatchEvent(message: RpcEventMessage): void {
    const handlers = this.eventHandlers.get(message.topic)
    if (!handlers) return
    for (const handler of handlers) handler(message.payload)
  }

  private send(message: RpcClientMessage): void {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      throw new Error('RPC transport is not connected')
    }
    this.socket.send(JSON.stringify(message))
  }
}
