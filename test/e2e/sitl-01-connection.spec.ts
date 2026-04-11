/**
 * SITL E2E: Connection & heartbeat validation.
 * Verifies Meridian can connect to PX4 SITL, identify the autopilot,
 * decode PX4 mode names, and show the vehicle on the map.
 */

import { test, expect, useSitl } from './fixtures/vehicleFixture'
import { waitConnected, waitGpsFix, getFlightMode } from './helpers/sitlHelpers'

test.skip(!useSitl, 'SITL-only tests')

test.describe.serial('PX4 SITL Connection', () => {
  test('app shows Connected after receiving PX4 HEARTBEAT', async ({ page }) => {
    await waitConnected(page)
    const body = await page.textContent('body')
    expect(body).toContain('Connected')
  })

  test('identifies PX4 autopilot type', async ({ page }) => {
    await waitConnected(page)
    const autopilot = await page.evaluate(() => {
      const store = (window as any).__vehicleStore
      return store?.getState()?.vehicles?.[1]?.core?.autopilot
    })
    // MAV_AUTOPILOT_PX4 = 12
    expect(autopilot).toBe(12)
  })

  test('decodes PX4 mode name from custom_mode bitfield', async ({ page }) => {
    await waitConnected(page)
    const mode = await getFlightMode(page)
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
    const hasValidMode = validModes.some((m) => mode.includes(m))
    expect(hasValidMode).toBeTruthy()
  })

  test('vehicle marker appears on map after GPS fix', async ({ page }) => {
    await waitGpsFix(page)
    const marker = page.locator('[title="Vehicle 1"]')
    await expect(marker).toBeVisible({ timeout: 10_000 })
  })
})
