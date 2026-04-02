/**
 * Playwright globalTeardown — stops SITL (Docker or local Gazebo).
 */

import { SitlManager } from '../sitl/SitlManager'
import { GazeboLauncher } from '../sitl/gazeboLauncher'

export default async function globalTeardown(): Promise<void> {
  const manager: SitlManager | undefined = (globalThis as any).__sitlManager
  if (manager?.isRunning) {
    console.log('[globalTeardown] Stopping Docker SITL...')
    manager.stop()
    console.log('[globalTeardown] Docker SITL stopped')
  }

  const gazebo: GazeboLauncher | undefined = (globalThis as any).__gazeboLauncher
  if (gazebo?.isRunning) {
    console.log('[globalTeardown] Stopping PX4 + Gazebo...')
    gazebo.stop()
    console.log('[globalTeardown] PX4 + Gazebo stopped')
  }
}
