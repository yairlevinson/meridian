import { EventEmitter } from 'events'
import type { RadarSettings, RadarState, RadarUnit, RadarTrack } from '@shared/ipc/RadarTypes'
import type { RadarProvider } from './RadarProvider'
import { RadarSimulator } from './RadarSimulator'
import { createLogger } from '../logger'

const log = createLogger('RadarManager')

const EMIT_RATE_MS = 100

/**
 * Runs the radar provider and aggregates unit/track updates into a single
 * debounced `stateChanged` event. Settings are pushed in from the main process
 * (see `RadarProxy` on the main side) rather than read from disk.
 */
export class RadarManager extends EventEmitter {
  private _units = new Map<number, RadarUnit>()
  private _tracks = new Map<number, RadarTrack>()
  private _provider: RadarProvider | null = null
  private _emitInterval: ReturnType<typeof setInterval> | null = null
  private _enabled = false
  private _simulationActive = false
  private _dirty = false
  private _settings: RadarSettings

  constructor(initial: RadarSettings) {
    super()
    this._settings = { ...initial }
  }

  get enabled(): boolean {
    return this._enabled
  }

  enable(): void {
    if (this._enabled) return
    this._enabled = true

    if (this._settings.radarSimulationEnabled) {
      const sim = new RadarSimulator({
        centerLat: this._settings.radarSimulationLat,
        centerLon: this._settings.radarSimulationLon,
        radiusMeters: this._settings.radarRadiusMeters,
        friendlyCount: this._settings.radarSimulationFriendlyCount,
        hostileCount: this._settings.radarSimulationHostileCount,
        minSpeedMs: this._settings.radarSimulationMinSpeedMs,
        maxSpeedMs: this._settings.radarSimulationMaxSpeedMs
      })
      this._attachProvider(sim)
      sim.start()
      this._simulationActive = true
      log.log('radar enabled (simulation)')
    } else {
      log.log('radar enabled (no provider)')
    }

    this._dirty = true
    this._startEmitLoop()
  }

  disable(): void {
    if (!this._enabled) return
    this._enabled = false
    this._simulationActive = false
    this._stopEmitLoop()

    if (this._provider) {
      this._provider.stop()
      this._provider.removeAllListeners()
      this._provider = null
    }

    this._units.clear()
    this._tracks.clear()
    this._emitState()
    log.log('radar disabled')
  }

  setSimulationPosition(lat: number, lon: number): void {
    this._settings.radarSimulationLat = lat
    this._settings.radarSimulationLon = lon
    if (this._provider instanceof RadarSimulator) {
      this._provider.setCenter(lat, lon)
    }
  }

  /**
   * Apply a partial settings update. Mirrors the old SettingsManager `changed`
   * listener: toggling `radarEnabled` drives enable/disable, radius changes
   * flow through to the sim provider, and toggling `radarSimulationEnabled`
   * while running forces a provider restart.
   */
  updateSettings(patch: Partial<RadarSettings>): void {
    const prev = this._settings
    this._settings = { ...prev, ...patch }

    if ('radarEnabled' in patch) {
      const enabled = this._settings.radarEnabled
      if (enabled && !this._enabled) this.enable()
      else if (!enabled && this._enabled) this.disable()
    }
    if (
      'radarRadiusMeters' in patch &&
      this._settings.radarRadiusMeters !== prev.radarRadiusMeters &&
      this._provider instanceof RadarSimulator
    ) {
      this._provider.setRadius(this._settings.radarRadiusMeters)
    }
    if (
      ('radarSimulationMinSpeedMs' in patch || 'radarSimulationMaxSpeedMs' in patch) &&
      this._provider instanceof RadarSimulator
    ) {
      this._provider.setSpeedRange(
        this._settings.radarSimulationMinSpeedMs,
        this._settings.radarSimulationMaxSpeedMs
      )
    }
    if (
      'radarSimulationEnabled' in patch &&
      this._settings.radarSimulationEnabled !== prev.radarSimulationEnabled &&
      this._enabled
    ) {
      this.disable()
      this.enable()
    }
  }

  getState(): RadarState {
    return {
      enabled: this._enabled,
      units: Array.from(this._units.values()),
      tracks: Array.from(this._tracks.values()),
      simulationActive: this._simulationActive
    }
  }

  destroy(): void {
    this.disable()
    this.removeAllListeners()
  }

  private _attachProvider(provider: RadarProvider): void {
    this._provider = provider
    provider.on('unitUpdate', (unit) => {
      this._units.set(unit.id, unit)
      this._dirty = true
    })
    provider.on('trackUpdate', (track) => {
      this._tracks.set(track.id, track)
      this._dirty = true
    })
    provider.on('trackRemoved', (trackId) => {
      this._tracks.delete(trackId)
      this._dirty = true
    })
  }

  private _startEmitLoop(): void {
    if (this._emitInterval) return
    this._emitInterval = setInterval(() => {
      this._pruneStale()
      if (this._dirty) {
        this._dirty = false
        this._emitState()
      }
    }, EMIT_RATE_MS)
  }

  private _stopEmitLoop(): void {
    if (this._emitInterval) {
      clearInterval(this._emitInterval)
      this._emitInterval = null
    }
  }

  private _pruneStale(): void {
    const now = Date.now()
    const staleMs = this._settings.radarTrackStaleMs
    for (const [id, track] of this._tracks) {
      if (now - track.lastSeenMs > staleMs) {
        this._tracks.delete(id)
        this._dirty = true
      }
    }
  }

  private _emitState(): void {
    this.emit('stateChanged', this.getState())
  }
}
