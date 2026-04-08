import { describe, it, expect, beforeEach } from 'vitest'
import { Av1RtpDepayloader } from '../src/main/video/Av1RtpDepayloader'

/**
 * Build a minimal RTP packet.
 *
 * RTP header (12 bytes):
 *   [0]: V=2, P=0, X=extension, CC=csrcCount
 *   [1]: M=marker, PT=96
 *   [2-3]: sequence number (big-endian)
 *   [4-7]: timestamp (big-endian)
 *   [8-11]: SSRC = 0x12345678
 *   + CSRC list (4 bytes each)
 *   + extension header if present
 *   + payload
 */
function buildRtp(opts: {
  seq: number
  timestamp: number
  marker?: boolean
  payload: Buffer
  csrcCount?: number
  extension?: Buffer // extension data (without the 4-byte ext header)
}): Buffer {
  const cc = opts.csrcCount ?? 0
  const hasExt = opts.extension !== undefined
  const extWords = opts.extension ? Math.ceil(opts.extension.length / 4) : 0
  const extPadded = extWords * 4
  const headerLen = 12 + cc * 4 + (hasExt ? 4 + extPadded : 0)
  const buf = Buffer.alloc(headerLen + opts.payload.length)

  // Byte 0: V=2, P=0, X=hasExt, CC
  buf[0] = 0x80 | (hasExt ? 0x10 : 0) | (cc & 0x0f)
  // Byte 1: M=marker, PT=96
  buf[1] = (opts.marker ? 0x80 : 0) | 96
  buf.writeUInt16BE(opts.seq, 2)
  buf.writeUInt32BE(opts.timestamp, 4)
  buf.writeUInt32BE(0x12345678, 8) // SSRC

  let offset = 12
  // CSRC (just zeros)
  offset += cc * 4

  // Extension header
  if (hasExt && opts.extension) {
    buf.writeUInt16BE(0xbede, offset) // extension profile
    buf.writeUInt16BE(extWords, offset + 2)
    opts.extension.copy(buf, offset + 4)
    offset += 4 + extPadded
  }

  opts.payload.copy(buf, offset)
  return buf
}

/**
 * Build an AV1 RTP aggregation header byte.
 *
 * Bits: Z(1) Y(1) W(2) N(1) reserved(3)
 */
function aggHeader(opts: { z?: boolean; y?: boolean; w?: number; n?: boolean }): number {
  return (
    ((opts.z ? 1 : 0) << 7) |
    ((opts.y ? 1 : 0) << 6) |
    (((opts.w ?? 0) & 0x03) << 4) |
    ((opts.n ? 1 : 0) << 3)
  )
}

/** Encode a number as LEB128. */
function leb128(value: number): Buffer {
  const bytes: number[] = []
  do {
    let b = value & 0x7f
    value >>>= 7
    if (value > 0) b |= 0x80
    bytes.push(b)
  } while (value > 0)
  return Buffer.from(bytes)
}

