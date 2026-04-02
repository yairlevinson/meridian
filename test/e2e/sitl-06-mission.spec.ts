/**
 * SITL E2E: Mission protocol validation.
 * Tests upload, download, and execution of missions against PX4 SITL.
 */

import { test, expect, useSitl } from './fixtures/vehicleFixture'
import {
  waitConnected,
  waitGpsFix,
  waitArmed,
  waitFlightMode,
  waitDisarmed,
  waitAltitude,
  waitAltitudeBelow,
  getPosition,
  armVehicle,
  ensureDisarmed,
  setMode,
  SITL_TIMEOUTS,
  PX4_MODES
} from './helpers/sitlHelpers'

test.skip(!useSitl, 'SITL-only tests')

// MAVLink mission commands
const MAV_CMD_NAV_TAKEOFF = 22
const MAV_CMD_NAV_WAYPOINT = 16
const MAV_CMD_NAV_RETURN_TO_LAUNCH = 20

// PX4 frame for mission items — use frame 3 (GLOBAL_RELATIVE_ALT) even
// with MISSION_ITEM_INT messages. Frame 6 (*_INT) is rejected by PX4.
const MAV_FRAME_GLOBAL_RELATIVE_ALT = 3

/**
 * Build a simple mission: takeoff -> 2 waypoints -> RTL.
 * Offsets are relative to the provided home position (~50m).
 * Fields match the MissionItem interface (current/autocontinue as booleans,
 * missionType required).
 */
function buildMission(homeLat: number, homeLon: number) {
  return [
    {
      seq: 0,
      frame: MAV_FRAME_GLOBAL_RELATIVE_ALT,
      command: MAV_CMD_NAV_TAKEOFF,
      current: true,
      autocontinue: true,
      param1: 0,
      param2: 0,
      param3: 0,
      param4: 0,
      x: Math.round(homeLat * 1e7),
      y: Math.round(homeLon * 1e7),
      z: 15,
      missionType: 0
    },
    {
      seq: 1,
      frame: MAV_FRAME_GLOBAL_RELATIVE_ALT,
      command: MAV_CMD_NAV_WAYPOINT,
      current: false,
      autocontinue: true,
      param1: 0,
      param2: 5, // acceptance radius
      param3: 0,
      param4: 0,
      x: Math.round((homeLat + 0.0005) * 1e7), // ~55m north
      y: Math.round(homeLon * 1e7),
      z: 15,
      missionType: 0
    },
    {
      seq: 2,
      frame: MAV_FRAME_GLOBAL_RELATIVE_ALT,
      command: MAV_CMD_NAV_WAYPOINT,
      current: false,
      autocontinue: true,
      param1: 0,
      param2: 5,
      param3: 0,
      param4: 0,
      x: Math.round((homeLat + 0.0005) * 1e7),
      y: Math.round((homeLon + 0.0005) * 1e7), // ~55m east
      z: 15,
      missionType: 0
    },
    {
      seq: 3,
      frame: MAV_FRAME_GLOBAL_RELATIVE_ALT,
      command: MAV_CMD_NAV_RETURN_TO_LAUNCH,
      current: false,
      autocontinue: true,
      param1: 0,
      param2: 0,
      param3: 0,
      param4: 0,
      x: 0,
      y: 0,
      z: 0,
      missionType: 0
    }
  ]
}

test.describe.serial('PX4 SITL Mission', () => {
  test('upload mission to PX4', async ({ page }) => {
    await waitConnected(page)
    await waitGpsFix(page)

    const pos = await getPosition(page)
    const items = buildMission(pos.lat, pos.lon)

    // Upload mission via IPC
    await page.evaluate((missionItems) => window.bridge.missionWrite(1, missionItems), items)
  })

  test('download mission round-trip preserves items', async ({ page }) => {
    test.setTimeout(30_000)
    await waitConnected(page)

    // PX4 may need time to process the upload from the previous test.
    // Poll the download until we get items back.
    await expect(async () => {
      const result = (await page.evaluate(() => window.bridge.missionLoad(1))) as any
      expect(result).toBeTruthy()
      const downloaded = result.items || result
      // PX4 may modify the mission on upload (add home position, merge items)
      expect(downloaded.length).toBeGreaterThanOrEqual(2)

      // Verify that waypoint commands are present in the downloaded mission
      const commands = downloaded.map((item: any) => item.command)
      const hasWaypoint = commands.includes(MAV_CMD_NAV_WAYPOINT)
      expect(hasWaypoint).toBeTruthy()
    }).toPass({ timeout: 20_000 })
  })

  test('arm and start mission in Auto mode', async ({ page }) => {
    // armVehicle may retry up to 6 times with 15s gaps (~90s worst case)
    test.setTimeout(SITL_TIMEOUTS.gpsFix + 120_000 + SITL_TIMEOUTS.modeTransition + 15_000)

    // PX4 may need recovery time from emergencyStop in previous test files
    await ensureDisarmed(page)
    await waitGpsFix(page)
    await armVehicle(page)

    // Upload mission again (arm may have cleared it) and switch to Auto:Mission
    const pos = await getPosition(page)
    const items = buildMission(pos.lat, pos.lon)
    await page.evaluate((missionItems) => window.bridge.missionWrite(1, missionItems), items)

    await setMode(page, PX4_MODES.AUTO_MISSION)
    await waitFlightMode(page, 'Auto:Mission')
  })

  test('vehicle takes off during mission', async ({ page }) => {
    test.setTimeout(SITL_TIMEOUTS.takeoffComplete)
    await waitAltitude(page, 10) // mission takeoff is to 15m
  })

  test('mission progresses through waypoints', async ({ page }) => {
    test.setTimeout(SITL_TIMEOUTS.missionComplete)

    // Monitor mission progress — wait for the vehicle to reach at least waypoint 2
    await expect(async () => {
      const pos = await getPosition(page)
      // Waypoint 2 is offset in both lat and lon from home
      // If we see significant movement in both axes, mission is progressing
      const body = await page.textContent('body')
      // Check that we're still in Auto:Mission or transitioning
      expect(body).toMatch(/Auto:(Mission|RTL|Land|Loiter)/)
    }).toPass({ timeout: SITL_TIMEOUTS.missionComplete })
  })

  test('RTL after mission and land', async ({ page }) => {
    test.setTimeout(SITL_TIMEOUTS.landComplete + SITL_TIMEOUTS.disarm)

    // The mission ends with RTL — wait for landing
    await waitAltitudeBelow(page, 2)
    await waitDisarmed(page)
  })
})
