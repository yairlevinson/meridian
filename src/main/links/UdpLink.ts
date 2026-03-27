import dgram from 'dgram'
import { LinkInterface } from './LinkInterface'
import { LinkConnectionStatus, type UdpLinkConfig } from '@shared/ipc/LinkState'

/**
 * UDP link transport.
 * Auto-discovers first sender as target (standard MAVLink UDP auto-discovery).
 */
export class UdpLink extends LinkInterface {
  private socket = dgram.createSocket('udp4')
  private remoteAddress: { address: string; port: number } | null = null
  private listenPort: number

  constructor(id: string, config: UdpLinkConfig) {
    super(id, config)
    this.listenPort = config.listenPort

    this.socket.on('message', (msg, rinfo) => {
      if (!this.remoteAddress) {
        this.remoteAddress = { address: rinfo.address, port: rinfo.port }
      }
      this.emit('data', msg)
    })

    this.socket.on('error', (err) => {
      this.setStatus(LinkConnectionStatus.Error)
      this.emit('error', err)
    })
  }

  async connect(): Promise<void> {
    this.setStatus(LinkConnectionStatus.Connecting)
    return new Promise((resolve) => {
      this.socket.bind(this.listenPort, () => {
        this.setStatus(LinkConnectionStatus.Connected)
        this.emit('connected')
        resolve()
      })
    })
  }

  disconnect(): void {
    try {
      this.socket.close()
    } catch {
      // already closed
    }
    this.setStatus(LinkConnectionStatus.Disconnected)
    this.emit('disconnected')
  }

  writeBytes(buf: Buffer): void {
    if (this.remoteAddress) {
      this.socket.send(buf, this.remoteAddress.port, this.remoteAddress.address)
    }
  }

  unref(): void {
    this.socket.unref()
  }
}
