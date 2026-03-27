// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { VehicleManager } from '../src/main/vehicle/VehicleManager'
import type { DecodedMessage } from '../src/main/mavlink/MavlinkChannel'

function heartbeatMsg(sysid: number, compid = 1): DecodedMessage {
  return {
    msgid: 0, // HEARTBEAT
    sysid,
    compid,
    seq: 0,
    data: {
      type: 2,
      autopilot: 3,
      baseMode: 128,
      customMode: 0,
      systemStatus: 4
    }
  }
}

function attitudeMsg(sysid: number): DecodedMessage {
  return {
    msgid: 30, // ATTITUDE
    sysid,
    compid: 1,
    seq: 1,
    data: {
      timeBootMs: 1000,
      roll: 0.1,
      pitch: 0.05,
      yaw: 1.5,
      rollspeed: 0,
      pitchspeed: 0,
      yawspeed: 0
    }
  }
}

describe('VehicleManager', () => {
  let vm: VehicleManager

  beforeEach(() => {
    vm = new VehicleManager()
  })

  afterEach(() => {
    vm.destroy()
  })

  it('auto-creates vehicle on first HEARTBEAT', () => {
    const events: number[] = []
    vm.on('vehicleAdded', (id: number) => events.push(id))

    vm.handleMessage(heartbeatMsg(1), 'link-0')

    expect(vm.vehicleCount).toBe(1)
    expect(vm.getVehicle(1)).toBeDefined()
    expect(events).toEqual([1])
  })

  it('does not create vehicle for non-heartbeat from unknown sysid', () => {
    vm.handleMessage(attitudeMsg(1), 'link-0')
    expect(vm.vehicleCount).toBe(0)
  })

  it('does not create vehicle for heartbeat from non-autopilot compid', () => {
    vm.handleMessage(heartbeatMsg(1, 190), 'link-0') // compid 190 = GCS
    expect(vm.vehicleCount).toBe(0)
  })

  it('routes subsequent messages to correct vehicle by sysid', () => {
    vm.handleMessage(heartbeatMsg(1), 'link-0')
    vm.handleMessage(heartbeatMsg(2), 'link-0')

    // Send attitude to vehicle 1
    vm.handleMessage(attitudeMsg(1), 'link-0')

    const v1 = vm.getVehicle(1)!
    const v2 = vm.getVehicle(2)!
    const delta1 = v1.getDelta()
    const delta2 = v2.getDelta()

    // Vehicle 1 should have attitude data, vehicle 2 should not
    expect(delta1.attitude).toBeDefined()
    expect(delta2.attitude).toBeUndefined()
  })

  it('filters out sysid >= 200 (GCS traffic)', () => {
    vm.handleMessage(heartbeatMsg(255), 'link-0')
    expect(vm.vehicleCount).toBe(0)
  })

  it('filters out sysid 0 (broadcast)', () => {
    vm.handleMessage(heartbeatMsg(0), 'link-0')
    expect(vm.vehicleCount).toBe(0)
  })

  it('supports multiple vehicles simultaneously', () => {
    vm.handleMessage(heartbeatMsg(1), 'link-0')
    vm.handleMessage(heartbeatMsg(2), 'link-0')
    vm.handleMessage(heartbeatMsg(3), 'link-0')

    expect(vm.vehicleCount).toBe(3)
    expect(vm.getAllSysIds().sort()).toEqual([1, 2, 3])
  })

  it('removeVehicle destroys and emits event', () => {
    vm.handleMessage(heartbeatMsg(1), 'link-0')
    vm.handleMessage(heartbeatMsg(2), 'link-0')

    const removed: number[] = []
    vm.on('vehicleRemoved', (id: number) => removed.push(id))

    vm.removeVehicle(1)
    expect(vm.vehicleCount).toBe(1)
    expect(vm.getVehicle(1)).toBeUndefined()
    expect(removed).toEqual([1])
  })

  it('does not duplicate vehicle on repeated heartbeats', () => {
    const events: number[] = []
    vm.on('vehicleAdded', (id: number) => events.push(id))

    vm.handleMessage(heartbeatMsg(1), 'link-0')
    vm.handleMessage(heartbeatMsg(1), 'link-0')
    vm.handleMessage(heartbeatMsg(1), 'link-0')

    expect(vm.vehicleCount).toBe(1)
    expect(events).toEqual([1]) // Only one added event
  })

  it('multiple vehicles accumulate independent deltas', () => {
    vm.handleMessage(heartbeatMsg(1), 'link-0')
    vm.handleMessage(heartbeatMsg(2), 'link-0')

    // Both get heartbeat deltas
    const d1 = vm.getVehicle(1)!.getDelta()
    const d2 = vm.getVehicle(2)!.getDelta()
    expect(d1.core).toBeDefined()
    expect(d2.core).toBeDefined()
    expect(d1.core?.sysid).toBe(1)
    expect(d2.core?.sysid).toBe(2)
  })

  it('getAllVehicles returns all vehicles', () => {
    vm.handleMessage(heartbeatMsg(1), 'link-0')
    vm.handleMessage(heartbeatMsg(5), 'link-0')
    expect(vm.getAllVehicles()).toHaveLength(2)
  })

  it('destroy cleans up all vehicles', () => {
    vm.handleMessage(heartbeatMsg(1), 'link-0')
    vm.handleMessage(heartbeatMsg(2), 'link-0')
    vm.destroy()
    expect(vm.vehicleCount).toBe(0)
  })
})
