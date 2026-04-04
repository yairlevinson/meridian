// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  ComponentInformationManager,
  CompMetadataType
} from '../src/main/componentinfo/ComponentInformationManager'
import { TerrainProtocolHandler } from '../src/main/terrain/TerrainProtocolHandler'
import { JoystickManager } from '../src/main/joystick/JoystickManager'

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
