import net from 'net'
import { LinkInterface } from './LinkInterface'
import { LinkConnectionStatus, type TcpLinkConfig } from '@shared/ipc/LinkState'
import { createLogger } from '../logger'

const log = createLogger('TcpLink')

const RECONNECT_DELAY_MS = 2000
const MAX_RECONNECT_DELAY_MS = 15000

export class TcpLink extends LinkInterface {
  private socket: net.Socket | null = null
  private host: string
  private port: number
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectDelay = RECONNECT_DELAY_MS
  private _autoReconnect = true
  private _destroyed = false

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
        this._scheduleReconnect()
      })

      this.socket.connect(this.port, this.host, () => {
        connected = true
        this.reconnectDelay = RECONNECT_DELAY_MS
        this.setStatus(LinkConnectionStatus.Connected)
        this.emit('connected')
        resolve()
      })
    })
  }

  disconnect(): void {
    this._destroyed = true
    this._clearReconnect()
    this.socket?.destroy()
    this.socket = null
  }

  writeBytes(buf: Buffer): void {
    if (this.socket && !this.socket.destroyed) {
      this.socket.write(buf)
    }
  }

  private _scheduleReconnect(): void {
    if (this._destroyed || !this._autoReconnect) return
    this._clearReconnect()
    log.debug('reconnect in %dms → %s:%d', this.reconnectDelay, this.host, this.port)
    this.reconnectTimer = setTimeout(() => this._reconnect(), this.reconnectDelay)
    this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, MAX_RECONNECT_DELAY_MS)
  }

  private _reconnect(): void {
    if (this._destroyed) return
    this.socket?.removeAllListeners()
    this.socket?.destroy()
    this.socket = null

    this.setStatus(LinkConnectionStatus.Connecting)
    const sock = new net.Socket()
    this.socket = sock

    sock.on('data', (buf) => this.emit('data', buf))

    sock.on('error', () => {
      this.setStatus(LinkConnectionStatus.Error)
      sock.destroy()
      this._scheduleReconnect()
    })

    sock.on('close', () => {
      this.setStatus(LinkConnectionStatus.Disconnected)
      this.emit('disconnected')
      this._scheduleReconnect()
    })

    sock.connect(this.port, this.host, () => {
      log.log('reconnected → %s:%d', this.host, this.port)
      this.reconnectDelay = RECONNECT_DELAY_MS
      this.setStatus(LinkConnectionStatus.Connected)
      this.emit('connected')
    })
  }

  private _clearReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }
}
