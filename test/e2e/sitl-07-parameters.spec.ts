/**
 * SITL E2E: Parameter protocol validation.
 * Tests auto-download of PX4's ~900 parameters and set/read-back.
 */

import { test, expect, useSitl } from './fixtures/vehicleFixture'
import { waitConnected, waitParameters, SITL_TIMEOUTS } from './helpers/sitlHelpers'

test.skip(!useSitl, 'SITL-only tests')

test.describe.serial('PX4 SITL Parameters', () => {
  test('parameters auto-download on connection', async ({ page }) => {
    test.setTimeout(SITL_TIMEOUTS.paramDownload)
    await waitConnected(page)

    // Wait for parametersReady event via polling
    await expect(async () => {
      const params = (await page.evaluate(() => window.bridge.getParameters(1))) as any[]
      expect(params).toBeTruthy()
      expect(params.length).toBeGreaterThan(100)
    }).toPass({ timeout: SITL_TIMEOUTS.paramDownload })
  })

  test('parameter list contains known PX4 params', async ({ page }) => {
    test.setTimeout(SITL_TIMEOUTS.paramDownload)
    await waitConnected(page)
    // Wait for a substantial portion of params to be downloaded
    await waitParameters(page, 500)
    const params = (await page.evaluate(() => window.bridge.getParameters(1))) as any[]
    expect(params.length).toBeGreaterThan(500)

    // Check that parameter objects have the expected structure
    const first = params[0]
    expect(first).toHaveProperty('name')
    expect(first).toHaveProperty('value')

    // Log some param names for debugging if the known param check fails
    const names = params.slice(0, 10).map((p: any) => p.name)
    console.log('[params] First 10 param names:', names.join(', '))

    // Find a well-known PX4 parameter — try several common ones
    const knownNames = [
      'SYS_AUTOSTART', 'MAV_SYS_ID', 'COM_ARM_EKF_AB', 'MPC_XY_VEL_MAX',
      'BAT1_CAPACITY', 'ATT_EN', 'ASPD_SCALE_1', 'NAV_ACC_RAD',
      'COM_RC_LOSS_T', 'COM_DL_LOSS_T', 'MPC_Z_VEL_MAX_UP'
    ]
    const knownParam = params.find((p: any) => knownNames.includes(p.name))
    expect(knownParam).toBeTruthy()
    expect(typeof knownParam.value).toBe('number')
  })

  test('set a parameter and verify read-back', async ({ page }) => {
    test.setTimeout(SITL_TIMEOUTS.paramDownload)
    await waitConnected(page)
    await waitParameters(page)
    // Use MPC_XY_VEL_MAX — safe to change, doesn't affect SITL stability
    const params = (await page.evaluate(() => window.bridge.getParameters(1))) as any[]
    const param = params.find((p: any) => p.name === 'MPC_XY_VEL_MAX')

    if (!param) {
      // Some PX4 versions may not have this param — skip gracefully
      test.skip(true, 'MPC_XY_VEL_MAX not found in parameter list')
      return
    }

    const originalValue = param.value
    const testValue = originalValue === 12 ? 10 : 12

    // Set new value
    await page.evaluate(
      ({ name, val }) => window.bridge.setParameter(1, name, val),
      { name: 'MPC_XY_VEL_MAX', val: testValue }
    )

    // Wait for the parameter to be acknowledged
    await page.waitForTimeout(2000)

    // Read back
    const updatedParams = (await page.evaluate(() => window.bridge.getParameters(1))) as any[]
    const updated = updatedParams.find((p: any) => p.name === 'MPC_XY_VEL_MAX')
    expect(updated).toBeTruthy()
    expect(updated.value).toBeCloseTo(testValue, 0)

    // Restore original value
    await page.evaluate(
      ({ name, val }) => window.bridge.setParameter(1, name, val),
      { name: 'MPC_XY_VEL_MAX', val: originalValue }
    )
  })

  test('parameter count is in expected range for PX4', async ({ page }) => {
    test.setTimeout(SITL_TIMEOUTS.paramDownload)
    await waitConnected(page)
    await waitParameters(page, 500)
    const params = (await page.evaluate(() => window.bridge.getParameters(1))) as any[]
    // PX4 typically has 700-1200 parameters
    expect(params.length).toBeGreaterThan(500)
    expect(params.length).toBeLessThan(2000)
  })
})
