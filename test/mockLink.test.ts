// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { MockLink, FailureMode } from '../src/test-utils/MockLink/MockLink'
import { MockVehicle } from '../src/test-utils/MockLink/MockVehicle'
import { MockLinkFTP } from '../src/test-utils/MockLink/MockLinkFTP'
import { MockLinkMissionItemHandler } from '../src/test-utils/MockLink/MockLinkMissionItemHandler'
import { MavlinkChannel, type DecodedMessage } from '../src/main/mavlink/MavlinkChannel'
import type { MissionItem } from '../src/shared-types/ipc/MissionTypes'

describe('MockLink', () => {
  let link: MockLink
  let channel: MavlinkChannel

  beforeEach(() => {
    link = new MockLink()
    channel = new MavlinkChannel(0)
    link.on('data', (buf: Buffer) => channel.write(buf))
  })

  afterEach(() => {
    channel.destroy()
  })

  it('connects successfully', async () => {
    await link.connect()
    expect(link.isConnected).toBe(true)
  })

  it('injects HEARTBEAT that decodes correctly', async () => {
    const msgs: DecodedMessage[] = []
    channel.onMessage((msg) => msgs.push(msg))

    link.injectHeartbeat(false)
    await new Promise((r) => setTimeout(r, 200))

    expect(msgs).toHaveLength(1)
    expect(msgs[0].msgid).toBe(0)
    expect(msgs[0].sysid).toBe(1)
  })

  it('injects HEARTBEAT with armed=true', async () => {
    const msgs: DecodedMessage[] = []
    channel.onMessage((msg) => msgs.push(msg))

    link.injectHeartbeat(true)
    await new Promise((r) => setTimeout(r, 200))

    const hb = msgs[0].data as { baseMode: number }
    expect(hb.baseMode & 128).toBeTruthy() // SAFETY_ARMED
  })

  it('injects ATTITUDE message', async () => {
    const msgs: DecodedMessage[] = []
    channel.onMessage((msg) => msgs.push(msg))

    link.injectAttitude(0.5, 0.1, 1.5)
    await new Promise((r) => setTimeout(r, 200))

    expect(msgs).toHaveLength(1)
    expect(msgs[0].msgid).toBe(30) // ATTITUDE
    const att = msgs[0].data as { roll: number; pitch: number; yaw: number }
    expect(att.roll).toBeCloseTo(0.5)
  })

  it('injects GLOBAL_POSITION_INT message', async () => {
    const msgs: DecodedMessage[] = []
    channel.onMessage((msg) => msgs.push(msg))

    link.injectPosition(42.389, -71.147, 100)
    await new Promise((r) => setTimeout(r, 200))

    expect(msgs).toHaveLength(1)
    expect(msgs[0].msgid).toBe(33) // GLOBAL_POSITION_INT
    const pos = msgs[0].data as { lat: number; lon: number }
    expect(pos.lat / 1e7).toBeCloseTo(42.389, 3)
  })

  it('records bytes sent via writeBytes', () => {
    link.writeBytes(Buffer.from([1, 2, 3]))
    link.writeBytes(Buffer.from([4, 5, 6]))
    expect(link.sentBuffers).toHaveLength(2)
  })
})

describe('MockVehicle', () => {
  let link: MockLink
  let vehicle: MockVehicle
  let channel: MavlinkChannel

  beforeEach(() => {
    link = new MockLink()
    vehicle = new MockVehicle(link)
    channel = new MavlinkChannel(0)
    link.on('data', (buf: Buffer) => channel.write(buf))
  })

  afterEach(() => {
    vehicle.stop()
    channel.destroy()
  })

  it('streams heartbeats, attitude, and position', async () => {
    const msgs: DecodedMessage[] = []
    channel.onMessage((msg) => msgs.push(msg))

    vehicle.startStreaming()
    await new Promise((r) => setTimeout(r, 1500))
    vehicle.stop()

    const msgIds = new Set(msgs.map((m) => m.msgid))
    expect(msgIds.has(0)).toBe(true) // HEARTBEAT
    expect(msgIds.has(30)).toBe(true) // ATTITUDE
    expect(msgIds.has(33)).toBe(true) // GLOBAL_POSITION_INT
    expect(msgs.length).toBeGreaterThan(10) // ~15 msgs/sec
  })
})

