/**
 * Shared helper functions for PX4 SITL E2E tests.
 *
 * All wait* functions use Playwright's expect().toPass() polling pattern
 * against the rendered UI, which validates the full pipeline (MAVLink ->
 * main process -> IPC delta -> Zustand store -> React render).
 *
 * Important PX4 SITL constraint: Manual/Stabilized/AltCtl modes require RC
 * input. Without a virtual RC (which SITL doesn't provide), PX4 reverts
 * these modes back to Auto:Loiter immediately. Only Auto:* modes work
 * reliably in SITL without RC.
 */

import { expect, type Page } from '@playwright/test'
import { common } from 'mavlink-mappings'

// ── PX4 custom_mode bitfield values ────────────────────────────────
// Encoding: main_mode in bits 16-23, sub_mode in bits 24-31.

export const PX4_MODES = {
  AUTO_LOITER: (4 << 16) | (3 << 24),
  AUTO_MISSION: (4 << 16) | (4 << 24),
  AUTO_RTL: (4 << 16) | (5 << 24),
  AUTO_LAND: (4 << 16) | (6 << 24)
} as const

// ── Timeouts calibrated for PX4 SITL + Gazebo ──────────────────────

export const SITL_TIMEOUTS = {
  connection: 30_000,
  gpsFix: 60_000,
  armReady: 15_000,
  ekfConverge: 120_000,
  modeTransition: 15_000,
  takeoffComplete: 30_000,
  waypointArrival: 45_000,
  missionComplete: 120_000,
  paramDownload: 90_000,
  landComplete: 60_000,
  disarm: 60_000
}

// ── Connection & telemetry waits ────────────────────────────────────

/** Wait for the telemetry bar to show CONNECTED. */
export async function waitConnected(page: Page): Promise<void> {
  await expect(async () => {
    const text = await page.locator('[data-testid="conn-status"]').textContent()
    expect(text).toBe('CONNECTED')
  }).toPass({ timeout: SITL_TIMEOUTS.connection })
}

/** Wait for GPS 3D fix (non-zero lat/lon in telemetry bar). */
export async function waitGpsFix(page: Page): Promise<void> {
  await expect(async () => {
    const body = await page.textContent('body')
    const latMatch = body?.match(/Lat:\s*([\d.-]+)/)
    expect(latMatch).toBeTruthy()
    const lat = parseFloat(latMatch![1])
    expect(lat).not.toBe(0)
  }).toPass({ timeout: SITL_TIMEOUTS.gpsFix })
}

/** Wait for DISARMED state in telemetry bar. */
export async function waitDisarmed(page: Page): Promise<void> {
  await expect(async () => {
    const body = await page.textContent('body')
    expect(body).toContain('DISARMED')
  }).toPass({ timeout: SITL_TIMEOUTS.disarm })
}

/** Wait for ARMED state in telemetry bar (must NOT contain DISARMED). */
export async function waitArmed(page: Page): Promise<void> {
  await expect(async () => {
    const body = await page.textContent('body')
    // "ARMED" appears in both "ARMED" and "DISARMED" — check specifically
    expect(body).not.toContain('DISARMED')
    expect(body).toContain('ARMED')
  }).toPass({ timeout: SITL_TIMEOUTS.armReady })
}

/** Wait for a specific PX4 flight mode name to appear in the UI. */
export async function waitFlightMode(page: Page, modeName: string): Promise<void> {
  await expect(async () => {
    const body = await page.textContent('body')
    expect(body).toContain(modeName)
  }).toPass({ timeout: SITL_TIMEOUTS.modeTransition })
}

/** Wait for altitude display to reach at least `minAlt` meters (relative/AGL). */
export async function waitAltitude(page: Page, minAlt: number): Promise<void> {
  await expect(async () => {
    const body = await page.textContent('body')
    // Use the instruments panel ALT field (relative altitude), not GPS Alt: (MSL)
    const altMatch = body?.match(/ALT\s*([\d.-]+)\s*m/)
    expect(altMatch).toBeTruthy()
    expect(parseFloat(altMatch![1])).toBeGreaterThanOrEqual(minAlt)
  }).toPass({ timeout: SITL_TIMEOUTS.takeoffComplete })
}

/** Wait for altitude to drop below `maxAlt` meters (relative/AGL, for landing checks). */
export async function waitAltitudeBelow(page: Page, maxAlt: number): Promise<void> {
  await expect(async () => {
    const body = await page.textContent('body')
    const altMatch = body?.match(/ALT\s*([\d.-]+)\s*m/)
    expect(altMatch).toBeTruthy()
    expect(parseFloat(altMatch![1])).toBeLessThanOrEqual(maxAlt)
  }).toPass({ timeout: SITL_TIMEOUTS.landComplete })
}

/**
 * Poll until PX4 is ready to accept arm commands again.
 * Replaces fixed post-disarm sleeps — exits as soon as PX4 accepts an arm,
 * then immediately disarms so the caller gets a clean disarmed state.
 *
 * Note: GazeboLauncher pre-configures EKF2_MAG_TYPE=6 (Init) + relaxed checks on
 * first run so the heading estimate converges reliably in SITL.
 */
