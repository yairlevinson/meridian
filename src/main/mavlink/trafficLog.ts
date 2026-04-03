import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import { REGISTRY } from './registry'

/**
 * MAVLink traffic logger — writes both TX and RX messages to a rolling log file.
 * Log file: ~/meridian-mavlink.log (truncated on each app start).
 *
 * Enable/disable at runtime via MavTrafficLog.enabled.
 * Filter noisy high-frequency messages by default (attitude, heartbeat, etc).
 */

const LOG_FILE = path.join(app?.getPath('home') ?? '/tmp', 'meridian-mavlink.log')

/** Message IDs to suppress by default (high-frequency telemetry) */
const QUIET_MSG_IDS = new Set([
  0, // HEARTBEAT
  1, // SYS_STATUS
  2, // SYSTEM_TIME
  24, // GPS_RAW_INT
  30, // ATTITUDE
  32, // LOCAL_POSITION_NED
  33, // GLOBAL_POSITION_INT
  36, // SERVO_OUTPUT_RAW
  65, // RC_CHANNELS
  74, // VFR_HUD
  105, // HIGHRES_IMU
  141, // ALTITUDE
  147, // BATTERY_STATUS
  230, // ESTIMATOR_STATUS
  241, // VIBRATION
])

function msgName(msgid: number): string {
  const cls = REGISTRY[msgid]
  return (cls as unknown as { MSG_NAME?: string })?.MSG_NAME ?? `UNKNOWN(${msgid})`
}

function formatFields(data: unknown): string {
  if (!data || typeof data !== 'object') return ''
  const obj = data as Record<string, unknown>
  const parts: string[] = []
  for (const [k, v] of Object.entries(obj)) {
    if (k.startsWith('_')) continue
    if (Array.isArray(v)) {
      parts.push(`${k}=[${v.length}]`)
    } else if (typeof v === 'number') {
      parts.push(`${k}=${Number.isInteger(v) ? v : v.toFixed(4)}`)
    } else {
      parts.push(`${k}=${v}`)
    }
  }
  return parts.join(' ')
}

class MavTrafficLogger {
  enabled = false
  showQuiet = false
  private fd: number | null = null

  start(): void {
    this.enabled = true
    try {
      this.fd = fs.openSync(LOG_FILE, 'w')
      this._write(`# MAVLink traffic log started ${new Date().toISOString()}\n`)
      this._write(`# Direction | Timestamp | sysid:compid | MsgName(id) | Fields\n`)
      console.log(`[MavLog] logging to ${LOG_FILE}`)
    } catch (e) {
      console.warn(`[MavLog] failed to open ${LOG_FILE}:`, e)
      this.fd = null
    }
  }

  stop(): void {
    this.enabled = false
    if (this.fd !== null) {
      fs.closeSync(this.fd)
      this.fd = null
    }
  }

  rx(msgid: number, sysid: number, compid: number, data: unknown): void {
    if (!this.enabled) return
    if (!this.showQuiet && QUIET_MSG_IDS.has(msgid)) return
    const ts = Date.now()
    const name = msgName(msgid)
    const fields = formatFields(data)
    this._write(`RX ${ts} ${sysid}:${compid} ${name}(${msgid}) ${fields}\n`)
  }

  tx(msgid: number, targetSystem: number, targetComponent: number, data: unknown): void {
    if (!this.enabled) return
    if (!this.showQuiet && QUIET_MSG_IDS.has(msgid)) return
    const ts = Date.now()
    const name = msgName(msgid)
    const fields = formatFields(data)
    this._write(`TX ${ts} →${targetSystem}:${targetComponent} ${name}(${msgid}) ${fields}\n`)
  }

  /** Write a general app-level message to the log */
  info(tag: string, message: string): void {
    if (!this.enabled) return
    this._write(`INFO ${Date.now()} [${tag}] ${message}\n`)
  }

  /** Write a warning to the log */
  warn(tag: string, message: string): void {
    if (!this.enabled) return
    this._write(`WARN ${Date.now()} [${tag}] ${message}\n`)
  }

  private _write(line: string): void {
    if (this.fd !== null) {
      fs.writeSync(this.fd, line)
    }
  }
}

export const mavLog = new MavTrafficLogger()
