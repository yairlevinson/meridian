/**
 * SITL E2E: Mission pause and resume validation.
 *
 * Tests the full flow: upload mission → start → pause mid-flight →
 * verify position hold → resume → verify continued mission progress → RTL.
 *
 * PX4-specific: pause uses DO_REPOSITION with NaN params (not DO_PAUSE_CONTINUE).
 * Resume switches back to Auto:Mission mode.
 */

import { test, expect, useSitl } from './fixtures/vehicleFixture'
import {
  fullPreFlight,
  ensureDisarmed,
  waitFlightMode,
  waitAltitude,
  waitAltitudeBelow,
  waitDisarmed,
  getPosition,
  setMode,
  PX4_MODES,
  SITL_TIMEOUTS
} from './helpers/sitlHelpers'

test.skip(!useSitl, 'SITL-only tests')

// Mission item constants
const MAV_CMD_NAV_TAKEOFF = 22
const MAV_CMD_NAV_WAYPOINT = 16
const MAV_CMD_NAV_RETURN_TO_LAUNCH = 20
const MAV_FRAME_GLOBAL_RELATIVE_ALT = 3

/** Build a 3-waypoint mission with enough distance to allow pausing mid-flight */
function buildLongMission(homeLat: number, homeLon: number) {
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
      param2: 5,
      param3: 0,
      param4: 0,
      x: Math.round((homeLat + 0.001) * 1e7), // ~110m north
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
      x: Math.round((homeLat + 0.001) * 1e7),
      y: Math.round((homeLon + 0.001) * 1e7), // ~110m east
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

test.describe.serial('PX4 SITL Mission Pause/Resume', () => {
  test('pre-flight and upload mission', async ({ page }) => {
    test.setTimeout(SITL_TIMEOUTS.gpsFix + 120_000 + 30_000)

    await ensureDisarmed(page)
    await fullPreFlight(page)

    // Upload mission
    const pos = await getPosition(page)
    const items = buildLongMission(pos.lat, pos.lon)
    await page.evaluate((missionItems) => window.bridge.missionWrite(1, missionItems), items)
    await page.waitForTimeout(2000)
  })

  test('start mission and wait for takeoff', async ({ page }) => {
    test.setTimeout(SITL_TIMEOUTS.takeoffComplete + SITL_TIMEOUTS.modeTransition)

    // Switch to Auto:Mission mode to start
    await setMode(page, PX4_MODES.AUTO_MISSION)
    await waitFlightMode(page, 'Auto:Mission')

    // Wait for takeoff
    await waitAltitude(page, 10)
  })

  test('pause mid-mission holds position', async ({ page }) => {
    test.setTimeout(30_000)

    // Let the vehicle fly toward WP1 for a few seconds
    await page.waitForTimeout(5000)

    // Pause — this now uses DO_REPOSITION with NaN params (via CommandSemantics)
    await page.evaluate(() => window.bridge.guidedPause(1))

    // Should transition to Auto:Loiter (PX4 hold mode after DO_REPOSITION)
    await expect(async () => {
      const body = await page.textContent('body')
      // PX4 enters Loiter or Hold after DO_REPOSITION
      expect(body).toMatch(/Auto:Loiter|PosCtl/)
    }).toPass({ timeout: SITL_TIMEOUTS.modeTransition })

    // Verify position holds: measure drift over 5 seconds
    const pos1 = await getPosition(page)
    await page.waitForTimeout(5000)
    const pos2 = await getPosition(page)

    const drift = Math.sqrt(
      Math.pow((pos2.lat - pos1.lat) * 111_000, 2) +
        Math.pow((pos2.lon - pos1.lon) * 111_000 * Math.cos((pos1.lat * Math.PI) / 180), 2)
    )
    expect(drift).toBeLessThan(5) // less than 5m drift while paused
  })

  test('resume mission continues flight', async ({ page }) => {
    test.setTimeout(SITL_TIMEOUTS.modeTransition + 15_000)

    // Resume by switching back to Auto:Mission
    await setMode(page, PX4_MODES.AUTO_MISSION)
    await waitFlightMode(page, 'Auto:Mission')

    // Verify the vehicle starts moving again
    const pos1 = await getPosition(page)
    await page.waitForTimeout(8000)
    const pos2 = await getPosition(page)

    const movement = Math.sqrt(
      Math.pow((pos2.lat - pos1.lat) * 111_000, 2) +
        Math.pow((pos2.lon - pos1.lon) * 111_000 * Math.cos((pos1.lat * Math.PI) / 180), 2)
    )
    expect(movement).toBeGreaterThan(2) // should have moved at least 2m
  })

  test('RTL and land after mission', async ({ page }) => {
    test.setTimeout(SITL_TIMEOUTS.landComplete + SITL_TIMEOUTS.disarm)

    await page.evaluate(() => window.bridge.guidedRTL(1))
    await waitFlightMode(page, 'Auto:RTL')
    await waitAltitudeBelow(page, 2)
    await waitDisarmed(page)
  })
})
