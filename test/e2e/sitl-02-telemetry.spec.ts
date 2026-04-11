/**
 * SITL E2E: Telemetry group validation.
 * Verifies that PX4 sends and Meridian correctly parses/displays
 * all major telemetry data groups via the floating UI panels.
 */

import { test, expect, useSitl } from './fixtures/vehicleFixture'
import { waitConnected, waitGpsFix } from './helpers/sitlHelpers'

test.skip(!useSitl, 'SITL-only tests')

test.describe.serial('PX4 SITL Telemetry', () => {
  test('displays heading in FloatingInstruments', async ({ page }) => {
    await waitConnected(page)
    await expect(async () => {
      const body = await page.textContent('body')
      // FloatingInstruments shows HDG with a numeric value
      expect(body).toMatch(/HDG\s*[\d.-]+/)
    }).toPass({ timeout: 10_000 })
  })

  test('displays GPS fix in StatusIcons tooltip', async ({ page }) => {
    await waitGpsFix(page)
    const body = await page.textContent('body')
    // GPS tooltip shows fix type and satellite count
    expect(body).toContain('3D Fix')
  })

  test('GPS coordinates available via store', async ({ page }) => {
    await waitGpsFix(page)
    const gps = await page.evaluate(() => {
      const store = (window as any).__vehicleStore
      return store?.getState()?.vehicles?.[1]?.gps
    })
    expect(gps).toBeDefined()
    expect(gps.lat).not.toBe(0)
    expect(gps.lon).not.toBe(0)
  })

  test('displays battery status in StatusIcons', async ({ page }) => {
    await waitConnected(page)
    await expect(async () => {
      const body = await page.textContent('body')
      // StatusIcons BatteryIcon shows percentage
      expect(body).toMatch(/\d+%/)
    }).toPass({ timeout: 15_000 })
  })

  test('displays altitude in FloatingInstruments', async ({ page }) => {
    await waitGpsFix(page)
    await expect(async () => {
      const body = await page.textContent('body')
      expect(body).toMatch(/ALT\s*[\d.-]+\s*m/)
    }).toPass({ timeout: 10_000 })
  })

  test('displays speed in FloatingInstruments', async ({ page }) => {
    await waitConnected(page)
    await expect(async () => {
      const body = await page.textContent('body')
      expect(body).toMatch(/SPD\s*[\d.-]+/)
    }).toPass({ timeout: 10_000 })
  })
})
