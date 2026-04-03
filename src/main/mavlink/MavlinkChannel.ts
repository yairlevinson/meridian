import { PassThrough } from 'stream'
import {
  MavLinkPacketSplitter,
  MavLinkPacketParser,
  MavLinkPacket,
  type MavLinkData,
  type MavLinkDataConstructor
} from 'node-mavlink'
import { ChannelStats } from './stats/ChannelStats'
import { REGISTRY } from './registry'
import { mavLog } from './trafficLog'

export { REGISTRY }

export interface DecodedMessage {
  msgid: number
  sysid: number
  compid: number
  seq: number
  data: unknown
}

/**
 * A single MAVLink channel wrapping node-mavlink's parser pipeline.
 * Each channel tracks its own sequence counters and loss statistics.
 */
export class MavlinkChannel {
  readonly id: number
  readonly stats = new ChannelStats()

  private passthrough = new PassThrough()
  private splitter = new MavLinkPacketSplitter()
  private parser = new MavLinkPacketParser()
  private reader = this.passthrough.pipe(this.splitter).pipe(this.parser)

  /** CRC extra bytes for messages not in mavlink-mappings (e.g. development dialect) */
  private static readonly EXTRA_CRC_MAGIC: Record<number, number> = {
    397: 182, // COMPONENT_METADATA
  }

  /** Per-sysid+compid sequence tracking for loss detection */
  private lastSeq = new Map<string, number>()
  private onMessageCb: ((msg: DecodedMessage) => void) | null = null

  constructor(id: number) {
    this.id = id

    // Register CRC magic for messages missing from mavlink-mappings
    const magicNumbers = (this.splitter as unknown as { magicNumbers: Record<number, number> })
      .magicNumbers
    for (const [msgid, magic] of Object.entries(MavlinkChannel.EXTRA_CRC_MAGIC)) {
      magicNumbers[Number(msgid)] = magic
    }

    this.reader.on('data', (packet: MavLinkPacket) => {
      this.stats.totalReceived++
      this._trackLoss(packet.header.sysid, packet.header.compid, packet.header.seq)

      const messageClass = REGISTRY[packet.header.msgid] as
        | MavLinkDataConstructor<MavLinkData>
        | undefined

      if (messageClass) {
        try {
          const data = packet.protocol.data(packet.payload, messageClass)
          mavLog.rx(packet.header.msgid, packet.header.sysid, packet.header.compid, data)
          this.onMessageCb?.({
            msgid: packet.header.msgid,
            sysid: packet.header.sysid,
            compid: packet.header.compid,
            seq: packet.header.seq,
            data
          })
        } catch {
          // Decode failure — skip
        }
      } else {
        // Unknown message — pass raw payload buffer so handlers can decode manually
        mavLog.rx(packet.header.msgid, packet.header.sysid, packet.header.compid, null)
        this.onMessageCb?.({
          msgid: packet.header.msgid,
          sysid: packet.header.sysid,
          compid: packet.header.compid,
          seq: packet.header.seq,
          data: { _rawPayload: packet.payload }
        })
      }
    })

    this.splitter.on('error', (err: Error) => {
      mavLog.warn('MavLink', `splitter error ch${id}: ${err.message}`)
    })
    this.parser.on('error', () => {
      /* swallow parse errors */
    })
  }

  /** Set the callback for decoded messages */
  onMessage(cb: (msg: DecodedMessage) => void): void {
    this.onMessageCb = cb
  }

  /** Feed raw bytes into the pipeline */
  write(data: Buffer): void {
    this.passthrough.write(data)
  }

  /** Destroy the pipeline */
  destroy(): void {
    this.passthrough.destroy()
  }

  private _trackLoss(sysid: number, compid: number, seq: number): void {
    const key = `${sysid}:${compid}`
    const last = this.lastSeq.get(key)
    if (last !== undefined) {
      // MAVLink sequence wraps at 255
      const expected = (last + 1) & 0xff
      if (seq !== expected) {
        // Count dropped packets (handle wrap-around)
        let lost: number
        if (seq > expected) {
          lost = seq - expected
        } else {
          lost = 256 - expected + seq
        }
        this.stats.totalLoss += lost
      }
    }
    this.lastSeq.set(key, seq)
  }
}
