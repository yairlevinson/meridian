import { EventEmitter } from 'events'
import type { RadarSettings, RadarState } from '@shared/ipc/RadarTypes'
import type { SettingsManager } from '../settings/SettingsManager'
import type { UtilityBridge } from '../utility/UtilityBridge'
import { createLogger } from '../logger'

const log = createLogger('RadarProxy')

const EMPTY_STATE: RadarState = { enabled: false, units: [], tracks: [], simulationActive: false }

const RADAR_KEYS: readonly (keyof RadarSettings)[] = [
  'radarEnabled',
  'radarRadiusMeters',
  'radarTrackStaleMs',
  'radarSimulationEnabled',
  'radarSimulationFriendlyCount',
  'radarSimulationHostileCount',
  'radarSimulationLat',
  'radarSimulationLon',
  'radarSimulationMinSpeedMs',
  'radarSimulationMaxSpeedMs'
]

function snapshotRadarSettings(sm: SettingsManager): RadarSettings {
  return {
    radarEnabled: sm.get('radarEnabled'),
    radarRadiusMeters: sm.get('radarRadiusMeters'),
    radarTrackStaleMs: sm.get('radarTrackStaleMs'),
    radarSimulationEnabled: sm.get('radarSimulationEnabled'),
    radarSimulationFriendlyCount: sm.get('radarSimulationFriendlyCount'),
    radarSimulationHostileCount: sm.get('radarSimulationHostileCount'),
    radarSimulationLat: sm.get('radarSimulationLat'),
    radarSimulationLon: sm.get('radarSimulationLon'),
    radarSimulationMinSpeedMs: sm.get('radarSimulationMinSpeedMs'),
    radarSimulationMaxSpeedMs: sm.get('radarSimulationMaxSpeedMs')
  }
}

/**
 * Main-side proxy for the RadarManager that actually runs in the utility
 * process. Provides the same sync-ish surface that ipcBridge/index used to get
 * from the in-process manager: enable/disable/setSimulationPosition are
 * fire-and-forget RPCs, and `stateChanged` is re-emitted from utility events.
 */
export class RadarProxy extends EventEmitter {
  private _bridge: UtilityBridge
  private _settings: SettingsManager
  private _latestState: RadarState = EMPTY_STATE
  private _onSettingsChanged = (key: string, value: unknown): void => {
    if (!RADAR_KEYS.includes(key as keyof RadarSettings)) return
    this._bridge
      .call('radar:updateSettings', { [key]: value })
      .catch((err) => log.warn(`updateSettings(${key}) failed: ${err.message}`))
  }
  private _onStateChanged = (payload: unknown): void => {
    this._latestState = payload as RadarState
    this.emit('stateChanged', this._latestState)
  }

  constructor(bridge: UtilityBridge, settings: SettingsManager) {
    super()
    this._bridge = bridge
    this._settings = settings

    this._bridge.on('radar:stateChanged', this._onStateChanged)
    this._bridge
      .call('radar:init', snapshotRadarSettings(settings))
      .catch((err) => log.warn(`init failed: ${err.message}`))
    this._settings.on('changed', this._onSettingsChanged)
  }

  enable(): void {
    this._bridge.call('radar:enable').catch((err) => log.warn(`enable failed: ${err.message}`))
  }

  disable(): void {
    this._bridge.call('radar:disable').catch((err) => log.warn(`disable failed: ${err.message}`))
  }

  setSimulationPosition(lat: number, lon: number): void {
    this._settings.set('radarSimulationLat', lat)
    this._settings.set('radarSimulationLon', lon)
    this._bridge
      .call('radar:setSimPosition', lat, lon)
      .catch((err) => log.warn(`setSimPosition failed: ${err.message}`))
  }

  getState(): RadarState {
    return this._latestState
  }

  destroy(): void {
    this._settings.removeListener('changed', this._onSettingsChanged)
    this._bridge.removeListener('radar:stateChanged', this._onStateChanged)
    this.removeAllListeners()
  }
}
