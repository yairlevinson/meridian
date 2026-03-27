// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Vehicle } from '../src/main/vehicle/Vehicle'
import { MavCommandQueue } from '../src/main/vehicle/MavCommandQueue'
import { VehicleLinkManager } from '../src/main/vehicle/VehicleLinkManager'
import { MissionManager } from '../src/main/mission/MissionManager'
import { MockLink } from '../src/test-utils/MockLink/MockLink'
import { MavlinkChannel, type DecodedMessage } from '../src/main/mavlink/MavlinkChannel'
import { MavResult } from '../src/shared-types/ipc/MavCommandRequest'
import { VehicleState } from '../src/main/vehicleState'

describe('VehicleLinkManager', () => {
  it('detects communication loss after heartbeat timeout', async () => {
    const mgr = new VehicleLinkManager({
      heartbeatMaxElapsedMs: 200,
      commLostCheckMs: 50
    })

    const link = new MockLink('link-1')
    mgr.addLink(link)
    mgr.heartbeatReceived('link-1')

    const lostPromise = new Promise<void>((resolve) => {
      mgr.on('communicationLost', resolve)
    })

    // Wait for timeout
    await lostPromise
    expect(mgr.communicationLost).toBe(true)
    mgr.destroy()
  })

  it('recovers from communication loss when heartbeat resumes', async () => {
    const mgr = new VehicleLinkManager({
      heartbeatMaxElapsedMs: 200,
      commLostCheckMs: 50
    })

    const link = new MockLink('link-1')
    mgr.addLink(link)

    // Wait for comm lost
    await new Promise<void>((resolve) => {
      mgr.on('communicationLost', resolve)
    })

    expect(mgr.communicationLost).toBe(true)

    // Resume heartbeats
    const restoredPromise = new Promise<void>((resolve) => {
      mgr.on('communicationRestored', resolve)
    })
    mgr.heartbeatReceived('link-1')

    await restoredPromise
    expect(mgr.communicationLost).toBe(false)
    mgr.destroy()
  })

  it('switches primary link on failover', async () => {
    const mgr = new VehicleLinkManager({
      heartbeatMaxElapsedMs: 200,
      commLostCheckMs: 50
    })

    const link1 = new MockLink('link-1')
    const link2 = new MockLink('link-2')
    mgr.addLink(link1)
    mgr.addLink(link2)

    // Keep link2 alive, let link1 die
    const keepAlive = setInterval(() => mgr.heartbeatReceived('link-2'), 50)

    const switchPromise = new Promise<void>((resolve) => {
      mgr.on('primaryLinkChanged', resolve)
    })

    await switchPromise
    expect(mgr.primaryLink?.id).toBe('link-2')

    clearInterval(keepAlive)
    mgr.destroy()
  })
})

describe('MavCommandQueue', () => {
  let link: MockLink
  let queue: MavCommandQueue

  beforeEach(() => {
    link = new MockLink()
    queue = new MavCommandQueue()
    queue.setLink(link)
  })

  afterEach(() => {
    queue.clear()
  })

  it('sends a command and resolves on ACK', async () => {
    const resultPromise = queue.sendCommand(400, 1, 0, { p1: 1 }, { timeoutMs: 2000 })

    // Simulate ACK from vehicle
    await new Promise((r) => setTimeout(r, 50))
    queue.handleCommandAck({ command: 400, result: MavResult.ACCEPTED })

    const result = await resultPromise
    expect(result).toBe(MavResult.ACCEPTED)
    expect(link.sentBuffers.length).toBe(1)
  })

  it('retries on timeout and eventually fails', async () => {
    MavCommandQueue.DEFAULT_TIMEOUT_MS = 100
    MavCommandQueue.DEFAULT_MAX_RETRIES = 2

    const resultPromise = queue.sendCommand(400, 1, 0, { p1: 1 })

    await expect(resultPromise).rejects.toThrow('timed out')
    // Should have sent: initial + 2 retries = 3
    expect(link.sentBuffers.length).toBe(3)

    // Reset defaults
    MavCommandQueue.DEFAULT_TIMEOUT_MS = 1500
    MavCommandQueue.DEFAULT_MAX_RETRIES = 3
  })

  it('retries then succeeds when ACK arrives on retry', async () => {
    MavCommandQueue.DEFAULT_TIMEOUT_MS = 100
    MavCommandQueue.DEFAULT_MAX_RETRIES = 3

    const resultPromise = queue.sendCommand(400, 1, 0, { p1: 1 })

    // Wait for first timeout + retry
    await new Promise((r) => setTimeout(r, 150))
    // Now ACK
    queue.handleCommandAck({ command: 400, result: MavResult.ACCEPTED })

    const result = await resultPromise
    expect(result).toBe(MavResult.ACCEPTED)
    expect(link.sentBuffers.length).toBe(2) // initial + 1 retry

    MavCommandQueue.DEFAULT_TIMEOUT_MS = 1500
    MavCommandQueue.DEFAULT_MAX_RETRIES = 3
  })

  it('handles DENIED result', async () => {
    const resultPromise = queue.sendCommand(400, 1, 0, { p1: 1 })
    await new Promise((r) => setTimeout(r, 50))
    queue.handleCommandAck({ command: 400, result: MavResult.DENIED })

    const result = await resultPromise
    expect(result).toBe(MavResult.DENIED)
  })
})

