import { EventEmitter } from 'events'
import type { LinkConfig, LinkState } from '@shared/ipc/LinkState'
import { LinkType } from '@shared/ipc/LinkState'
import { LinkInterface } from './LinkInterface'
import { UdpLink } from './UdpLink'
import { TcpLink } from './TcpLink'
import { MavlinkProtocol } from '../mavlink/MavlinkProtocol'
import type { DecodedMessage } from '../mavlink/MavlinkChannel'

export class LinkManager extends EventEmitter {
  private links = new Map<string, LinkInterface>()
  private protocol: MavlinkProtocol
  private linkCounter = 0

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

  /** Disconnect all links */
  disconnectAll(): void {
    const ids = Array.from(this.links.keys())
    for (const id of ids) {
      this.disconnectLink(id)
    }
  }
}
