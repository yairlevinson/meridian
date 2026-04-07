import dgram from 'dgram'
import { LinkInterface } from './LinkInterface'
import { LinkConnectionStatus, type UdpLinkConfig } from '@shared/ipc/LinkState'
import { createLogger } from '../logger'

const log = createLogger('UdpLink')

/**
 * UDP link transport.
 * Auto-discovers senders as targets (standard MAVLink UDP auto-discovery).
 * Supports multi-sender broadcast and explicit sendTo for SITL probing.
 */
export class UdpLink extends LinkInterface {
  private socket = dgram.createSocket('udp4')
  /** All known senders, keyed by "address:port" */
  private remoteSenders = new Map<string, { address: string; port: number }>()
  private listenPort: number

  constructor(id: string, config: UdpLinkConfig) {
    super(id, config)
    this.listenPort = config.listenPort

    this.socket.on('message', (msg, rinfo) => {
      const key = `${rinfo.address}:${rinfo.port}`
      if (!this.remoteSenders.has(key)) {
        log.log(`discovered sender at ${key}`)
        this.remoteSenders.set(key, { address: rinfo.address, port: rinfo.port })
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

  /** Send to all known senders (each vehicle gets the packet). */
  writeBytes(buf: Buffer): void {
    for (const { address, port } of this.remoteSenders.values()) {
      this.socket.send(buf, port, address)
    }
  }

  /** Send to a specific address:port (used for initial connection probes like PX4 SITL). */
  sendTo(buf: Buffer, port: number, address: string): void {
    this.socket.send(buf, port, address)
  }

  unref(): void {
    this.socket.unref()
  }
}
