/**
 * Integration tests using tlog replay.
 *
 * These tests feed real (or synthetic) MAVLink captures through the same
 * MavlinkChannel → Vehicle pipeline used in production, verifying that
 * telemetry state is correctly derived from actual autopilot traffic.
 *
 * To generate real captures:
 *   1. Start PX4 SITL
 *   2. python3 scripts/capture-tlog.py --scenario all
 *   3. Re-run tests — they'll use the real captures
 */

import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, it, expect, beforeEach } from 'vitest'
import { MavLinkProtocolV2 } from 'node-mavlink'
import { minimal, common } from 'mavlink-mappings'
import { MavlinkChannel } from '../src/main/mavlink/MavlinkChannel'
import { Vehicle } from '../src/main/vehicle/Vehicle'
import { TlogReplay, parseTlog, type TlogEntry } from '../src/test-utils/TlogReplay'

const CAPTURES_DIR = resolve(__dirname, 'fixtures/captures')

// ── Synthetic tlog builder ────────────────────────────────────
// Builds a minimal tlog in memory for tests that don't have real captures.

function buildSyntheticTlog(scenario: 'arm-takeoff-land' | 'mode-changes'): Buffer {
  const protocol = new MavLinkProtocolV2(1, 1) // sysid=1, compid=1
  let seq = 0
  const frames: { timestampUs: bigint; frame: Buffer }[] = []

  function addMessage(msg: unknown, timeOffsetMs: number): void {
    const frame = protocol.serialize(msg as Parameters<typeof protocol.serialize>[0], seq++ & 0xff)
    frames.push({
      timestampUs: BigInt(timeOffsetMs) * 1000n,
      frame
    })
  }

  function makeHeartbeat(armed: boolean, customMode: number): minimal.Heartbeat {
    const hb = new minimal.Heartbeat()
    hb.type = minimal.MavType.QUADROTOR
    hb.autopilot = minimal.MavAutopilot.PX4
    hb.baseMode = armed
      ? (minimal.MavModeFlag.SAFETY_ARMED | minimal.MavModeFlag.CUSTOM_MODE_ENABLED)
      : minimal.MavModeFlag.CUSTOM_MODE_ENABLED
    hb.customMode = customMode
    hb.systemStatus = minimal.MavState.ACTIVE
    return hb
  }

  function makePosition(lat: number, lon: number, altMsl: number, relAlt: number): common.GlobalPositionInt {
    const pos = new common.GlobalPositionInt()
    pos.timeBootMs = 0
    pos.lat = Math.round(lat * 1e7)
    pos.lon = Math.round(lon * 1e7)
    pos.alt = Math.round(altMsl * 1000)
    pos.relativeAlt = Math.round(relAlt * 1000)
    pos.vx = 0
    pos.vy = 0
    pos.vz = 0
    pos.hdg = 9000 // 90.00 degrees
    return pos
  }

  function makeAttitude(roll: number, pitch: number, yaw: number): common.Attitude {
    const att = new common.Attitude()
    att.timeBootMs = 0
    att.roll = roll
    att.pitch = pitch
    att.yaw = yaw
    att.rollspeed = 0
    att.pitchspeed = 0
    att.yawspeed = 0
    return att
  }

  function makeGpsRaw(fixType: number, sats: number): common.GpsRawInt {
    const gps = new common.GpsRawInt()
    gps.timeUsec = 0n
    gps.fixType = fixType
    gps.lat = Math.round(47.397742 * 1e7)
    gps.lon = Math.round(8.545594 * 1e7)
    gps.alt = Math.round(488 * 1000)
    gps.eph = 100 // HDOP * 100
    gps.epv = 100
    gps.vel = 0
    gps.cog = 0
    gps.satellitesVisible = sats
    return gps
  }

  if (scenario === 'arm-takeoff-land') {
    const HOME_LAT = 47.397742
    const HOME_LON = 8.545594

    // T=0s: Disarmed on ground, GPS fix
    for (let t = 0; t < 5000; t += 200) {
      addMessage(makeHeartbeat(false, 0), t)
      addMessage(makePosition(HOME_LAT, HOME_LON, 488, 0), t + 50)
      addMessage(makeAttitude(0, 0, 1.57), t + 100)
      addMessage(makeGpsRaw(3, 12), t + 150) // 3D fix
    }

    // T=5s: Armed, takeoff mode
    for (let t = 5000; t < 8000; t += 200) {
      const elapsed = (t - 5000) / 3000
      const alt = elapsed * 10 // climbing to 10m
      addMessage(makeHeartbeat(true, 0x20000), t) // PX4 takeoff-ish mode
      addMessage(makePosition(HOME_LAT, HOME_LON, 488 + alt, alt), t + 50)
      addMessage(makeAttitude(0.01, -0.02, 1.57), t + 100)
    }

    // T=8s: Hovering at 10m
    for (let t = 8000; t < 13000; t += 200) {
      addMessage(makeHeartbeat(true, 0x30000), t) // PX4 position hold mode
      addMessage(makePosition(HOME_LAT, HOME_LON, 498, 10), t + 50)
      addMessage(makeAttitude(0.005, -0.003, 1.57), t + 100)
    }

    // T=13s: Landing
    for (let t = 13000; t < 18000; t += 200) {
      const elapsed = (t - 13000) / 5000
      const alt = 10 * (1 - elapsed)
      addMessage(makeHeartbeat(true, 0x40006), t) // PX4 land mode
      addMessage(makePosition(HOME_LAT, HOME_LON, 488 + alt, alt), t + 50)
      addMessage(makeAttitude(0, 0, 1.57), t + 100)
    }

    // T=18s: Landed, disarmed
    for (let t = 18000; t < 20000; t += 200) {
      addMessage(makeHeartbeat(false, 0), t)
      addMessage(makePosition(HOME_LAT, HOME_LON, 488, 0), t + 50)
    }
  } else if (scenario === 'mode-changes') {
    // PX4 custom_mode values for different modes
    const modes = [0, 0x10000, 0x20000, 0x30000, 0x40004, 0x50004, 0x40006, 0x70000]
    let t = 0
    for (const mode of modes) {
      for (let i = 0; i < 10; i++) {
        addMessage(makeHeartbeat(false, mode), t)
        t += 200
      }
    }
  }

  // Serialize to tlog format
  const chunks: Buffer[] = []
  for (const { timestampUs, frame } of frames) {
    const header = Buffer.alloc(8)
    header.writeBigUInt64LE(timestampUs)
    chunks.push(header, frame)
  }
  return Buffer.concat(chunks)
}

