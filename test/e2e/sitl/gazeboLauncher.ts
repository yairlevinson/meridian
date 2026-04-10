/**
 * Launches PX4 SITL + Gazebo (headless) as a local child process.
 * Requires PX4_HOME env var pointing to the PX4-Autopilot source directory.
 *
 * Prefers running the pre-built PX4 binary directly (avoids re-compilation).
 * Falls back to `make px4_sitl <target>` if no build directory exists.
 *
 * Readiness is detected by watching PX4's stdout for the MAVLink startup
 * message (port 14550) and the home position set message (EKF converged).
 *
 * SITL parameters (EKF2_MAG_TYPE, heading noise, broadcast mode, etc.) are
 * written directly to parameters.bson before PX4 boots — no separate
 * bootstrap launch needed. PX4 starts once with correct params.
 *
 * Gazebo runs headless (no GUI) to reduce resource usage and avoid
 * shared-memory issues that cause SIGBUS on macOS.
 */

import { spawn, execSync, type ChildProcess } from 'child_process'
import path from 'path'
import fs from 'fs'
import type { ReadinessResult } from './readiness'

const READY_TIMEOUT_MS = 180_000
const KILL_GRACE_MS = 5_000
const WATCHDOG_INTERVAL_MS = 5_000
const WATCHDOG_STALL_MS = 30_000

/**
 * SITL parameters to inject into parameters.bson before PX4 boots.
 * These override PX4 defaults to make SITL arming reliable.
 *
 * Bump PARAM_VERSION when changing this list to force re-generation.
 */
const PARAM_VERSION = '7'
const SITL_PARAMS: Record<string, { type: 'int32' | 'double'; value: number }> = {
  // EKF2_MAG_TYPE=5 (NONE): disable magnetometer entirely.
  // SIH doesn't reliably simulate a mag — using type 1 (heading) causes
  // "MAG #0 failed: TIMEOUT" spam. v1.15.4 only accepts 0, 1, 5.
  EKF2_MAG_TYPE: { type: 'int32', value: 5 },
  // EKF2_GPS_DELAY=0: SIH has zero sensor delay (default 110ms is for real hardware).
  // PX4 docs explicitly recommend this for SIH-as-SITL.
  EKF2_GPS_DELAY: { type: 'double', value: 0.0 },
  // MAV_0_BROADCAST=1: force PX4's GCS MAVLink instance to proactively
  // broadcast to 127.255.255.255:14550. Without this, PX4 only sends
  // after receiving a packet from the GCS.
  MAV_0_BROADCAST: { type: 'int32', value: 1 },
  // SYS_AUTOCONFIG=0: prevent rcS from resetting all params on next boot.
  SYS_AUTOCONFIG: { type: 'int32', value: 0 },
  // SIH home position (Tel Aviv) — SIH uses params, not PX4_HOME env var.
  // LAT0/LON0 are INT32 in degE7 format in PX4 v1.15.x.
  SIH_LOC_LAT0: { type: 'int32', value: 320800000 }, // 32.08° N
  SIH_LOC_LON0: { type: 'int32', value: 347800000 }, // 34.78° E
  SIH_LOC_H0: { type: 'double', value: 20.0 },
  // CBRK_SUPPLY_CHK=894281: disable battery health check in SITL.
  CBRK_SUPPLY_CHK: { type: 'int32', value: 894281 },
  // CBRK_IO_SAFETY=22027: disable safety switch (matches official 10040 airframe).
  CBRK_IO_SAFETY: { type: 'int32', value: 22027 }
}

export class GazeboLauncher {
  private proc: ChildProcess | null = null
  private _running = false
  private killTimer: ReturnType<typeof setTimeout> | null = null

  get isRunning(): boolean {
    return this._running
  }

