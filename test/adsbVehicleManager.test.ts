// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ADSBVehicleManager } from '../src/main/adsb/ADSBVehicleManager'

function makeADSBData(icao: number, overrides: Record<string, unknown> = {}) {
  return {
    ICAOAddress: icao,
    callsign: overrides.callsign ?? 'UAL123\0\0',
    lat: overrides.lat ?? Math.round(42.3898 * 1e7),
    lon: overrides.lon ?? Math.round(-71.1476 * 1e7),
    altitude: overrides.altitude ?? 10000_000, // mm
    heading: overrides.heading ?? 18000, // cdeg (180.00°)
    horVelocity: overrides.horVelocity ?? 25000, // cm/s (250 m/s)
    verVelocity: overrides.verVelocity ?? -500, // cm/s (-5 m/s)
    squawk: overrides.squawk ?? 1200,
    altitudeType: overrides.altitudeType ?? 0
  }
}

describe('ADSBVehicleManager', () => {
  let mgr: ADSBVehicleManager

  beforeEach(() => {
    mgr = new ADSBVehicleManager()
  })

  afterEach(() => mgr.destroy())

  it('adds a new vehicle on first ADSB_VEHICLE message', () => {
    const added = vi.fn()
    mgr.on('vehicleAdded', added)

    mgr.handleADSBVehicle(makeADSBData(0xabcdef))

    expect(added).toHaveBeenCalledTimes(1)
    expect(mgr.vehicleCount).toBe(1)

    const v = mgr.getVehicle(0xabcdef)
    expect(v).toBeDefined()
    expect(v!.icaoAddress).toBe(0xabcdef)
  })

  it('emits vehicleUpdated on subsequent messages for same ICAO', () => {
    const added = vi.fn()
    const updated = vi.fn()
    mgr.on('vehicleAdded', added)
    mgr.on('vehicleUpdated', updated)

    mgr.handleADSBVehicle(makeADSBData(0x123456))
    mgr.handleADSBVehicle(makeADSBData(0x123456, { altitude: 12000_000 }))

    expect(added).toHaveBeenCalledTimes(1)
    expect(updated).toHaveBeenCalledTimes(1)
    expect(mgr.vehicleCount).toBe(1)
  })

  it('converts lat/lon from 1e7 integer to degrees', () => {
    mgr.handleADSBVehicle(
      makeADSBData(1, {
        lat: Math.round(42.3898 * 1e7),
        lon: Math.round(-71.1476 * 1e7)
      })
    )

    const v = mgr.getVehicle(1)!
    expect(v.lat).toBeCloseTo(42.3898, 3)
    expect(v.lon).toBeCloseTo(-71.1476, 3)
  })

  it('converts altitude from mm to meters', () => {
    mgr.handleADSBVehicle(makeADSBData(1, { altitude: 10000_000 }))

    const v = mgr.getVehicle(1)!
    expect(v.altitude).toBe(10000)
  })

  it('converts heading from cdeg to degrees', () => {
    mgr.handleADSBVehicle(makeADSBData(1, { heading: 27045 }))

    const v = mgr.getVehicle(1)!
    expect(v.heading).toBeCloseTo(270.45, 2)
  })

  it('converts horizontal velocity from cm/s to m/s', () => {
    mgr.handleADSBVehicle(makeADSBData(1, { horVelocity: 25000 }))

    const v = mgr.getVehicle(1)!
    expect(v.velocity).toBe(250)
  })

  it('converts vertical velocity from cm/s to m/s', () => {
    mgr.handleADSBVehicle(makeADSBData(1, { verVelocity: -500 }))

    const v = mgr.getVehicle(1)!
    expect(v.verticalVelocity).toBe(-5)
  })

  it('strips null bytes and trims callsign', () => {
    mgr.handleADSBVehicle(makeADSBData(1, { callsign: 'DAL42\0\0\0' }))

    const v = mgr.getVehicle(1)!
    expect(v.callsign).toBe('DAL42')
  })

  it('tracks multiple vehicles independently', () => {
    mgr.handleADSBVehicle(makeADSBData(100, { callsign: 'AAL1\0' }))
    mgr.handleADSBVehicle(makeADSBData(200, { callsign: 'UAL2\0' }))
    mgr.handleADSBVehicle(makeADSBData(300, { callsign: 'SWA3\0' }))

    expect(mgr.vehicleCount).toBe(3)
    expect(mgr.getVehicle(100)!.callsign).toBe('AAL1')
    expect(mgr.getVehicle(200)!.callsign).toBe('UAL2')
    expect(mgr.getVehicle(300)!.callsign).toBe('SWA3')
  })

  it('getVehicles returns all tracked vehicles', () => {
    mgr.handleADSBVehicle(makeADSBData(1))
    mgr.handleADSBVehicle(makeADSBData(2))

    const vehicles = mgr.getVehicles()
    expect(vehicles).toHaveLength(2)
    expect(vehicles.map((v) => v.icaoAddress).sort()).toEqual([1, 2])
  })

  it('getVehicle returns undefined for unknown ICAO', () => {
    expect(mgr.getVehicle(999)).toBeUndefined()
  })

  it('preserves squawk and altitudeType', () => {
    mgr.handleADSBVehicle(makeADSBData(1, { squawk: 7700, altitudeType: 1 }))

    const v = mgr.getVehicle(1)!
    expect(v.squawk).toBe(7700)
    expect(v.altitudeType).toBe(1)
  })
})

