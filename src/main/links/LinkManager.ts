import { EventEmitter } from 'events'
import { SerialPort } from 'serialport'
import type { LinkConfig, LinkState } from '@shared/ipc/LinkState'
import { LinkType } from '@shared/ipc/LinkState'
import { LinkInterface } from './LinkInterface'
import { UdpLink } from './UdpLink'
import { TcpLink } from './TcpLink'
import { SerialLink } from './SerialLink'
import { MavlinkProtocol } from '../mavlink/MavlinkProtocol'
import type { DecodedMessage } from '../mavlink/MavlinkChannel'

/** Known autopilot USB vendor IDs (decimal) — from QGC's USBBoardInfo.json */
const AUTOPILOT_VENDOR_IDS = new Set([
  9900, // 3DR / PX4
  12677, // ARK Electronics
  7052, // NXP (PX4 FMU V6U)
  13891, // ZeroOne / PX4 FMU V6X-RT
  8137, // NXP FMUK66 / Tropic
  1155, // STMicro (ArduPilot ChibiOS, ModalAI)
  4617, // ArduPilot
  12642, // Holybro
  11694, // CubePilot
  2702, // JFB
  13735, // ThePeach
  4104, // UVify
  12643, // CUAV
  2106, // Accton
  8355, // Svehicle
  16325 // VOLOLAND
])

const SERIAL_POLL_MS = 1000

export class LinkManager extends EventEmitter {
  private links = new Map<string, LinkInterface>()
  private protocol: MavlinkProtocol
  private linkCounter = 0
  private autoConnectTimer: ReturnType<typeof setInterval> | null = null
  /** Ports we already auto-connected (path → link id) */
  private autoConnectedPorts = new Map<string, string>()
  /** Skip port on first detection (let bootloader finish, matching QGC) */
  private waitList = new Set<string>()

  constructor(protocol: MavlinkProtocol) {
    super()
    this.protocol = protocol
  }

  /** Create and connect a new link */
  async createLink(config: LinkConfig): Promise<LinkInterface> {
    const id = `link-${++this.linkCounter}`
    let link: LinkInterface

    switch (config.type) {
      case LinkType.UDP:
        link = new UdpLink(id, config)
        break
      case LinkType.TCP:
        link = new TcpLink(id, config)
        break
      case LinkType.Serial:
        link = new SerialLink(id, config)
        break
      default:
        throw new Error(`Unsupported link type: ${config.type}`)
    }

    // Allocate MAVLink channel
    const channel = this.protocol.allocateChannel((msg: DecodedMessage) => {
      this.emit('message', msg, link)
    })
    link.mavlinkChannel = channel.id

    // Pipe link data into channel
    link.on('data', (buf: Buffer) => {
      channel.write(buf)
    })

    link.on('disconnected', () => {
      this.emit('linkStateChanged', link)
    })

    this.links.set(id, link)
    await link.connect()
    this.emit('linkStateChanged', link)

    return link
  }

  /** Disconnect and remove a link */
  disconnectLink(id: string): void {
    const link = this.links.get(id)
    if (!link) return
    link.disconnect()
    if (link.mavlinkChannel >= 0) {
      this.protocol.freeChannel(link.mavlinkChannel)
    }
    this.links.delete(id)
  }

  /** Get the state of all links */
  getAllStates(): LinkState[] {
    return Array.from(this.links.values()).map((link) => {
      const channel = this.protocol.getChannel(link.mavlinkChannel)
      return {
        id: link.id,
        config: link.config,
        status: link.status,
        mavlinkChannel: link.mavlinkChannel,
        vehicleIds: [],
        totalReceived: channel?.stats.totalReceived ?? 0,
        totalLoss: channel?.stats.totalLoss ?? 0,
        lossPercent: channel?.stats.lossPercent ?? 0
      }
    })
  }

  /** Get link by id */
  getLink(id: string): LinkInterface | undefined {
    return this.links.get(id)
  }

  /** Start polling for USB autopilot boards and auto-connecting */
  startAutoConnect(): void {
    if (this.autoConnectTimer) return
    this.autoConnectTimer = setInterval(() => this._pollSerial(), SERIAL_POLL_MS)
    // Run immediately on start
    this._pollSerial()
  }

  /** Stop auto-connect polling */
  stopAutoConnect(): void {
    if (this.autoConnectTimer) {
      clearInterval(this.autoConnectTimer)
      this.autoConnectTimer = null
    }
  }

  private async _pollSerial(): Promise<void> {
    try {
      const ports = await SerialPort.list()
      const currentPaths = new Set<string>()

      for (const port of ports) {
        const vid = parseInt(port.vendorId ?? '', 16)
        if (!vid || !AUTOPILOT_VENDOR_IDS.has(vid)) continue

        currentPaths.add(port.path)

        if (this.autoConnectedPorts.has(port.path)) continue

        // Wait one cycle before connecting (bootloader may still be running)
        if (!this.waitList.has(port.path)) {
          this.waitList.add(port.path)
          console.log(`[LinkManager] Detected autopilot on ${port.path} (${port.manufacturer ?? 'unknown'}), waiting...`)
          continue
        }
        this.waitList.delete(port.path)

        const name = `${port.manufacturer ?? 'Autopilot'} on ${port.path}`
        console.log(`[LinkManager] Auto-connecting: ${name}`)
        try {
          const link = await this.createLink({
            type: LinkType.Serial,
            name,
            portName: port.path,
            baudRate: 115200
          })
          this.autoConnectedPorts.set(port.path, link.id)
        } catch (err) {
          console.warn(`[LinkManager] Auto-connect failed for ${port.path}:`, err)
        }
      }

      // Clean up disappeared ports from wait list
      for (const path of this.waitList) {
        if (!currentPaths.has(path)) this.waitList.delete(path)
      }

      // Disconnect ports that disappeared
      for (const [path, linkId] of this.autoConnectedPorts) {
        if (!currentPaths.has(path)) {
          console.log(`[LinkManager] Autopilot disconnected: ${path}`)
          this.disconnectLink(linkId)
          this.autoConnectedPorts.delete(path)
        }
      }
    } catch {
      // ignore enumeration errors
    }
  }

  /** Disconnect all links */
  disconnectAll(): void {
    this.stopAutoConnect()
    const ids = Array.from(this.links.keys())
    for (const id of ids) {
      this.disconnectLink(id)
    }
  }
}
