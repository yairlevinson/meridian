/**
 * Shared helper functions for PX4 SITL E2E tests.
 *
 * All wait* functions use Playwright's expect().toPass() polling pattern.
 * UI-based checks validate the full pipeline (MAVLink -> main process ->
 * IPC delta -> Zustand store -> React render). Store-based checks are used
 * when the relevant data is no longer rendered in the floating UI.
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

/** Wait for ConnectionIndicator to show "Connected" (rendered in tooltip DOM). */
export async function waitConnected(page: Page): Promise<void> {
  await expect(async () => {
    const body = await page.textContent('body')
    expect(body).toContain('Connected')
  }).toPass({ timeout: SITL_TIMEOUTS.connection })
}

/** Wait for GPS 3D fix (shown in StatusIcons GPS tooltip). */
export async function waitGpsFix(page: Page): Promise<void> {
  await expect(async () => {
    const body = await page.textContent('body')
    expect(body).toContain('3D Fix')
  }).toPass({ timeout: SITL_TIMEOUTS.gpsFix })
}

/** Wait for "Disarmed" state in ConnectionIndicator. */
export async function waitDisarmed(page: Page): Promise<void> {
  await expect(async () => {
    const body = await page.textContent('body')
    expect(body).toContain('Disarmed')
  }).toPass({ timeout: SITL_TIMEOUTS.disarm })
}

/** Wait for "Armed" state in ConnectionIndicator (must NOT contain "Disarmed"). */
export async function waitArmed(page: Page): Promise<void> {
  await expect(async () => {
    const body = await page.textContent('body')
    // "Armed" is a substring of "Disarmed" — exclude Disarmed first
    expect(body).not.toContain('Disarmed')
    expect(body).toContain('Armed')
  }).toPass({ timeout: SITL_TIMEOUTS.armReady })
}

/** Wait for a specific PX4 flight mode name via vehicle store. */
export async function waitFlightMode(page: Page, modeName: string): Promise<void> {
  await expect(async () => {
    const mode = await page.evaluate(() => {
      const store = (window as any).__vehicleStore
      return store?.getState()?.vehicles?.[1]?.core?.flightModeName as string | undefined
    })
    expect(mode).toContain(modeName)
  }).toPass({ timeout: SITL_TIMEOUTS.modeTransition })
}

/** Wait for altitude display to reach at least `minAlt` meters (FloatingInstruments ALT). */
export async function waitAltitude(page: Page, minAlt: number): Promise<void> {
  await expect(async () => {
    const body = await page.textContent('body')
    const altMatch = body?.match(/ALT\s*([\d.-]+)\s*m/)
    expect(altMatch).toBeTruthy()
    expect(parseFloat(altMatch![1])).toBeGreaterThanOrEqual(minAlt)
  }).toPass({ timeout: SITL_TIMEOUTS.takeoffComplete })
}

/** Wait for altitude to drop below `maxAlt` meters (FloatingInstruments ALT). */
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
      expect(body).toContain('Disarmed')
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

/** Arm the vehicle via IPC bridge and wait for Armed state. */
export async function armVehicle(page: Page): Promise<void> {
  const { AUTO_LOITER } = PX4_MODES

  const tryArm = async () => {
    await setMode(page, AUTO_LOITER).catch(() => {})
    await page.evaluate(() => window.bridge.disarm(1)).catch(() => {})
    await page.evaluate(() => window.bridge.arm(1))
    const body = await page.textContent('body')
    expect(body).not.toContain('Disarmed')
    expect(body).toContain('Armed')
  }

  try {
    await expect(tryArm).toPass({
      timeout: 60_000,
      intervals: [2_000, 5_000, 5_000, 10_000]
    })
  } catch {
    console.log('[armVehicle] Normal arm failed, retrying with longer intervals')
    await expect(tryArm).toPass({
      timeout: 60_000,
      intervals: [5_000, 10_000]
    })
  }
}

/**
 * Disarm the vehicle. PX4 SITL auto-takes off in Auto:Loiter after arming,
 * so normal disarm is rejected mid-flight. Strategy: RTL -> land -> auto-disarm.
 */
export async function disarmVehicle(page: Page): Promise<void> {
  // Try normal disarm first (works if on ground)
  await page.evaluate(() => window.bridge.disarm(1))
  try {
    await expect(async () => {
      const body = await page.textContent('body')
      expect(body).toContain('Disarmed')
    }).toPass({ timeout: 5_000 })
    return
  } catch {
    // Normal disarm rejected (in flight) — use RTL to land cleanly
  }

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

/** Ensure the vehicle is disarmed and on the ground. */
export async function ensureDisarmed(page: Page): Promise<void> {
  await waitConnected(page)
  const body = await page.textContent('body')
  if (body?.includes('Disarmed')) return
  await disarmVehicle(page)
}

/** Wait for parameters to be downloaded from PX4. */
export async function waitParameters(page: Page, minCount = 100): Promise<void> {
  await expect(async () => {
    const params = (await page.evaluate(() => window.bridge.parametersGetAll(1))) as any[]
    expect(params.length).toBeGreaterThan(minCount)
  }).toPass({ timeout: SITL_TIMEOUTS.paramDownload })
}

/** Full pre-flight sequence: wait for connection, GPS fix, then arm. */
export async function fullPreFlight(page: Page): Promise<void> {
  await waitConnected(page)
  await waitGpsFix(page)
  await armVehicle(page)
}

// ── Data extraction ─────────────────────────────────────────────────

/** Get current vehicle position via vehicle store. */
export async function getPosition(page: Page): Promise<{ lat: number; lon: number; alt: number }> {
  return page.evaluate(() => {
    const store = (window as any).__vehicleStore
    const gps = store?.getState()?.vehicles?.[1]?.gps
    return gps ? { lat: gps.lat, lon: gps.lon, alt: gps.alt } : { lat: 0, lon: 0, alt: 0 }
  })
}

/** Get current flight mode name via vehicle store. */
export async function getFlightMode(page: Page): Promise<string> {
  return page.evaluate(() => {
    const store = (window as any).__vehicleStore
    return (store?.getState()?.vehicles?.[1]?.core?.flightModeName as string) ?? ''
  })
}
