/** MAVLink 2 message signing types */

/** A stored signing key */
export interface SigningKey {
  id: string
  name: string
  key: string // hex-encoded 32-byte key
  createdAt: number // epoch ms
}

/** Signing configuration for a link */
export interface SigningConfig {
  enabled: boolean
  keyId: string | null
  allowUnsigned: boolean
}

/** Signing status reported per link */
export interface SigningStatus {
  linkId: string
  signingActive: boolean
  keyName: string | null
  badSignatureCount: number
  unsignedCount: number
}