describe('Av1RtpDepayloader', () => {
  let depay: Av1RtpDepayloader

  beforeEach(() => {
    depay = new Av1RtpDepayloader()
  })

  describe('RTP header parsing', () => {
    it('rejects packets shorter than 12 bytes', () => {
      const result = depay.push(Buffer.alloc(10))
      expect(result).toEqual([])
    })

    it('rejects non-version-2 packets', () => {
      const pkt = buildRtp({
        seq: 0,
        timestamp: 1000,
        marker: true,
        payload: Buffer.from([0x08, 0xaa])
      })
      pkt[0] = 0x00 // version 0
      expect(depay.push(pkt)).toEqual([])
    })

    it('handles CSRC fields', () => {
      const obu = Buffer.from([0xde, 0xad])
      // W=1 means single OBU element, no length prefix needed
      const payload = Buffer.from([aggHeader({ w: 1, n: true }), ...obu])
      const pkt = buildRtp({ seq: 0, timestamp: 1000, marker: true, payload, csrcCount: 2 })
      const aus = depay.push(pkt)
      expect(aus).toHaveLength(1)
      expect(aus[0]!.obus).toEqual([obu])
    })

    it('handles RTP header extensions', () => {
      const obu = Buffer.from([0xca, 0xfe])
      const payload = Buffer.from([aggHeader({ w: 1, n: true }), ...obu])
      const ext = Buffer.from([0x01, 0x02, 0x03, 0x04])
      const pkt = buildRtp({ seq: 0, timestamp: 1000, marker: true, payload, extension: ext })
      const aus = depay.push(pkt)
      expect(aus).toHaveLength(1)
      expect(aus[0]!.obus).toEqual([obu])
    })
  })

  describe('single OBU per packet (W=1)', () => {
    it('emits an access unit on marker bit', () => {
      const obu = Buffer.from([0x01, 0x02, 0x03])
      const payload = Buffer.from([aggHeader({ w: 1, n: true }), ...obu])
      const pkt = buildRtp({ seq: 0, timestamp: 9000, marker: true, payload })

      const aus = depay.push(pkt)
      expect(aus).toHaveLength(1)
      expect(aus[0]!.timestamp90k).toBe(9000)
      expect(aus[0]!.key).toBe(true)
      expect(aus[0]!.obus).toEqual([obu])
    })

    it('accumulates OBUs across packets until marker', () => {
      const obu1 = Buffer.from([0xaa])
      const obu2 = Buffer.from([0xbb])
      const p1 = buildRtp({
        seq: 0,
        timestamp: 9000,
        marker: false,
        payload: Buffer.from([aggHeader({ w: 1 }), ...obu1])
      })
      const p2 = buildRtp({
        seq: 1,
        timestamp: 9000,
        marker: true,
        payload: Buffer.from([aggHeader({ w: 1 }), ...obu2])
      })

      expect(depay.push(p1)).toEqual([])
      const aus = depay.push(p2)
      expect(aus).toHaveLength(1)
      expect(aus[0]!.obus).toEqual([obu1, obu2])
    })
  })

  describe('multiple OBUs per packet (W=0, LEB128 lengths)', () => {
    it('parses two OBUs with LEB128 sizes', () => {
      const obu1 = Buffer.from([0x11, 0x22])
      const obu2 = Buffer.from([0x33, 0x44, 0x55])
      const body = Buffer.concat([leb128(obu1.length), obu1, leb128(obu2.length), obu2])
      const payload = Buffer.concat([Buffer.from([aggHeader({ w: 0, n: true })]), body])
      const pkt = buildRtp({ seq: 0, timestamp: 1000, marker: true, payload })

      const aus = depay.push(pkt)
      expect(aus).toHaveLength(1)
      expect(aus[0]!.obus).toEqual([obu1, obu2])
      expect(aus[0]!.key).toBe(true)
    })

    it('handles LEB128 multi-byte lengths', () => {
      // 200 bytes = 0xC8 → LEB128: [0xC8, 0x01]
      const obu = Buffer.alloc(200, 0x42)
      const body = Buffer.concat([leb128(200), obu])
      const payload = Buffer.concat([Buffer.from([aggHeader({ w: 0 })]), body])
      const pkt = buildRtp({ seq: 0, timestamp: 2000, marker: true, payload })

      const aus = depay.push(pkt)
      expect(aus).toHaveLength(1)
      expect(aus[0]!.obus[0]!.length).toBe(200)
    })
  })

  describe('W field variants', () => {
    it('W=2: one explicit length + one implicit last element', () => {
      const obu1 = Buffer.from([0xaa, 0xbb])
      const obu2 = Buffer.from([0xcc, 0xdd, 0xee])
      // W=2 means 1 explicit length (W-1=1), last element is implicit (rest of data)
      const body = Buffer.concat([leb128(obu1.length), obu1, obu2])
      const payload = Buffer.concat([Buffer.from([aggHeader({ w: 2 })]), body])
      const pkt = buildRtp({ seq: 0, timestamp: 3000, marker: true, payload })

      const aus = depay.push(pkt)
      expect(aus).toHaveLength(1)
      expect(aus[0]!.obus).toEqual([obu1, obu2])
    })

    it('W=3: two explicit lengths + one implicit', () => {
      const obu1 = Buffer.from([0x01])
      const obu2 = Buffer.from([0x02])
      const obu3 = Buffer.from([0x03])
      const body = Buffer.concat([leb128(obu1.length), obu1, leb128(obu2.length), obu2, obu3])
      const payload = Buffer.concat([Buffer.from([aggHeader({ w: 3 })]), body])
      const pkt = buildRtp({ seq: 0, timestamp: 4000, marker: true, payload })

      const aus = depay.push(pkt)
      expect(aus).toHaveLength(1)
      expect(aus[0]!.obus).toEqual([obu1, obu2, obu3])
    })
  })

  describe('OBU fragmentation (Z/Y bits)', () => {
    it('reassembles a fragmented OBU across two packets', () => {
      const part1 = Buffer.from([0xaa, 0xbb])
      const part2 = Buffer.from([0xcc, 0xdd])

      // Packet 1: Y=1 (last element is a fragment start), W=1
      const p1 = buildRtp({
        seq: 0,
        timestamp: 5000,
        marker: false,
        payload: Buffer.from([aggHeader({ y: true, w: 1 }), ...part1])
      })
      // Packet 2: Z=1 (continues fragment), W=1, marker=true
      const p2 = buildRtp({
        seq: 1,
        timestamp: 5000,
        marker: true,
        payload: Buffer.from([aggHeader({ z: true, w: 1 }), ...part2])
      })

      expect(depay.push(p1)).toEqual([])
      const aus = depay.push(p2)
      expect(aus).toHaveLength(1)
      expect(aus[0]!.obus).toEqual([Buffer.concat([part1, part2])])
    })

    it('reassembles a fragment spanning three packets', () => {
      const part1 = Buffer.from([0x01])
      const part2 = Buffer.from([0x02])
      const part3 = Buffer.from([0x03])

      // Packet 1: Y=1 (fragment start)
      const p1 = buildRtp({
        seq: 10,
        timestamp: 6000,
        marker: false,
        payload: Buffer.from([aggHeader({ y: true, w: 1 }), ...part1])
      })
      // Packet 2: Z=1 + Y=1 (continuation, still incomplete)
      const p2 = buildRtp({
        seq: 11,
        timestamp: 6000,
        marker: false,
        payload: Buffer.from([aggHeader({ z: true, y: true, w: 1 }), ...part2])
      })
      // Packet 3: Z=1 (final fragment)
      const p3 = buildRtp({
        seq: 12,
        timestamp: 6000,
        marker: true,
        payload: Buffer.from([aggHeader({ z: true, w: 1 }), ...part3])
      })

      expect(depay.push(p1)).toEqual([])
      expect(depay.push(p2)).toEqual([])
      const aus = depay.push(p3)
      expect(aus).toHaveLength(1)
      expect(aus[0]!.obus).toEqual([Buffer.concat([part1, part2, part3])])
    })
  })

  describe('keyframe detection (N bit)', () => {
    it('marks access unit as key when N bit is set', () => {
      const payload = Buffer.from([aggHeader({ w: 1, n: true }), 0xff])
      const pkt = buildRtp({ seq: 0, timestamp: 1000, marker: true, payload })
      const aus = depay.push(pkt)
      expect(aus[0]!.key).toBe(true)
    })

    it('marks access unit as delta when N bit is not set', () => {
      // First packet to initialize sequence
      const p1 = buildRtp({
        seq: 0,
        timestamp: 500,
        marker: true,
        payload: Buffer.from([aggHeader({ w: 1, n: true }), 0x01])
      })
      depay.push(p1)

      const payload = Buffer.from([aggHeader({ w: 1, n: false }), 0xff])
      const pkt = buildRtp({ seq: 1, timestamp: 2000, marker: true, payload })
      const aus = depay.push(pkt)
      expect(aus[0]!.key).toBe(false)
    })
  })

  describe('timestamp boundary detection', () => {
    it('flushes previous AU when timestamp changes', () => {
      // Frame 1, packet 1 (no marker)
      const p1 = buildRtp({
        seq: 0,
        timestamp: 1000,
        marker: false,
        payload: Buffer.from([aggHeader({ w: 1, n: true }), 0xaa])
      })
      // Frame 2, packet 1 (different timestamp, marker)
      const p2 = buildRtp({
        seq: 1,
        timestamp: 4000,
        marker: true,
        payload: Buffer.from([aggHeader({ w: 1, n: false }), 0xbb])
      })

      expect(depay.push(p1)).toEqual([])
      const aus = depay.push(p2)
      // Should get both: frame 1 flushed by timestamp change, frame 2 flushed by marker
      expect(aus).toHaveLength(2)
      expect(aus[0]!.timestamp90k).toBe(1000)
      expect(aus[0]!.obus).toEqual([Buffer.from([0xaa])])
      expect(aus[1]!.timestamp90k).toBe(4000)
      expect(aus[1]!.obus).toEqual([Buffer.from([0xbb])])
    })
  })

  describe('packet loss handling', () => {
    it('drops in-flight data on sequence gap', () => {
      // Normal packet
      const p1 = buildRtp({
        seq: 100,
        timestamp: 1000,
        marker: false,
        payload: Buffer.from([aggHeader({ w: 1 }), 0xaa])
      })
      // Packet with gap (seq 102, skipping 101)
      const p2 = buildRtp({
        seq: 102,
        timestamp: 2000,
        marker: true,
        payload: Buffer.from([aggHeader({ w: 1, n: true }), 0xbb])
      })

      depay.push(p1)
      const aus = depay.push(p2)
      // After gap, depayloader waits for keyframe. p2 has N=true so it should emit.
      expect(aus).toHaveLength(1)
      expect(aus[0]!.key).toBe(true)
      expect(aus[0]!.obus).toEqual([Buffer.from([0xbb])])
    })

    it('suppresses delta frames after packet loss until next keyframe', () => {
      // Initial keyframe to establish sequence
      const p0 = buildRtp({
        seq: 0,
        timestamp: 500,
        marker: true,
        payload: Buffer.from([aggHeader({ w: 1, n: true }), 0x00])
      })
      depay.push(p0)

      // Normal delta
      const p1 = buildRtp({
        seq: 1,
        timestamp: 1000,
        marker: false,
        payload: Buffer.from([aggHeader({ w: 1 }), 0xaa])
      })
      depay.push(p1)

      // Gap: skip seq 2. Send delta at seq 3.
      const p3delta = buildRtp({
        seq: 3,
        timestamp: 2000,
        marker: true,
        payload: Buffer.from([aggHeader({ w: 1, n: false }), 0xcc])
      })
      const aus1 = depay.push(p3delta)
      // Delta after loss should be suppressed
      expect(aus1).toEqual([])

      // Another delta — still suppressed
      const p4delta = buildRtp({
        seq: 4,
        timestamp: 3000,
        marker: true,
        payload: Buffer.from([aggHeader({ w: 1, n: false }), 0xdd])
      })
      expect(depay.push(p4delta)).toEqual([])

      // Keyframe arrives — should emit
      const p5key = buildRtp({
        seq: 5,
        timestamp: 4000,
        marker: true,
        payload: Buffer.from([aggHeader({ w: 1, n: true }), 0xee])
      })
      const aus2 = depay.push(p5key)
      expect(aus2).toHaveLength(1)
      expect(aus2[0]!.key).toBe(true)
      expect(aus2[0]!.obus).toEqual([Buffer.from([0xee])])

      // Normal delta after recovery — should emit
      const p6 = buildRtp({
        seq: 6,
        timestamp: 5000,
        marker: true,
        payload: Buffer.from([aggHeader({ w: 1, n: false }), 0xff])
      })
      const aus3 = depay.push(p6)
      expect(aus3).toHaveLength(1)
      expect(aus3[0]!.key).toBe(false)
    })

    it('drops partial OBU fragment on sequence gap', () => {
      // Start of fragment
      const p1 = buildRtp({
        seq: 0,
        timestamp: 1000,
        marker: false,
        payload: Buffer.from([aggHeader({ y: true, w: 1, n: true }), 0xaa])
      })
      depay.push(p1)

      // Gap, then continuation — should not produce corrupt OBU
      const p3 = buildRtp({
        seq: 2,
        timestamp: 1000,
        marker: true,
        payload: Buffer.from([aggHeader({ z: true, w: 1, n: true }), 0xcc])
      })
      const aus = depay.push(p3)
      // Z=1 but partial was cleared by gap — reassembleObus returns empty.
      // The N bit is set but there are no completed OBUs, so nothing to emit.
      expect(aus).toEqual([])
    })
  })

  describe('sequence wraparound', () => {
    it('handles seq wrapping from 65535 to 0', () => {
      const p1 = buildRtp({
        seq: 65535,
        timestamp: 1000,
        marker: true,
        payload: Buffer.from([aggHeader({ w: 1, n: true }), 0xaa])
      })
      const p2 = buildRtp({
        seq: 0,
        timestamp: 2000,
        marker: true,
        payload: Buffer.from([aggHeader({ w: 1 }), 0xbb])
      })

      const aus1 = depay.push(p1)
      expect(aus1).toHaveLength(1)
      const aus2 = depay.push(p2)
      // Seq 0 follows 65535 correctly ((65535+1) & 0xFFFF === 0)
      expect(aus2).toHaveLength(1)
      expect(aus2[0]!.obus).toEqual([Buffer.from([0xbb])])
    })
  })

  describe('reset', () => {
    it('clears all state', () => {
      // Push partial data
      const p1 = buildRtp({
        seq: 5,
        timestamp: 1000,
        marker: false,
        payload: Buffer.from([aggHeader({ y: true, w: 1 }), 0xaa])
      })
      depay.push(p1)

      depay.reset()

      // After reset, should accept any sequence number
      const p2 = buildRtp({
        seq: 999,
        timestamp: 2000,
        marker: true,
        payload: Buffer.from([aggHeader({ w: 1, n: true }), 0xbb])
      })
      const aus = depay.push(p2)
      expect(aus).toHaveLength(1)
      expect(aus[0]!.obus).toEqual([Buffer.from([0xbb])])
    })
  })
})
