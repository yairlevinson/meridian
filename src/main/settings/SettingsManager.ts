import { EventEmitter } from 'events'
import fs from 'fs'
import path from 'path'
import { DEFAULT_SETTINGS, type AppSettings } from '@shared/ipc/AppSettings'

export type { AppSettings }
export { DEFAULT_SETTINGS }

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
