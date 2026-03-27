// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { useVehicleStore } from '../src/renderer/src/store/vehicleStore'
import type { VehicleSnapshot } from '../src/shared-types/ipc/VehicleState'

/**
 * Test that the fly view components can consume vehicle state correctly.
 * These tests operate at the store level since we don't want to pull in
 * full React rendering (that's covered by E2E tests).
 */
describe('Fly View — store-driven component logic', () => {
  beforeEach(() => {
    useVehicleStore.setState({
      vehicles: {},
      activeVehicleId: null,
      ipcLatency: 0,
      mergeCount: 0
    })
  })

  it('InstrumentPanel reads vfrHud from store', () => {
    useVehicleStore.getState().mergeDelta(
      1,
      {
        vfrHud: {
          airspeed: 15.5,
          groundspeed: 12.3,
          heading: 270,
          throttle: 65,
          altitude: 120.5,
          climbRate: 2.1,
          seq: 1
        }
      },
      Date.now()
    )
    const hud = useVehicleStore.getState().vehicles[1]?.vfrHud
    expect(hud?.groundspeed).toBeCloseTo(12.3)
    expect(hud?.heading).toBe(270)
    expect(hud?.throttle).toBe(65)
  })

  it('GpsStatus reads gpsRaw from store', () => {
    useVehicleStore.getState().mergeDelta(
      1,
      {
        gpsRaw: {
          fixType: 3,
          satelliteCount: 12,
          hdop: 1.2,
          vdop: 2.1,
          lat: 32.0,
          lon: 34.8,
          alt: 150,
          seq: 1
        }
      },
      Date.now()
    )
    const gpsRaw = useVehicleStore.getState().vehicles[1]?.gpsRaw
    expect(gpsRaw?.fixType).toBe(3)
    expect(gpsRaw?.satelliteCount).toBe(12)
    expect(gpsRaw?.hdop).toBeCloseTo(1.2)
  })

  it('BatteryStatus renders multiple instances', () => {
    useVehicleStore.getState().mergeDelta(
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
    const battery = useVehicleStore.getState().vehicles[1]?.battery
    expect(battery?.batteries).toHaveLength(2)
    expect(battery?.batteries[0].remaining).toBe(75)
    expect(battery?.batteries[1].remaining).toBe(40)
  })

  it('ArmedIndicator reads core.armed from store', () => {
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
          systemStatus: 4,
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
    expect(core?.armed).toBe(true)
    expect(core?.flightModeName).toBe('GUIDED')
  })

  it('Compass reads heading from vfrHud in store', () => {
    useVehicleStore.getState().mergeDelta(
      1,
      {
        vfrHud: {
          airspeed: 10,
          groundspeed: 8,
          heading: 45,
          throttle: 50,
          altitude: 100,
          climbRate: 0,
          seq: 1
        }
      },
      Date.now()
    )
    const hud = useVehicleStore.getState().vehicles[1]?.vfrHud
    expect(hud?.heading).toBe(45)
  })

  it('Compass heading updates when vfrHud delta arrives', () => {
    useVehicleStore.getState().mergeDelta(
      1,
      {
        vfrHud: {
          airspeed: 10,
          groundspeed: 8,
          heading: 0,
          throttle: 50,
          altitude: 100,
          climbRate: 0,
          seq: 1
        }
      },
      Date.now()
    )
    expect(useVehicleStore.getState().vehicles[1]?.vfrHud?.heading).toBe(0)

    useVehicleStore.getState().mergeDelta(
      1,
      {
        vfrHud: {
          airspeed: 10,
          groundspeed: 8,
          heading: 180,
          throttle: 50,
          altitude: 100,
          climbRate: 0,
          seq: 2
        }
      },
      Date.now()
    )
    expect(useVehicleStore.getState().vehicles[1]?.vfrHud?.heading).toBe(180)
  })

  it('delta encoding: only GPS changed -> battery key absent', () => {
    useVehicleStore.getState().mergeDelta(
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
        },
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
            }
          ],
          seq: 1
        }
      },
      Date.now()
    )

    // Send only GPS delta
    const gpsOnlyDelta: Partial<VehicleSnapshot> = {
      gps: {
        lat: 32.1,
        lon: 34.9,
        alt: 110,
        relativeAlt: 60,
        vx: 1,
        vy: 2,
        vz: 0,
        hdg: 190,
        seq: 2
      }
    }
    expect(gpsOnlyDelta.battery).toBeUndefined()

    useVehicleStore.getState().mergeDelta(1, gpsOnlyDelta, Date.now())

    const snap = useVehicleStore.getState().vehicles[1]
    expect(snap?.gps?.lat).toBeCloseTo(32.1)
    expect(snap?.battery?.batteries[0].voltage).toBeCloseTo(12.6) // unchanged
  })
})
