/**
 * In-memory signing key store.
 * In production, this would be backed by electron-store for persistence.
 */
export interface StoredKey {
  id: string
  name: string
  key: Buffer // 32 bytes
}

export class MavlinkSigningKeys {
  private keys = new Map<string, StoredKey>()

  addKey(id: string, name: string, keyHex: string): void {
    const key = Buffer.from(keyHex, 'hex')
    if (key.length !== 32) {
      throw new Error(`Signing key must be 32 bytes, got ${key.length}`)
    }
    this.keys.set(id, { id, name, key })
  }

  removeKey(id: string): boolean {
    return this.keys.delete(id)
  }

  getKey(id: string): StoredKey | undefined {
    return this.keys.get(id)
  }

  getAllKeys(): StoredKey[] {
    return Array.from(this.keys.values())
  }

  getAllKeyBuffers(): Buffer[] {
    return Array.from(this.keys.values()).map((k) => k.key)
  }

  get size(): number {
    return this.keys.size
  }
}
