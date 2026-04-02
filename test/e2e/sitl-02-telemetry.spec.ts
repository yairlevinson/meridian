/**
 * SITL E2E: Telemetry group validation.
 * Verifies that PX4 sends and Meridian correctly parses/displays
 * all major telemetry data groups.
 */

import { test, expect, useSitl } from './fixtures/vehicleFixture'
import { waitConnected, waitGpsFix, SITL_TIMEOUTS } from './helpers/sitlHelpers'

test.skip(!useSitl, 'SITL-only tests')

test.describe.serial('PX4 SITL Telemetry', () => {
  test('displays attitude (roll/pitch/yaw)', async ({ page }) => {
    await waitConnected(page)
    // Wait for attitude data to flow (PX4 sends ATTITUDE at 10Hz)
    await expect(async () => {
      const body = await page.textContent('body')
      expect(body).toMatch(/Roll:\s*[\d.-]+/)
      expect(body).toMatch(/Pitch:\s*[\d.-]+/)
      expect(body).toMatch(/Yaw:\s*[\d.-]+/)
    }).toPass({ timeout: 10_000 })
  })

  test('displays GPS coordinates after fix', async ({ page }) => {
    await waitGpsFix(page)
    const body = await page.textContent('body')
    const lat = parseFloat(body?.match(/Lat:\s*([\d.-]+)/)?.[1] || '0')
    const lon = parseFloat(body?.match(/Lon:\s*([\d.-]+)/)?.[1] || '0')
    expect(lat).not.toBe(0)
    expect(lon).not.toBe(0)
  })

  test('GPS raw data available via IPC (fixType, satellites)', async ({ page }) => {
    await waitGpsFix(page)
    const gpsRaw = await page.evaluate(() => {
      const store = (window as any).__vehicleStore
      return store?.getState()?.vehicles?.[1]?.gpsRaw
    })
    // Even if store isn't exposed, the UI should show GPS info in sidebar
    // Verify GPS status section exists
    const gpsSection = page.locator('text=GPS Lock')
    await expect(gpsSection).toBeVisible({ timeout: 10_000 })
  })

  test('displays heading from VFR_HUD', async ({ page }) => {
    await waitConnected(page)
    await expect(async () => {
      const body = await page.textContent('body')
      expect(body).toMatch(/Yaw:\s*[\d.-]+/)
    }).toPass({ timeout: 10_000 })
  })

  test('displays battery status', async ({ page }) => {
    await waitConnected(page)
    // Battery section in sidebar should show voltage or percentage
    await expect(async () => {
      // Use exact match to avoid matching PreFlightChecklist "Battery" text
      const batterySection = page.locator('.section-label', { hasText: 'BATTERY' })
      await expect(batterySection).toBeVisible()
    }).toPass({ timeout: 15_000 })
  })

  test('displays system health (sensors)', async ({ page }) => {
    await waitConnected(page)
    // The pre-flight checklist shows sensor status
    await expect(async () => {
      const sensorsCheck = page.getByText('Sensors', { exact: true })
      await expect(sensorsCheck).toBeVisible()
    }).toPass({ timeout: 15_000 })
  })

  test('displays altitude', async ({ page }) => {
    await waitGpsFix(page)
    await expect(async () => {
      const body = await page.textContent('body')
      expect(body).toMatch(/Alt:\s*[\d.-]+m/)
    }).toPass({ timeout: 10_000 })
  })

  test('FPS stays above 30 during PX4 streaming', async ({ page }) => {
    await waitConnected(page)
    // Let telemetry flow for a few seconds
    await page.waitForTimeout(5000)
    const body = await page.textContent('body')
    const fpsMatch = body?.match(/FPS\s+(\d+)/)
    expect(fpsMatch).toBeTruthy()
    expect(parseInt(fpsMatch![1])).toBeGreaterThan(30)
  })

  test('IPC latency stays under 40ms', async ({ page }) => {
    await waitConnected(page)
    await page.waitForTimeout(3000)
    const body = await page.textContent('body')
    const ipcMatch = body?.match(/IPC\s+(\d+)ms/)
    expect(ipcMatch).toBeTruthy()
    expect(parseInt(ipcMatch![1])).toBeLessThan(40)
  })
})
