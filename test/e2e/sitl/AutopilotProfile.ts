/**
 * Abstraction for autopilot-specific SITL configuration.
 * Add new profiles (ArduPilot, etc.) by exporting additional constants.
 */

export interface AutopilotProfile {
  /** Human-readable name for logs */
  name: string

  /** Docker Compose service name */
  serviceName: string

  /** Docker image */
  dockerImage: string

  /** Host port for MAVLink TCP */
  mavlinkPort: number

  /** Container-internal MAVLink port */
  containerPort: number

  /** Container startup command */
  command: string

  /** Optional extra environment variables for the container */
  env?: Record<string, string>

  /** MAV_AUTOPILOT enum value expected in HEARTBEAT */
  expectedAutopilot: number

  /** Timeout in ms to wait for first HEARTBEAT after container starts */
  readyTimeoutMs: number

  /** Flight mode mapping: abstract name → custom_mode value */
  modes: {
    stabilize: number
    guided: number
    auto: number
    rtl: number
    land: number
    loiter: number
  }

  /** The connection type to use when connecting the app to SITL */
  connectionType: 'tcp' | 'udp'
}

// ── PX4 SITL ──────────────────────────────────────────────────

export const PX4_COPTER: AutopilotProfile = {
  name: 'PX4 Copter SITL',
  serviceName: 'px4-sitl',
  dockerImage: 'meridian-px4-sitl:latest',
  mavlinkPort: 5760,
  containerPort: 5760,
  command: '', // image has its own entrypoint
  expectedAutopilot: 12, // MAV_AUTOPILOT_PX4
  readyTimeoutMs: 120_000, // ARM emulation can be slow
  modes: {
    stabilize: 0x0700_0000, // MANUAL (PX4 main=7, sub=0)
    guided: 0x0400_0003, // OFFBOARD (main=4, sub=3) — closest to guided
    auto: 0x0400_0004, // MISSION (main=4, sub=4)
    rtl: 0x0500_0004, // RTL (main=5, sub=4)
    land: 0x0400_0006, // LAND (main=4, sub=6)
    loiter: 0x0400_0003 // LOITER (main=4, sub=3)
  },
  connectionType: 'tcp'
}

// ── ArduPilot SITL (placeholder — uncomment and adjust when needed) ──

// export const ARDUPILOT_COPTER: AutopilotProfile = {
//   name: 'ArduCopter SITL',
//   serviceName: 'ardupilot-sitl',
//   dockerImage: 'ardupilot/ardupilot-dev-coptertest:latest',
//   mavlinkPort: 5760,
//   containerPort: 5760,
//   command: 'sim_vehicle.py -v ArduCopter --no-mavproxy -A --uartC=tcpclient:0.0.0.0:5760',
//   expectedAutopilot: 3, // MAV_AUTOPILOT_ARDUPILOTMEGA
//   readyTimeoutMs: 60_000,
//   modes: {
//     stabilize: 0,
//     guided: 4,
//     auto: 3,
//     rtl: 6,
//     land: 9,
//     loiter: 5,
//   },
//   connectionType: 'tcp',
// }

/** PX4 profile for connecting to an already-running external SITL (e.g. Gazebo) via UDP */
export const PX4_EXTERNAL: AutopilotProfile = {
  ...PX4_COPTER,
  name: 'PX4 External SITL (UDP)',
  mavlinkPort: 14550,
  containerPort: 0,
  connectionType: 'udp'
}

// ── Profile selection ─────────────────────────────────────────

const PROFILES: Record<string, AutopilotProfile> = {
  px4: PX4_COPTER,
  'px4-external': PX4_EXTERNAL
  // ardupilot: ARDUPILOT_COPTER,
}

/**
 * Get the active profile from GC_SITL_PROFILE env var.
 * Defaults to 'px4'.
 */
export function getActiveProfile(): AutopilotProfile {
  const name = process.env.GC_SITL_PROFILE || 'px4'
  const profile = PROFILES[name]
  if (!profile) {
    throw new Error(
      `Unknown SITL profile "${name}". Available: ${Object.keys(PROFILES).join(', ')}`
    )
  }
  return profile
}
