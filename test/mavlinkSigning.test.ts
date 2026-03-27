// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { randomBytes } from 'crypto'
import {
  computeSignature,
  verifySignature,
  buildSignatureBlock,
  tryDetectKey,
  mavlinkTimestamp
} from '../src/main/mavlink/MavlinkSigning'
import { MavlinkSigningKeys } from '../src/main/mavlink/MavlinkSigningKeys'
import type { SignedPacketParts } from '../src/main/mavlink/MavlinkSigning'

function makeParts(overrides: Partial<SignedPacketParts> = {}): SignedPacketParts {
  return {
    header: Buffer.from([0xfd, 9, 0, 0, 1, 1, 0, 0, 0, 0]), // MAVLink 2 HEARTBEAT-like
    payload: Buffer.alloc(9), // 9 bytes for HEARTBEAT
    crc: Buffer.from([0x12, 0x34]),
    linkId: 0,
    timestamp: mavlinkTimestamp(),
    ...overrides
  }
}

describe('MAVLink signing', () => {
  it('computeSignature returns 6-byte buffer', () => {
    const key = randomBytes(32)
    const sig = computeSignature(key, makeParts())
    expect(sig).toBeInstanceOf(Buffer)
    expect(sig.length).toBe(6)
  })

  it('verifySignature returns true for correct key', () => {
    const key = randomBytes(32)
    const parts = makeParts()
    const sig = computeSignature(key, parts)
    expect(verifySignature(key, parts, sig)).toBe(true)
  })

  it('verifySignature returns false for corrupted signature', () => {
    const key = randomBytes(32)
    const parts = makeParts()
    const sig = computeSignature(key, parts)
    sig[0] ^= 0xff // corrupt one byte
    expect(verifySignature(key, parts, sig)).toBe(false)
  })

  it('verifySignature returns false for wrong key', () => {
    const key1 = randomBytes(32)
    const key2 = randomBytes(32)
    const parts = makeParts()
    const sig = computeSignature(key1, parts)
    expect(verifySignature(key2, parts, sig)).toBe(false)
  })

  it('buildSignatureBlock produces 13-byte block (1 + 6 + 6)', () => {
    const key = randomBytes(32)
    const block = buildSignatureBlock(key, makeParts())
    expect(block.length).toBe(13)
    expect(block[0]).toBe(0) // linkId
  })

  it('signature changes when payload changes', () => {
    const key = randomBytes(32)
    const parts1 = makeParts({ payload: Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9]) })
    const parts2 = makeParts({ payload: Buffer.from([9, 8, 7, 6, 5, 4, 3, 2, 1]) })
    const sig1 = computeSignature(key, parts1)
    const sig2 = computeSignature(key, parts2)
    expect(sig1.equals(sig2)).toBe(false)
  })

  it('signature changes when timestamp changes', () => {
    const key = randomBytes(32)
    const parts1 = makeParts({ timestamp: 1000n })
    const parts2 = makeParts({ timestamp: 2000n })
    const sig1 = computeSignature(key, parts1)
    const sig2 = computeSignature(key, parts2)
    expect(sig1.equals(sig2)).toBe(false)
  })

  it('tryDetectKey finds the correct key from a set', () => {
    const key1 = randomBytes(32)
    const key2 = randomBytes(32)
    const key3 = randomBytes(32)
    const parts = makeParts()
    const sig = computeSignature(key2, parts) // signed with key2

    const found = tryDetectKey([key1, key2, key3], parts, sig)
    expect(found).not.toBeNull()
    expect(found!.equals(key2)).toBe(true)
  })

  it('tryDetectKey returns null when no key matches', () => {
    const parts = makeParts()
    const sig = computeSignature(randomBytes(32), parts) // different key
    const found = tryDetectKey([randomBytes(32), randomBytes(32)], parts, sig)
    expect(found).toBeNull()
  })

  it('mavlinkTimestamp returns a positive bigint', () => {
    const ts = mavlinkTimestamp()
    expect(typeof ts).toBe('bigint')
    expect(ts > 0n).toBe(true)
  })
})

describe('MavlinkSigningKeys store', () => {
  it('adds and retrieves keys', () => {
    const store = new MavlinkSigningKeys()
    const hex = randomBytes(32).toString('hex')
    store.addKey('k1', 'Test Key', hex)

    const key = store.getKey('k1')
    expect(key).toBeDefined()
    expect(key!.name).toBe('Test Key')
    expect(key!.key.length).toBe(32)
  })

  it('rejects keys that are not 32 bytes', () => {
    const store = new MavlinkSigningKeys()
    expect(() => store.addKey('k1', 'Bad', 'aabb')).toThrow('32 bytes')
  })

  it('removes keys', () => {
    const store = new MavlinkSigningKeys()
    store.addKey('k1', 'Key 1', randomBytes(32).toString('hex'))
    expect(store.removeKey('k1')).toBe(true)
    expect(store.getKey('k1')).toBeUndefined()
    expect(store.size).toBe(0)
  })

  it('getAllKeyBuffers returns all key buffers', () => {
    const store = new MavlinkSigningKeys()
    store.addKey('k1', 'Key 1', randomBytes(32).toString('hex'))
    store.addKey('k2', 'Key 2', randomBytes(32).toString('hex'))
    const buffers = store.getAllKeyBuffers()
    expect(buffers).toHaveLength(2)
    expect(buffers[0].length).toBe(32)
  })
})
