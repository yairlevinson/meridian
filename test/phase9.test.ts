// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  ComponentInformationManager,
  CompMetadataType
} from '../src/main/componentinfo/ComponentInformationManager'
import { TerrainProtocolHandler } from '../src/main/terrain/TerrainProtocolHandler'
import { JoystickManager } from '../src/main/joystick/JoystickManager'
import { ADSBVehicleManager } from '../src/main/adsb/ADSBVehicleManager'
import { GimbalController } from '../src/main/gimbal/GimbalController'
import { MockLink } from '../src/test-utils/MockLink/MockLink'

describe('ComponentInformationManager', () => {
  it('stores and retrieves metadata', () => {
    const cim = new ComponentInformationManager('/tmp/test-cache')
    cim.setMetadata(CompMetadataType.PARAMETER, { version: 1, params: {} })

    expect(cim.hasMetadata(CompMetadataType.PARAMETER)).toBe(true)
    expect(cim.getMetadata(CompMetadataType.PARAMETER)?.data).toEqual({ version: 1, params: {} })
  })

  it('reports missing metadata correctly', () => {
    const cim = new ComponentInformationManager('/tmp/test-cache')
    expect(cim.hasMetadata(CompMetadataType.GENERAL)).toBe(false)
  })

  it('emits metadataReady event', () => {
    const cim = new ComponentInformationManager('/tmp/test-cache')
    const events: CompMetadataType[] = []
    cim.on('metadataReady', (type) => events.push(type))

    cim.setMetadata(CompMetadataType.EVENTS, { events: [] })
    expect(events).toEqual([CompMetadataType.EVENTS])
  })
})

describe('TerrainProtocolHandler', () => {
  it('stores and retrieves terrain tiles', () => {
    const tph = new TerrainProtocolHandler()
    const elevations = new Int16Array(256)
    elevations.fill(150)
    tph.addTile(32.0, 34.8, 30, elevations)

    expect(tph.tileCount).toBe(1)
  })

  it('returns elevation from nearest tile', () => {
    const tph = new TerrainProtocolHandler()
    const elevations = new Int16Array(256)
    elevations.fill(150)
    tph.addTile(32.0, 34.8, 30, elevations)

    const elev = tph.getElevation(32.0, 34.8)
    expect(elev).toBe(150)
  })

  it('returns null when no tiles available', () => {
    const tph = new TerrainProtocolHandler()
    expect(tph.getElevation(32.0, 34.8)).toBeNull()
  })
})

describe('JoystickManager', () => {
  let jm: JoystickManager

  beforeEach(() => {
    jm = new JoystickManager({ deadband: 0.1, expo: 0.0 })
  })

  afterEach(() => {
    jm.destroy()
  })

  it('applies deadband — small values become 0', () => {
    jm.updateState({
      axes: [0.05, 0.05, 0.05, 0.05],
      buttons: [],
      connected: true,
      name: 'Test Gamepad'
    })

    const axes = jm.getProcessedAxes()
    expect(axes.roll).toBe(0)
    expect(axes.pitch).toBe(0)
  })

  it('scales output after deadband', () => {
    jm.updateState({
      axes: [0.55, 0, 0, 0], // 0.55 with 0.1 deadband → (0.55-0.1)/0.9 ≈ 0.5
      buttons: [],
      connected: true,
      name: 'Test Gamepad'
    })

    const axes = jm.getProcessedAxes()
    expect(axes.roll).toBeCloseTo(0.5, 1)
  })

  it('applies expo curve', () => {
    const jmExpo = new JoystickManager({ deadband: 0.0, expo: 1.0 })
    jmExpo.updateState({
      axes: [0.5, 0, 0, 0], // with full expo: 0*0.5 + 1*0.5^3 = 0.125
      buttons: [],
      connected: true,
      name: 'Test Gamepad'
    })

    const axes = jmExpo.getProcessedAxes()
    expect(axes.roll).toBeCloseTo(0.125, 2)
    jmExpo.destroy()
  })

  it('emits output events at 30Hz when connected', async () => {
    const outputs: unknown[] = []
    jm.on('output', (o) => outputs.push(o))

    jm.updateState({
      axes: [0.5, 0, 0, 0],
      buttons: [],
      connected: true,
      name: 'Test Gamepad'
    })

    await new Promise((r) => setTimeout(r, 200))
    jm.destroy()

    expect(outputs.length).toBeGreaterThan(3) // ~6 at 30Hz over 200ms
  })

  it('tracks connection state', () => {
    expect(jm.isConnected).toBe(false)
    jm.updateState({ axes: [], buttons: [], connected: true, name: 'Test' })
    expect(jm.isConnected).toBe(true)
  })
})