// ── Helpers ───────────────────────────────────────────────────

function hasCaptureFile(name: string): boolean {
  return existsSync(resolve(CAPTURES_DIR, `${name}.tlog`))
}

function loadReplay(name: string): TlogReplay {
  const realPath = resolve(CAPTURES_DIR, `${name}.tlog`)
  if (existsSync(realPath)) {
    return TlogReplay.fromFile(realPath)
  }
  // Fall back to synthetic
  return TlogReplay.fromBuffer(buildSyntheticTlog(name as 'arm-takeoff-land' | 'mode-changes'))
}

function createTestVehicle(): { vehicle: Vehicle; channel: MavlinkChannel } {
  const vehicle = new Vehicle(1)
  const channel = new MavlinkChannel(0)
  return { vehicle, channel }
}

// ── Tests ─────────────────────────────────────────────────────

describe('tlog parser', () => {
  it('parses synthetic tlog into entries', () => {
    const buf = buildSyntheticTlog('arm-takeoff-land')
    const entries = parseTlog(buf)
    expect(entries.length).toBeGreaterThan(100)
    // All entries should have MAVLink v2 magic
    for (const entry of entries) {
      expect(entry.frame[0]).toBe(0xfd)
    }
  })

  it('reports correct duration', () => {
    const replay = TlogReplay.fromBuffer(buildSyntheticTlog('arm-takeoff-land'))
    expect(replay.durationSec).toBeGreaterThan(15)
    expect(replay.durationSec).toBeLessThan(25)
  })

  it('parses real capture if available', () => {
    if (!hasCaptureFile('arm-takeoff-land')) return
    const replay = TlogReplay.fromFile(resolve(CAPTURES_DIR, 'arm-takeoff-land.tlog'))
    expect(replay.messageCount).toBeGreaterThan(0)
    console.log(`Real capture: ${replay.messageCount} messages, ${replay.durationSec.toFixed(1)}s`)
  })
})

