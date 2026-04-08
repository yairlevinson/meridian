export const AV1_CHUNK_MAGIC = [0x41, 0x31, 0x43, 0x48] as const // "A1CH"
export const AV1_CHUNK_HEADER_SIZE = 13

/**
 * Pack an AV1 access unit into a binary envelope for WebSocket transport:
 *   [4-byte magic][1-byte flags][8-byte timestamp-us][payload...]
 */
export function packAv1Chunk(payload: Uint8Array, timestampUs: number, key: boolean): Uint8Array {
  const out = new Uint8Array(AV1_CHUNK_HEADER_SIZE + payload.length)
  out.set(AV1_CHUNK_MAGIC, 0)
  out[4] = key ? 1 : 0
  const view = new DataView(out.buffer)
  const ts = Math.floor(timestampUs)
  if (ts < 0) {
    console.warn(`[VideoChunkProtocol] negative timestamp: ${timestampUs}µs, clamping to 0`)
  }
  view.setBigUint64(5, BigInt(Math.max(0, ts)), false)
  out.set(payload, AV1_CHUNK_HEADER_SIZE)
  return out
}

export interface Av1ChunkPacket {
  key: boolean
  timestampUs: number
  payload: Uint8Array
}

export function unpackAv1Chunk(data: Uint8Array): Av1ChunkPacket | null {
  if (data.length < AV1_CHUNK_HEADER_SIZE) return null
  if (
    data[0] !== AV1_CHUNK_MAGIC[0] ||
    data[1] !== AV1_CHUNK_MAGIC[1] ||
    data[2] !== AV1_CHUNK_MAGIC[2] ||
    data[3] !== AV1_CHUNK_MAGIC[3]
  ) {
    return null
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const key = ((data[4] ?? 0) & 1) === 1
  const timestampUs = Number(view.getBigUint64(5, false))
  return {
    key,
    timestampUs,
    payload: data.subarray(AV1_CHUNK_HEADER_SIZE)
  }
}