  async start(): Promise<ReadinessResult> {
    const px4Home = process.env.PX4_HOME
    if (!px4Home) {
      throw new Error(
        'PX4_HOME is not set. Point it to your PX4-Autopilot directory.\n' +
          '  export PX4_HOME=/path/to/PX4-Autopilot'
      )
    }

    // Kill stale PX4/Gazebo processes from previous runs
    this.killStaleProcesses()

    const buildDir = path.join(px4Home, 'build', 'px4_sitl_default')
    const px4Binary = path.join(buildDir, 'bin', 'px4')
    // gz_env.sh may be in rootfs/ or directly in the build dir depending on PX4 version
    const gzEnvScript = fs.existsSync(path.join(buildDir, 'rootfs', 'gz_env.sh'))
      ? path.join(buildDir, 'rootfs', 'gz_env.sh')
      : path.join(buildDir, 'gz_env.sh')
    const hasBuild = fs.existsSync(px4Binary)

    if (hasBuild) {
      return this.startDirect(px4Home, buildDir, px4Binary, gzEnvScript)
    }
    return this.startViaMake(px4Home)
  }

  private killStaleProcesses(): void {
    // Kill all PX4/Gazebo processes broadly. Order matters: kill PX4 first
    // (it spawns gz_bridge), then Gazebo server/GUI, then helpers.
    const killPatterns = [
      'bin/px4',
      'gz sim',
      'gz-sim-server',
      'ruby.*gz',
      'parameter_bridge',
      'gz gui',
      'gzserver',
      'gzclient'
    ]
    for (const pat of killPatterns) {
      try {
        execSync(`pkill -9 -f "${pat}" 2>/dev/null`, { stdio: 'ignore' })
      } catch {
        // Process may not exist
      }
    }
    // Clean PX4 lock files — PX4 refuses to start if these exist from a
    // previous run (exits 255 with "server already running for instance N").
    try {
      execSync('rm -f /tmp/px4_lock-* /tmp/px4-sock-*', { stdio: 'ignore' })
    } catch {
      // Ignore
    }
    // Wait for ports and shared memory to be released
    try {
      execSync('sleep 2', { stdio: 'ignore' })
    } catch {
      // Ignore
    }
  }

  /**
   * Launch PX4 directly from the pre-built binary — fast, no recompilation.
   */
  private async startDirect(
    _px4Home: string,
    buildDir: string,
    px4Binary: string,
    gzEnvScript: string
  ): Promise<ReadinessResult> {
    const target = process.env.PX4_SITL_TARGET || 'gz_x500'
    const model = target.startsWith('gz_') ? target : `gz_${target}`

    console.log(`[GazeboLauncher] Launching pre-built PX4 binary with model ${model}`)

    // Validate Gazebo environment before spawning PX4.
    // If gz_env.sh doesn't exist, PX4 will block forever on
    // "Waiting for Gazebo world..." in an unkillable kernel wait state.
    if (!fs.existsSync(gzEnvScript)) {
      throw new Error(
        `[GazeboLauncher] gz_env.sh not found at ${gzEnvScript}. ` +
          'PX4 build may be incomplete — run: cd $PX4_HOME && make px4_sitl gz_x500'
      )
    }

    // Source the Gazebo env script to get paths, then merge into our env
    let gzEnv: Record<string, string> = {}
    try {
      const envDump = execSync(`source "${gzEnvScript}" && env`, {
        shell: '/bin/bash',
        encoding: 'utf-8'
      })
      for (const line of envDump.split('\n')) {
        const eq = line.indexOf('=')
        if (eq > 0) gzEnv[line.slice(0, eq)] = line.slice(eq + 1)
      }
    } catch {
      console.warn('[GazeboLauncher] Could not source gz_env.sh, proceeding without it')
    }

    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      ...gzEnv,
      PX4_SIM_MODEL: model,
      PX4_SIM_SPEED_FACTOR: '1',
      PX4_HOME_LAT: process.env.PX4_HOME_LAT || '32.08',
      PX4_HOME_LON: process.env.PX4_HOME_LON || '34.78',
      PX4_HOME_ALT: process.env.PX4_HOME_ALT || '20',
      PX4_GZ_MODEL: model.replace(/^gz_/, ''),
      // Run Gazebo without GUI — reduces CPU/memory usage and avoids
      // shared-memory SIGBUS crashes on macOS.
      HEADLESS: '1'
    }

