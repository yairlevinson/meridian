import type { RpcClientMessage, RpcEventMessage, RpcServerMessage } from '@shared/rpc'

export interface RpcTransportOptions {
  url: string
  requestTimeoutMs?: number
  reconnectInitialDelayMs?: number
  reconnectMaxDelayMs?: number
  WebSocketCtor?: typeof WebSocket
}

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
  timer: ReturnType<typeof setTimeout>
}

type EventHandler = (payload: unknown) => void
export type RpcTransportStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'closed'

type StatusHandler = (status: RpcTransportStatus) => void

let nextRequestId = 0

export class RpcTransport {
  private readonly url: string
  private readonly requestTimeoutMs: number
  private readonly reconnectInitialDelayMs: number
  private readonly reconnectMaxDelayMs: number
  private readonly WebSocketCtor: typeof WebSocket
  private socket: WebSocket | null = null
  private connectPromise: Promise<void> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectDelayMs: number
  private closed = false
  private pending = new Map<string, PendingRequest>()
  private eventHandlers = new Map<string, Set<EventHandler>>()
  private subscribedTopics = new Set<string>()
  private status: RpcTransportStatus = 'disconnected'
  private statusHandlers = new Set<StatusHandler>()

  constructor(options: RpcTransportOptions) {
    this.url = options.url
    this.requestTimeoutMs = options.requestTimeoutMs ?? 10_000
    this.reconnectInitialDelayMs = options.reconnectInitialDelayMs ?? 500
    this.reconnectMaxDelayMs = options.reconnectMaxDelayMs ?? 5_000
    this.reconnectDelayMs = this.reconnectInitialDelayMs
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
      try {
        this.send(message)
      } catch (err) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    })
  }

  getStatus(): RpcTransportStatus {
    return this.status
  }

  onStatusChange(handler: StatusHandler): () => void {
    this.statusHandlers.add(handler)
    handler(this.status)
    return () => {
      this.statusHandlers.delete(handler)
    }
  }

  on(topic: string, handler: EventHandler): () => void {
    this.closed = false
    let handlers = this.eventHandlers.get(topic)
    const shouldSubscribe = !handlers || handlers.size === 0
    if (!handlers) {
      handlers = new Set<EventHandler>()
      this.eventHandlers.set(topic, handlers)
    }
    handlers.add(handler)

    if (shouldSubscribe) {
      this.subscribedTopics.add(topic)
      void this.connect()
        .then(() => this.send({ type: 'subscribe', topics: [topic] }))
        .catch(() => this.scheduleReconnect())
    }

    return () => {
      const current = this.eventHandlers.get(topic)
      if (!current) return
      current.delete(handler)
      if (current.size > 0) return

      this.eventHandlers.delete(topic)
      this.subscribedTopics.delete(topic)
      if (this.subscribedTopics.size === 0) this.clearReconnectTimer()
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.send({ type: 'unsubscribe', topics: [topic] })
      }
    }
  }

  close(): void {
    this.closed = true
    this.clearReconnectTimer()
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.reject(new Error(`RPC transport closed with pending request: ${id}`))
    }
    this.pending.clear()
    this.socket?.close()
    this.socket = null
    this.connectPromise = null
    this.setStatus('closed')
  }

  private connect(): Promise<void> {
    this.closed = false
    if (this.socket?.readyState === WebSocket.OPEN) return Promise.resolve()
    if (this.connectPromise) return this.connectPromise
    this.setStatus(this.status === 'reconnecting' ? 'reconnecting' : 'connecting')

    this.connectPromise = new Promise((resolve, reject) => {
      const socket = new this.WebSocketCtor(this.url)
      let settled = false
      this.socket = socket

      socket.onopen = () => {
        settled = true
        this.reconnectDelayMs = this.reconnectInitialDelayMs
        this.setStatus('connected')
        for (const topic of this.subscribedTopics) {
          this.send({ type: 'subscribe', topics: [topic] })
        }
        resolve()
      }

      socket.onmessage = (event) => this.handleMessage(event.data)

      socket.onerror = () => {
        if (!settled) {
          settled = true
          this.setStatus('disconnected')
          reject(new Error(`RPC WebSocket error: ${this.url}`))
        }
      }

      socket.onclose = () => {
        const wasConnecting = this.connectPromise !== null && !settled
        this.socket = null
        this.connectPromise = null
        if (wasConnecting) {
          settled = true
          this.setStatus('disconnected')
          reject(new Error(`RPC WebSocket closed before connecting: ${this.url}`))
        }
        for (const [id, pending] of this.pending) {
          clearTimeout(pending.timer)
          pending.reject(new Error(`RPC transport disconnected with pending request: ${id}`))
        }
        this.pending.clear()
        if (!this.scheduleReconnect()) this.setStatus(this.closed ? 'closed' : 'disconnected')
      }
    })

    return this.connectPromise
  }

  private scheduleReconnect(): boolean {
    if (this.closed || this.reconnectTimer || this.subscribedTopics.size === 0) return false

    const delayMs = this.reconnectDelayMs
    this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, this.reconnectMaxDelayMs)
    this.setStatus('reconnecting')
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      void this.connect().catch(() => this.scheduleReconnect())
    }, delayMs)
    return true
  }

  private clearReconnectTimer(): void {
    if (!this.reconnectTimer) return
    clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
  }

  private handleMessage(raw: unknown): void {
    if (typeof raw !== 'string') return
    let message: RpcServerMessage
    try {
      message = JSON.parse(raw) as RpcServerMessage
    } catch {
      return
    }

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

  private setStatus(status: RpcTransportStatus): void {
    if (this.status === status) return
    this.status = status
    for (const handler of this.statusHandlers) handler(status)
  }
}
