import { createHmac } from 'crypto'

/**
 * MAVLink 2 message signing implementation.
 * Ports the logic from MAVLinkSigning.cc using Node.js crypto.
 *
 * MAVLink 2 signature format (13 bytes appended to packet):
 *   linkId (1 byte) + timestamp (6 bytes LE) + signature (6 bytes)
 *
 * Signature = first 6 bytes of SHA-256 HMAC over:
 *   secretKey (32 bytes) + header (10 bytes) + payload + CRC (2 bytes) + linkId (1 byte) + timestamp (6 bytes)
 */

/** 48-bit timestamp: 10 microsecond units since 1 Jan 2015 GMT */
export function mavlinkTimestamp(): bigint {
  const EPOCH_2015 = 1420070400000n // ms since Unix epoch to 2015-01-01
  const nowMs = BigInt(Date.now())
  return (nowMs - EPOCH_2015) * 100n // 10µs units
}

export interface SignedPacketParts {
  header: Buffer // 10-byte MAVLink 2 header (including STX)
  payload: Buffer
  crc: Buffer // 2-byte CRC
  linkId: number
  timestamp: bigint // 48-bit
}

/**
 * Compute a MAVLink 2 signature.
 * Returns the 6-byte signature.
 */
export function computeSignature(
  secretKey: Buffer, // 32 bytes
  parts: SignedPacketParts
): Buffer {
  const timestampBuf = Buffer.alloc(6)
  let ts = parts.timestamp
  for (let i = 0; i < 6; i++) {
    timestampBuf[i] = Number(ts & 0xffn)
    ts >>= 8n
  }

  const hmac = createHmac('sha256', secretKey)
  hmac.update(parts.header)
  hmac.update(parts.payload)
  hmac.update(parts.crc)
  hmac.update(Buffer.from([parts.linkId]))
  hmac.update(timestampBuf)

  return hmac.digest().subarray(0, 6)
}

/**
 * Build the 13-byte signature block: linkId (1) + timestamp (6) + signature (6)
 */
export function buildSignatureBlock(secretKey: Buffer, parts: SignedPacketParts): Buffer {
  const sig = computeSignature(secretKey, parts)
  const timestampBuf = Buffer.alloc(6)
  let ts = parts.timestamp
  for (let i = 0; i < 6; i++) {
    timestampBuf[i] = Number(ts & 0xffn)
    ts >>= 8n
  }

  return Buffer.concat([Buffer.from([parts.linkId]), timestampBuf, sig])
}

/**
 * Verify a MAVLink 2 signature.
 * Returns true if the signature is valid for the given key.
 */
export function verifySignature(
  secretKey: Buffer,
  parts: SignedPacketParts,
  receivedSignature: Buffer // 6 bytes
): boolean {
  const computed = computeSignature(secretKey, parts)
  return computed.equals(receivedSignature)
}

/**
 * Try to detect which key signed a packet from a set of keys.
 * Returns the key buffer if found, null otherwise.
 */
export function tryDetectKey(
  keys: Buffer[],
  parts: SignedPacketParts,
  receivedSignature: Buffer
): Buffer | null {
  for (const key of keys) {
    if (verifySignature(key, parts, receivedSignature)) {
      return key
    }
  }
  return null
}
