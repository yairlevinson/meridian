/**
 * Playwright globalTeardown — stops the SITL Docker container.
 */

import { SitlManager } from '../sitl/SitlManager'

export default async function globalTeardown(): Promise<void> {
  const manager: SitlManager | undefined = (globalThis as any).__sitlManager
  if (manager?.isRunning) {
    console.log('[globalTeardown] Stopping SITL...')
    manager.stop()
    console.log('[globalTeardown] SITL stopped')
  }
}
