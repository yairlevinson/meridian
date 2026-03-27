import { EventEmitter } from 'events'

export enum CompMetadataType {
  GENERAL = 0,
  PARAMETER = 1,
  COMMANDS = 2,
  PERIPHERALS = 3,
  EVENTS = 4,
  ACTUATORS = 5
}

export interface ComponentMetadata {
  type: CompMetadataType
  uri: string
  fileCrc: number
  data: Record<string, unknown> | null
}

/**
 * Manages COMP_METADATA_TYPE requests.
 * Downloads component metadata via FTP or HTTP, caches locally.
 */
export class ComponentInformationManager extends EventEmitter {
  private metadata = new Map<CompMetadataType, ComponentMetadata>()
  private cacheDir: string

  constructor(cacheDir: string) {
    super()
    this.cacheDir = cacheDir
  }

  /** Request metadata of a specific type */
  requestMetadata(type: CompMetadataType, uri: string, crc: number): void {
    this.metadata.set(type, { type, uri, fileCrc: crc, data: null })
    this.emit('metadataRequested', { type, uri })
  }

  /** Store downloaded and parsed metadata */
  setMetadata(type: CompMetadataType, data: Record<string, unknown>): void {
    const existing = this.metadata.get(type)
    if (existing) {
      existing.data = data
    } else {
      this.metadata.set(type, { type, uri: '', fileCrc: 0, data })
    }
    this.emit('metadataReady', type)
  }

  /** Get metadata by type */
  getMetadata(type: CompMetadataType): ComponentMetadata | undefined {
    return this.metadata.get(type)
  }

  /** Check if metadata of a type is available */
  hasMetadata(type: CompMetadataType): boolean {
    const m = this.metadata.get(type)
    return m?.data !== null && m?.data !== undefined
  }

  get cacheDirectory(): string {
    return this.cacheDir
  }
}
