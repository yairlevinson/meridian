export interface Av1AccessUnit {
  timestamp90k: number
  key: boolean
  /** Individual OBU elements as extracted from RTP (may lack obu_has_size_field). */
  obus: Buffer[]
}

interface ParsedRtpPacket {
  seq: number
  timestamp90k: number
  marker: boolean
  payload: Buffer
}

interface ParsedAggregation {
  z: boolean
  y: boolean
  n: boolean
  obuElements: Buffer[]
}

/**
 * Minimal AV1 RTP depayloader for realtime single-stream usage.
 *
 * It handles:
 * - RTP header parsing (including CSRC / extension skipping)
 * - AV1 aggregation header Z/Y/W/N bits
 * - OBU element size parsing (LEB128)
 * - OBU fragment reassembly across RTP packets
 * - Access unit assembly on RTP marker bit
 */
export class Av1RtpDepayloader {
  private expectedSeq: number | null = null
  private partialObu: Buffer | null = null
  private currentObus: Buffer[] = []
  private currentTimestamp90k: number | null = null
  private currentKey = false
  /** After packet loss, wait for the next keyframe (N bit) before emitting. */
  private _waitingForKey = false

  reset(): void {
    this.expectedSeq = null
    this.partialObu = null
    this.currentObus = []
    this.currentTimestamp90k = null
    this.currentKey = false
    this._waitingForKey = false
  }

  push(packet: Buffer): Av1AccessUnit[] {
    const rtp = this.parseRtp(packet)
    if (!rtp) return []

    if (this.expectedSeq !== null && rtp.seq !== this.expectedSeq) {
      // Packet loss/out-of-order: drop in-flight fragments and wait for
      // the next keyframe to avoid feeding corrupted reference chains.
      this.partialObu = null
      this.currentObus = []
      this.currentTimestamp90k = null
      this.currentKey = false
      this._waitingForKey = true
    }
    this.expectedSeq = (rtp.seq + 1) & 0xffff

    const parsed = this.parseAggregation(rtp.payload)
    if (!parsed) return []

    const completed = this.reassembleObus(parsed)
    const out: Av1AccessUnit[] = []

    if (completed.length > 0) {
      if (this.currentTimestamp90k !== null && this.currentTimestamp90k !== rtp.timestamp90k) {
        const flushed = this.flush()
        if (flushed) out.push(flushed)
      }
      if (this.currentTimestamp90k === null) this.currentTimestamp90k = rtp.timestamp90k
      this.currentObus.push(...completed)
      // N bit in aggregation header signals a keyframe. As a fallback for
      // muxers that don't set N (e.g. ffmpeg experimental), also check if
      // any completed OBU is a Sequence Header (type 1) — which only
      // appears at the start of a coded video sequence (keyframe).
      if (parsed.n || completed.some((obu) => ((obu[0]! >> 3) & 0x0f) === 1)) {
        this.currentKey = true
      }
    }

    if (rtp.marker) {
      const flushed = this.flush()
      if (flushed) out.push(flushed)
    }

    return out
  }

  private flush(): Av1AccessUnit | null {
    if (this.currentTimestamp90k === null || this.currentObus.length === 0) return null
    const timestamp90k = this.currentTimestamp90k
    const obus = this.currentObus
    const key = this.currentKey
    this.currentObus = []
    this.currentTimestamp90k = null
    this.currentKey = false

    // After packet loss, suppress delta frames until the next keyframe
    if (this._waitingForKey) {
      if (!key) return null
      this._waitingForKey = false
    }

    return { timestamp90k, key, obus }
  }

  private parseRtp(packet: Buffer): ParsedRtpPacket | null {
    if (packet.length < 12) return null
    const version = packet[0]! >> 6
    if (version !== 2) return null

    const hasExtension = (packet[0]! & 0x10) !== 0
    const csrcCount = packet[0]! & 0x0f
    const marker = (packet[1]! & 0x80) !== 0
    const seq = packet.readUInt16BE(2)
    const timestamp90k = packet.readUInt32BE(4)

    let offset = 12 + csrcCount * 4
    if (offset > packet.length) return null

    if (hasExtension) {
      if (offset + 4 > packet.length) return null
      const extWords = packet.readUInt16BE(offset + 2)
      offset += 4 + extWords * 4
      if (offset > packet.length) return null
    }

    return {
      seq,
      timestamp90k,
      marker,
      payload: packet.subarray(offset)
    }
  }

