/**
 * Tlog replay utility for integration tests.
 *
 * Parses .tlog files (captured from PX4/ArduPilot SITL) and feeds the raw
 * MAVLink bytes into a Vehicle instance, simulating a real connection.
 *
 * Tlog format: repeated [8-byte uint64LE timestamp_usec][MAVLink v1/v2 frame]
 *
 * Usage:
 *   const vehicle = new Vehicle(1)
 *   const channel = new MavlinkChannel(0)
 *   const replay = TlogReplay.fromFile('test/fixtures/captures/arm-takeoff-land.tlog')
 *   await replay.replayAll(channel, vehicle)
 *   expect(vehicle.state.getSnapshot().core.armed).toBe(false) // landed & disarmed
 */

import { readFileSync } from 'fs'
import { MavlinkChannel } from '../main/mavlink/MavlinkChannel'
import { Vehicle } from '../main/vehicle/Vehicle'

export interface TlogEntry {
  /** Timestamp in microseconds since epoch */
  timestampUs: bigint
  /** Raw MAVLink frame bytes */
  frame: Buffer
}

/**
 * Parse a tlog buffer into entries.
 *
 * MAVLink v2 frame structure: 0xFD [len] [...] — total length = 12 + len + 2 (crc) [+ 13 signature]
 * MAVLink v1 frame structure: 0xFE [len] [...] — total length = 8 + len
 */
export function parseTlog(buf: Buffer): TlogEntry[] {
  const entries: TlogEntry[] = []
  let offset = 0

  while (offset < buf.length) {
    // Need at least 8 bytes for timestamp + 1 byte for magic
    if (offset + 9 > buf.length) break

    const timestampUs = buf.readBigUInt64LE(offset)
    offset += 8

    const magic = buf[offset]
    let frameLen: number

    if (magic === 0xfd) {
      // MAVLink v2: FD [len] [incompat] [compat] [seq] [sysid] [compid] [msgid0] [msgid1] [msgid2] [payload...] [crc0] [crc1]
      // Total: 10 header + len payload + 2 crc = 12 + len
      if (offset + 2 > buf.length) break
      const payloadLen = buf[offset + 1]!
      const incompatFlags = buf[offset + 2]!
      frameLen = 12 + payloadLen
      // If signing bit set (0x01), add 13 bytes for signature
      if (incompatFlags & 0x01) {
        frameLen += 13
      }
    } else if (magic === 0xfe) {
      // MAVLink v1: FE [len] [seq] [sysid] [compid] [msgid] [payload...] [crc0] [crc1]
      // Total: 6 header + len payload + 2 crc = 8 + len
      if (offset + 2 > buf.length) break
      const payloadLen = buf[offset + 1]!
      frameLen = 8 + payloadLen
    } else {
      // Unknown magic — skip byte and try to resync
      offset++
      continue
    }

    if (offset + frameLen > buf.length) break

    entries.push({
      timestampUs,
      frame: buf.subarray(offset, offset + frameLen)
    })
    offset += frameLen
  }

  return entries
}

export class TlogReplay {
  readonly entries: TlogEntry[]

  constructor(entries: TlogEntry[]) {
    this.entries = entries
  }

  static fromFile(path: string): TlogReplay {
    const buf = readFileSync(path)
    return new TlogReplay(parseTlog(buf))
  }

  static fromBuffer(buf: Buffer): TlogReplay {
    return new TlogReplay(parseTlog(buf))
  }

  /** Number of MAVLink messages in the capture */
  get messageCount(): number {
    return this.entries.length
  }

  /** Duration of the capture in seconds */
  get durationSec(): number {
    if (this.entries.length < 2) return 0
    const first = this.entries[0]!.timestampUs
    const last = this.entries[this.entries.length - 1]!.timestampUs
    return Number(last - first) / 1e6
  }

  /**
   * Replay all captured messages through a MavlinkChannel into a Vehicle.
   * Messages are fed synchronously (no timing delay) for fast test execution.
   * Returns after all messages have been processed by the channel's async pipeline.
   */
  async replayAll(
    channel: MavlinkChannel,
    vehicle: Vehicle,
    options?: { linkId?: string; filterSysid?: number }
  ): Promise<void> {
    const linkId = options?.linkId ?? 'replay-link'
    const filterSysid = options?.filterSysid

    // Wire channel output to vehicle
    channel.onMessage((msg) => {
      if (filterSysid !== undefined && msg.sysid !== filterSysid) return
      vehicle.handleMessage(msg, linkId)
    })

    // Feed all frames
    for (const entry of this.entries) {
      channel.write(entry.frame)
    }

    // The node-mavlink pipeline is stream-based and async.
    // Give it time to process all buffered data.
    await new Promise((resolve) => setTimeout(resolve, 500))
  }

  /**
   * Replay messages and collect state snapshots at regular intervals.
   * Useful for asserting state transitions over time.
   */
  async replayWithSnapshots(
    channel: MavlinkChannel,
    vehicle: Vehicle,
    intervalMs: number = 1000
  ): Promise<{ timestampUs: bigint; snapshot: ReturnType<typeof vehicle.state.getSnapshot> }[]> {
    const linkId = 'replay-link'
    const snapshots: {
      timestampUs: bigint
      snapshot: ReturnType<typeof vehicle.state.getSnapshot>
    }[] = []

    channel.onMessage((msg) => {
      vehicle.handleMessage(msg, linkId)
    })

    if (this.entries.length === 0) return snapshots

    const startUs = this.entries[0]!.timestampUs
    let nextSnapshotUs = startUs + BigInt(intervalMs * 1000)

    for (const entry of this.entries) {
      channel.write(entry.frame)

      if (entry.timestampUs >= nextSnapshotUs) {
        // Allow pipeline to process
        await new Promise((resolve) => setTimeout(resolve, 50))
        snapshots.push({
          timestampUs: entry.timestampUs,
          snapshot: vehicle.state.getSnapshot()
        })
        nextSnapshotUs = entry.timestampUs + BigInt(intervalMs * 1000)
      }
    }

    // Final snapshot
    await new Promise((resolve) => setTimeout(resolve, 500))
    snapshots.push({
      timestampUs: this.entries[this.entries.length - 1]!.timestampUs,
      snapshot: vehicle.state.getSnapshot()
    })

    return snapshots
  }
}
