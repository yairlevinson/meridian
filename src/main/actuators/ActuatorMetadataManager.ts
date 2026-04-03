import { EventEmitter } from 'events'
import type { MavCommandQueue } from '../vehicle/MavCommandQueue'
import type { FTPManager } from '../ftp/FTPManager'
import { gunzipSync } from 'zlib'
import { xz } from '@napi-rs/lzma'
import { mavLog } from '../mavlink/trafficLog'

// MAVLink message IDs
const MSG_AUTOPILOT_VERSION = 148
const MSG_COMPONENT_METADATA = 397
const MSG_COMPONENT_INFORMATION = 395
const MAV_CMD_REQUEST_MESSAGE = 512

// Component metadata types (from MAVLink spec)
const COMP_METADATA_TYPE_ACTUATORS = 5

const TAG = 'ActuatorMetadata'

/** Parsed actuator type from vehicle metadata JSON */
export interface ActuatorType {
  functionMin: number
  functionMax: number
  valueMin: number
  valueMax: number
  reversible: boolean
}

/** Parsed actuator metadata for a vehicle */
export interface ActuatorMetadata {
  motors: ActuatorType | null
  servos: ActuatorType | null
}

// Default PX4 values (used as fallback)
const DEFAULT_METADATA: ActuatorMetadata = {
  motors: { functionMin: 101, functionMax: 108, valueMin: 0, valueMax: 1, reversible: false },
  servos: { functionMin: 201, functionMax: 208, valueMin: -1, valueMax: 1, reversible: false }
}

/**
 * Fetches and parses actuator metadata from a PX4 vehicle.
 *
 * Protocol flow (matching QGC ComponentInformationManager):
 * 1. Request COMPONENT_INFORMATION (msg 395) via MAV_CMD_REQUEST_MESSAGE
 * 2. Vehicle responds with generalMetadataUri (usually mftp:// for MAVLink FTP)
 * 3. Download general metadata JSON via FTP
 * 4. Parse to find ACTUATORS type URI
 * 5. Download actuators JSON via FTP
 * 6. Parse actuator-types → extract function ranges for motors/servos
 */
export class ActuatorMetadataManager extends EventEmitter {
  private _commandQueue: MavCommandQueue | null = null
  private _ftpManager: FTPManager | null = null
  private _sysid = 0
  private _metadata: ActuatorMetadata = { ...DEFAULT_METADATA }
  private _fetched = false
  private _fetching = false

  get metadata(): ActuatorMetadata {
    return this._metadata
  }

  get fetched(): boolean {
    return this._fetched
  }

  setTarget(sysid: number): void {
    this._sysid = sysid
  }

  setCommandQueue(queue: MavCommandQueue): void {
    this._commandQueue = queue
  }

  setFtpManager(ftp: FTPManager): void {
    this._ftpManager = ftp
  }

  /** Handle COMPONENT_METADATA (397) response from vehicle */
  handleComponentMetadata(data: { uri: string }): void {
    this._handleMetadataUri(data.uri)
  }

  /** Handle COMPONENT_INFORMATION (395) response from vehicle (legacy) */
  handleComponentInformation(data: {
    generalMetadataUri: string
    generalMetadataFileCrc: number
  }): void {
    this._handleMetadataUri(data.generalMetadataUri)
  }

  private _handleMetadataUri(rawUri: string): void {
    const uri = this._cleanString(rawUri)
    if (!uri) {
      mavLog.warn(TAG, 'empty metadata URI')
      return
    }
    mavLog.info(TAG, `got general metadata URI: ${uri}`)
    this._fetchMetadataChain(uri).catch((err) => {
      mavLog.warn(TAG, `fetch failed: ${err.message}`)
    })
  }