describe('VehicleState getDelta deep copy', () => {
  it('modifying a returned delta does not affect internal state', () => {
    const vehicle = new Vehicle(1)
    // Inject a heartbeat to make core dirty
    vehicle.handleMessage(
      {
        msgid: 0,
        sysid: 1,
        compid: 1,
        seq: 0,
        data: { type: 2, autopilot: 3, baseMode: 128, customMode: 0, systemStatus: 4 }
      },
      'link-0'
    )

    const delta1 = vehicle.getDelta()
    expect(delta1.core).toBeDefined()
    const originalArmed = delta1.core!.armed

    // Mutate the returned delta
    delta1.core!.armed = !originalArmed
    delta1.core!.sysid = 999

    // Inject another heartbeat so we get a fresh delta
    vehicle.handleMessage(
      {
        msgid: 0,
        sysid: 1,
        compid: 1,
        seq: 1,
        data: { type: 2, autopilot: 3, baseMode: 128, customMode: 0, systemStatus: 4 }
      },
      'link-0'
    )

    const delta2 = vehicle.getDelta()
    // The mutation of delta1 should not have leaked into the internal state
    expect(delta2.core!.sysid).toBe(1)
    expect(delta2.core!.armed).toBe(originalArmed)
  })

  it('modifying returned delta arrays does not affect internal state', () => {
    const state = new VehicleState()

    // Inject a battery status to populate battery.batteries array
    state.handleMessage(147, {
      id: 0,
      voltages: [12600, 65535, 65535, 65535, 65535, 65535, 65535, 65535, 65535, 65535],
      currentBattery: 1500,
      batteryRemaining: 75,
      temperature: 3500
    })

    const delta1 = state.getDelta()
    expect(delta1.battery?.batteries).toHaveLength(1)

    // Mutate the returned batteries array
    delta1.battery!.batteries.push({
      id: 99,
      voltage: 0,
      current: 0,
      remaining: 0,
      temperature: 0,
      cellCount: 0,
      chargeState: 0
    })

    // Get a fresh delta after another battery message
    state.handleMessage(147, {
      id: 0,
      voltages: [12600, 65535, 65535, 65535, 65535, 65535, 65535, 65535, 65535, 65535],
      currentBattery: 1500,
      batteryRemaining: 75,
      temperature: 3500
    })

    const delta2 = state.getDelta()
    // Should still have exactly 1 battery, not 2
    expect(delta2.battery?.batteries).toHaveLength(1)
    expect(delta2.battery!.batteries[0].id).toBe(0)
  })
})

