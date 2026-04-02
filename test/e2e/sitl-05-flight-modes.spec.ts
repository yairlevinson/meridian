/**
 * SITL E2E: PX4 flight mode transitions.
 *
 * PX4 SITL has no RC input, so Manual/Stabilized/AltCtl/PosCtl modes
 * revert immediately. DO_SET_MODE returns ACCEPTED but PX4 doesn't
 * actually change mode — this is a known SITL limitation without RC.
 *
 * This test validates mode display and decoding. Mode-switching tests
 * that depend on DO_SET_MODE are skipped.
 */

import { test, expect, useSitl } from './fixtures/vehicleFixture'
import {
  waitConnected,
  waitGpsFix,
  ensureDisarmed,
  SITL_TIMEOUTS
} from './helpers/sitlHelpers'

test.skip(!useSitl, 'SITL-only tests')

test.describe.serial('PX4 SITL Flight Modes', () => {
  test('initial mode is readable', async ({ page }) => {
    await ensureDisarmed(page)
    const body = await page.textContent('body')
    // PX4 SITL boots into Auto:Loiter (no RC available)
    const validModes = ['Manual', 'Stabilized', 'AltCtl', 'PosCtl', 'Auto:']
    const hasMode = validModes.some((m) => body?.includes(m))
    expect(hasMode).toBeTruthy()
  })

  test('mode name is decoded in UI (PX4 custom_mode bitfield)', async ({ page }) => {
    await waitConnected(page)
    // Wait for mode to stabilize after connection (may briefly show "Mode ---")
    await expect(async () => {
      const body = await page.textContent('body')
      // Must contain "Auto:" prefix which comes from PX4_MODE_NAMES decoder
      expect(body).toContain('Auto:')
      // Should NOT show "Unknown" if decoder works correctly
      expect(body).not.toMatch(/Unknown \(\d+\)/)
    }).toPass({ timeout: SITL_TIMEOUTS.modeTransition })
  })

  test('flight mode button shows current mode in dropdown', async ({ page }) => {
    await waitConnected(page)
    const modeButton = page.locator('button', { hasText: /\u25BE/ })
    await expect(modeButton).toBeVisible({ timeout: 5000 })
  })

  // DO_SET_MODE returns ACCEPTED but PX4 SITL doesn't actually change mode
  // without RC input. These tests document the limitation.
  test.skip('switch to Auto:RTL mode (requires RC — skipped in SITL)', async () => {})
  test.skip('switch to Auto:Loiter mode (requires RC — skipped in SITL)', async () => {})
})
