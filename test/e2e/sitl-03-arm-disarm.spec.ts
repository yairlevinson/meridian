/**
 * SITL E2E: Arm/disarm command validation.
 *
 * PX4 SITL auto-takes off in Auto:Loiter mode after arming (no RC to hold
 * position on ground). Disarming requires RTL landing. This test validates
 * arm/disarm via IPC and UI.
 *
 * Important: UI hold-button arm runs first (clean PX4 state). After an
 * RTL-based disarm, PX4 won't reliably re-arm, so the second arm test
 * uses IPC.
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
  test('vehicle shows DISARMED initially', async ({ page }) => {
    await waitConnected(page)
    await waitDisarmed(page)
    const body = await page.textContent('body')
    expect(body).toContain('DISARMED')
  })

  test('GPS fix achieved before arming', async ({ page }) => {
    await waitGpsFix(page)
    const body = await page.textContent('body')
    expect(body).toMatch(/Lat:\s*[\d.-]+/)
  })

  test('arm via UI hold-button', async ({ page }) => {
    // EKF heading convergence can take up to 120s after GPS fix in SITL
    test.setTimeout(SITL_TIMEOUTS.ekfConverge + 30_000)
    await waitGpsFix(page)

    // Wait for EKF convergence — PX4 rejects arm if EKF2 heading not valid.
    // waitArmReady arms+disarms to verify PX4 is ready, then we test the UI button.
    await waitArmReady(page)

    // Find the "Hold to ARM" button and perform a hold-click.
    // HoldButton requires 1000ms hold — use 2500ms for RAF timing safety.
    const armBtn = page.locator('button', { hasText: 'Hold to ARM' })
    await expect(armBtn).toBeVisible({ timeout: 5000 })
    await armBtn.click({ delay: 2500, force: true })

    await waitArmed(page)
  })

  test('disarm via RTL and auto-disarm', async ({ page }) => {
    // PX4 is armed and auto-hovering in Auto:Loiter
    // disarmVehicle uses RTL to land, then PX4 auto-disarms after touchdown
    test.setTimeout(SITL_TIMEOUTS.landComplete + SITL_TIMEOUTS.disarm)
    await waitConnected(page)
    await disarmVehicle(page)
    const body = await page.textContent('body')
    expect(body).toContain('DISARMED')
  })

  test('arm via IPC succeeds after disarm', async ({ page }) => {
    test.setTimeout(90_000)
    await waitGpsFix(page)
    await armVehicle(page)
    const body = await page.textContent('body')
    expect(body).not.toContain('DISARMED')
    expect(body).toContain('ARMED')
  })

  test('disarm via RTL after IPC arm', async ({ page }) => {
    test.setTimeout(SITL_TIMEOUTS.landComplete + SITL_TIMEOUTS.disarm)
    await waitConnected(page)
    await disarmVehicle(page)
    const body = await page.textContent('body')
    expect(body).toContain('DISARMED')
  })
})
