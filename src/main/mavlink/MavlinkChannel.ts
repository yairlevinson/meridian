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

  /** Per-sysid+compid sequence tracking for loss detection */
  private lastSeq = new Map<string, number>()
  private onMessageCb: ((msg: DecodedMessage) => void) | null = null

  constructor(id: number) {
    this.id = id

    this.reader.on('data', (packet: MavLinkPacket) => {
      this.stats.totalReceived++
      this._trackLoss(packet.header.sysid, packet.header.compid, packet.header.seq)

      const messageClass = REGISTRY[packet.header.msgid] as
        | MavLinkDataConstructor<MavLinkData>
        | undefined
      if (!messageClass) return

      try {
        const data = packet.protocol.data(packet.payload, messageClass)
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
    })

    this.splitter.on('error', () => {
      /* swallow framing errors */
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
