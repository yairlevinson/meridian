// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  VehicleType,
  getModeNamesForVehicleType,
  ARDUCOPTER_MODE_NAMES,
  ARDUPLANE_MODE_NAMES,
  ARDUROVER_MODE_NAMES,
  ARDUSUB_MODE_NAMES
} from '../src/shared-types/ipc/SetupTypes'

describe('Vehicle type mode names', () => {
  it('returns ArduCopter modes for Copter type', () => {
    const modes = getModeNamesForVehicleType(VehicleType.Copter)
    expect(modes).toBe(ARDUCOPTER_MODE_NAMES)
    expect(modes[0]).toBe('Stabilize')
    expect(modes[5]).toBe('Loiter')
    expect(modes[6]).toBe('RTL')
  })

  it('returns ArduPlane modes for Plane type', () => {
    const modes = getModeNamesForVehicleType(VehicleType.Plane)
    expect(modes).toBe(ARDUPLANE_MODE_NAMES)
    expect(modes[0]).toBe('Manual')
    expect(modes[5]).toBe('FlyByWireA')
    expect(modes[11]).toBe('RTL')
  })

  it('returns ArduRover modes for Rover type', () => {
    const modes = getModeNamesForVehicleType(VehicleType.Rover)
    expect(modes).toBe(ARDUROVER_MODE_NAMES)
    expect(modes[0]).toBe('Manual')
    expect(modes[4]).toBe('Hold')
    expect(modes[11]).toBe('RTL')
  })

  it('returns ArduSub modes for Sub type', () => {
    const modes = getModeNamesForVehicleType(VehicleType.Sub)
    expect(modes).toBe(ARDUSUB_MODE_NAMES)
    expect(modes[0]).toBe('Stabilize')
    expect(modes[2]).toBe('AltHold')
    expect(modes[19]).toBe('Manual')
  })

  describe('ArduCopter modes', () => {
    it('has all standard copter modes', () => {
      expect(ARDUCOPTER_MODE_NAMES[0]).toBe('Stabilize')
      expect(ARDUCOPTER_MODE_NAMES[1]).toBe('Acro')
      expect(ARDUCOPTER_MODE_NAMES[2]).toBe('AltHold')
      expect(ARDUCOPTER_MODE_NAMES[3]).toBe('Auto')
      expect(ARDUCOPTER_MODE_NAMES[4]).toBe('Guided')
      expect(ARDUCOPTER_MODE_NAMES[9]).toBe('Land')
      expect(ARDUCOPTER_MODE_NAMES[15]).toBe('AutoTune')
      expect(ARDUCOPTER_MODE_NAMES[21]).toBe('SmartRTL')
    })
  })

  describe('ArduPlane modes', () => {
    it('has plane-specific modes', () => {
      expect(ARDUPLANE_MODE_NAMES[5]).toBe('FlyByWireA')
      expect(ARDUPLANE_MODE_NAMES[6]).toBe('FlyByWireB')
      expect(ARDUPLANE_MODE_NAMES[7]).toBe('Cruise')
      expect(ARDUPLANE_MODE_NAMES[17]).toBe('QStabilize')
      expect(ARDUPLANE_MODE_NAMES[18]).toBe('QHover')
      expect(ARDUPLANE_MODE_NAMES[19]).toBe('QLoiter')
    })
  })

  describe('ArduRover modes', () => {
    it('has rover-specific modes', () => {
      expect(ARDUROVER_MODE_NAMES[3]).toBe('Steering')
      expect(ARDUROVER_MODE_NAMES[4]).toBe('Hold')
      expect(ARDUROVER_MODE_NAMES[6]).toBe('Follow')
      expect(ARDUROVER_MODE_NAMES[7]).toBe('Simple')
      expect(ARDUROVER_MODE_NAMES[12]).toBe('SmartRTL')
    })
  })

  describe('ArduSub modes', () => {
    it('has sub-specific modes', () => {
      expect(ARDUSUB_MODE_NAMES[9]).toBe('Surface')
      expect(ARDUSUB_MODE_NAMES[16]).toBe('PosHold')
      expect(ARDUSUB_MODE_NAMES[19]).toBe('Manual')
    })
  })

  it('all vehicle types return non-empty mode tables', () => {
    for (const type of Object.values(VehicleType)) {
      const modes = getModeNamesForVehicleType(type)
      expect(Object.keys(modes).length).toBeGreaterThan(0)
    }
  })
})
