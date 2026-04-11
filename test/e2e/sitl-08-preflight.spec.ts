/**
 * SITL E2E: Pre-flight sensor validation.
 * Verifies that PX4 sensor data is available and healthy via the vehicle store.
 *
 * The PreFlightChecklist component is no longer rendered in FlyView (replaced by
 * floating panels). These tests validate the underlying telemetry data that
 * the checklist logic depends on.
 */

import { test, expect, useSitl } from './fixtures/vehicleFixture'
import { waitGpsFix, ensureDisarmed } from './helpers/sitlHelpers'

test.skip(!useSitl, 'SITL-only tests')

test.describe.serial('PX4 SITL Pre-flight Checks', () => {
  test('GPS check: 3D fix shown in StatusIcons', async ({ page }) => {
    await ensureDisarmed(page)
    await waitGpsFix(page)

    const body = await page.textContent('body')
    expect(body).toContain('3D Fix')
  })

  test('battery data available', async ({ page }) => {
    await ensureDisarmed(page)

    await expect(async () => {
      const body = await page.textContent('body')
      // StatusIcons BatteryIcon shows percentage
      expect(body).toMatch(/\d+%/)
    }).toPass({ timeout: 15_000 })
  })

  test('sensor health available via store', async ({ page }) => {
    await ensureDisarmed(page)

    await expect(async () => {
      const sysStatus = await page.evaluate(() => {
        const store = (window as any).__vehicleStore
        return store?.getState()?.vehicles?.[1]?.sysStatus
      })
      expect(sysStatus).toBeDefined()
      // At least some sensors should be enabled
      expect(sysStatus.onboardControlSensorsEnabled).toBeGreaterThan(0)
    }).toPass({ timeout: 15_000 })
  })

  test('communication link active', async ({ page }) => {
    await ensureDisarmed(page)

    await expect(async () => {
      const body = await page.textContent('body')
      // ConnectionIndicator shows "Connected" when link is active
      expect(body).toContain('Connected')
    }).toPass({ timeout: 10_000 })
  })
})
