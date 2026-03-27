import dgram from 'dgram'
import { EventEmitter } from 'events'

export class UdpLink extends EventEmitter {
  private socket = dgram.createSocket('udp4')
  /** All known senders, keyed by "address:port" */
  private remoteSenders = new Map<string, { address: string; port: number }>()

  constructor(private readonly listenPort: number) {
    super()
    this.socket.on('message', (msg, rinfo) => {
      const key = `${rinfo.address}:${rinfo.port}`
      if (!this.remoteSenders.has(key)) {
        console.log(`[UdpLink] discovered vehicle at ${key}`)
        this.remoteSenders.set(key, { address: rinfo.address, port: rinfo.port })
      }
      this.emit('data', msg)
    })
    this.socket.on('error', (err) => {
      console.error('[UdpLink] socket error:', err.message)
      this.emit('error', err)
    })
  }

  bind(): Promise<void> {
    return new Promise((resolve) => this.socket.bind(this.listenPort, resolve))
  }

  /** Send to all known senders (each vehicle gets the command, filters by targetSystem) */
  send(buf: Buffer): void {
    for (const { address, port } of this.remoteSenders.values()) {
      this.socket.send(buf, port, address)
    }
  }

  close(): void {
    try {
      this.socket.close()
    } catch {
      // Socket may already be closed
    }
  }

  /** Allow the process to exit even if the socket is still open. */
  unref(): void {
    this.socket.unref()
  }
}
