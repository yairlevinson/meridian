// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { useLinkStore } from '../src/renderer/src/store/linkStore'
import { useParameterStore } from '../src/renderer/src/store/parameterStore'
import { useMissionStore } from '../src/renderer/src/store/missionStore'
import { useSettingsStore } from '../src/renderer/src/store/settingsStore'
import { MissionProtocolState } from '../src/shared-types/ipc/MissionTypes'
import { ParamValueType } from '../src/shared-types/ipc/ParameterTypes'

describe('linkStore', () => {
  beforeEach(() => {
    useLinkStore.setState({ links: [] })
  })

  it('sets and retrieves links', () => {
    useLinkStore.getState().setLinks([
      {
        id: 'link-1',
        config: { type: 'udp' as any, name: 'UDP', listenPort: 14550 },
        status: 'connected' as any,
        mavlinkChannel: 0,
        vehicleIds: [],
        totalReceived: 100,
        totalLoss: 2,
        lossPercent: 1.96
      }
    ])
    expect(useLinkStore.getState().links).toHaveLength(1)
    expect(useLinkStore.getState().links[0].id).toBe('link-1')
  })

  it('updates a specific link', () => {
    useLinkStore.getState().setLinks([
      {
        id: 'link-1',
        config: { type: 'udp' as any, name: 'UDP', listenPort: 14550 },
        status: 'connected' as any,
        mavlinkChannel: 0,
        vehicleIds: [],
        totalReceived: 100,
        totalLoss: 2,
        lossPercent: 1.96
      }
    ])
    useLinkStore.getState().updateLink({
      id: 'link-1',
      config: { type: 'udp' as any, name: 'UDP', listenPort: 14550 },
      status: 'disconnected' as any,
      mavlinkChannel: 0,
      vehicleIds: [],
      totalReceived: 100,
      totalLoss: 2,
      lossPercent: 1.96
    })
    expect(useLinkStore.getState().links[0].status).toBe('disconnected')
  })
})

describe('parameterStore', () => {
  beforeEach(() => {
    useParameterStore.setState({
      parameters: new Map(),
      loadState: {
        totalCount: 0,
        receivedCount: 0,
        loadProgress: 0,
        parametersReady: false,
        missingParameters: false,
        missingIndices: [],
        retryCount: 0,
        pendingWrites: 0
      }
    })
  })

  it('sets parameters from array', () => {
    useParameterStore.getState().setParameters([
      {
        name: 'MPC_XY_VEL_MAX',
        value: 12.0,
        type: ParamValueType.REAL32,
        index: 0,
        componentId: 1
      },
      { name: 'MPC_Z_VEL_MAX', value: 3.0, type: ParamValueType.REAL32, index: 1, componentId: 1 }
    ])
    expect(useParameterStore.getState().parameters.size).toBe(2)
    expect(useParameterStore.getState().parameters.get('MPC_XY_VEL_MAX')?.value).toBe(12.0)
  })

  it('updates a single parameter', () => {
    useParameterStore.getState().setParameters([
      {
        name: 'MPC_XY_VEL_MAX',
        value: 12.0,
        type: ParamValueType.REAL32,
        index: 0,
        componentId: 1
      }
    ])
    useParameterStore.getState().updateParameter({
      name: 'MPC_XY_VEL_MAX',
      value: 15.0,
      type: ParamValueType.REAL32,
      index: 0,
      componentId: 1
    })
    expect(useParameterStore.getState().parameters.get('MPC_XY_VEL_MAX')?.value).toBe(15.0)
  })

  it('updates load state partially', () => {
    useParameterStore.getState().setLoadState({ loadProgress: 0.5, receivedCount: 50 })
    const state = useParameterStore.getState().loadState
    expect(state.loadProgress).toBe(0.5)
    expect(state.receivedCount).toBe(50)
    expect(state.parametersReady).toBe(false) // unchanged
  })
})

describe('missionStore', () => {
  it('sets mission items', () => {
    useMissionStore.getState().setMissionItems([
      {
        seq: 0,
        frame: 3,
        command: 16,
        current: true,
        autocontinue: true,
        param1: 0,
        param2: 0,
        param3: 0,
        param4: 0,
        x: 0,
        y: 0,
        z: 50,
        missionType: 0
      }
    ])
    expect(useMissionStore.getState().missionItems).toHaveLength(1)
  })

  it('tracks protocol state', () => {
    useMissionStore.getState().setProtocolState(MissionProtocolState.ReadingItems)
    expect(useMissionStore.getState().protocolState).toBe('readingItems')
  })

  it('sets geofence data', () => {
    useMissionStore.getState().setFence(
      [
        {
          inclusion: true,
          vertices: [
            { lat: 32, lon: 34 },
            { lat: 32.1, lon: 34.1 },
            { lat: 32, lon: 34.1 }
          ]
        }
      ],
      [{ inclusion: false, center: { lat: 32.05, lon: 34.05 }, radius: 500 }]
    )
    expect(useMissionStore.getState().fencePolygons).toHaveLength(1)
    expect(useMissionStore.getState().fenceCircles).toHaveLength(1)
  })
})

describe('settingsStore', () => {
  it('sets and gets individual settings', () => {
    useSettingsStore.getState().setSetting('mapProvider', 'osm')
    expect(useSettingsStore.getState().settings['mapProvider']).toBe('osm')
  })

  it('sets all settings at once', () => {
    useSettingsStore.getState().setAll({ mapProvider: 'google', units: 'metric' })
    const s = useSettingsStore.getState().settings
    expect(s['mapProvider']).toBe('google')
    expect(s['units']).toBe('metric')
  })
})