describe('ADSBVehicleManager', () => {
  let adsb: ADSBVehicleManager

  beforeEach(() => {
    adsb = new ADSBVehicleManager()
  })

  afterEach(() => {
    adsb.destroy()
  })

  it('adds and retrieves ADSB vehicles', () => {
    adsb.handleADSBVehicle({
      ICAOAddress: 0xabcdef,
      callsign: 'UAL123\0\0',
      lat: 423890000,
      lon: -711470000,
      altitude: 10000000, // 10000m
      heading: 27000, // 270°
      horVelocity: 25000, // 250 m/s
      verVelocity: 500, // 5 m/s
      squawk: 1200,
      altitudeType: 0
    })

    expect(adsb.vehicleCount).toBe(1)
    const v = adsb.getVehicle(0xabcdef)
    expect(v).toBeDefined()
    expect(v!.callsign).toBe('UAL123')
    expect(v!.lat).toBeCloseTo(42.389, 3)
    expect(v!.altitude).toBeCloseTo(10000, 0)
    expect(v!.heading).toBeCloseTo(270, 0)
  })

  it('updates existing vehicle', () => {
    const events: string[] = []
    adsb.on('vehicleAdded', () => events.push('added'))
    adsb.on('vehicleUpdated', () => events.push('updated'))

    adsb.handleADSBVehicle({
      ICAOAddress: 0x123,
      callsign: 'TEST\0\0\0\0',
      lat: 320000000,
      lon: 348000000,
      altitude: 5000000,
      heading: 18000,
      horVelocity: 10000,
      verVelocity: 0,
      squawk: 7700,
      altitudeType: 1
    })

    adsb.handleADSBVehicle({
      ICAOAddress: 0x123,
      callsign: 'TEST\0\0\0\0',
      lat: 320010000,
      lon: 348010000,
      altitude: 5100000,
      heading: 18500,
      horVelocity: 10000,
      verVelocity: 0,
      squawk: 7700,
      altitudeType: 1
    })

    expect(events).toEqual(['added', 'updated'])
    expect(adsb.vehicleCount).toBe(1) // same vehicle, updated
  })

  it('getAllVehicles returns all tracked vehicles', () => {
    adsb.handleADSBVehicle({
      ICAOAddress: 0x111,
      callsign: 'A\0\0\0\0\0\0\0',
      lat: 0,
      lon: 0,
      altitude: 0,
      heading: 0,
      horVelocity: 0,
      verVelocity: 0,
      squawk: 0,
      altitudeType: 0
    })
    adsb.handleADSBVehicle({
      ICAOAddress: 0x222,
      callsign: 'B\0\0\0\0\0\0\0',
      lat: 0,
      lon: 0,
      altitude: 0,
      heading: 0,
      horVelocity: 0,
      verVelocity: 0,
      squawk: 0,
      altitudeType: 0
    })

    expect(adsb.getVehicles()).toHaveLength(2)
  })
})

describe('GimbalController', () => {
  it('converts quaternion to euler angles', () => {
    const gc = new GimbalController()
    const events: unknown[] = []
    gc.on('attitudeChanged', (s) => events.push(s))

    // Identity quaternion: [1, 0, 0, 0] → all angles 0
    gc.handleAttitudeStatus({
      q: [1, 0, 0, 0],
      angularVelocityX: 0,
      angularVelocityY: 0,
      angularVelocityZ: 0
    })

    const state = gc.currentState
    expect(state.pitch).toBeCloseTo(0, 0)
    expect(state.roll).toBeCloseTo(0, 0)
    expect(state.yaw).toBeCloseTo(0, 0)
    expect(events).toHaveLength(1)
  })

  it('sends gimbal angle command', () => {
    const gc = new GimbalController()
    const link = new MockLink()
    gc.setLink(link)

    gc.setAngles(-30, 45)
    expect(link.sentBuffers).toHaveLength(1)
  })
})