describe('ADSBVehicleManager — stale vehicle cleanup', () => {
  let mgr: ADSBVehicleManager

  beforeEach(() => {
    vi.useFakeTimers()
    mgr = new ADSBVehicleManager()
  })

  afterEach(() => {
    mgr.destroy()
    vi.useRealTimers()
  })

  it('removes vehicle after 60s without update', () => {
    const removed = vi.fn()
    mgr.on('vehicleRemoved', removed)

    mgr.handleADSBVehicle(makeADSBData(0xabc))
    expect(mgr.vehicleCount).toBe(1)

    // Advance past TIMEOUT_MS (60s) + cleanup interval (10s)
    vi.advanceTimersByTime(70_000)

    expect(removed).toHaveBeenCalledWith(0xabc)
    expect(mgr.vehicleCount).toBe(0)
  })

  it('does not remove vehicle that was recently updated', () => {
    const removed = vi.fn()
    mgr.on('vehicleRemoved', removed)

    mgr.handleADSBVehicle(makeADSBData(0xabc))

    // Advance 50s (still within 60s window)
    vi.advanceTimersByTime(50_000)

    // Update the vehicle
    mgr.handleADSBVehicle(makeADSBData(0xabc, { altitude: 11000_000 }))

    // Advance another 50s (total 100s from start, but only 50s since last update)
    vi.advanceTimersByTime(50_000)

    expect(removed).not.toHaveBeenCalled()
    expect(mgr.vehicleCount).toBe(1)
  })

  it('removes only stale vehicles, keeps active ones', () => {
    mgr.handleADSBVehicle(makeADSBData(1))
    mgr.handleADSBVehicle(makeADSBData(2))

    // Advance 50s
    vi.advanceTimersByTime(50_000)

    // Update vehicle 2 only
    mgr.handleADSBVehicle(makeADSBData(2, { altitude: 12000_000 }))

    // Advance another 20s (vehicle 1 now 70s stale, vehicle 2 only 20s)
    vi.advanceTimersByTime(20_000)

    expect(mgr.vehicleCount).toBe(1)
    expect(mgr.getVehicle(1)).toBeUndefined()
    expect(mgr.getVehicle(2)).toBeDefined()
  })

  it('destroy stops cleanup interval', () => {
    mgr.handleADSBVehicle(makeADSBData(1))
    mgr.destroy()

    // Advance well past timeout
    vi.advanceTimersByTime(120_000)

    // Vehicle still there (no cleanup ran)
    expect(mgr.vehicleCount).toBe(1)
  })
})
