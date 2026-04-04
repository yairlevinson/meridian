// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { SettingsManager, DEFAULT_SETTINGS } from '../src/main/settings/SettingsManager'

describe('SettingsManager', () => {
  it('returns default values', () => {
    const sm = new SettingsManager()
    expect(sm.get('mapProvider')).toBe('osm')
    expect(sm.get('autoConnectUDP')).toBe(true)
    expect(sm.get('autoConnectUDPPort')).toBe(14550)
    expect(sm.get('distanceUnits')).toBe('meters')
    expect(sm.get('theme')).toBe('dark')
  })

  it('sets and gets values', () => {
    const sm = new SettingsManager()
    sm.set('mapProvider', 'google_satellite')
    expect(sm.get('mapProvider')).toBe('google_satellite')
  })

  it('emits changed event', () => {
    const sm = new SettingsManager()
    const changed = vi.fn()
    sm.on('changed', changed)

    sm.set('distanceUnits', 'feet')
    expect(changed).toHaveBeenCalledWith('distanceUnits', 'feet', 'meters')
  })

  it('does not emit if value unchanged', () => {
    const sm = new SettingsManager()
    const changed = vi.fn()
    sm.on('changed', changed)

    sm.set('mapProvider', 'osm') // same as default
    expect(changed).not.toHaveBeenCalled()
  })

  it('getAll returns a copy', () => {
    const sm = new SettingsManager()
    const all = sm.getAll()
    all.mapProvider = 'modified'
    expect(sm.get('mapProvider')).toBe('osm') // original unmodified
  })

  it('setAll updates multiple settings', () => {
    const sm = new SettingsManager()
    sm.setAll({ mapProvider: 'bing_satellite', theme: 'light', maxFlightAltitude: 200 })
    expect(sm.get('mapProvider')).toBe('bing_satellite')
    expect(sm.get('theme')).toBe('light')
    expect(sm.get('maxFlightAltitude')).toBe(200)
  })

  it('accepts initial settings in constructor', () => {
    const sm = new SettingsManager({ initial: { mapProvider: 'esri_satellite', language: 'fr' } })
    expect(sm.get('mapProvider')).toBe('esri_satellite')
    expect(sm.get('language')).toBe('fr')
    expect(sm.get('theme')).toBe('dark') // default
  })

  it('resets to defaults', () => {
    const sm = new SettingsManager()
    sm.set('mapProvider', 'custom')
    sm.reset()
    expect(sm.get('mapProvider')).toBe('osm')
  })

  it('exports and imports JSON', () => {
    const sm1 = new SettingsManager()
    sm1.set('mapProvider', 'google_hybrid')
    sm1.set('batteryPercentWarning', 25)
    const json = sm1.toJSON()

    const sm2 = new SettingsManager()
    sm2.fromJSON(json)
    expect(sm2.get('mapProvider')).toBe('google_hybrid')
    expect(sm2.get('batteryPercentWarning')).toBe(25)
  })

  it('has all ArduPilot stream rate settings', () => {
    const sm = new SettingsManager()
    expect(sm.get('streamRatePosition')).toBe(4)
    expect(sm.get('streamRateExtra1')).toBe(10)
    expect(sm.get('streamRateExtra2')).toBe(4)
    expect(sm.get('streamRateExtra3')).toBe(2)
    expect(sm.get('streamRateRCChannels')).toBe(2)
    expect(sm.get('streamRateRawSensors')).toBe(2)
  })

  it('battery warning thresholds have sensible defaults', () => {
    expect(DEFAULT_SETTINGS.batteryPercentWarning).toBe(30)
    expect(DEFAULT_SETTINGS.batteryPercentCritical).toBe(15)
    expect(DEFAULT_SETTINGS.batteryPercentWarning).toBeGreaterThan(
      DEFAULT_SETTINGS.batteryPercentCritical
    )
  })
})
