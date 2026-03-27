// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { PassThrough } from 'stream'
import { MavLinkPacketSplitter, MavLinkPacketParser, MavLinkPacket } from 'node-mavlink'
import { common, minimal, MavLinkProtocolV2, MavLinkProtocolV1 } from 'node-mavlink'

const REGISTRY = {
  ...minimal.REGISTRY,
  ...common.REGISTRY
}

/**
 * Encode a MavLink message to a Buffer using the given protocol.
 * Used to synthesize test packets without needing a real vehicle.
 */
function encodeMessage(
  msg: minimal.Heartbeat | common.Attitude | common.GlobalPositionInt,
  protocol: MavLinkProtocolV1 | MavLinkProtocolV2 = new MavLinkProtocolV2()
): Buffer {
  return protocol.serialize(msg as any, 0)
}

/** Feed a buffer through the splitter→parser pipeline and collect decoded packets. */
function parseThroughPipeline(buf: Buffer): Promise<MavLinkPacket[]> {
  return new Promise((resolve, reject) => {
    const passthrough = new PassThrough()
    const splitter = new MavLinkPacketSplitter()
    const parser = new MavLinkPacketParser()
    const reader = passthrough.pipe(splitter).pipe(parser)

    const packets: MavLinkPacket[] = []
    const timeout = setTimeout(() => reject(new Error('pipeline timeout')), 2000)

    reader.on('data', (packet: MavLinkPacket) => {
      packets.push(packet)
    })

    passthrough.on('end', () => {
      clearTimeout(timeout)
      resolve(packets)
    })

    passthrough.end(buf)
  })
}

describe('MAVLink pipeline — packet parsing', () => {
  it('decodes a synthesized HEARTBEAT', async () => {
    const hb = new minimal.Heartbeat()
    hb.type = minimal.MavType.QUADROTOR
    hb.autopilot = minimal.MavAutopilot.ARDUPILOTMEGA
    hb.baseMode = minimal.MavModeFlag.SAFETY_ARMED
    hb.customMode = 0
    hb.systemStatus = minimal.MavState.ACTIVE
    const buf = encodeMessage(hb)

    const packets = await parseThroughPipeline(buf)
    expect(packets).toHaveLength(1)

    const cls = REGISTRY[packets[0].header.msgid]
    expect(cls).toBeDefined()
    const decoded = packets[0].protocol.data(packets[0].payload, cls!) as minimal.Heartbeat
    expect(decoded.autopilot).toBe(minimal.MavAutopilot.ARDUPILOTMEGA)
    expect(decoded.baseMode & minimal.MavModeFlag.SAFETY_ARMED).toBeTruthy()
  })

  it('decodes a synthesized ATTITUDE', async () => {
    const att = new common.Attitude()
    att.timeBootMs = 1000
    att.roll = 0.523598 // ~30°
    att.pitch = 0.174533 // ~10°
    att.yaw = 1.5708 // ~90°
    att.rollspeed = 0
    att.pitchspeed = 0
    att.yawspeed = 0
    const buf = encodeMessage(att)

    const packets = await parseThroughPipeline(buf)
    expect(packets).toHaveLength(1)
    expect(packets[0].header.msgid).toBe(common.Attitude.MSG_ID)

    const decoded = packets[0].protocol.data(
      packets[0].payload,
      REGISTRY[packets[0].header.msgid]!
    ) as common.Attitude
    expect(decoded.roll).toBeCloseTo(0.523598, 4)
    expect(decoded.pitch).toBeCloseTo(0.174533, 4)
    expect(decoded.yaw).toBeCloseTo(1.5708, 4)
  })

  it('decodes a synthesized GLOBAL_POSITION_INT', async () => {
    const pos = new common.GlobalPositionInt()
    pos.timeBootMs = 2000
    pos.lat = 320000000 // 32.0°
    pos.lon = 348000000 // 34.8°
    pos.alt = 150000 // 150m in mm
    pos.relativeAlt = 50000
    pos.vx = 0
    pos.vy = 0
    pos.vz = 0
    pos.hdg = 18000 // 180°
    const buf = encodeMessage(pos)

    const packets = await parseThroughPipeline(buf)
    expect(packets).toHaveLength(1)
    expect(packets[0].header.msgid).toBe(common.GlobalPositionInt.MSG_ID)

    const decoded = packets[0].protocol.data(
      packets[0].payload,
      REGISTRY[packets[0].header.msgid]!
    ) as common.GlobalPositionInt
    expect(decoded.lat).toBe(320000000)
    expect(decoded.lon).toBe(348000000)
    expect(decoded.alt).toBe(150000)
  })

  it('decodes multiple consecutive messages from a single buffer', async () => {
    const hb = new minimal.Heartbeat()
    hb.type = minimal.MavType.QUADROTOR
    hb.autopilot = minimal.MavAutopilot.ARDUPILOTMEGA
    hb.baseMode = 0
    hb.customMode = 0
    hb.systemStatus = minimal.MavState.STANDBY

    const att = new common.Attitude()
    att.timeBootMs = 500
    att.roll = 0
    att.pitch = 0
    att.yaw = 0
    att.rollspeed = 0
    att.pitchspeed = 0
    att.yawspeed = 0

    const combined = Buffer.concat([encodeMessage(hb), encodeMessage(att)])
    const packets = await parseThroughPipeline(combined)

    expect(packets).toHaveLength(2)
    const msgIds = packets.map((p) => p.header.msgid)
    expect(msgIds).toContain(minimal.Heartbeat.MSG_ID)
    expect(msgIds).toContain(common.Attitude.MSG_ID)
  })

  it('createPipeline calls onMessage for each decoded packet', async () => {
    // Import after environment is set
    const { createPipeline } = await import('../src/main/mavlinkPipeline')

    const hb = new minimal.Heartbeat()
    hb.type = minimal.MavType.QUADROTOR
    hb.autopilot = minimal.MavAutopilot.ARDUPILOTMEGA
    hb.baseMode = 128
    hb.customMode = 3
    hb.systemStatus = minimal.MavState.ACTIVE

    const buf = encodeMessage(hb)

    // Create a minimal UdpLink-like EventEmitter mock
    const { EventEmitter } = await import('events')
    const mockLink = new EventEmitter() as any
    mockLink.on = mockLink.on.bind(mockLink)
    mockLink.off = mockLink.off.bind(mockLink)

    const received: Array<{ msgid: number; data: any }> = []
    const cleanup = createPipeline(mockLink, (msg) => received.push(msg))

    // Wait for pipeline to process
    await new Promise<void>((resolve) => {
      setTimeout(() => {
        mockLink.emit('data', buf)
        setTimeout(resolve, 200)
      }, 10)
    })

    cleanup()

    expect(received.length).toBeGreaterThanOrEqual(1)
    expect(received[0].msgid).toBe(minimal.Heartbeat.MSG_ID)
    const decodedHb = received[0].data as minimal.Heartbeat
    expect(decodedHb.customMode).toBe(3)
  })
})
