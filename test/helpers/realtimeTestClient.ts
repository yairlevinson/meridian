import { WebSocket } from 'ws'

type MessagePredicate = (message: Record<string, unknown>) => boolean

interface PendingWaiter {
  predicate: MessagePredicate
  resolve: (message: Record<string, unknown>) => void
  reject: (err: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

export class RealtimeTestClient {
  readonly messages: Record<string, unknown>[] = []
  private waiters: PendingWaiter[] = []

  private constructor(private ws: WebSocket) {
    ws.on('message', (data) => {
      const message = JSON.parse(data.toString()) as Record<string, unknown>
      this.messages.push(message)
      this.resolveWaiters(message)
    })
  }

  static async connect(
    port: number,
    options: { token?: string; origin?: string } = {}
  ): Promise<RealtimeTestClient> {
    const url = new URL(`ws://127.0.0.1:${port}/realtime`)
    if (options.token) url.searchParams.set('token', options.token)
    const ws = new WebSocket(url, {
      headers: options.origin ? { Origin: options.origin } : undefined
    })
    await new Promise<void>((resolve) => ws.once('open', resolve))
    return new RealtimeTestClient(ws)
  }

  subscribe(topics: string[]): void {
    this.ws.send(JSON.stringify({ type: 'subscribe', topics }))
  }

  async command(
    id: string,
    module: string,
    command: string,
    args: unknown[] = []
  ): Promise<Record<string, unknown>> {
    const reply = this.waitFor((message) => message['id'] === id)
    this.ws.send(JSON.stringify({ id, type: 'command', module, command, args }))
    return reply
  }

  waitFor(predicate: MessagePredicate, timeoutMs = 1000): Promise<Record<string, unknown>> {
    const existing = this.messages.find(predicate)
    if (existing) return Promise.resolve(existing)

    return new Promise((resolve, reject) => {
      const waiter: PendingWaiter = {
        predicate,
        resolve,
        reject,
        timeout: setTimeout(() => {
          this.waiters = this.waiters.filter((item) => item !== waiter)
          reject(new Error('Timed out waiting for realtime message'))
        }, timeoutMs)
      }
      this.waiters.push(waiter)
    })
  }

  close(): void {
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timeout)
      waiter.reject(new Error('Realtime test client closed'))
    }
    this.waiters = []
    this.ws.close()
  }

  private resolveWaiters(message: Record<string, unknown>): void {
    for (const waiter of [...this.waiters]) {
      if (!waiter.predicate(message)) continue
      clearTimeout(waiter.timeout)
      this.waiters = this.waiters.filter((item) => item !== waiter)
      waiter.resolve(message)
    }
  }
}
