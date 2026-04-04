import { EventEmitter } from 'events'
import fs from 'fs'
import path from 'path'

export interface AppSettings {
  // Map settings
  mapProvider: string
  offlineMapPath: string

  // Connection settings
  autoConnectUDP: boolean
  autoConnectUDPPort: number

  // Unit settings
  distanceUnits: 'meters' | 'feet'
  speedUnits: 'ms' | 'kmh' | 'mph' | 'knots'
  altitudeUnits: 'meters' | 'feet'

  // Display settings
  showPerfOverlay: boolean
  language: string
  theme: 'dark' | 'light'

  // Flight settings
  defaultTakeoffAltitude: number
  defaultRTLAltitude: number
  maxFlightAltitude: number

  // Battery settings
  batteryPercentWarning: number
  batteryPercentCritical: number

  // Logging
  saveFlightLogs: boolean
  flightLogDirectory: string

  // MAVLink stream rates (ArduPilot)
  streamRatePosition: number
  streamRateExtra1: number
  streamRateExtra2: number
  streamRateExtra3: number
  streamRateRCChannels: number
  streamRateRawSensors: number

  // Video streaming
  videoSource: 'disabled' | 'udp_h264' | 'udp_h265' | 'rtsp' | 'tcp_mpegts'
  videoUdpPort: number
  videoRtspUrl: string
  videoTcpUrl: string
  videoStreamEnabled: boolean
  videoLowLatencyMode: boolean
  videoRecordingFormat: 'mkv' | 'mov' | 'mp4'
  videoGridLines: boolean

  // MAVLink forwarding
  mavlinkForwardingEnabled: boolean
  mavlinkForwardingTargets: Array<{
    id: string
    host: string
    port: number
    enabled: boolean
  }>
}

const DEFAULT_SETTINGS: AppSettings = {
  mapProvider: 'osm',
  offlineMapPath: '',
  autoConnectUDP: true,
  autoConnectUDPPort: 14550,
  distanceUnits: 'meters',
  speedUnits: 'ms',
  altitudeUnits: 'meters',
  showPerfOverlay: true,
  language: 'en',
  theme: 'dark',
  defaultTakeoffAltitude: 10,
  defaultRTLAltitude: 30,
  maxFlightAltitude: 120,
  batteryPercentWarning: 30,
  batteryPercentCritical: 15,
  saveFlightLogs: true,
  flightLogDirectory: '',
  streamRatePosition: 4,
  streamRateExtra1: 10,
  streamRateExtra2: 4,
  streamRateExtra3: 2,
  streamRateRCChannels: 2,
  streamRateRawSensors: 2,
  videoSource: 'disabled',
  videoUdpPort: 5600,
  videoRtspUrl: '',
  videoTcpUrl: '',
  videoStreamEnabled: true,
  videoLowLatencyMode: true,
  videoRecordingFormat: 'mp4',
  videoGridLines: false,
  mavlinkForwardingEnabled: false,
  mavlinkForwardingTargets: []
}

export class SettingsManager extends EventEmitter {
  private settings: AppSettings
  private filePath: string | null
  private saveTimer: ReturnType<typeof setTimeout> | null = null

  /**
   * @param opts.filePath  Path to the JSON settings file. Enables disk persistence.
   *                       Omit for in-memory only (tests).
   * @param opts.initial   Optional overrides applied on top of defaults / loaded file.
   */
  constructor(opts: { filePath?: string; initial?: Partial<AppSettings> } = {}) {
    super()
    this.filePath = opts.filePath ?? null
    this.settings = { ...DEFAULT_SETTINGS, ...this._loadFromDisk(), ...opts.initial }
  }

  get<K extends keyof AppSettings>(key: K): AppSettings[K] {
    return this.settings[key]
  }

  set<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void {
    const old = this.settings[key]
    this.settings[key] = value
    if (old !== value) {
      this._scheduleSave()
      this.emit('changed', key, value, old)
    }
  }

  getAll(): AppSettings {
    return { ...this.settings }
  }

  setAll(settings: Partial<AppSettings>): void {
    for (const [key, value] of Object.entries(settings)) {
      this.set(key as keyof AppSettings, value as AppSettings[keyof AppSettings])
    }
  }

  reset(): void {
    this.settings = { ...DEFAULT_SETTINGS }
    this._scheduleSave()
    this.emit('reset')
  }

  /** Export settings as JSON string */
  toJSON(): string {
    return JSON.stringify(this.settings, null, 2)
  }

  /** Import settings from JSON string */
  fromJSON(json: string): void {
    const parsed: unknown = JSON.parse(json)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('Settings JSON must be a plain object')
    }
    const raw = parsed as Record<string, unknown>
    const validKeys = new Set<string>(Object.keys(DEFAULT_SETTINGS))
    const filtered: Partial<AppSettings> = {}
    for (const key of Object.keys(raw)) {
      if (validKeys.has(key)) {
        ;(filtered as Record<string, unknown>)[key] = raw[key]
      }
    }
    this.setAll(filtered)
  }

  /** Flush any pending save immediately. Call before app quit. */
  flush(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    this._writeToDisk()
  }

  private _loadFromDisk(): Partial<AppSettings> {
    if (!this.filePath) return {}
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8')
      const parsed: unknown = JSON.parse(raw)
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
      const validKeys = new Set<string>(Object.keys(DEFAULT_SETTINGS))
      const filtered: Partial<AppSettings> = {}
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (validKeys.has(key)) {
          ;(filtered as Record<string, unknown>)[key] = value
        }
      }
      return filtered
    } catch {
      return {}
    }
  }

  private _scheduleSave(): void {
    if (!this.filePath) return
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      this._writeToDisk()
    }, 500)
  }

  private _writeToDisk(): void {
    if (!this.filePath) return
    try {
      const dir = path.dirname(this.filePath)
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(this.filePath, JSON.stringify(this.settings, null, 2), 'utf-8')
    } catch (err) {
      console.warn('[SettingsManager] Failed to save settings:', err)
    }
  }
}

export { DEFAULT_SETTINGS }
