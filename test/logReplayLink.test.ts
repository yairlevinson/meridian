// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { MavLinkProtocolV2 } from 'node-mavlink'
import { minimal, common } from 'mavlink-mappings'
import { LogReplayLink } from '../src/main/links/LogReplayLink'
import { LinkType } from '../src/shared-types/ipc/LinkState'

function createTestLog(filepath: string, count: number): void {
  const protocol = new MavLinkProtocolV2(1, 1)
  const buffers: Buffer[] = []

  for (let i = 0; i < count; i++) {
    if (i % 3 === 0) {
      const hb = new minimal.Heartbeat()
      hb.type = minimal.MavType.QUADROTOR
      hb.autopilot = minimal.MavAutopilot.ARDUPILOTMEGA
      hb.baseMode = 0
      hb.customMode = 0
      hb.systemStatus = minimal.MavState.ACTIVE
      buffers.push(protocol.serialize(hb, i))
    } else {
      const att = new common.Attitude()
      att.timeBootMs = i * 100
      att.roll = Math.sin(i * 0.1) * 0.3
      att.pitch = 0
      att.yaw = 0
      att.rollspeed = 0
      att.pitchspeed = 0
      att.yawspeed = 0
      buffers.push(protocol.serialize(att, i))
    }
  }

  writeFileSync(filepath, Buffer.concat(buffers))
}

describe('LogReplayLink', () => {
  let tempDir: string
  let link: LogReplayLink | null = null

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'qgc-replay-test-'))
  })

  afterEach(() => {
    link?.disconnect()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('replays a synthetic log file', async () => {
    const filepath = join(tempDir, 'test.mavlink')
    createTestLog(filepath, 9) // 3 heartbeats + 6 attitudes

    link = new LogReplayLink('replay-1', {
      type: LinkType.LogReplay,
      name: 'Test Replay',
      filePath: filepath,
      speedMultiplier: 10
    })

    const packets: Buffer[] = []
    link.on('data', (buf: Buffer) => packets.push(buf))

    await link.connect()
    expect(link.isConnected).toBe(true)
    expect(link.totalPackets).toBe(9)

    // Wait for all packets to be emitted
    await new Promise((r) => setTimeout(r, 500))

    expect(packets.length).toBe(9)
  })

  it('reports progress during replay', async () => {
    const filepath = join(tempDir, 'test2.mavlink')
    createTestLog(filepath, 6)

    link = new LogReplayLink('replay-2', {
      type: LinkType.LogReplay,
      name: 'Test Replay 2',
      filePath: filepath,
      speedMultiplier: 50
    })

    await link.connect()
    await new Promise((r) => setTimeout(r, 300))

    expect(link.progress).toBeGreaterThan(0)
  })
})
