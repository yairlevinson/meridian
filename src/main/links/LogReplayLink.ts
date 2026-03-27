import { readFileSync } from 'fs'
import { LinkInterface } from './LinkInterface'
import { LinkConnectionStatus, type LogReplayLinkConfig } from '@shared/ipc/LinkState'

// MAVLink 2 STX byte
const MAVLINK2_STX = 0xfd
const MAVLINK1_STX = 0xfe

/**
 * Replays a .mavlink binary log file.
 * Splits on MAVLink packet boundaries and emits with configurable speed.
 */
export class LogReplayLink extends LinkInterface {
  private filePath: string
  private speedMultiplier: number
  private timer: ReturnType<typeof setTimeout> | null = null
  private packets: Buffer[] = []
  private currentIndex = 0

  constructor(id: string, config: LogReplayLinkConfig) {
    super(id, config)
    this.filePath = config.filePath
    this.speedMultiplier = config.speedMultiplier
  }

  async connect(): Promise<void> {
    this.setStatus(LinkConnectionStatus.Connecting)
    const raw = readFileSync(this.filePath)
    this.packets = this._splitPackets(raw)
    this.currentIndex = 0
    this.setStatus(LinkConnectionStatus.Connected)
    this.emit('connected')
    this._scheduleNext()
  }

  disconnect(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.setStatus(LinkConnectionStatus.Disconnected)
    this.emit('disconnected')
  }

  writeBytes(/* _buf: Buffer */): void {
    // Log replay links don't send data back
  }

  get progress(): number {
    if (this.packets.length === 0) return 0
    return this.currentIndex / this.packets.length
  }

  get totalPackets(): number {
    return this.packets.length
  }

  private _scheduleNext(): void {
    if (this.currentIndex >= this.packets.length) {
      this.setStatus(LinkConnectionStatus.Disconnected)
      this.emit('disconnected')
      return
    }

    // Base interval: 1ms per packet, adjusted by speed multiplier
    const delayMs = Math.max(1, Math.round(10 / this.speedMultiplier))

    this.timer = setTimeout(() => {
      const pkt = this.packets[this.currentIndex]
      if (pkt) {
        this.emit('data', pkt)
      }
      this.currentIndex++
      this._scheduleNext()
    }, delayMs)
  }

  /** Split raw bytes into individual MAVLink packets */
  private _splitPackets(raw: Buffer): Buffer[] {
    const packets: Buffer[] = []
    let offset = 0

    while (offset < raw.length) {
      const stx = raw[offset]
      if (stx === MAVLINK2_STX) {
        // MAVLink 2: STX(1) + len(1) + incompat(1) + compat(1) + seq(1) + sysid(1) + compid(1) + msgid(3) + payload(len) + crc(2) + optional sig(13)
        if (offset + 10 > raw.length) break
        const payloadLen = raw[offset + 1]!
        const incompatFlags = raw[offset + 2]!
        const hasSignature = !!(incompatFlags & 0x01)
        const packetLen = 10 + payloadLen + 2 + (hasSignature ? 13 : 0)
        if (offset + packetLen > raw.length) break
        packets.push(raw.subarray(offset, offset + packetLen))
        offset += packetLen
      } else if (stx === MAVLINK1_STX) {
        // MAVLink 1: STX(1) + len(1) + seq(1) + sysid(1) + compid(1) + msgid(1) + payload(len) + crc(2)
        if (offset + 6 > raw.length) break
        const payloadLen = raw[offset + 1]!
        const packetLen = 6 + payloadLen + 2
        if (offset + packetLen > raw.length) break
        packets.push(raw.subarray(offset, offset + packetLen))
        offset += packetLen
      } else {
        // Skip non-MAVLink byte
        offset++
      }
    }

    return packets
  }
}
