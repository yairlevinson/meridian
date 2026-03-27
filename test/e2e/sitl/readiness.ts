/**
 * Heartbeat-based readiness probe for SITL.
 * Opens a TCP or UDP connection to the SITL MAVLink port and waits for a HEARTBEAT.
 * Port polling alone isn't enough — PX4 exposes the port before the firmware boots.
 */

import net from 'net'
import dgram from 'dgram'
import { PassThrough } from 'stream'
import {
  MavLinkPacketSplitter,
  MavLinkPacketParser,
  MavLinkProtocolV2,
  type MavLinkPacket
} from 'node-mavlink'
import { minimal } from 'mavlink-mappings'

export interface ReadinessResult {
  autopilot: number
  type: number
  customMode: number
  baseMode: number
}

/**
 * Wait for a MAVLink HEARTBEAT on the given TCP endpoint.
 * Resolves with the first HEARTBEAT's fields. Rejects on timeout.
 */
export function waitForHeartbeat(
  host: string,
  port: number,
  timeoutMs: number
): Promise<ReadinessResult> {
  return new Promise((resolve, reject) => {
    let settled = false
    let socket: net.Socket | null = null
    let retryTimer: ReturnType<typeof setTimeout> | null = null

    const deadline = setTimeout(() => {
      cleanup()
      reject(
        new Error(`SITL readiness timeout: no HEARTBEAT on ${host}:${port} within ${timeoutMs}ms`)
      )
    }, timeoutMs)

    function cleanup() {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      if (retryTimer) clearTimeout(retryTimer)
      if (socket) {
        socket.removeAllListeners()
        socket.destroy()
      }
    }

    function attempt() {
      if (settled) return

      socket = net.createConnection({ host, port })
      socket.setTimeout(5000)

      const passThrough = new PassThrough()
      const splitter = new MavLinkPacketSplitter()
      const parser = new MavLinkPacketParser()
      passThrough.pipe(splitter).pipe(parser)

      parser.on('data', (packet: MavLinkPacket) => {
        if (settled) return
        // HEARTBEAT = msgid 0
        if (packet.header.msgid === 0) {
          // Extract fields from raw payload (HEARTBEAT layout: type u8, autopilot u8, base_mode u8, custom_mode u32, system_status u8)
          const payload = packet.payload
          const customMode = payload.readUInt32LE(0)
          const type = payload.readUInt8(4)
          const autopilot = payload.readUInt8(5)
          const baseMode = payload.readUInt8(6)

          console.log(
            `[SITL readiness] HEARTBEAT from sysid=${packet.header.sysid}: ` +
              `type=${type} autopilot=${autopilot} baseMode=0x${baseMode.toString(16)} customMode=0x${customMode.toString(16)}`
          )

          cleanup()
          resolve({ autopilot, type, customMode, baseMode })
        }
      })

      // Send GCS heartbeats so PX4's TCP bridge starts relaying vehicle data
      const gcsProto = new MavLinkProtocolV2(255, 190)
      let gcsSeq = 0
      let hbInterval: ReturnType<typeof setInterval> | null = null

      const sendGcsHeartbeat = (): void => {
        if (!socket || socket.destroyed) return
        const hb = new minimal.Heartbeat()
        hb.type = minimal.MavType.GCS
        hb.autopilot = minimal.MavAutopilot.INVALID
        hb.baseMode = 0
        hb.customMode = 0
        hb.systemStatus = minimal.MavState.ACTIVE
        hb.mavlinkVersion = 3
        socket.write(gcsProto.serialize(hb, gcsSeq++))
      }

      socket.on('connect', () => {
        sendGcsHeartbeat()
        hbInterval = setInterval(sendGcsHeartbeat, 1000)
      })

      socket.on('data', (buf: Buffer) => passThrough.write(buf))

      socket.on('error', () => {
        if (hbInterval) clearInterval(hbInterval)
        // Connection refused — SITL not ready yet, retry
        socket?.destroy()
        if (!settled) {
          retryTimer = setTimeout(attempt, 2000)
        }
      })

      socket.on('timeout', () => {
        if (hbInterval) clearInterval(hbInterval)
        socket?.destroy()
        if (!settled) {
          retryTimer = setTimeout(attempt, 1000)
        }
      })

      splitter.on('error', () => {}) // suppress framing errors during boot
      parser.on('error', () => {})
    }

    attempt()
  })
}

/**
 * Wait for a MAVLink HEARTBEAT on a UDP port (for externally-running SITL).
 * Binds to the port, listens for incoming packets, resolves on first HEARTBEAT.
 */
export function waitForHeartbeatUdp(port: number, timeoutMs: number): Promise<ReadinessResult> {
  return new Promise((resolve, reject) => {
    let settled = false
    const socket = dgram.createSocket('udp4')

    const passThrough = new PassThrough()
    const splitter = new MavLinkPacketSplitter()
    const parser = new MavLinkPacketParser()
    passThrough.pipe(splitter).pipe(parser)

    const deadline = setTimeout(() => {
      cleanup()
      reject(new Error(`SITL readiness timeout: no HEARTBEAT on UDP ${port} within ${timeoutMs}ms`))
    }, timeoutMs)

    function cleanup() {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      socket.close()
    }

    parser.on('data', (packet: MavLinkPacket) => {
      if (settled) return
      if (packet.header.msgid === 0) {
        const payload = packet.payload
        const customMode = payload.readUInt32LE(0)
        const type = payload.readUInt8(4)
        const autopilot = payload.readUInt8(5)
        const baseMode = payload.readUInt8(6)

        console.log(
          `[SITL readiness] UDP HEARTBEAT from sysid=${packet.header.sysid}: ` +
            `type=${type} autopilot=${autopilot} baseMode=0x${baseMode.toString(16)}`
        )

        cleanup()
        resolve({ autopilot, type, customMode, baseMode })
      }
    })

    socket.on('message', (buf: Buffer) => passThrough.write(buf))

    splitter.on('error', () => {})
    parser.on('error', () => {})

    socket.bind(port, () => {
      console.log(`[SITL readiness] Listening for HEARTBEAT on UDP ${port}...`)
    })

    socket.on('error', (err) => {
      cleanup()
      reject(new Error(`Failed to bind UDP ${port}: ${err.message}`))
    })
  })
}
