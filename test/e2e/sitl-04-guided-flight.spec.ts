/**
 * SITL E2E: Guided flight command validation.
 * Serial chain: preflight -> takeoff -> goto -> pause -> RTL -> land.
 * Each test depends on vehicle state from the previous test.
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

test.describe.serial('PX4 SITL Guided Flight', () => {
  test('pre-flight: connect, GPS fix, arm, takeoff', async ({ page }) => {
    // armVehicle may retry up to 6 times with 15s gaps (~90s worst case)
    test.setTimeout(SITL_TIMEOUTS.gpsFix + 120_000 + SITL_TIMEOUTS.takeoffComplete * 2)

    // PX4 may still be recovering from a previous test file's RTL/landing.
    await ensureDisarmed(page)
    await fullPreFlight(page)

    // PX4 SITL auto-takes off in Auto:Loiter after arming. Send explicit
    // takeoff command repeatedly until the vehicle starts climbing — PX4 may
    // ignore the first command while still transitioning modes internally.
    await expect(async () => {
      await page.evaluate(() => window.bridge.guidedTakeoff(1, 15))
      await page.waitForTimeout(3000)
      const body = await page.textContent('body')
      const altMatch = body?.match(/ALT\s*([\d.-]+)\s*m/)
      expect(altMatch).toBeTruthy()
      expect(parseFloat(altMatch![1])).toBeGreaterThanOrEqual(5)
    }).toPass({ timeout: SITL_TIMEOUTS.takeoffComplete })

    // Wait for full altitude and stable loiter
    await waitAltitude(page, 12)
    await page.waitForTimeout(3000)
  })

  test('goto a nearby position', async ({ page }) => {
    test.setTimeout(SITL_TIMEOUTS.waypointArrival * 2)

    // Ensure vehicle is in Auto:Loiter before sending goto
    await setMode(page, PX4_MODES.AUTO_LOITER)
    await page.waitForTimeout(2000)

    const startPos = await getPosition(page)

    // DO_REPOSITION param7 is altitude in MSL meters. Home is ~488m MSL,
    // vehicle is at ~503m MSL after takeoff. Use current GPS alt to stay level.
    const targetAlt = startPos.alt > 0 ? startPos.alt : 503

    // Move ~55m north (0.0005 degrees latitude ~ 55m).
    // Retry the goto command — PX4 may reject the first attempt while
    // still stabilizing after takeoff (lockstep sim can be slow).
    await expect(async () => {
      await page.evaluate(
        ([lat, lon, alt]) => window.bridge.guidedGoto(1, lat + 0.0005, lon, alt),
        [startPos.lat, startPos.lon, targetAlt]
      )
      await page.waitForTimeout(5000)
      const newPos = await getPosition(page)
      const dLat = Math.abs(newPos.lat - startPos.lat)
      expect(dLat).toBeGreaterThan(0.00005) // ~5m movement
    }).toPass({ timeout: SITL_TIMEOUTS.waypointArrival * 2 })
  })

  test('pause stops movement', async ({ page }) => {
    await page.evaluate(() => window.bridge.guidedPause(1))

    // After pause, vehicle should hold position. Wait a moment then check
    // that position barely changes over 3 seconds.
    await page.waitForTimeout(2000)
    const pos1 = await getPosition(page)
    await page.waitForTimeout(3000)
    const pos2 = await getPosition(page)

    const drift = Math.sqrt(
      Math.pow((pos2.lat - pos1.lat) * 111_000, 2) +
        Math.pow((pos2.lon - pos1.lon) * 111_000 * Math.cos((pos1.lat * Math.PI) / 180), 2)
    )
    // Should drift less than 5 meters in 3 seconds while paused
    expect(drift).toBeLessThan(5)
  })

  test('RTL returns toward home', async ({ page }) => {
    test.setTimeout(SITL_TIMEOUTS.landComplete + SITL_TIMEOUTS.modeTransition)

    await page.evaluate(() => window.bridge.guidedRTL(1))
    await waitFlightMode(page, 'Auto:RTL')
  })

  test('vehicle lands and disarms after RTL', async ({ page }) => {
    // Vehicle may need to fly ~55m back to home before landing
    test.setTimeout(SITL_TIMEOUTS.landComplete * 2 + SITL_TIMEOUTS.disarm)

    // Wait for altitude to drop near ground
    await waitAltitudeBelow(page, 2)

    // PX4 auto-disarms after landing
    await waitDisarmed(page)
  })
})