  /**
   * Start the metadata fetch process.
   * Called after vehicle connection is established and parameters loaded.
   */
  async requestMetadata(): Promise<void> {
    if (this._fetching || this._fetched) return
    if (!this._commandQueue) return
    this._fetching = true

    try {
      // Request AUTOPILOT_VERSION first — PX4 requires this before serving component metadata
      mavLog.info(TAG, 'requesting AUTOPILOT_VERSION (148)')
      await this._commandQueue.sendCommand(
        MAV_CMD_REQUEST_MESSAGE,
        this._sysid,
        1,
        { p1: MSG_AUTOPILOT_VERSION },
        { timeoutMs: 3000, maxRetries: 1 }
      ).catch(() => {}) // ignore failure, not critical

      // Try COMPONENT_METADATA (397) — newer PX4 firmware uses this
      mavLog.info(TAG, 'requesting COMPONENT_METADATA (397)')
      await this._commandQueue.sendCommand(
        MAV_CMD_REQUEST_MESSAGE,
        this._sysid,
        1, // MAV_COMP_ID_AUTOPILOT1
        { p1: MSG_COMPONENT_METADATA },
        { timeoutMs: 3000, maxRetries: 1 }
      )
      // Response arrives as msg 397 and is handled by handleComponentMetadata
    } catch {
      // Fall back to COMPONENT_INFORMATION (395) for older firmware
      try {
        mavLog.info(TAG, '397 failed, trying COMPONENT_INFORMATION (395)')
        await this._commandQueue.sendCommand(
          MAV_CMD_REQUEST_MESSAGE,
          this._sysid,
          1,
          { p1: MSG_COMPONENT_INFORMATION },
          { timeoutMs: 3000, maxRetries: 1 }
        )
      } catch {
        mavLog.warn(TAG, 'neither 397 nor 395 supported, using defaults')
        this._fetching = false
      }
    }
  }

  /** Get the actuator function ID for a motor instance (1-based) */
  motorFunction(instance: number): number {
    const m = this._metadata.motors ?? DEFAULT_METADATA.motors!
    return 1000 + m.functionMin + (instance - 1)
  }

  /** Get the actuator function ID for a servo instance (1-based) */
  servoFunction(instance: number): number {
    const s = this._metadata.servos ?? DEFAULT_METADATA.servos!
    return 1000 + s.functionMin + (instance - 1)
  }

  destroy(): void {
    this.removeAllListeners()
  }

  // --- Private ---

  private async _fetchMetadataChain(generalUri: string): Promise<void> {
    if (!this._ftpManager) {
      mavLog.warn(TAG, 'no FTP manager, using defaults')
      this._fetching = false
      return
    }

    try {
      // Step 1: Download general metadata JSON
      const ftpPath = this._uriToFtpPath(generalUri)
      if (!ftpPath) {
        mavLog.warn(TAG, `unsupported URI scheme: ${generalUri}`)
        this._fetching = false
        return
      }

      mavLog.info(TAG, `downloading general metadata: ${ftpPath}`)
      const generalBuf = await this._ftpManager.download(ftpPath)
      const generalJson = this._decompressAndParse(generalBuf)

      if (!generalJson) {
        mavLog.warn(TAG, 'failed to parse general metadata')
        this._fetching = false
        return
      }

      // Step 2: Find actuator metadata URI in the general JSON
      const actuatorUri = this._findTypeUri(generalJson, COMP_METADATA_TYPE_ACTUATORS)
      if (!actuatorUri) {
        mavLog.warn(TAG, 'no actuator metadata URI in general metadata')
        this._fetching = false
        return
      }

      // Step 3: Download actuator metadata JSON
      const actuatorFtpPath = this._uriToFtpPath(actuatorUri)
      if (!actuatorFtpPath) {
        mavLog.warn(TAG, `unsupported actuator URI: ${actuatorUri}`)
        this._fetching = false
        return
      }

      mavLog.info(TAG, `downloading actuator metadata: ${actuatorFtpPath}`)
      const actuatorBuf = await this._ftpManager.download(actuatorFtpPath)
      const actuatorJson = this._decompressAndParse(actuatorBuf)

      if (!actuatorJson) {
        mavLog.warn(TAG, 'failed to parse actuator metadata')
        this._fetching = false
        return
      }

      // Step 4: Parse actuator types
      this._parseActuatorTypes(actuatorJson)
      this._fetched = true
      this._fetching = false
      mavLog.info(TAG, `loaded: ${JSON.stringify(this._metadata)}`)
      this.emit('metadataLoaded', this._metadata)
    } catch (err) {
      mavLog.warn(TAG, `error during fetch: ${(err as Error).message}`)
      this._fetching = false
    }
  }

