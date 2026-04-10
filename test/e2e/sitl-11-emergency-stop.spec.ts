/**
 * SITL E2E: Emergency stop (forced disarm) validation.
 *
 * Tests that the vehicle can be immediately disarmed mid-flight via
 * emergencyStop (MAV_CMD_COMPONENT_ARM_DISARM with p1=0, p2=21196).
 *
 * WARNING: Emergency stop corrupts PX4 internal state — subsequent arms
 * may fail until PX4 resets. This test should run last in the SITL suite.
 */

import { test, expect, useSitl } from './fixtures/vehicleFixture'
import {
  fullPreFlight,
  ensureDisarmed,
  waitAltitude,
  waitDisarmed,
  SITL_TIMEOUTS
} from './helpers/sitlHelpers'

test.skip(!useSitl, 'SITL-only tests')

test.describe.serial('PX4 SITL Emergency Stop', () => {
  test('pre-flight: connect, GPS fix, arm, takeoff', async ({ page }) => {
    test.setTimeout(SITL_TIMEOUTS.gpsFix + 120_000 + SITL_TIMEOUTS.takeoffComplete * 2)

    await ensureDisarmed(page)
    await fullPreFlight(page)

    // Wait for takeoff to at least 8m
    await expect(async () => {
      await page.evaluate(() => window.bridge.guidedTakeoff(1, 15))
      await page.waitForTimeout(3000)
      const body = await page.textContent('body')
      const altMatch = body?.match(/ALT\s*([\d.-]+)\s*m/)
      expect(altMatch).toBeTruthy()
      expect(parseFloat(altMatch![1])).toBeGreaterThanOrEqual(5)
    }).toPass({ timeout: SITL_TIMEOUTS.takeoffComplete })

    await waitAltitude(page, 8)
  })

  test('emergency stop immediately disarms mid-flight', async ({ page }) => {
    test.setTimeout(30_000)

    // Verify vehicle is armed and flying
    const bodyBefore = await page.textContent('body')
    expect(bodyBefore).toContain('ARMED')
    expect(bodyBefore).not.toContain('DISARMED')

    // Send emergency stop — forced disarm with p2=21196
    await page.evaluate(() => window.bridge.emergencyStop(1))

    // Vehicle should disarm almost immediately (within a few seconds)
    await waitDisarmed(page)

    const bodyAfter = await page.textContent('body')
    expect(bodyAfter).toContain('DISARMED')
  })
})
