/**
 * SITL E2E: Pre-flight checklist validation.
 * Verifies that PX4 sensor data correctly populates the checklist items.
 *
 * The PreFlightChecklist only renders when the vehicle is DISARMED.
 * Since the PX4 process is shared across test suites, we force-disarm first.
 */

import { test, expect, useSitl } from './fixtures/vehicleFixture'
import { waitConnected, waitGpsFix, ensureDisarmed, SITL_TIMEOUTS } from './helpers/sitlHelpers'

test.skip(!useSitl, 'SITL-only tests')

test.describe.serial('PX4 SITL Pre-flight Checks', () => {
  test('pre-flight checklist is visible', async ({ page }) => {
    await ensureDisarmed(page)
    const checklist = page.locator('text=Pre-Flight Checklist')
    await expect(checklist).toBeVisible({ timeout: 10_000 })
  })

  test('GPS check passes after fix', async ({ page }) => {
    await ensureDisarmed(page)
    await waitGpsFix(page)

    await expect(async () => {
      const body = await page.textContent('body')
      // GPS Lock item should show 3D fix info
      expect(body).toMatch(/3D/)
    }).toPass({ timeout: 10_000 })
  })

  test('battery check passes', async ({ page }) => {
    await ensureDisarmed(page)

    await expect(async () => {
      const body = await page.textContent('body')
      // Battery item should show percentage
      expect(body).toMatch(/\d+%/)
    }).toPass({ timeout: 15_000 })
  })

  test('sensors check passes', async ({ page }) => {
    await ensureDisarmed(page)

    await expect(async () => {
      const body = await page.textContent('body')
      expect(body).toMatch(/[Hh]ealthy/)
    }).toPass({ timeout: 15_000 })
  })

  test('communication check passes', async ({ page }) => {
    await ensureDisarmed(page)

    await expect(async () => {
      const body = await page.textContent('body')
      expect(body).toMatch(/[Ll]ink\s*(active|ok)/i)
    }).toPass({ timeout: 10_000 })
  })

  test('system checks section shows pass count', async ({ page }) => {
    await ensureDisarmed(page)
    await waitGpsFix(page)

    await expect(async () => {
      const body = await page.textContent('body')
      // Match pattern like "4/5" or "5/5" in checklist header
      expect(body).toMatch(/\d+\/\d+/)
    }).toPass({ timeout: 10_000 })
  })
})