export async function waitArmReady(page: Page): Promise<void> {
  await expect(async () => {
    const result = (await page.evaluate(() => window.bridge.arm(1))) as unknown as number
    expect(result).toBe(0) // MAV_RESULT_ACCEPTED
  }).toPass({ timeout: SITL_TIMEOUTS.ekfConverge, intervals: [5_000] })

  // Arm succeeded — immediately disarm
  await page.evaluate(() => window.bridge.disarm(1))

  // If vehicle took off (Auto:Loiter auto-takeoff), RTL to land
  try {
    await expect(async () => {
      const body = await page.textContent('body')
      expect(body).toContain('DISARMED')
    }).toPass({ timeout: 3_000 })
  } catch {
    await page.evaluate(() => window.bridge.guidedRTL(1))
    await waitAltitudeBelow(page, 2)
    await waitDisarmed(page)
  }
}

// ── MAV_CMD helpers ────────────────────────────────────────────────

/** Send MAV_CMD_DO_SET_MODE with a PX4 custom_mode value. */
export async function setMode(page: Page, customMode: number): Promise<number> {
  const cmd = common.MavCmd.DO_SET_MODE
  return page.evaluate(
    ({ mode, command }) =>
      window.bridge.sendMavCommand({
        vehicleId: 1,
        componentId: 0,
        command,
        confirmation: 0,
        param1: 1, // MAV_MODE_FLAG_CUSTOM_MODE_ENABLED
        param2: mode,
        param3: 0,
        param4: 0,
        param5: 0,
        param6: 0,
        param7: 0
      }),
    { mode: customMode, command: cmd }
  ) as Promise<number>
}

// ── Compound actions ────────────────────────────────────────────────

/** Arm the vehicle via IPC bridge and wait for ARMED state.
 *  Uses polling instead of fixed sleeps — resets mode to Auto:Loiter,
 *  attempts arm, and checks result. Exits as soon as arm succeeds.
 *  If PX4 keeps rejecting due to preflight failures, relaxes checks and retries. */
export async function armVehicle(page: Page): Promise<void> {
  const { AUTO_LOITER } = PX4_MODES

  const tryArm = async () => {
    await setMode(page, AUTO_LOITER).catch(() => {})
    await page.evaluate(() => window.bridge.disarm(1)).catch(() => {})
    await page.evaluate(() => window.bridge.arm(1))
    const body = await page.textContent('body')
    expect(body).not.toContain('DISARMED')
    expect(body).toContain('ARMED')
  }

  try {
    await expect(tryArm).toPass({
      timeout: 60_000,
      intervals: [2_000, 5_000, 5_000, 10_000]
    })
  } catch {
    // If normal arm keeps failing, retry with longer intervals — EKF may
    // need more time to converge after mode transitions or landing.
    console.log('[armVehicle] Normal arm failed, retrying with longer intervals')
    await expect(tryArm).toPass({
      timeout: 60_000,
      intervals: [5_000, 10_000]
    })
  }
}

/**
 * Disarm the vehicle. PX4 SITL auto-takes off in Auto:Loiter after arming
 * (no RC to hold on ground), so normal disarm is rejected mid-flight.
 *
 * Strategy: RTL -> wait for landing -> auto-disarm. This avoids emergencyStop
 * which corrupts PX4 state and prevents subsequent arming.
 */
export async function disarmVehicle(page: Page): Promise<void> {
  // Try normal disarm first (works if on ground)
  await page.evaluate(() => window.bridge.disarm(1))
  try {
    await expect(async () => {
      const body = await page.textContent('body')
      expect(body).toContain('DISARMED')
    }).toPass({ timeout: 5_000 })
    return
  } catch {
    // Normal disarm rejected (in flight) — use RTL to land cleanly
  }

  // RTL brings the vehicle back and PX4 auto-disarms after landing.
  await page.evaluate(() => window.bridge.guidedRTL(1))
  try {
    await waitAltitudeBelow(page, 2)
    await waitDisarmed(page)
    return
  } catch {
    // RTL didn't complete — fall back to emergencyStop as last resort
  }

  await page.evaluate(() => window.bridge.emergencyStop(1))
  await waitDisarmed(page)
}

/** Ensure the vehicle is disarmed and on the ground (cleanup for cross-suite state). */
export async function ensureDisarmed(page: Page): Promise<void> {
  await waitConnected(page)
  const body = await page.textContent('body')
  if (body?.includes('DISARMED')) return

  // Vehicle is armed — use disarmVehicle which handles all cases
  await disarmVehicle(page)
}

/** Wait for parameters to be downloaded from PX4. */
export async function waitParameters(page: Page, minCount = 100): Promise<void> {
  await expect(async () => {
    const params = (await page.evaluate(() => window.bridge.getParameters(1))) as any[]
    expect(params.length).toBeGreaterThan(minCount)
  }).toPass({ timeout: SITL_TIMEOUTS.paramDownload })
}

/** Full pre-flight sequence: wait for connection, GPS fix, then arm.
 *  armVehicle polls until PX4 accepts, so a separate waitArmReady is unnecessary. */
export async function fullPreFlight(page: Page): Promise<void> {
  await waitConnected(page)
  await waitGpsFix(page)
  await armVehicle(page)
}

// ── Data extraction ─────────────────────────────────────────────────

/** Parse current lat/lon/alt from the telemetry bar text. */
export async function getPosition(page: Page): Promise<{ lat: number; lon: number; alt: number }> {
  const body = (await page.textContent('body')) || ''
  const lat = parseFloat(body.match(/Lat:\s*([\d.-]+)/)?.[1] || '0')
  const lon = parseFloat(body.match(/Lon:\s*([\d.-]+)/)?.[1] || '0')
  const alt = parseFloat(body.match(/Alt:\s*([\d.-]+)/)?.[1] || '0')
  return { lat, lon, alt }
}
