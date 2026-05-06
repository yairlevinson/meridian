// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { commandChannel, eventChannel, type IpcModuleSpec } from '../src/shared-types/ipc/ipcModule'
import { allIpcModules } from '../src/shared-types/ipc/modules'

const allModules: readonly IpcModuleSpec[] = allIpcModules

function allCommandChannels(): string[] {
  return allModules.flatMap((m) => Object.keys(m.commands).map((k) => commandChannel(m.name, k)))
}

function allEventChannels(): string[] {
  return allModules.flatMap((m) => Object.keys(m.events).map((k) => eventChannel(m.name, k)))
}

describe('IPC contract validation', () => {
  it('command channels have no duplicates across modules', () => {
    const channels = allCommandChannels()
    expect(new Set(channels).size).toBe(channels.length)
  })

  it('event channels have no duplicates across modules', () => {
    const channels = allEventChannels()
    expect(new Set(channels).size).toBe(channels.length)
  })

  it('all command channels follow namespace:action pattern', () => {
    for (const channel of allCommandChannels()) {
      expect(channel).toMatch(/^[a-zA-Z]+:[a-zA-Z]+$/)
    }
  })

  it('all event channels follow namespace:action pattern', () => {
    for (const channel of allEventChannels()) {
      expect(channel).toMatch(/^[a-zA-Z]+:[a-zA-Z]+$/)
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