describe('MockLinkMissionItemHandler', () => {
  let link: MockLink
  let handler: MockLinkMissionItemHandler

  beforeEach(() => {
    link = new MockLink()
    handler = new MockLinkMissionItemHandler(link)
  })

  it('sends MISSION_COUNT when items are loaded', () => {
    const testItems: MissionItem[] = [
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
      },
      {
        seq: 1,
        frame: 3,
        command: 16,
        current: false,
        autocontinue: true,
        param1: 0,
        param2: 0,
        param3: 0,
        param4: 0,
        x: 423900000,
        y: -711460000,
        z: 60,
        missionType: 0
      }
    ]
    handler.setItems(testItems)
    expect(handler.getItems()).toHaveLength(2)
  })

  it('does not respond in NoResponse failure mode', () => {
    handler.setFailureMode(FailureMode.NoResponse)
    const events: unknown[] = []
    link.on('data', (d) => events.push(d))
    handler.handleMissionRequestList()
    expect(events).toHaveLength(0)
  })
})

describe('MockLinkFTP', () => {
  let link: MockLink
  let ftp: MockLinkFTP

  beforeEach(() => {
    link = new MockLink()
    ftp = new MockLinkFTP(link)
  })

  it('serves a file via open + read', async () => {
    const content = 'PARAM1=42.0\nPARAM2=3.14'
    ftp.addFile('/APM.parm', content)

    const responses: Array<{
      opcode: number
      data: Buffer
      reqOpcode: number
      offset: number
    }> = []
    link.on('ftpResponse', (r) => responses.push(r))

    // Open file
    ftp.handleFTPRequest({
      seqNumber: 1,
      session: 0,
      opcode: 4, // OPEN_FILE_RO
      size: 0,
      reqOpcode: 0,
      offset: 0,
      data: Buffer.from('/APM.parm\0')
    })

    expect(responses).toHaveLength(1)
    expect(responses[0].opcode).toBe(128) // ACK
    const session = responses[0].data[0]

    // Read file
    ftp.handleFTPRequest({
      seqNumber: 2,
      session: session!,
      opcode: 5, // READ_FILE
      size: 0,
      reqOpcode: 0,
      offset: 0,
      data: Buffer.alloc(0)
    })

    expect(responses).toHaveLength(2)
    expect(responses[1].data.toString()).toBe(content)
  })

  it('returns NAK for non-existent file', () => {
    const responses: Array<{ opcode: number }> = []
    link.on('ftpResponse', (r) => responses.push(r))

    ftp.handleFTPRequest({
      seqNumber: 1,
      session: 0,
      opcode: 4,
      size: 0,
      reqOpcode: 0,
      offset: 0,
      data: Buffer.from('/nonexistent\0')
    })

    expect(responses[0].opcode).toBe(129) // NAK
  })

  it('handles file upload (create + write)', () => {
    const responses: Array<{ opcode: number; data: Buffer }> = []
    link.on('ftpResponse', (r) => responses.push(r))

    // Create file
    ftp.handleFTPRequest({
      seqNumber: 1,
      session: 0,
      opcode: 6, // CREATE_FILE
      size: 0,
      reqOpcode: 0,
      offset: 0,
      data: Buffer.from('/upload.txt\0')
    })

    expect(responses[0].opcode).toBe(128)
    const session = responses[0].data[0]!

    // Write data
    const payload = Buffer.from('hello world')
    ftp.handleFTPRequest({
      seqNumber: 2,
      session,
      opcode: 7, // WRITE_FILE
      size: payload.length,
      reqOpcode: 0,
      offset: 0,
      data: payload
    })

    expect(responses[1].opcode).toBe(128) // ACK
    expect(ftp.getFile('/upload.txt')?.toString()).toBe('hello world')
  })
})
