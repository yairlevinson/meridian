/**
 * Shared Playwright fixtures for E2E tests.
 *
 * Provides `app`, `page`, `profile`, and optionally `syntheticVehicle`.
 * When GC_E2E_SITL=1, connects the app to Docker SITL via TCP.
 * Otherwise, creates a SyntheticVehicle over UDP (default for local dev).
 *
 * SITL mode uses worker-scoped fixtures so the Electron app is launched
 * once and shared across all tests — avoids relaunching per-test (~5-10s each).
 *
 * Tests that need direct vehicle control (sending specific messages) can
 * use `syntheticVehicle` — these are automatically skipped in SITL mode.
 */

import {
  test as base,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import path from 'path'
import { SyntheticVehicle } from '../helpers/SyntheticVehicle'
import { getActiveProfile, PX4_EXTERNAL, type AutopilotProfile } from '../sitl/AutopilotProfile'

export const useSitl = process.env.GC_E2E_SITL === '1'
const useExternalSitl = process.env.GC_E2E_SITL_EXTERNAL === '1'

let nextPort = 14570

/** Build the Electron app once per worker. */
let built = false
async function ensureBuilt(): Promise<void> {
  if (built) return
  const { execSync } = await import('child_process')
  execSync('npx electron-vite build', {
    cwd: path.resolve(__dirname, '../../..'),
    stdio: 'pipe'
  })
  built = true
}

function getSitlProfile(): AutopilotProfile {
  if (useExternalSitl) return PX4_EXTERNAL
  return getActiveProfile()
}

function getSyntheticProfile(): AutopilotProfile {
  return {
    name: 'SyntheticVehicle (ArduCopter-like)',
    serviceName: 'synthetic',
    dockerImage: '',
    mavlinkPort: 0,
    containerPort: 0,
    command: '',
    expectedAutopilot: 3,
    readyTimeoutMs: 5000,
    modes: {
      stabilize: 0,
      guided: 4,
      auto: 3,
      rtl: 6,
      land: 9,
      loiter: 5
    },
    connectionType: 'udp'
  }
}

/** Build the Electron app environment for a given profile/port. */
function buildAppEnv(profile: AutopilotProfile, testPort: number): Record<string, string> {
  const appEnv: Record<string, string> = {
    ...(process.env as Record<string, string>),
    NODE_ENV: 'production'
  }
  // Must be deleted or Electron runs as plain Node (no app API)
  delete appEnv.ELECTRON_RUN_AS_NODE

  if (useSitl && profile.connectionType === 'tcp') {
    appEnv.GC_TCP_LINKS = `127.0.0.1:${profile.mavlinkPort}`
  } else if (useSitl && profile.connectionType === 'udp') {
    appEnv.GC_UDP_PORT = String(profile.mavlinkPort)
  } else {
    appEnv.GC_UDP_PORT = String(testPort)
  }

  return appEnv
}

// ── Worker-scoped fixtures (shared across all tests in SITL mode) ──

interface WorkerFixtures {
  /** Shared Electron app in SITL mode (one launch per worker). */
  sitlApp: ElectronApplication | null
  /** Shared page in SITL mode (one window per worker). */
  sitlPage: Page | null
}

export interface VehicleFixtures {
  /** The Electron app instance */
  app: ElectronApplication
  /** The main browser window */
  page: Page
  /** The active autopilot profile (mode values, autopilot type, etc.) */
  profile: AutopilotProfile
  /**
   * The SyntheticVehicle instance (null in SITL mode).
   * Use for tests that need direct message control.
   */
  syntheticVehicle: SyntheticVehicle | null
  /** The UDP port used for this test (only in SyntheticVehicle mode) */
  testPort: number
}

export const test = base.extend<VehicleFixtures, WorkerFixtures>({
  // Worker-scoped: launch Electron once for all SITL tests
  sitlApp: [
    async ({}, use) => {
      if (!useSitl) {
        await use(null)
        return
      }
      await ensureBuilt()
      const profile = getSitlProfile()
      const appEnv = buildAppEnv(profile, 0)

      const app = await electron.launch({
        args: [path.resolve(__dirname, '../../../out/main/index.js')],
        env: appEnv
      })

      // Forward main process stdout/stderr for debugging
      const proc = app.process()
      proc.stdout?.on('data', (buf: Buffer) => {
        for (const line of buf.toString().split('\n').filter(Boolean)) {
          console.log(`[Electron] ${line}`)
        }
      })
      proc.stderr?.on('data', (buf: Buffer) => {
        for (const line of buf.toString().split('\n').filter(Boolean)) {
          console.log(`[Electron err] ${line}`)
        }
      })

      await use(app)
      await app.close().catch(() => {})
    },
    { scope: 'worker' }
  ],

  sitlPage: [
    async ({ sitlApp }, use) => {
      if (!sitlApp) {
        await use(null)
        return
      }
      const page = await sitlApp.firstWindow()
      // Wait for renderer to be ready (DOM loaded)
      await page.waitForLoadState('domcontentloaded')
      await use(page)
    },
    { scope: 'worker' }
  ],

  profile: async ({}, use) => {
    await use(useSitl ? getSitlProfile() : getSyntheticProfile())
  },

  testPort: async ({}, use) => {
    await use(nextPort++)
  },

  syntheticVehicle: async ({ testPort }, use) => {
    if (useSitl) {
      await use(null)
      return
    }
    const vehicle = new SyntheticVehicle(testPort)
    await use(vehicle)
    vehicle.stop()
  },

  app: async ({ sitlApp, profile, testPort }, use) => {
    if (useSitl) {
      // Reuse worker-scoped app
      await use(sitlApp!)
      return
    }

    // Non-SITL: per-test Electron launch
    await ensureBuilt()
    const appEnv = buildAppEnv(profile, testPort)

    const app = await electron.launch({
      args: [path.resolve(__dirname, '../../../out/main/index.js')],
      env: appEnv
    })

    await use(app)
    await app.close().catch(() => {})
  },

  page: async ({ sitlPage, app }, use) => {
    if (useSitl) {
      // Reuse worker-scoped page
      await use(sitlPage!)
      return
    }

    // Non-SITL: per-test page
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await use(page)
  }
})

export { expect } from '@playwright/test'

/**
 * Helper: skip a test if running against real SITL.
 * Use for tests that require direct SyntheticVehicle control.
 */
export function skipInSitl(testFn: typeof test): void {
  if (useSitl) {
    testFn.skip(true, 'Test requires SyntheticVehicle (skipped in SITL mode)')
  }
}