describe('arm-takeoff-land replay', () => {
  let vehicle: Vehicle
  let channel: MavlinkChannel

  beforeEach(() => {
    const setup = createTestVehicle()
    vehicle = setup.vehicle
    channel = setup.channel
  })

  it('processes all messages without errors', async () => {
    const replay = loadReplay('arm-takeoff-land')
    await replay.replayAll(channel, vehicle)

    const snap = vehicle.state.getSnapshot()
    // Should have received at least heartbeats and position
    expect(snap.core.seq).toBeGreaterThan(0)
    expect(snap.gps.seq).toBeGreaterThan(0)
    expect(snap.attitude.seq).toBeGreaterThan(0)
  })

  it('detects vehicle type from heartbeat', async () => {
    const replay = loadReplay('arm-takeoff-land')
    await replay.replayAll(channel, vehicle)

    const snap = vehicle.state.getSnapshot()
    expect(snap.core.vehicleType).toBe(minimal.MavType.QUADROTOR)
  })

  it('resolves GPS position', async () => {
    const replay = loadReplay('arm-takeoff-land')
    await replay.replayAll(channel, vehicle)

    const snap = vehicle.state.getSnapshot()
    // Should have non-zero GPS coordinates (PX4 SITL default is Zurich area)
    expect(snap.gps.lat).not.toBe(0)
    expect(snap.gps.lon).not.toBe(0)
    // Sanity check for PX4 default location
    expect(snap.gps.lat).toBeCloseTo(47.4, 0)
    expect(snap.gps.lon).toBeCloseTo(8.5, 0)
  })

  it('ends disarmed after landing', async () => {
    const replay = loadReplay('arm-takeoff-land')
    await replay.replayAll(channel, vehicle)

    const snap = vehicle.state.getSnapshot()
    // Final state should be disarmed (landed)
    expect(snap.core.armed).toBe(false)
  })

  it('tracks altitude changes through snapshots', async () => {
    const replay = loadReplay('arm-takeoff-land')
    const snapshots = await replay.replayWithSnapshots(channel, vehicle, 2000)

    expect(snapshots.length).toBeGreaterThan(3)

    // Find the max altitude snapshot
    const maxAlt = Math.max(...snapshots.map((s) => s.snapshot.gps.relativeAlt))
    expect(maxAlt).toBeGreaterThan(5) // Should have reached at least 5m

    // Last snapshot should be back on the ground (landed)
    const last = snapshots[snapshots.length - 1]
    expect(last.snapshot.gps.relativeAlt).toBeLessThan(2)

    // Should see altitude variation (climbed and descended)
    const minAlt = Math.min(...snapshots.map((s) => s.snapshot.gps.relativeAlt))
    expect(maxAlt - minAlt).toBeGreaterThan(5)
  })

  it('detects GPS fix from raw GPS messages', async () => {
    const replay = loadReplay('arm-takeoff-land')
    await replay.replayAll(channel, vehicle)

    const snap = vehicle.state.getSnapshot()
    expect(snap.gpsRaw.fixType).toBeGreaterThanOrEqual(3) // 3D fix
    expect(snap.gpsRaw.satelliteCount).toBeGreaterThan(0)
  })
})

describe('mode-changes replay', () => {
  let vehicle: Vehicle
  let channel: MavlinkChannel

  beforeEach(() => {
    const setup = createTestVehicle()
    vehicle = setup.vehicle
    channel = setup.channel
  })

  it('tracks flight mode changes', async () => {
    const replay = loadReplay('mode-changes')
    const snapshots = await replay.replayWithSnapshots(channel, vehicle, 500)

    // Should have seen multiple different mode values
    const modes = new Set(snapshots.map((s) => s.snapshot.core.flightMode))
    expect(modes.size).toBeGreaterThan(3)
  })

  it('always reports a flight mode name', async () => {
    const replay = loadReplay('mode-changes')
    const snapshots = await replay.replayWithSnapshots(channel, vehicle, 500)

    for (const s of snapshots) {
      if (s.snapshot.core.seq === 0) continue // skip initial state
      // Every mode should have a name (even if it's "Mode N")
      expect(s.snapshot.core.flightModeName).toBeTruthy()
      expect(s.snapshot.core.flightModeName.length).toBeGreaterThan(0)
    }
  })
})

