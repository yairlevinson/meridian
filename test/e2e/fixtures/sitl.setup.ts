/**
 * Playwright globalSetup — starts PX4 SITL via Docker if GC_E2E_SITL=1.
 * If GC_E2E_SITL_EXTERNAL=1, skips Docker and connects to an already-running SITL.
 * Stores connection info in env vars for test files to consume.
 */

import { SitlManager } from '../sitl/SitlManager'
import { getActiveProfile, PX4_EXTERNAL } from '../sitl/AutopilotProfile'
import { waitForHeartbeatUdp } from '../sitl/readiness'

const manager = new SitlManager()

// Export so teardown can access the same instance
;(globalThis as any).__sitlManager = manager

export default async function globalSetup(): Promise<void> {
  if (process.env.GC_E2E_SITL !== '1') {
    console.log('[globalSetup] GC_E2E_SITL not set — using SyntheticVehicle for E2E tests')
    return
  }

  const external = process.env.GC_E2E_SITL_EXTERNAL === '1'
  const profile = external ? PX4_EXTERNAL : getActiveProfile()

  if (external) {
    console.log(
      `[globalSetup] External SITL mode — app will connect to PX4 on UDP ${profile.mavlinkPort}`
    )

    // No readiness probe needed — the app itself will bind the UDP port.
    // We trust the user has PX4 SITL running externally.
    process.env.GC_UDP_PORT = String(profile.mavlinkPort)
    process.env.__SITL_AUTOPILOT = String(profile.expectedAutopilot)
    process.env.__SITL_VEHICLE_TYPE = '1' // quadrotor
    process.env.__SITL_PROFILE = 'px4-external'

    console.log(`[globalSetup] External SITL configured (UDP ${profile.mavlinkPort})`)
    return
  }

  console.log(`[globalSetup] Starting SITL: ${profile.name}`)

  const result = await manager.start(profile)

  // Store connection info for tests
  const appEnv = manager.getAppEnv()
  for (const [k, v] of Object.entries(appEnv)) {
    process.env[k] = v
  }

  // Store SITL metadata for test assertions
  process.env.__SITL_AUTOPILOT = String(result.autopilot)
  process.env.__SITL_VEHICLE_TYPE = String(result.type)
  process.env.__SITL_PROFILE = process.env.GC_SITL_PROFILE || 'px4'

  console.log(`[globalSetup] SITL ready, app env: ${JSON.stringify(appEnv)}`)
}
