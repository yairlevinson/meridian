// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { useVehicleStore } from '../src/renderer/src/store/vehicleStore'
import type { VehicleDelta } from '../src/shared-types/ipc/VehicleState'

describe('vehicleStore', () => {
  beforeEach(() => {
    useVehicleStore.setState({
      vehicles: {},
      activeVehicleId: null,
      ipcLatency: 0,
      mergeCount: 0
    })
  })

  it('merges attitude delta into vehicle snapshot', () => {
    const { mergeDelta } = useVehicleStore.getState()
    mergeDelta(
      1,
      {
        attitude: {
          roll: 0.5,
          pitch: 0.1,
          yaw: 1.0,
          rollSpeed: 0,
          pitchSpeed: 0,
          yawSpeed: 0,
          seq: 1
        }
      },
      Date.now()
    )

    const snap = useVehicleStore.getState().vehicles[1]
    expect(snap?.attitude?.roll).toBeCloseTo(0.5)
    expect(snap?.attitude?.pitch).toBeCloseTo(0.1)
  })

  it('merges gps delta without clobbering existing attitude', () => {
    const { mergeDelta } = useVehicleStore.getState()
    mergeDelta(
      1,
      {
        attitude: {
          roll: 0.3,
          pitch: 0,
          yaw: 0,
          rollSpeed: 0,
          pitchSpeed: 0,
          yawSpeed: 0,
          seq: 1
        }
      },
      Date.now()
    )
    mergeDelta(
      1,
      {
        gps: {
          lat: 32.0,
          lon: 34.8,
          alt: 100,
          relativeAlt: 50,
          vx: 0,
          vy: 0,
          vz: 0,
          hdg: 180,
          seq: 1
        }
      },
      Date.now()
    )

    const snap = useVehicleStore.getState().vehicles[1]
    expect(snap?.attitude?.roll).toBeCloseTo(0.3)
    expect(snap?.gps?.lat).toBeCloseTo(32.0)
  })

  it('increments mergeCount on each delta', () => {
    const { mergeDelta } = useVehicleStore.getState()
    const att: VehicleDelta = {
      attitude: {
        roll: 0,
        pitch: 0,
        yaw: 0,
        rollSpeed: 0,
        pitchSpeed: 0,
        yawSpeed: 0,
        seq: 1
      }
    }
    mergeDelta(1, att, Date.now())
    mergeDelta(
      1,
      {
        attitude: {
          roll: 0.1,
          pitch: 0,
          yaw: 0,
          rollSpeed: 0,
          pitchSpeed: 0,
          yawSpeed: 0,
          seq: 2
        }
      },
      Date.now()
    )

    expect(useVehicleStore.getState().mergeCount).toBe(2)
  })

  it('auto-selects first vehicle as activeVehicleId', () => {
    expect(useVehicleStore.getState().activeVehicleId).toBeNull()
    useVehicleStore.getState().mergeDelta(
      1,
      {
        attitude: {
          roll: 0,
          pitch: 0,
          yaw: 0,
          rollSpeed: 0,
          pitchSpeed: 0,
          yawSpeed: 0,
          seq: 1
        }
      },
      Date.now()
    )
    expect(useVehicleStore.getState().activeVehicleId).toBe(1)
  })

  it('records ipcLatency as time from sentAt to merge', () => {
    const sentAt = Date.now() - 20
    useVehicleStore.getState().mergeDelta(
      1,
      {
        attitude: {
          roll: 0,
          pitch: 0,
          yaw: 0,
          rollSpeed: 0,
          pitchSpeed: 0,
          yawSpeed: 0,
          seq: 1
        }
      },
      sentAt
    )

    const latency = useVehicleStore.getState().ipcLatency
    expect(latency).toBeGreaterThanOrEqual(20)
    expect(latency).toBeLessThan(200)
  })

  it('handles full VehicleSnapshot delta in one merge', () => {
    const { mergeDelta } = useVehicleStore.getState()
    mergeDelta(
      1,
      {
        core: {
          armed: true,
          flightMode: 3,
          flightModeName: 'GUIDED',
          sysid: 1,
          compid: 1,
          vehicleType: 2,
          autopilot: 3,
          systemStatus: 4,
          firmwareVersionMajor: 4,
          firmwareVersionMinor: 0,
          firmwareVersionPatch: 3,
          communicationLost: false,
          communicationLostCountdown: 0,
          seq: 1
        },
        attitude: {
          roll: 0.2,
          pitch: 0.05,
          yaw: 2.1,
          rollSpeed: 0,
          pitchSpeed: 0,
          yawSpeed: 0,
          seq: 1
        },
        gps: {
          lat: 32.1,
          lon: 34.9,
          alt: 120,
          relativeAlt: 80,
          vx: 1,
          vy: 2,
          vz: 0.5,
          hdg: 270,
          seq: 1
        }
      },
      Date.now()
    )

    const snap = useVehicleStore.getState().vehicles[1]
    expect(snap?.core?.armed).toBe(true)
    expect(snap?.attitude?.yaw).toBeCloseTo(2.1)
    expect(snap?.gps?.alt).toBeCloseTo(120)
  })

  it('merges battery group with multiple instances', () => {
    const { mergeDelta } = useVehicleStore.getState()
    mergeDelta(
      1,
      {
        battery: {
          batteries: [
            {
              id: 0,
              voltage: 12.6,
              current: 15,
              remaining: 75,
              temperature: 35,
              cellCount: 3,
              chargeState: 0
            },
            {
              id: 1,
              voltage: 11.8,
              current: 8,
              remaining: 40,
              temperature: 38,
              cellCount: 3,
              chargeState: 0
            }
          ],
          seq: 1
        }
      },
      Date.now()
    )

    const snap = useVehicleStore.getState().vehicles[1]
    expect(snap?.battery?.batteries).toHaveLength(2)
    expect(snap?.battery?.batteries[0].voltage).toBeCloseTo(12.6)
  })

  // ── Multi-vehicle tests ──────────────────────────────────────────

  it('keeps vehicle snapshots independent', () => {
    const { mergeDelta } = useVehicleStore.getState()
    mergeDelta(
      1,
      {
        attitude: { roll: 0.5, pitch: 0, yaw: 0, rollSpeed: 0, pitchSpeed: 0, yawSpeed: 0, seq: 1 }
      },
      Date.now()
    )
    mergeDelta(
      2,
      {
        attitude: { roll: -0.3, pitch: 0, yaw: 0, rollSpeed: 0, pitchSpeed: 0, yawSpeed: 0, seq: 1 }
      },
      Date.now()
    )

    const snap1 = useVehicleStore.getState().vehicles[1]
    const snap2 = useVehicleStore.getState().vehicles[2]
    expect(snap1?.attitude?.roll).toBeCloseTo(0.5)
    expect(snap2?.attitude?.roll).toBeCloseTo(-0.3)
  })

  it('setActiveVehicle switches the active vehicle', () => {
    const { mergeDelta, setActiveVehicle } = useVehicleStore.getState()
    mergeDelta(
      1,
      { attitude: { roll: 0, pitch: 0, yaw: 0, rollSpeed: 0, pitchSpeed: 0, yawSpeed: 0, seq: 1 } },
      Date.now()
    )
    mergeDelta(
      2,
      { attitude: { roll: 0, pitch: 0, yaw: 0, rollSpeed: 0, pitchSpeed: 0, yawSpeed: 0, seq: 1 } },
      Date.now()
    )

    expect(useVehicleStore.getState().activeVehicleId).toBe(1)
    setActiveVehicle(2)
    expect(useVehicleStore.getState().activeVehicleId).toBe(2)
  })

  it('removeVehicle cleans up and selects another active', () => {
    const { mergeDelta, removeVehicle } = useVehicleStore.getState()
    mergeDelta(
      1,
      { attitude: { roll: 0, pitch: 0, yaw: 0, rollSpeed: 0, pitchSpeed: 0, yawSpeed: 0, seq: 1 } },
      Date.now()
    )
    mergeDelta(
      2,
      { attitude: { roll: 0, pitch: 0, yaw: 0, rollSpeed: 0, pitchSpeed: 0, yawSpeed: 0, seq: 1 } },
      Date.now()
    )

    expect(useVehicleStore.getState().activeVehicleId).toBe(1)
    removeVehicle(1)
    expect(useVehicleStore.getState().vehicles[1]).toBeUndefined()
    expect(useVehicleStore.getState().activeVehicleId).toBe(2)
  })

  it('removeVehicle sets null when last vehicle removed', () => {
    const { mergeDelta, removeVehicle } = useVehicleStore.getState()
    mergeDelta(
      1,
      { attitude: { roll: 0, pitch: 0, yaw: 0, rollSpeed: 0, pitchSpeed: 0, yawSpeed: 0, seq: 1 } },
      Date.now()
    )
    removeVehicle(1)
    expect(useVehicleStore.getState().activeVehicleId).toBeNull()
  })

  it('addVehicle creates empty snapshot and auto-selects', () => {
    const { addVehicle } = useVehicleStore.getState()
    addVehicle(5)
    expect(useVehicleStore.getState().vehicles[5]).toEqual({})
    expect(useVehicleStore.getState().activeVehicleId).toBe(5)
  })
})