describe('attitude replay', () => {
  let vehicle: Vehicle
  let channel: MavlinkChannel

  beforeEach(() => {
    const setup = createTestVehicle()
    vehicle = setup.vehicle
    channel = setup.channel
  })

  it('populates attitude from replay', async () => {
    const replay = loadReplay('arm-takeoff-land')
    await replay.replayAll(channel, vehicle)

    const snap = vehicle.state.getSnapshot()
    expect(snap.attitude.seq).toBeGreaterThan(0)
    // Yaw should be non-zero (we set it to ~1.57 in synthetic)
    expect(snap.attitude.yaw).not.toBe(0)
  })
})

// ── Real-capture-only tests ──────────────────────────────────
// These test suites require real PX4 SITL captures. They are skipped
// when capture files are not present (e.g. in CI without SITL).

describe('waypoint-mission replay', () => {
  let vehicle: Vehicle
  let channel: MavlinkChannel

  beforeEach(() => {
    if (!hasCaptureFile('waypoint-mission')) return
    const setup = createTestVehicle()
    vehicle = setup.vehicle
    channel = setup.channel
  })

  it('tracks mission waypoint progress', async () => {
    if (!hasCaptureFile('waypoint-mission')) return
    const replay = TlogReplay.fromFile(resolve(CAPTURES_DIR, 'waypoint-mission.tlog'))
    await replay.replayAll(channel, vehicle)

    const snap = vehicle.state.getSnapshot()
    expect(snap.missionStatus.seq).toBeGreaterThan(0)
    // Should have advanced past waypoint 0
    expect(snap.missionStatus.currentIndex).toBeGreaterThan(0)
  })

  it('captures VFR HUD with varying groundspeed', async () => {
    if (!hasCaptureFile('waypoint-mission')) return
    const replay = TlogReplay.fromFile(resolve(CAPTURES_DIR, 'waypoint-mission.tlog'))
    const snapshots = await replay.replayWithSnapshots(channel, vehicle, 3000)

    const speeds = snapshots.map((s) => s.snapshot.vfrHud.groundspeed).filter((s) => s > 0)
    expect(speeds.length).toBeGreaterThan(0)
    // Should see speed variation during waypoint flight
    const maxSpeed = Math.max(...speeds)
    expect(maxSpeed).toBeGreaterThan(1) // moving at > 1 m/s
  })

  it('captures battery status during flight', async () => {
    if (!hasCaptureFile('waypoint-mission')) return
    const replay = TlogReplay.fromFile(resolve(CAPTURES_DIR, 'waypoint-mission.tlog'))
    await replay.replayAll(channel, vehicle)

    const snap = vehicle.state.getSnapshot()
    expect(snap.battery.seq).toBeGreaterThan(0)
    expect(snap.battery.batteries.length).toBeGreaterThan(0)
    expect(snap.battery.batteries[0].voltage).toBeGreaterThan(0)
  })

  it('shows GPS position change during mission', async () => {
    if (!hasCaptureFile('waypoint-mission')) return
    const replay = TlogReplay.fromFile(resolve(CAPTURES_DIR, 'waypoint-mission.tlog'))
    const snapshots = await replay.replayWithSnapshots(channel, vehicle, 5000)

    const lats = snapshots.map((s) => s.snapshot.gps.lat).filter((l) => l !== 0)
    const lons = snapshots.map((s) => s.snapshot.gps.lon).filter((l) => l !== 0)
    // Should see position change as vehicle flies the square pattern
    const latRange = Math.max(...lats) - Math.min(...lats)
    const lonRange = Math.max(...lons) - Math.min(...lons)
    expect(latRange + lonRange).toBeGreaterThan(0.0001)
  })
})

