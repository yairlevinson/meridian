import { EventEmitter } from 'events'
import type { AppSettings } from '@shared/ipc/AppSettings'
import type { RadarSettings, RadarState } from '@shared/ipc/RadarTypes'
import type { SettingsManager } from '../../main/settings/SettingsManager'
import { RadarManager } from '../../utility/radar/RadarManager'

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

function snapshotRadarSettings(settings: SettingsManager): RadarSettings {
  return {
    radarEnabled: settings.get('radarEnabled'),
    radarRadiusMeters: settings.get('radarRadiusMeters'),
    radarTrackStaleMs: settings.get('radarTrackStaleMs'),
    radarSimulationEnabled: settings.get('radarSimulationEnabled'),
    radarSimulationFriendlyCount: settings.get('radarSimulationFriendlyCount'),
    radarSimulationHostileCount: settings.get('radarSimulationHostileCount'),
    radarSimulationLat: settings.get('radarSimulationLat'),
    radarSimulationLon: settings.get('radarSimulationLon'),
    radarSimulationMinSpeedMs: settings.get('radarSimulationMinSpeedMs'),
    radarSimulationMaxSpeedMs: settings.get('radarSimulationMaxSpeedMs')
  }
}

export class ServerRadarManager extends EventEmitter {
  private readonly radar: RadarManager

  private readonly onSettingsChanged = (key: keyof AppSettings, value: unknown): void => {
    if (!RADAR_KEYS.includes(key as keyof RadarSettings)) return
    this.radar.updateSettings({ [key]: value } as Partial<RadarSettings>)
  }

  private readonly onStateChanged = (state: RadarState): void => {
    this.emit('stateChanged', state)
  }

  constructor(private readonly settings: SettingsManager) {
    super()
    this.radar = new RadarManager(snapshotRadarSettings(settings))
    this.radar.on('stateChanged', this.onStateChanged)
    this.settings.on('changed', this.onSettingsChanged)
    if (this.settings.get('radarEnabled')) this.radar.enable()
  }

  enable(): void {
    this.radar.enable()
  }

  disable(): void {
    this.radar.disable()
  }

  getState(): RadarState {
    return this.radar.getState()
  }

  setSimulationPosition(lat: number, lon: number): void {
    this.settings.set('radarSimulationLat', lat)
    this.settings.set('radarSimulationLon', lon)
    this.radar.setSimulationPosition(lat, lon)
  }

  destroy(): void {
    this.settings.off('changed', this.onSettingsChanged)
    this.radar.off('stateChanged', this.onStateChanged)
    this.radar.destroy()
    this.removeAllListeners()
  }
}