    // PX4 data dir: use rootfs if it contains the rcS, otherwise fall back to build dir.
    const rootfs = path.join(buildDir, 'rootfs')
    const dataDir = fs.existsSync(path.join(rootfs, 'etc', 'init.d-posix', 'rcS'))
      ? rootfs
      : buildDir

    // Clean stale dataman (mission/fence/rally state)
    const dataman = path.join(dataDir, 'dataman')
    if (fs.existsSync(dataman)) {
      console.log('[GazeboLauncher] Removing stale dataman')
      fs.unlinkSync(dataman)
    }

    // Ensure SITL parameters are written directly to parameters.bson.
    // This replaces the old bootstrap approach (boot PX4, set params via console,
    // save, kill, reboot) which was fragile: params failed to save due to races,
    // and the extra PX4+Gazebo cycle caused SIGBUS crashes on macOS.
    this.ensureSitlParams(dataDir)

    const px4Args = [dataDir, '-s', 'etc/init.d-posix/rcS']
    return this.spawnAndWait(px4Binary, px4Args, dataDir, env)
  }

  /**
   * Write SITL parameters directly to parameters.bson.
   *
   * On first run, PX4 boots with defaults and the airframe init (SYS_AUTOSTART=4002)
   * writes calibration params. We let that happen, then patch in our SITL-specific
   * params on subsequent runs. If no parameters.bson exists yet, we write a minimal
   * file that PX4 will merge with its defaults.
   */
  private ensureSitlParams(dataDir: string): void {
    const paramFile = path.join(dataDir, 'parameters.bson')
    const backupFile = paramFile.replace('.bson', '_backup.bson')
    const markerFile = path.join(dataDir, '.sitl_param_version')

    const currentVersion = fs.existsSync(markerFile)
      ? fs.readFileSync(markerFile, 'utf-8').trim()
      : ''

    if (currentVersion === PARAM_VERSION && fs.existsSync(paramFile)) {
      console.log(`[GazeboLauncher] SITL params v${PARAM_VERSION} already in place`)
      return
    }

    console.log(`[GazeboLauncher] Writing SITL params v${PARAM_VERSION} to parameters.bson`)

    // If an existing file exists, read and patch it. Otherwise create from scratch.
    let params: Map<string, { type: 'int32' | 'double'; value: number }>
    if (fs.existsSync(paramFile)) {
      params = this.readBsonParams(paramFile)
    } else {
      params = new Map()
    }

    // Merge our SITL params
    for (const [key, spec] of Object.entries(SITL_PARAMS)) {
      params.set(key, spec)
    }

    // Write the merged params
    const bson = this.writeBsonParams(params)
    fs.writeFileSync(paramFile, bson)
    fs.writeFileSync(backupFile, bson)
    fs.writeFileSync(markerFile, PARAM_VERSION)

    console.log(`[GazeboLauncher] Wrote ${params.size} params to parameters.bson`)
  }

  /** Read a PX4 parameters.bson file into a Map. */
  private readBsonParams(
    filePath: string
  ): Map<string, { type: 'int32' | 'double'; value: number }> {
    const data = fs.readFileSync(filePath)
    const params = new Map<string, { type: 'int32' | 'double'; value: number }>()

    let pos = 4 // skip BSON doc size
    while (pos < data.length - 1) {
      const typeByte = data[pos]
      if (typeByte === 0) break // end of document
      pos++

      // Read null-terminated key
      const nullPos = data.indexOf(0, pos)
      const key = data.subarray(pos, nullPos).toString('utf-8')
      pos = nullPos + 1

      if (typeByte === 0x10) {
        // int32
        const value = data.readInt32LE(pos)
        pos += 4
        params.set(key, { type: 'int32', value })
      } else if (typeByte === 0x01) {
        // double
        const value = data.readDoubleLE(pos)
        pos += 8
        params.set(key, { type: 'double', value })
      } else {
        console.warn(`[GazeboLauncher] Unknown BSON type ${typeByte} for key ${key}, stopping`)
        break
      }
    }

    return params
  }

  /** Write a Map of params to PX4 BSON format. */
  private writeBsonParams(
    params: Map<string, { type: 'int32' | 'double'; value: number }>
  ): Buffer {
    // Calculate document size
    let docSize = 4 + 1 // size header + trailing null
    for (const [key, spec] of params) {
      // type byte + key + null + value
      docSize += 1 + Buffer.byteLength(key) + 1 + (spec.type === 'int32' ? 4 : 8)
    }

    const buf = Buffer.alloc(docSize)
    buf.writeInt32LE(docSize, 0)

    let pos = 4
    // Sort keys for deterministic output
    const sortedKeys = [...params.keys()].sort()
    for (const key of sortedKeys) {
      const spec = params.get(key)!
      if (spec.type === 'int32') {
        buf[pos++] = 0x10
      } else {
        buf[pos++] = 0x01
      }
      pos += buf.write(key, pos)
      buf[pos++] = 0 // null terminator

      if (spec.type === 'int32') {
        buf.writeInt32LE(spec.value, pos)
        pos += 4
      } else {
        buf.writeDoubleLE(spec.value, pos)
        pos += 8
      }
    }

    buf[pos] = 0 // trailing null
    return buf
  }

  /**
   * Fall back to `make px4_sitl <target>` — slower, requires build tools.
   */
  private startViaMake(px4Home: string): Promise<ReadinessResult> {
    const target = process.env.PX4_SITL_TARGET || 'gz_x500'
    console.log(`[GazeboLauncher] No pre-built binary found, running make px4_sitl ${target}`)

    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      PX4_HOME_LAT: process.env.PX4_HOME_LAT || '32.08',
      PX4_HOME_LON: process.env.PX4_HOME_LON || '34.78',
      PX4_HOME_ALT: process.env.PX4_HOME_ALT || '20',
      HEADLESS: '1'
    }

    return this.spawnAndWait('make', ['px4_sitl', target], px4Home, env)
  }

  private spawnAndWait(
    command: string,
    args: string[],
    cwd: string,
    env: Record<string, string>
  ): Promise<ReadinessResult> {
    return new Promise<ReadinessResult>((resolve, reject) => {
      console.log(`[GazeboLauncher] Spawning: ${command} ${args.join(' ')}`)
      console.log(`[GazeboLauncher] CWD: ${cwd}`)

      const proc = spawn(command, args, {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        env
      })

      this.proc = proc
      this._running = true
      let settled = false

      const deadline = setTimeout(() => {
        if (!settled) {
          settled = true
          this.killProcessTree(proc)
          reject(new Error(`[GazeboLauncher] Timeout after ${READY_TIMEOUT_MS}ms`))
        }
      }, READY_TIMEOUT_MS)

      // Watchdog: if PX4 produces no stdout for 30s during startup, it's
      // likely stuck in "Waiting for Gazebo world..." (unkillable kernel wait).
      // Kill the process group early to avoid zombie processes that require reboot.
      let lastOutputTime = Date.now()
      const watchdog = setInterval(() => {
        if (settled) {
          clearInterval(watchdog)
          return
        }
        if (Date.now() - lastOutputTime > WATCHDOG_STALL_MS) {
          clearInterval(watchdog)
          if (!settled) {
            settled = true
            clearTimeout(deadline)
            console.error('[GazeboLauncher] Watchdog: no output for 30s — killing stalled PX4')
            this.killProcessTree(proc)
            reject(
              new Error(
                '[GazeboLauncher] PX4 stalled (no output for 30s). ' +
                  'Likely stuck on "Waiting for Gazebo world..." — check GZ_SIM_RESOURCE_PATH and model name.'
              )
            )
          }
        }
      }, WATCHDOG_INTERVAL_MS)

      let mavlinkReady = false
      let homeSet = false

      const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*[a-zA-Z]|\[\d+[a-zA-Z]/g, '')

      // Strip pxh> prompt noise that floods stdout and drowns real messages
      const stripPrompt = (s: string): string => s.replace(/pxh>\s*/g, '')

      const tryResolve = (): void => {
        if (settled || !mavlinkReady || !homeSet) return
        settled = true
        clearTimeout(deadline)
        clearInterval(watchdog)
        console.log('[GazeboLauncher] EKF converged, home position set, MAVLink active')
        // Brief delay for PX4 to finish initialization after readiness markers
        setTimeout(() => {
          resolve({
            autopilot: 12,
            type: 2,
            customMode: 0,
            baseMode: 0
          })
        }, 2000)
      }

      const onData = (buf: Buffer): void => {
        lastOutputTime = Date.now()
        const text = buf.toString()
        const clean = stripAnsi(text)
        // Only log meaningful lines (skip pure prompt noise)
        for (const line of clean.split('\n').filter((l) => l.trim())) {
          const meaningful = stripPrompt(line).trim()
          if (meaningful) console.log(`[PX4] ${meaningful}`)
        }

        if (settled) return

        // Check the cleaned text for readiness markers
        const filtered = stripPrompt(clean)

        // MAVLink instance starts
        if (!mavlinkReady && (filtered.includes('remote port 14550') || clean.includes('pxh>'))) {
          mavlinkReady = true
          console.log('[GazeboLauncher] PX4 shell ready, MAVLink active')
          tryResolve()
        }

        // EKF converged — "home set" or "home position" appears after EKF2
        // provides a valid position estimate. This may appear before or after
        // the MAVLink port message depending on PX4 version.
        if (!homeSet && (filtered.includes('home set') || filtered.includes('home position'))) {
          homeSet = true
          console.log('[GazeboLauncher] Home position set (EKF converged)')
          tryResolve()
        }
      }

      proc.stdout?.on('data', onData)
      proc.stderr?.on('data', (buf: Buffer) => {
        const text = buf.toString()
        for (const line of text.split('\n').filter(Boolean)) {
          console.log(`[PX4 err] ${line}`)
        }
        // Some PX4 versions print status to stderr
        if (!settled) onData(buf)
      })

      proc.on('exit', (code, signal) => {
        console.log(`[GazeboLauncher] PX4 process exited with code ${code}, signal ${signal}`)
        this._running = false
        clearInterval(watchdog)
        if (!settled) {
          settled = true
          clearTimeout(deadline)
          reject(new Error(`PX4 exited unexpectedly with code ${code}, signal ${signal}`))
        }
      })
    })
  }

  private killProcessTree(proc: ChildProcess): void {
    const pid = proc.pid
    if (!pid) return
    // Kill the process and its children via pkill -P (parent PID)
    try {
      execSync(`pkill -9 -P ${pid} 2>/dev/null`, { stdio: 'ignore' })
    } catch {
      // No children
    }
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // Already gone
    }
  }

  stop(): void {
    if (!this.proc || !this._running) {
      if (this.killTimer) {
        clearTimeout(this.killTimer)
        this.killTimer = null
      }
      return
    }

    console.log('[GazeboLauncher] Stopping PX4 + Gazebo...')
    const proc = this.proc
    const pid = proc.pid
    if (!pid) return

    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      // Already gone
    }

    this.killTimer = setTimeout(() => {
      this.killProcessTree(proc)
      this.killTimer = null
    }, KILL_GRACE_MS)

    proc.on('exit', () => {
      if (this.killTimer) {
        clearTimeout(this.killTimer)
        this.killTimer = null
      }
    })
    this._running = false
    this.proc = null
  }
}
