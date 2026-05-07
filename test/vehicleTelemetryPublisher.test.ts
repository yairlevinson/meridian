// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { VehicleTelemetryPublisher } from '../src/runtime/vehicle/VehicleTelemetryPublisher'

function createVehicle(sysid: number, dirty = true) {
  return {
    sysid,
    hasDirty: vi.fn(() => dirty),
    getDelta: vi.fn(() => ({ core: { sysid, armed: true } }))
  }
}

describe('VehicleTelemetryPublisher', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('emits deltas for dirty vehicles', () => {
    vi.useFakeTimers()
    const vehicle = createVehicle(1)
    const manager = {
      getAllVehicles: () => [vehicle],
      vehicleCount: 1
    }
    const publisher = new VehicleTelemetryPublisher(manager as any, { tickRateMs: 33 })
    const deltas: unknown[] = []
    publisher.on('delta', (payload) => deltas.push(payload))

    vi.advanceTimersByTime(34)

    expect(deltas).toHaveLength(1)
    expect(deltas[0]).toMatchObject({ vehicleId: 1, delta: { core: { sysid: 1 } } })
    expect(vehicle.getDelta).toHaveBeenCalledTimes(1)
    publisher.dispose()
  })

  it('does not consume dirty state when publishing is disabled', () => {
    vi.useFakeTimers()
    const vehicle = createVehicle(1)
    const manager = {
      getAllVehicles: () => [vehicle],
      vehicleCount: 1
    }
    const publisher = new VehicleTelemetryPublisher(manager as any, {
      tickRateMs: 33,
      shouldPublish: () => false
    })
    const deltas: unknown[] = []
    publisher.on('delta', (payload) => deltas.push(payload))

    vi.advanceTimersByTime(34)

    expect(deltas).toHaveLength(0)
    expect(vehicle.hasDirty).not.toHaveBeenCalled()
    expect(vehicle.getDelta).not.toHaveBeenCalled()
    publisher.dispose()
  })
})
