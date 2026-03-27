// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useVehicleStore } from '../src/renderer/src/store/vehicleStore'

describe('Emergency Stop — GuidedActions visibility logic', () => {
  beforeEach(() => {
    useVehicleStore.setState({
      vehicles: {},
      activeVehicleId: null,
      ipcLatency: 0,
      mergeCount: 0
    })
  })

  it('flying is true when armed and systemStatus is MAV_STATE_ACTIVE (4)', () => {
    useVehicleStore.getState().mergeDelta(
      1,
      {
        core: {
          sysid: 1,
          compid: 1,
          armed: true,
          flightMode: 4,
          flightModeName: 'GUIDED',
          vehicleType: 2,
          autopilot: 3,
          systemStatus: 4, // MAV_STATE_ACTIVE
          firmwareVersionMajor: 4,
          firmwareVersionMinor: 0,
          firmwareVersionPatch: 3,
          communicationLost: false,
          communicationLostCountdown: 0,
          seq: 1
        }
      },
      Date.now()
    )
    const core = useVehicleStore.getState().vehicles[1]?.core
    const armed = core?.armed ?? false
    const flying = armed && core?.systemStatus === 4
    expect(flying).toBe(true)
  })

  it('flying is false when armed but on ground (systemStatus !== 4)', () => {
    useVehicleStore.getState().mergeDelta(
      1,
      {
        core: {
          sysid: 1,
          compid: 1,
          armed: true,
          flightMode: 0,
          flightModeName: 'STABILIZE',
          vehicleType: 2,
          autopilot: 3,
          systemStatus: 3, // MAV_STATE_STANDBY
          firmwareVersionMajor: 4,
          firmwareVersionMinor: 0,
          firmwareVersionPatch: 3,
          communicationLost: false,
          communicationLostCountdown: 0,
          seq: 1
        }
      },
      Date.now()
    )
    const core = useVehicleStore.getState().vehicles[1]?.core
    const armed = core?.armed ?? false
    const flying = armed && core?.systemStatus === 4
    expect(flying).toBe(false)
  })

  it('flying is false when disarmed', () => {
    useVehicleStore.getState().mergeDelta(
      1,
      {
        core: {
          sysid: 1,
          compid: 1,
          armed: false,
          flightMode: 0,
          flightModeName: 'STABILIZE',
          vehicleType: 2,
          autopilot: 3,
          systemStatus: 3,
          firmwareVersionMajor: 4,
          firmwareVersionMinor: 0,
          firmwareVersionPatch: 3,
          communicationLost: false,
          communicationLostCountdown: 0,
          seq: 1
        }
      },
      Date.now()
    )
    const core = useVehicleStore.getState().vehicles[1]?.core
    const armed = core?.armed ?? false
    const flying = armed && core?.systemStatus === 4
    expect(flying).toBe(false)
  })
})
