// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { IpcChannels } from '../src/shared-types/ipc/channels'
import { IpcEvents } from '../src/shared-types/ipc/events'

describe('IPC contract validation', () => {
  it('IpcChannels enum has no duplicate values', () => {
    const values = Object.values(IpcChannels)
    const unique = new Set(values)
    expect(unique.size).toBe(values.length)
  })

  it('IpcEvents enum has no duplicate values', () => {
    const values = Object.values(IpcEvents)
    const unique = new Set(values)
    expect(unique.size).toBe(values.length)
  })

  it('all IpcChannels values are non-empty strings', () => {
    for (const value of Object.values(IpcChannels)) {
      expect(typeof value).toBe('string')
      expect(value.length).toBeGreaterThan(0)
    }
  })

  it('all IpcEvents values are non-empty strings', () => {
    for (const value of Object.values(IpcEvents)) {
      expect(typeof value).toBe('string')
      expect(value.length).toBeGreaterThan(0)
    }
  })

  it('IpcChannels follow namespace:action pattern', () => {
    for (const value of Object.values(IpcChannels)) {
      expect(value).toMatch(/^[a-z]+:[a-zA-Z]+$/)
    }
  })

  it('VehicleSnapshot has all required groups', () => {
    // This is a compile-time check — importing the type ensures it exists
    type Check = import('../src/shared-types/ipc/VehicleState').VehicleSnapshot
    const groupNames: Array<keyof Check> = [
      'core',
      'attitude',
      'gps',
      'gpsRaw',
      'home',
      'battery',
      'rc',
      'vfrHud',
      'sysStatus',
      'wind',
      'radio',
      'vibration',
      'extendedState',
      'missionStatus',
      'terrain'
    ]
    expect(groupNames).toHaveLength(15)
  })
})