describe('Vehicle', () => {
  let vehicle: Vehicle
  let link: MockLink
  let channel: MavlinkChannel

  beforeEach(() => {
    vehicle = new Vehicle(1, { heartbeatMaxElapsedMs: 500, commLostCheckMs: 100 })
    link = new MockLink()
    channel = new MavlinkChannel(0)
    vehicle.addLink(link)

    // Wire MockLink → channel → Vehicle
    link.on('data', (buf: Buffer) => channel.write(buf))
    channel.onMessage((msg: DecodedMessage) => {
      vehicle.handleMessage(msg, link.id)
    })
  })

  afterEach(() => {
    vehicle.destroy()
    channel.destroy()
  })

  it('updates state from heartbeat', async () => {
    link.injectHeartbeat(true)
    await new Promise((r) => setTimeout(r, 200))

    const delta = vehicle.getDelta()
    expect(delta.core?.armed).toBe(true)
  })

  it('updates state from attitude', async () => {
    link.injectAttitude(0.5, 0.1, 1.0)
    await new Promise((r) => setTimeout(r, 200))

    const delta = vehicle.getDelta()
    expect(delta.attitude?.roll).toBeCloseTo(0.5)
  })

  it('updates state from position', async () => {
    link.injectPosition(42.389, -71.147, 100)
    await new Promise((r) => setTimeout(r, 200))

    const delta = vehicle.getDelta()
    expect(delta.gps?.lat).toBeCloseTo(42.389, 3)
  })

  it('detects communication loss', async () => {
    link.injectHeartbeat()
    await new Promise((r) => setTimeout(r, 200))

    const lostPromise = new Promise<void>((resolve) => {
      vehicle.on('communicationLost', resolve)
    })

    // Wait for heartbeat timeout
    await lostPromise
    const delta = vehicle.getDelta()
    expect(delta.core?.communicationLost).toBe(true)
  })

  it('arm command sends COMMAND_LONG and resolves on ACK', async () => {
    const armPromise = vehicle.arm()

    // Wait for command to be sent
    await new Promise((r) => setTimeout(r, 50))
    expect(link.sentBuffers.length).toBe(1)

    // Inject ACK
    link.injectCommandAck(400, MavResult.ACCEPTED)
    await new Promise((r) => setTimeout(r, 200))

    // The ACK needs to go through the channel pipeline
    const result = await armPromise
    expect(result).toBe(MavResult.ACCEPTED)
  })

  it('handles multiple message types updating different state groups', async () => {
    link.injectHeartbeat(true)
    link.injectAttitude(0.3, 0.1, 2.0)
    link.injectPosition(32.0, 34.8, 150)
    link.injectSysStatus()
    await new Promise((r) => setTimeout(r, 300))

    const delta = vehicle.getDelta()
    expect(delta.core?.armed).toBe(true)
    expect(delta.attitude?.roll).toBeCloseTo(0.3)
    expect(delta.gps?.lat).toBeCloseTo(32.0, 4)
    expect(delta.sysStatus).toBeDefined()
  })
})

describe('Vehicle.setCommandLink with plain WritableLink', () => {
  it('sets both commandQueue and missionManager link', async () => {
    const vehicle = new Vehicle(1)
    const sent: Buffer[] = []
    // Plain object with only writeBytes — no `id`, like the real UDP wrapper
    const plainWritable = { writeBytes: (buf: Buffer) => sent.push(buf) }

    vehicle.setCommandLink(plainWritable)

    // Command queue should work — catch the rejection from destroy()
    const armPromise = vehicle.arm().catch(() => {})
    expect(sent.length).toBeGreaterThan(0)

    // Mission manager should also have a link — writeToVehicle should send data
    const sentBefore = sent.length
    vehicle.missionManager.writeToVehicle([
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
        x: 423890000,
        y: -711470000,
        z: 50,
        missionType: 0
      }
    ])
    expect(sent.length).toBeGreaterThan(sentBefore)

    vehicle.destroy()
    await armPromise
  })

  it('mission manager link is null if setCommandLink is never called', () => {
    const vehicle = new Vehicle(1)

    // Without setCommandLink, writeToVehicle should be a no-op (no link)
    // This verifies the bug scenario: missionManager.link was not set
    const spy = vi.spyOn(vehicle.missionManager, 'writeToVehicle')
    vehicle.missionManager.writeToVehicle([
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
        x: 423890000,
        y: -711470000,
        z: 50,
        missionType: 0
      }
    ])
    // State should remain Idle (never transitions because no link)
    expect(vehicle.missionManager.currentState).toBe('idle')
    expect(spy).toHaveBeenCalled()

    vehicle.destroy()
  })
})

describe('Vehicle mission routing', () => {
  it('has a missionManager property', () => {
    const vehicle = new Vehicle(1)
    expect(vehicle.missionManager).toBeInstanceOf(MissionManager)
    vehicle.destroy()
  })

  it('routes MISSION_CURRENT (msgid 42) to missionManager.handleMissionCurrent', () => {
    const vehicle = new Vehicle(1)
    const spy = vi.spyOn(vehicle.missionManager, 'handleMissionCurrent')

    vehicle.handleMessage({ msgid: 42, sysid: 1, compid: 1, seq: 0, data: { seq: 5 } }, 'link-0')

    expect(spy).toHaveBeenCalledWith(5)
    vehicle.destroy()
  })

  it('routes MISSION_COUNT (msgid 44) to missionManager.handleMissionCount', () => {
    const vehicle = new Vehicle(1)
    const spy = vi.spyOn(vehicle.missionManager, 'handleMissionCount')

    vehicle.handleMessage({ msgid: 44, sysid: 1, compid: 1, seq: 0, data: { count: 10 } }, 'link-0')

    expect(spy).toHaveBeenCalledWith(10)
    vehicle.destroy()
  })
})
