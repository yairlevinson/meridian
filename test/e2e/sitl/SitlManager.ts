/**
 * Manages the SITL Docker container lifecycle for E2E tests.
 * Starts/stops Docker Compose with the selected autopilot profile.
 */

import { execSync } from 'child_process'
import path from 'path'
import type { AutopilotProfile } from './AutopilotProfile'
import { waitForHeartbeat, type ReadinessResult } from './readiness'

const COMPOSE_FILE = path.resolve(__dirname, 'docker-compose.sitl.yml')
const CONTAINER_NAME = 'meridian-e2e-sitl'

export class SitlManager {
  private profile: AutopilotProfile | null = null
  private running = false

  /**
   * Start the SITL container and wait for HEARTBEAT readiness.
   */
  async start(profile: AutopilotProfile): Promise<ReadinessResult> {
    this.profile = profile

    // Check Docker is available
    try {
      execSync('docker info', { stdio: 'pipe' })
    } catch {
      throw new Error(
        'Docker is not available. Install Docker or set GC_E2E_SITL=0 to skip SITL tests.'
      )
    }

    // Stop any leftover container from a previous run
    this.forceCleanup()

    console.log(`[SitlManager] Starting ${profile.name}...`)
    console.log(`[SitlManager]   image: ${profile.dockerImage}`)
    console.log(`[SitlManager]   port: ${profile.mavlinkPort}:${profile.containerPort}`)

    const env = {
      ...process.env,
      SITL_IMAGE: profile.dockerImage,
      SITL_MAVLINK_PORT: String(profile.mavlinkPort),
      SITL_CONTAINER_PORT: String(profile.containerPort),
      SITL_COMMAND: profile.command,
      SITL_CONTAINER_NAME: CONTAINER_NAME,
      // Pass any profile-specific env vars
      ...Object.fromEntries(Object.entries(profile.env ?? {}).map(([k, v]) => [`SITL_ENV_${k}`, v]))
    }

    execSync(`docker compose -f "${COMPOSE_FILE}" up -d`, {
      env,
      stdio: 'pipe'
    })

    this.running = true
    console.log(`[SitlManager] Container started, waiting for HEARTBEAT...`)

    const result = await waitForHeartbeat('localhost', profile.mavlinkPort, profile.readyTimeoutMs)

    console.log(`[SitlManager] SITL ready: autopilot=${result.autopilot} type=${result.type}`)
    return result
  }

  /**
   * Stop the SITL container.
   */
  stop(): void {
    if (!this.running) return

    console.log(`[SitlManager] Stopping SITL...`)
    try {
      execSync(`docker compose -f "${COMPOSE_FILE}" down --timeout 5`, {
        stdio: 'pipe',
        env: {
          ...process.env,
          SITL_CONTAINER_NAME: CONTAINER_NAME
        }
      })
    } catch (err) {
      console.warn(`[SitlManager] docker compose down failed:`, err)
      this.forceCleanup()
    }
    this.running = false
  }

  /**
   * Force-remove the container if it exists (cleanup from crashes).
   */
  private forceCleanup(): void {
    try {
      execSync(`docker rm -f ${CONTAINER_NAME}`, { stdio: 'pipe' })
    } catch {
      // Container doesn't exist — that's fine
    }
  }

  /**
   * Get the environment variables needed to connect the app to this SITL instance.
   */
  getAppEnv(): Record<string, string> {
    if (!this.profile) throw new Error('SitlManager not started')

    if (this.profile.connectionType === 'tcp') {
      return {
        GC_TCP_LINKS: `127.0.0.1:${this.profile.mavlinkPort}`
      }
    }
    return {
      GC_UDP_PORT: String(this.profile.mavlinkPort)
    }
  }

  get activeProfile(): AutopilotProfile | null {
    return this.profile
  }

  get isRunning(): boolean {
    return this.running
  }
}
