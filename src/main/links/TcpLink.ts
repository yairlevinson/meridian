import net from 'net'
import { LinkInterface } from './LinkInterface'
import { LinkConnectionStatus, type TcpLinkConfig } from '@shared/ipc/LinkState'

export class TcpLink extends LinkInterface {
  private socket: net.Socket | null = null
  private host: string
  private port: number

  constructor(id: string, config: TcpLinkConfig) {
    super(id, config)
    this.host = config.host
    this.port = config.port
  }

  async connect(): Promise<void> {
    this.setStatus(LinkConnectionStatus.Connecting)
    return new Promise((resolve, reject) => {
      this.socket = new net.Socket()
      let connected = false

      this.socket.on('data', (buf) => this.emit('data', buf))

      this.socket.on('error', (err) => {
        this.setStatus(LinkConnectionStatus.Error)
        this.emit('error', err)
        this.socket?.destroy()
        if (!connected) reject(err)
      })

      this.socket.on('close', () => {
        this.setStatus(LinkConnectionStatus.Disconnected)
        this.emit('disconnected')
      })

      this.socket.connect(this.port, this.host, () => {
        connected = true
        this.setStatus(LinkConnectionStatus.Connected)
        this.emit('connected')
        resolve()
      })
    })
  }

  disconnect(): void {
    this.socket?.destroy()
    this.socket = null
  }

  writeBytes(buf: Buffer): void {
    if (this.socket && !this.socket.destroyed) {
      this.socket.write(buf)
    }
  }
}
