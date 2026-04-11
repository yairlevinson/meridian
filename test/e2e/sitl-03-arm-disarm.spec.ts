/**
 * SITL E2E: Arm/disarm command validation.
 *
 * PX4 SITL auto-takes off in Auto:Loiter mode after arming (no RC to hold
 * position on ground). Disarming requires RTL landing. This test validates
 * arm/disarm via IPC and UI.
 */

import { test, expect, useSitl } from './fixtures/vehicleFixture'
import {
  waitConnected,
  waitGpsFix,
  waitArmed,
  waitDisarmed,
  waitArmReady,
  armVehicle,
  disarmVehicle,
  SITL_TIMEOUTS
} from './helpers/sitlHelpers'

test.skip(!useSitl, 'SITL-only tests')

test.describe.serial('PX4 SITL Arm/Disarm', () => {
  test('vehicle shows Disarmed initially', async ({ page }) => {
    await waitConnected(page)
    await waitDisarmed(page)
    const body = await page.textContent('body')
    expect(body).toContain('Disarmed')
  })

  test('GPS fix achieved before arming', async ({ page }) => {
    await waitGpsFix(page)
    const body = await page.textContent('body')
    expect(body).toContain('3D Fix')
  })

  test('arm via IPC and verify UI reflects Armed state', async ({ page }) => {
    test.setTimeout(SITL_TIMEOUTS.ekfConverge + 30_000)
    await waitGpsFix(page)
    await waitArmReady(page)

    // Arm via IPC bridge
    await armVehicle(page)
    await waitArmed(page)
  })

  test('disarm via RTL and auto-disarm', async ({ page }) => {
    test.setTimeout(SITL_TIMEOUTS.landComplete + SITL_TIMEOUTS.disarm)
    await waitConnected(page)
    await disarmVehicle(page)
    const body = await page.textContent('body')
    expect(body).toContain('Disarmed')
  })

  test('arm via IPC succeeds after disarm', async ({ page }) => {
    test.setTimeout(90_000)
    await waitGpsFix(page)
    await armVehicle(page)
    const body = await page.textContent('body')
    expect(body).not.toContain('Disarmed')
    expect(body).toContain('Armed')
  })

  test('disarm via RTL after IPC arm', async ({ page }) => {
    test.setTimeout(SITL_TIMEOUTS.landComplete + SITL_TIMEOUTS.disarm)
    await waitConnected(page)
    await disarmVehicle(page)
    const body = await page.textContent('body')
    expect(body).toContain('Disarmed')
  })
})
