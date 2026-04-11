/**
 * SITL E2E: PX4 flight mode transitions.
 *
 * PX4 SITL has no RC input, so Manual/Stabilized/AltCtl/PosCtl modes
 * revert immediately. This test validates mode decoding via the vehicle store.
 */

import { test, expect, useSitl } from './fixtures/vehicleFixture'
import { waitConnected, ensureDisarmed, getFlightMode, SITL_TIMEOUTS } from './helpers/sitlHelpers'

test.skip(!useSitl, 'SITL-only tests')

test.describe.serial('PX4 SITL Flight Modes', () => {
  test('initial mode is readable', async ({ page }) => {
    await ensureDisarmed(page)
    const mode = await getFlightMode(page)
    const validModes = ['Manual', 'Stabilized', 'AltCtl', 'PosCtl', 'Auto:']
    const hasMode = validModes.some((m) => mode.includes(m))
    expect(hasMode).toBeTruthy()
  })

  test('mode name is decoded correctly (PX4 custom_mode bitfield)', async ({ page }) => {
    await waitConnected(page)
    await expect(async () => {
      const mode = await getFlightMode(page)
      // Must contain "Auto:" prefix which comes from PX4_MODE_NAMES decoder
      expect(mode).toContain('Auto:')
      // Should NOT show "Unknown" if decoder works correctly
      expect(mode).not.toMatch(/Unknown \(\d+\)/)
    }).toPass({ timeout: SITL_TIMEOUTS.modeTransition })
  })

  // DO_SET_MODE returns ACCEPTED but PX4 SITL doesn't actually change mode
  // without RC input. These tests document the limitation.
  test.skip('switch to Auto:RTL mode (requires RC — skipped in SITL)', async () => {})
  test.skip('switch to Auto:Loiter mode (requires RC — skipped in SITL)', async () => {})
})
