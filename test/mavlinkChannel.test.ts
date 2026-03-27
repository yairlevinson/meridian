// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { MavlinkChannel, type DecodedMessage } from '../src/main/mavlink/MavlinkChannel'
import { MavlinkProtocol } from '../src/main/mavlink/MavlinkProtocol'
import { MavLinkProtocolV2 } from 'node-mavlink'
import { minimal, common } from 'mavlink-mappings'

function encodeHeartbeat(armed = false, seq = 0): Buffer {
  const hb = new minimal.Heartbeat()
  hb.type = minimal.MavType.QUADROTOR
  hb.autopilot = minimal.MavAutopilot.ARDUPILOTMEGA
  hb.baseMode = armed ? minimal.MavModeFlag.SAFETY_ARMED : 0
  hb.customMode = 0
  hb.systemStatus = minimal.MavState.ACTIVE
  const protocol = new MavLinkProtocolV2(1, 1)
  return protocol.serialize(hb, seq)
}

function encodeAttitude(roll: number, seq = 0): Buffer {
  const att = new common.Attitude()
  att.timeBootMs = 1000
  att.roll = roll
  att.pitch = 0
  att.yaw = 0
  att.rollspeed = 0
  att.pitchspeed = 0
  att.yawspeed = 0
  const protocol = new MavLinkProtocolV2(1, 1)
  return protocol.serialize(att, seq)
}

async function feedAndCollect(channel: MavlinkChannel, buf: Buffer): Promise<DecodedMessage[]> {
  const messages: DecodedMessage[] = []
  channel.onMessage((msg) => messages.push(msg))
  channel.write(buf)
  await new Promise((r) => setTimeout(r, 200))
  return messages
}

describe('MavlinkChannel', () => {
  it('decodes a heartbeat message', async () => {
    const ch = new MavlinkChannel(0)
    const msgs = await feedAndCollect(ch, encodeHeartbeat())
    expect(msgs).toHaveLength(1)
    expect(msgs[0].msgid).toBe(0) // HEARTBEAT
    expect(msgs[0].sysid).toBe(1)
    ch.destroy()
  })

  it('tracks loss statistics from sequence gaps', async () => {
    const ch = new MavlinkChannel(0)
    const msgs: DecodedMessage[] = []
    ch.onMessage((msg) => msgs.push(msg))

    // Send seq 0, then seq 3 — should detect 2 lost
    ch.write(encodeHeartbeat(false, 0))
    await new Promise((r) => setTimeout(r, 100))
    ch.write(encodeHeartbeat(false, 3))
    await new Promise((r) => setTimeout(r, 100))

    expect(ch.stats.totalReceived).toBe(2)
    expect(ch.stats.totalLoss).toBe(2)
    expect(ch.stats.lossPercent).toBeCloseTo(50, 0)
    ch.destroy()
  })

  it('handles sequence wrap-around (255 -> 0)', async () => {
    const ch = new MavlinkChannel(0)
    ch.onMessage(() => {})
    ch.write(encodeHeartbeat(false, 255))
    await new Promise((r) => setTimeout(r, 100))
    ch.write(encodeHeartbeat(false, 0))
    await new Promise((r) => setTimeout(r, 100))

    expect(ch.stats.totalLoss).toBe(0) // no loss — correct wrap
    ch.destroy()
  })

  it('decodes multiple message types', async () => {
    const ch = new MavlinkChannel(0)
    const msgs: DecodedMessage[] = []
    ch.onMessage((msg) => msgs.push(msg))

    ch.write(Buffer.concat([encodeHeartbeat(false, 0), encodeAttitude(0.5, 1)]))
    await new Promise((r) => setTimeout(r, 200))

    expect(msgs).toHaveLength(2)
    const msgIds = msgs.map((m) => m.msgid)
    expect(msgIds).toContain(0) // HEARTBEAT
    expect(msgIds).toContain(30) // ATTITUDE
    ch.destroy()
  })
})

describe('MavlinkProtocol — channel pool', () => {
  it('allocates channels with sequential IDs', () => {
    const proto = new MavlinkProtocol()
    const ch0 = proto.allocateChannel(() => {})
    const ch1 = proto.allocateChannel(() => {})
    expect(ch0.id).toBe(0)
    expect(ch1.id).toBe(1)
    proto.destroy()
  })

  it('throws when all 16 channels are allocated', () => {
    const proto = new MavlinkProtocol()
    for (let i = 0; i < 16; i++) {
      proto.allocateChannel(() => {})
    }
    expect(() => proto.allocateChannel(() => {})).toThrow('all 16 channels allocated')
    proto.destroy()
  })

  it('reuses freed channel slots', () => {
    const proto = new MavlinkProtocol()
    const ch0 = proto.allocateChannel(() => {})
    proto.allocateChannel(() => {})
    proto.freeChannel(ch0.id)

    const ch2 = proto.allocateChannel(() => {})
    expect(ch2.id).toBe(0) // reused slot 0
    proto.destroy()
  })

  it('tracks allocated count', () => {
    const proto = new MavlinkProtocol()
    expect(proto.allocatedCount).toBe(0)
    proto.allocateChannel(() => {})
    proto.allocateChannel(() => {})
    expect(proto.allocatedCount).toBe(2)
    proto.freeChannel(0)
    expect(proto.allocatedCount).toBe(1)
    proto.destroy()
  })
})