  private parseAggregation(payload: Buffer): ParsedAggregation | null {
    if (payload.length < 1) return null
    const agg = payload[0]!
    const z = (agg & 0x80) !== 0
    const y = (agg & 0x40) !== 0
    const w = (agg >> 4) & 0x03
    const n = (agg & 0x08) !== 0
    const body = payload.subarray(1)

    const obuElements: Buffer[] = []
    let offset = 0

    if (w === 0) {
      while (offset < body.length) {
        const lenInfo = this.readLeb128(body, offset)
        if (!lenInfo) return null
        offset = lenInfo.next
        if (offset + lenInfo.value > body.length) return null
        obuElements.push(body.subarray(offset, offset + lenInfo.value))
        offset += lenInfo.value
      }
    } else {
      const explicitCount = w - 1
      for (let i = 0; i < explicitCount; i++) {
        const lenInfo = this.readLeb128(body, offset)
        if (!lenInfo) return null
        offset = lenInfo.next
        if (offset + lenInfo.value > body.length) return null
        obuElements.push(body.subarray(offset, offset + lenInfo.value))
        offset += lenInfo.value
      }
      if (offset <= body.length) {
        obuElements.push(body.subarray(offset))
      }
    }

    return { z, y, n, obuElements }
  }

  private reassembleObus(parsed: ParsedAggregation): Buffer[] {
    const out: Buffer[] = []
    const elements = parsed.obuElements
    let start = 0

    if (parsed.z) {
      if (!this.partialObu || elements.length === 0) return out
      const combined = Buffer.concat([this.partialObu, elements[0]!])
      this.partialObu = null
      if (elements.length === 1 && parsed.y) {
        this.partialObu = combined
        return out
      }
      out.push(combined)
      start = 1
    }

    for (let i = start; i < elements.length; i++) {
      const elem = elements[i]!
      const isLast = i === elements.length - 1
      if (parsed.y && isLast) {
        this.partialObu = elem
      } else {
        out.push(elem)
      }
    }

    return out
  }

  private readLeb128(data: Uint8Array, offset: number): { value: number; next: number } | null {
    let value = 0
    let shift = 0
    let idx = offset
    while (idx < data.length && shift <= 28) {
      const byte = data[idx]!
      value |= (byte & 0x7f) << shift
      idx++
      if ((byte & 0x80) === 0) {
        return { value, next: idx }
      }
      shift += 7
    }
    return null
  }

  /**
   * Ensure an OBU has obu_has_size_field set and the LEB128 size present.
   * RTP payloads strip the size field (RFC 9601), but WebCodecs requires
   * Low Overhead Bitstream Format where each OBU carries its own size.
   */
  static ensureObuSizeField(obu: Buffer): Buffer {
    if (obu.length === 0) return obu
    const headerByte = obu[0]!
    // If size field already present, return as-is
    if ((headerByte & 0x02) !== 0) return obu

    const hasExtension = (headerByte & 0x04) !== 0
    const headerLen = hasExtension ? 2 : 1
    if (obu.length < headerLen) return obu

    const payloadLen = obu.length - headerLen
    const sizeBytes = Av1RtpDepayloader.encodeLeb128(payloadLen)

    const result = Buffer.alloc(headerLen + sizeBytes.length + payloadLen)
    result[0] = headerByte | 0x02 // set obu_has_size_field
    if (hasExtension && obu.length > 1) {
      result[1] = obu[1]!
    }
    Buffer.from(sizeBytes).copy(result, headerLen)
    obu.copy(result, headerLen + sizeBytes.length, headerLen)
    return result
  }

  static encodeLeb128(value: number): number[] {
    const bytes: number[] = []
    do {
      let b = value & 0x7f
      value >>>= 7
      if (value > 0) b |= 0x80
      bytes.push(b)
    } while (value > 0)
    return bytes
  }
}