  /** Convert mftp:// or mavlinkftp:// URI to a local FTP path */
  private _uriToFtpPath(uri: string): string | null {
    // QGC supports: mftp://[;comp=<compid>]<path> and mavlinkftp://...
    // PX4 may send mftp://etc/... (no leading slash) or mftp:///etc/... (with slash)
    if (uri.startsWith('mftp://')) {
      let path = uri.slice('mftp://'.length)
      // Strip optional component ID prefix: [;comp=1]
      if (path.startsWith('[')) {
        const closeBracket = path.indexOf(']')
        if (closeBracket >= 0) path = path.slice(closeBracket + 1)
      }
      // Ensure leading slash for absolute FTP path
      if (!path.startsWith('/')) path = '/' + path
      return path
    }
    if (uri.startsWith('mavlinkftp://')) {
      let path = uri.slice('mavlinkftp://'.length)
      if (!path.startsWith('/')) path = '/' + path
      return path
    }
    // HTTP URIs not supported yet
    return null
  }

  /** Decompress (if compressed) and parse JSON from a buffer */
  private _decompressAndParse(buf: Buffer): Record<string, unknown> | null {
    try {
      let data: Buffer = buf
      // Check for gzip magic bytes (0x1f 0x8b)
      if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
        data = gunzipSync(buf)
      }
      // Check for XZ magic bytes (0xFD 0x37 0x7A 0x58 0x5A 0x00)
      else if (buf.length >= 6 && buf[0] === 0xfd && buf[1] === 0x37 && buf[2] === 0x7a && buf[3] === 0x58 && buf[4] === 0x5a && buf[5] === 0x00) {
        data = Buffer.from(xz.decompressSync(buf))
      }
      const text = data.toString('utf8')
      return JSON.parse(text) as Record<string, unknown>
    } catch (err) {
      mavLog.warn(TAG, `decompress/parse error: ${(err as Error).message}`)
      return null
    }
  }

  /** Find a metadata type URI in the general metadata JSON */
  private _findTypeUri(
    generalJson: Record<string, unknown>,
    metadataType: number
  ): string | null {
    // General metadata format: { version: 1, metadataTypes: [{ type, uri, fileCrc }, ...] }
    // The key could be "metadataTypes" or "metadata" depending on version
    const types =
      (generalJson['metadataTypes'] as Array<Record<string, unknown>>) ??
      (generalJson['metadata'] as Array<Record<string, unknown>>)
    if (!Array.isArray(types)) return null

    for (const entry of types) {
      if (entry['type'] === metadataType) {
        return (entry['uri'] as string) ?? null
      }
    }
    return null
  }

  /** Parse actuator-types from the actuator metadata JSON */
  private _parseActuatorTypes(json: Record<string, unknown>): void {
    // The mixer section contains actuator-types
    // Look in mixer first, then at top level
    const mixer = (json['mixer_v1'] as Record<string, unknown>) ?? (json['mixer'] as Record<string, unknown>) ?? json
    const actuatorTypes =
      (mixer['actuator-types'] as Record<string, Record<string, unknown>>) ?? {}

    for (const [typeName, typeData] of Object.entries(actuatorTypes)) {
      const functionMin = typeData['function-min'] as number | undefined
      const functionMax = typeData['function-max'] as number | undefined
      const values = typeData['values'] as Record<string, unknown> | undefined

      if (functionMin === undefined || functionMax === undefined) continue

      const parsed: ActuatorType = {
        functionMin,
        functionMax,
        valueMin: (values?.['min'] as number) ?? -1,
        valueMax: (values?.['max'] as number) ?? 1,
        reversible: (values?.['reversible'] as boolean) ?? false
      }

      if (typeName === 'motor') {
        this._metadata.motors = parsed
      } else if (typeName === 'servo') {
        this._metadata.servos = parsed
      }
    }
  }

  /** Strip null bytes from MAVLink strings */
  private _cleanString(s: string): string {
    return s.replace(/\0/g, '').trim()
  }
}
