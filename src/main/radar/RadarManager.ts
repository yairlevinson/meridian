import { EventEmitter } from 'events'
import type { RadarState, RadarUnit, RadarTrack } from '@shared/ipc/RadarTypes'
import type { RadarProvider } from './RadarProvider'
import { RadarSimulator } from './RadarSimulator'
import type { SettingsManager } from '../settings/SettingsManager'
import { createLogger } from '../logger'

const log = createLogger('RadarManager')

const STALE_TRACK_MS = 10_000
const EMIT_RATE_MS = 100

export class RadarManager extends EventEmitter {
  private _units = new Map<number, RadarUnit>()
  private _tracks = new Map<number, RadarTrack>()
  private _provider: RadarProvider | null = null
  private _emitInterval: ReturnType<typeof setInterval> | null = null
  private _enabled = false
  private _simulationActive = false
  private _dirty = false
  private _settings: SettingsManager

  private _onSettingsChanged = (key: string): void => {
    if (key === 'radarEnabled') {
      const enabled = this._settings.get('radarEnabled')
      if (enabled && !this._enabled) this.enable()
      else if (!enabled && this._enabled) this.disable()
    }
    if (key === 'radarRadiusMeters' && this._provider instanceof RadarSimulator) {
      this._provider.setRadius(this._settings.get('radarRadiusMeters'))
    }
    if (key === 'radarSimulationEnabled' && this._enabled) {
      // Restart radar to pick up new provider
      this.disable()
      this.enable()
    }
  }

  constructor(settings: SettingsManager) {
    super()
    this._settings = settings
    settings.on('changed', this._onSettingsChanged)
  }

  get enabled(): boolean {
    return this._enabled
  }

  enable(): void {
    if (this._enabled) return
    this._enabled = true

    const simEnabled = this._settings.get('radarSimulationEnabled')
    if (simEnabled) {
      const sim = new RadarSimulator({
        centerLat: this._settings.get('radarSimulationLat'),
        centerLon: this._settings.get('radarSimulationLon'),
        radiusMeters: this._settings.get('radarRadiusMeters'),
        friendlyCount: this._settings.get('radarSimulationFriendlyCount'),
        hostileCount: this._settings.get('radarSimulationHostileCount')
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
    this._settings.set('radarSimulationLat', lat)
    this._settings.set('radarSimulationLon', lon)
    if (this._provider instanceof RadarSimulator) {
      this._provider.setCenter(lat, lon)
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
    this._settings.removeListener('changed', this._onSettingsChanged)
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
    for (const [id, track] of this._tracks) {
      if (now - track.lastSeenMs > STALE_TRACK_MS) {
        this._tracks.delete(id)
        this._dirty = true
      }
    }
  }

  private _emitState(): void {
    this.emit('stateChanged', this.getState())
  }
}
