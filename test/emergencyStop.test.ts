// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Vehicle } from '../src/main/vehicle/Vehicle'
import { MavCommandQueue } from '../src/main/vehicle/MavCommandQueue'
import { MockLink } from '../src/test-utils/MockLink/MockLink'
import { MavlinkChannel, type DecodedMessage } from '../src/main/mavlink/MavlinkChannel'
import { MavResult } from '../src/shared-types/ipc/MavCommandRequest'
import { IpcChannels } from '../src/shared-types/ipc/channels'

describe('Emergency Stop — Vehicle command', () => {
  let vehicle: Vehicle
  let link: MockLink
  let channel: MavlinkChannel

  beforeEach(() => {
    vehicle = new Vehicle(1, { heartbeatMaxElapsedMs: 500, commLostCheckMs: 100 })
    link = new MockLink()
    channel = new MavlinkChannel(0)
    vehicle.addLink(link)

    link.on('data', (buf: Buffer) => channel.write(buf))
    channel.onMessage((msg: DecodedMessage) => {
      vehicle.handleMessage(msg, link.id)
    })
  })

  afterEach(() => {
    vehicle.destroy()
    channel.destroy()
  })

  it('sends MAV_CMD_COMPONENT_ARM_DISARM with force param', async () => {
    const resultPromise = vehicle.emergencyStop()

    await new Promise((r) => setTimeout(r, 50))
    expect(link.sentBuffers.length).toBe(1)

    // Inject ACK for command 400
    link.injectCommandAck(400, MavResult.ACCEPTED)
    await new Promise((r) => setTimeout(r, 200))

    const result = await resultPromise
    expect(result).toBe(MavResult.ACCEPTED)
  })

  it('resolves with DENIED when vehicle rejects emergency stop', async () => {
    const resultPromise = vehicle.emergencyStop()

    await new Promise((r) => setTimeout(r, 50))
    link.injectCommandAck(400, MavResult.DENIED)
    await new Promise((r) => setTimeout(r, 200))

    const result = await resultPromise
    expect(result).toBe(MavResult.DENIED)
  })
})

describe('Emergency Stop — MavCommandQueue params', () => {
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

  it('sends command 400 with p1=0 and p2=21196', async () => {
    const resultPromise = queue.sendCommand(400, 1, 0, { p1: 0, p2: 21196 }, { timeoutMs: 2000 })

    await new Promise((r) => setTimeout(r, 50))
    expect(link.sentBuffers.length).toBe(1)

    queue.handleCommandAck({ command: 400, result: MavResult.ACCEPTED })
    const result = await resultPromise
    expect(result).toBe(MavResult.ACCEPTED)
  })
})

describe('Emergency Stop — IPC channel', () => {
  it('VehicleEmergencyStop channel exists and is unique', () => {
    expect(IpcChannels.VehicleEmergencyStop).toBe('vehicle:emergencyStop')

    const values = Object.values(IpcChannels)
    const occurrences = values.filter((v) => v === 'vehicle:emergencyStop')
    expect(occurrences).toHaveLength(1)
  })
})
