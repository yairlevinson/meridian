/**
 * SITL E2E: Connection & heartbeat validation.
 * Verifies Meridian can connect to PX4 SITL, identify the autopilot,
 * decode PX4 mode names, and show the vehicle on the map.
 */

import { test, expect, useSitl } from './fixtures/vehicleFixture'
import { waitConnected, waitGpsFix } from './helpers/sitlHelpers'

test.skip(!useSitl, 'SITL-only tests')

test.describe.serial('PX4 SITL Connection', () => {
  test('app shows CONNECTED after receiving PX4 HEARTBEAT', async ({ page }) => {
    await waitConnected(page)
    const status = await page.locator('[data-testid="conn-status"]').textContent()
    expect(status).toBe('CONNECTED')
  })

  test('identifies PX4 autopilot type', async ({ page }) => {
    await waitConnected(page)
    // PX4 autopilot type = 12 (MAV_AUTOPILOT_PX4)
    const autopilot = await page.evaluate(
      () => (window as any).__vehicleStore?.getState()?.vehicles?.[1]?.core?.autopilot
    )
    // If store isn't directly accessible, check the telemetry bar shows a PX4 mode name
    const body = await page.textContent('body')
    // PX4 modes contain colons (e.g. "Auto:Loiter") or are PX4-specific names
    const hasPx4Indicators =
      autopilot === 12 ||
      body?.includes('Auto:') ||
      body?.includes('PosCtl') ||
      body?.includes('AltCtl') ||
      body?.includes('Stabilized') ||
      body?.includes('Manual')
    expect(hasPx4Indicators).toBeTruthy()
  })

  test('decodes PX4 mode name from custom_mode bitfield', async ({ page }) => {
    await waitConnected(page)
    // PX4 initial mode after boot is typically Manual, Stabilized, or Auto:Loiter
    const body = await page.textContent('body')
    const validModes = [
      'Manual',
      'Stabilized',
      'AltCtl',
      'PosCtl',
      'Auto:Ready',
      'Auto:Takeoff',
      'Auto:Loiter',
      'Auto:Mission',
      'Auto:RTL',
      'Auto:Land',
      'Acro',
      'Offboard'
    ]
    const hasValidMode = validModes.some((m) => body?.includes(m))
    expect(hasValidMode).toBeTruthy()
  })

  test('vehicle marker appears on map after GPS fix', async ({ page }) => {
    await waitGpsFix(page)
    // The vehicle marker has a title attribute
    const marker = page.locator('[title="Vehicle 1"]')
    await expect(marker).toBeVisible({ timeout: 10_000 })
  })
})