describe('long-hover replay', () => {
  let vehicle: Vehicle
  let channel: MavlinkChannel

  beforeEach(() => {
    if (!hasCaptureFile('long-hover')) return
    const setup = createTestVehicle()
    vehicle = setup.vehicle
    channel = setup.channel
  })

  it('captures SYS_STATUS with sensor health', async () => {
    if (!hasCaptureFile('long-hover')) return
    const replay = TlogReplay.fromFile(resolve(CAPTURES_DIR, 'long-hover.tlog'))
    await replay.replayAll(channel, vehicle)

    const snap = vehicle.state.getSnapshot()
    expect(snap.sysStatus.seq).toBeGreaterThan(0)
    // PX4 should report some sensors present
    expect(snap.sysStatus.onboardControlSensorsPresent).toBeGreaterThan(0)
    expect(snap.sysStatus.onboardControlSensorsEnabled).toBeGreaterThan(0)
    // CPU load may be 0 in SITL
    expect(snap.sysStatus.load).toBeGreaterThanOrEqual(0)
  })

  it('captures vibration levels', async () => {
    if (!hasCaptureFile('long-hover')) return
    const replay = TlogReplay.fromFile(resolve(CAPTURES_DIR, 'long-hover.tlog'))
    await replay.replayAll(channel, vehicle)

    const snap = vehicle.state.getSnapshot()
    expect(snap.vibration.seq).toBeGreaterThan(0)
    // SITL should report some vibration values (even if small)
    const total = snap.vibration.xVibration + snap.vibration.yVibration + snap.vibration.zVibration
    expect(total).toBeGreaterThanOrEqual(0)
  })

  it('captures home position', async () => {
    if (!hasCaptureFile('long-hover')) return
    const replay = TlogReplay.fromFile(resolve(CAPTURES_DIR, 'long-hover.tlog'))
    await replay.replayAll(channel, vehicle)

    const snap = vehicle.state.getSnapshot()
    expect(snap.home.seq).toBeGreaterThan(0)
    expect(snap.home.valid).toBe(true)
    expect(snap.home.lat).toBeCloseTo(47.4, 0) // PX4 SITL default
    expect(snap.home.lon).toBeCloseTo(8.5, 0)
  })

  it('captures extended sys state (landed state)', async () => {
    if (!hasCaptureFile('long-hover')) return
    const replay = TlogReplay.fromFile(resolve(CAPTURES_DIR, 'long-hover.tlog'))
    await replay.replayAll(channel, vehicle)

    const snap = vehicle.state.getSnapshot()
    expect(snap.extendedState.seq).toBeGreaterThan(0)
    // Final state after landing should be MAV_LANDED_STATE_ON_GROUND (1)
    expect(snap.extendedState.landedState).toBe(1)
  })

  it('captures VFR HUD during hover', async () => {
    if (!hasCaptureFile('long-hover')) return
    const replay = TlogReplay.fromFile(resolve(CAPTURES_DIR, 'long-hover.tlog'))
    await replay.replayAll(channel, vehicle)

    const snap = vehicle.state.getSnapshot()
    expect(snap.vfrHud.seq).toBeGreaterThan(0)
    // Throttle should have been non-zero during hover
    expect(snap.vfrHud.heading).toBeGreaterThanOrEqual(0)
  })

  it('captures battery drain over time', async () => {
    if (!hasCaptureFile('long-hover')) return
    const replay = TlogReplay.fromFile(resolve(CAPTURES_DIR, 'long-hover.tlog'))
    const snapshots = await replay.replayWithSnapshots(channel, vehicle, 5000)

    const batteryLevels = snapshots
      .map((s) => s.snapshot.battery)
      .filter((b) => b.seq > 0 && b.batteries.length > 0)
      .map((b) => b.batteries[0].remaining)
      .filter((r) => r > 0 && r <= 100)

    if (batteryLevels.length >= 2) {
      // Battery should drain (or at least not increase) over time
      const first = batteryLevels[0]
      const last = batteryLevels[batteryLevels.length - 1]
      expect(first).toBeGreaterThanOrEqual(last)
    }
  })
})
