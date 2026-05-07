/**
 * Manages the SITL Docker container lifecycle for E2E tests.
 * Starts/stops Docker Compose with the selected autopilot profile.
 *
 * Supports two image tiers controlled via the profile's dockerImage:
 *   - meridian-px4-sitl:latest  — headless, no Gazebo (fast, CI-friendly)
 *   - meridian-px4-gz:latest    — PX4 + Gazebo Harmonic (full physics sim)
 */

import { execSync } from 'child_process'
import path from 'path'
import type { AutopilotProfile } from './AutopilotProfile'
import { waitForHeartbeat, type ReadinessResult } from './readiness'

const COMPOSE_FILE = path.resolve(__dirname, 'docker-compose.sitl.yml')
const COMPOSE_MULTI_FILE = path.resolve(__dirname, 'docker-compose.sitl.multi.yml')
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

    const composeProfiles = this.resolveComposeProfiles(profile)
    const composeFiles = this.resolveComposeFiles()

    const env = {
      ...(profile.env ?? {}),
      ...process.env,
      SITL_IMAGE: profile.dockerImage,
      SITL_GZ_IMAGE: profile.dockerImage,
      SITL_MAVLINK_PORT: String(profile.mavlinkPort),
      SITL_CONTAINER_PORT: String(profile.containerPort),
      SITL_COMMAND: profile.command,
      SITL_CONTAINER_NAME: CONTAINER_NAME,
      // Pass any profile-specific env vars
      ...Object.fromEntries(Object.entries(profile.env ?? {}).map(([k, v]) => [`SITL_ENV_${k}`, v]))
    }

    const fileArgs = composeFiles.map((f) => `-f "${f}"`).join(' ')
    const profileArgs = composeProfiles.length
      ? composeProfiles.map((p) => `--profile ${p}`).join(' ')
      : ''

    execSync(`docker compose ${fileArgs} ${profileArgs} up -d`, {
      env,
      stdio: 'pipe'
    })

    this.running = true
    console.log(`[SitlManager] Container started, waiting for HEARTBEAT...`)

    let result: ReadinessResult
    try {
      result = await waitForHeartbeat('localhost', profile.mavlinkPort, profile.readyTimeoutMs)
    } catch (err) {
      this.logDiagnostics()
      throw err
    }

    console.log(`[SitlManager] SITL ready: autopilot=${result.autopilot} type=${result.type}`)
    return result
  }

  /**
   * Stop the SITL container.
   */
  stop(): void {
    if (!this.running) return

    console.log(`[SitlManager] Stopping SITL...`)
    const composeFiles = this.resolveComposeFiles()
    const fileArgs = composeFiles.map((f) => `-f "${f}"`).join(' ')

    try {
      execSync(`docker compose ${fileArgs} down --timeout 5`, {
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

  private logDiagnostics(): void {
    console.warn('[SitlManager] SITL readiness failed; collecting Docker diagnostics...')

    this.runDiagnosticCommand(`docker ps -a --filter "name=${CONTAINER_NAME}"`)
    this.runDiagnosticCommand(`docker port ${CONTAINER_NAME}`)
    this.runDiagnosticCommand(`docker inspect --format "{{json .State.Health}}" ${CONTAINER_NAME}`)
    this.runDiagnosticCommand(`docker logs --tail 200 ${CONTAINER_NAME}`)
  }

  private runDiagnosticCommand(command: string): void {
    try {
      const output = execSync(command, { stdio: 'pipe', encoding: 'utf8' }).trim()
      console.warn(`[SitlManager] $ ${command}`)
      console.warn(output || '(no output)')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.warn(`[SitlManager] $ ${command}`)
      console.warn(`failed: ${message}`)
    }
  }

  /**
   * Determine which compose --profile flags to pass based on the autopilot profile.
   */
  private resolveComposeProfiles(profile: AutopilotProfile): string[] {
    if (profile.dockerImage.includes('px4-gz')) {
      return ['gz']
    }
    return []
  }

  /**
   * Determine which compose files to use. Adds multi-vehicle override if
   * GC_E2E_SITL_MULTI is set.
   */
  private resolveComposeFiles(): string[] {
    const files = [COMPOSE_FILE]
    if (process.env.GC_E2E_SITL_MULTI) {
      files.push(COMPOSE_MULTI_FILE)
    }
    return files
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
