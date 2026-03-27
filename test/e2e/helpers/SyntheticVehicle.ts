import dgram from 'dgram'
import {
  MavLinkProtocolV2,
  MavLinkPacketSplitter,
  MavLinkPacketParser,
  type MavLinkPacket
} from 'node-mavlink'
import { minimal, common } from 'mavlink-mappings'
import { PassThrough } from 'stream'

const REGISTRY: Record<number, unknown> = {
  ...minimal.REGISTRY,
  ...common.REGISTRY
}

// ArduCopter flight modes
const COPTER_MODE_STABILIZE = 0
const COPTER_MODE_GUIDED = 4
const COPTER_MODE_AUTO = 3
const COPTER_MODE_LAND = 9
const COPTER_MODE_RTL = 6

// MAV_CMD IDs
const MAV_CMD_COMPONENT_ARM_DISARM = 400
const MAV_CMD_NAV_TAKEOFF = 22
const MAV_CMD_NAV_RETURN_TO_LAUNCH = 20
const MAV_CMD_NAV_LAND = 21
const MAV_CMD_DO_SET_MODE = 176
const MAV_CMD_DO_REPOSITION = 192
const MAV_CMD_DO_PAUSE_CONTINUE = 252

// Mission protocol msgids
const MSGID_MISSION_REQUEST_LIST = 43
const MSGID_MISSION_COUNT = 44
const MSGID_MISSION_ITEM_INT = 73
const MSGID_MISSION_REQUEST_INT = 51
const MSGID_MISSION_ACK = 47
const _MSGID_MISSION_CURRENT = 42

interface StoredMissionItem {
  seq: number
  frame: number
  command: number
  param1: number
  param2: number
  param3: number
  param4: number
  x: number
  y: number
  z: number
}

/**
 * Sends synthetic MAVLink messages over UDP to simulate a vehicle.
 * Listens for incoming commands (arm, takeoff, RTL, land) and reacts.
 */
export class SyntheticVehicle {
  private socket = dgram.createSocket('udp4')
  private protocol: MavLinkProtocolV2
  private seq = 0
  private intervals: NodeJS.Timeout[] = []
  private targetPort: number
  readonly sysid: number

  // Vehicle state
  private armed = false
  private flightMode = COPTER_MODE_STABILIZE
  private baseLat = 42.3898
  private baseLon = -71.1476
  private baseAlt = 14
  private orbitRadius = 0.0005
  private orbitSpeed = 0
  private startTime = 0

  // Mission state
  private missionItems: StoredMissionItem[] = []
  private missionExpectedCount = 0
  private missionCurrentIndex = 0
  private missionRunning = false
  private missionTimer: NodeJS.Timeout | null = null

  constructor(targetPort = 14550, sysid = 1) {
    this.targetPort = targetPort
    this.sysid = sysid
    this.protocol = new MavLinkProtocolV2(sysid, 1) // compid=1
    this.orbitSpeed = 0.15 + sysid * 0.03

    // Listen for incoming commands on the same socket
    this._setupCommandListener()
  }

  private _setupCommandListener(): void {
    const passThrough = new PassThrough()
    const splitter = new MavLinkPacketSplitter()
    const parser = new MavLinkPacketParser()

    passThrough.pipe(splitter).pipe(parser)

    parser.on('data', (packet: MavLinkPacket) => {
      const msgid = packet.header.msgid
      const messageClass = REGISTRY[msgid]
      if (!messageClass) return

      try {
        const data = packet.protocol.data(packet.payload, messageClass)

        // COMMAND_LONG (76)
        if (msgid === 76) {
          if (data.targetSystem !== this.sysid) return
          this._handleCommand(data)
          return
        }

        // Mission protocol messages
        if (data.targetSystem !== undefined && data.targetSystem !== this.sysid) return
        this._handleMissionProtocol(msgid, data)
      } catch {
        // ignore parse errors
      }
    })

    this.socket.on('message', (buf) => {
      passThrough.write(buf)
    })
  }

  private _handleCommand(cmd: any): void {
    const command = cmd.command as number
    let result = 0 // MAV_RESULT_ACCEPTED

    switch (command) {
      case MAV_CMD_COMPONENT_ARM_DISARM: {
        const armFlag = cmd.param1 ?? cmd._param1 ?? 0
        this.armed = armFlag === 1
        this.flightMode = this.armed ? COPTER_MODE_GUIDED : COPTER_MODE_STABILIZE
        console.log(`[SyntheticVehicle ${this.sysid}] ${this.armed ? 'ARMED' : 'DISARMED'}`)
        break
      }
      case MAV_CMD_NAV_TAKEOFF: {
        const alt = cmd.param7 ?? cmd._param7 ?? 10
        this.baseAlt = alt
        this.flightMode = COPTER_MODE_GUIDED
        console.log(`[SyntheticVehicle ${this.sysid}] TAKEOFF to ${alt}m`)
        break
      }
      case MAV_CMD_NAV_RETURN_TO_LAUNCH:
        this.flightMode = COPTER_MODE_RTL
        console.log(`[SyntheticVehicle ${this.sysid}] RTL`)
        break
      case MAV_CMD_NAV_LAND:
        this.flightMode = COPTER_MODE_LAND
        this.baseAlt = 0
        console.log(`[SyntheticVehicle ${this.sysid}] LAND`)
        // Disarm after "landing"
        setTimeout(() => {
          this.armed = false
          this.flightMode = COPTER_MODE_STABILIZE
          console.log(`[SyntheticVehicle ${this.sysid}] LANDED & DISARMED`)
        }, 3000)
        break
      case MAV_CMD_DO_PAUSE_CONTINUE: {
        const pause = (cmd.param1 ?? cmd._param1 ?? 0) === 0
        if (pause) {
          this.orbitSpeed = 0
          console.log(`[SyntheticVehicle ${this.sysid}] PAUSED`)
        } else {
          this.orbitSpeed = 0.15 + this.sysid * 0.03
          console.log(`[SyntheticVehicle ${this.sysid}] RESUMED`)
        }
        break
      }
      case MAV_CMD_DO_SET_MODE: {
        const mode = cmd.param2 ?? cmd._param2 ?? 0
        this.flightMode = mode
        console.log(`[SyntheticVehicle ${this.sysid}] SET MODE ${mode}`)
        if (mode === COPTER_MODE_AUTO) {
          this._startMission()
        } else {
          this._stopMission()
        }
        break
      }
      case MAV_CMD_DO_REPOSITION: {
        const lat = cmd.param5 ?? cmd._param5 ?? 0
        const lon = cmd.param6 ?? cmd._param6 ?? 0
        const alt = cmd.param7 ?? cmd._param7 ?? this.baseAlt
        this.baseLat = lat
        this.baseLon = lon
        this.baseAlt = alt
        this.startTime = Date.now() / 1000
        console.log(`[SyntheticVehicle ${this.sysid}] GOTO ${lat},${lon} alt=${alt}m`)
        break
      }
      default:
        result = 4 // MAV_RESULT_UNSUPPORTED
    }

    // Send COMMAND_ACK
    this._sendCommandAck(command, result)
  }

  private _sendCommandAck(command: number, result: number): void {
    const ack = new common.CommandAck()
    ack.command = command
    ack.result = result
    ack.targetSystem = 255 // GCS
    ack.targetComponent = 0
    this.send(ack)
  }

  /** Send a single MAVLink message. */
  private send(msg: any): void {
    const buf = this.protocol.serialize(msg, this.seq++ & 0xff)
    this.socket.send(buf, this.targetPort, '127.0.0.1')
  }

  /** Send a single HEARTBEAT. */
  sendHeartbeat(armed?: boolean): void {
    const isArmed = armed ?? this.armed
    const hb = new minimal.Heartbeat()
    hb.type = minimal.MavType.QUADROTOR
    hb.autopilot = minimal.MavAutopilot.ARDUPILOTMEGA
    hb.baseMode = isArmed
      ? minimal.MavModeFlag.SAFETY_ARMED | minimal.MavModeFlag.CUSTOM_MODE_ENABLED
      : minimal.MavModeFlag.CUSTOM_MODE_ENABLED
    hb.customMode = this.flightMode
    hb.systemStatus = minimal.MavState.ACTIVE
    this.send(hb)
  }

  /** Send a single ATTITUDE message. */
  sendAttitude(roll: number, pitch: number, yaw: number): void {
    const att = new common.Attitude()
    att.timeBootMs = Date.now() & 0xffffffff
    att.roll = roll
    att.pitch = pitch
    att.yaw = yaw
    att.rollspeed = 0
    att.pitchspeed = 0
    att.yawspeed = 0
    this.send(att)
  }

  /** Send a single GLOBAL_POSITION_INT message. */
  sendPosition(lat: number, lon: number, alt: number, hdg = 0): void {
    const pos = new common.GlobalPositionInt()
    pos.timeBootMs = Date.now() & 0xffffffff
    pos.lat = Math.round(lat * 1e7)
    pos.lon = Math.round(lon * 1e7)
    pos.alt = Math.round(alt * 1000) // m → mm
    pos.relativeAlt = Math.round(alt * 1000)
    pos.vx = 0
    pos.vy = 0
    pos.vz = 0
    pos.hdg = Math.round(hdg * 100) // deg → cdeg
    this.send(pos)
  }

  /** Send a VFR_HUD message. */
  sendVfrHud(
    options: {
      airspeed?: number
      groundspeed?: number
      heading?: number
      throttle?: number
      alt?: number
      climb?: number
    } = {}
  ): void {
    const hud = new common.VfrHud()
    hud.airspeed = options.airspeed ?? 0
    hud.groundspeed = options.groundspeed ?? 0
    hud.heading = options.heading ?? 270
    hud.throttle = options.throttle ?? 0
    hud.alt = options.alt ?? 0
    hud.climb = options.climb ?? 0
    this.send(hud)
  }

  /** Send a GPS_RAW_INT message. */
  sendGpsRaw(lat: number, lon: number, alt: number): void {
    const gps = new common.GpsRawInt()
    gps.timeUsec = BigInt(Date.now()) * 1000n
    gps.fixType = 3 // 3D Fix
    gps.lat = Math.round(lat * 1e7)
    gps.lon = Math.round(lon * 1e7)
    gps.alt = Math.round(alt * 1000)
    gps.eph = 120 // HDOP * 100
    gps.epv = 200
    gps.vel = 0
    gps.cog = 27000 // 270 degrees * 100
    gps.satellitesVisible = 12
    this.send(gps)
  }

  /** Send a SYS_STATUS message. */
  sendSysStatus(): void {
    const sys = new common.SysStatus()
    sys.load = 200 + Math.round(Math.random() * 50)
    this.send(sys)
  }

  /** Send a BATTERY_STATUS message. */
  sendBatteryStatus(remaining = 75): void {
    const bat = new common.BatteryStatus()
    bat.id = 0
    bat.batteryRemaining = remaining
    bat.currentBattery = 500 + Math.round(Math.random() * 100) // cA
    bat.voltages = [
      3950 + Math.round(Math.random() * 50),
      3940,
      3960,
      65535,
      65535,
      65535,
      65535,
      65535,
      65535,
      65535
    ] as any
    bat.temperature = 3200 // 32.00°C
    this.send(bat)
  }

  /**
   * Start streaming telemetry at realistic rates.
   * HEARTBEAT at 1Hz, ATTITUDE at 10Hz, POSITION at 4Hz, VFR_HUD at 5Hz,
   * GPS_RAW at 1Hz, BATTERY at 0.5Hz.
   */
  startStreaming(
    options: {
      lat?: number
      lon?: number
      alt?: number
      armed?: boolean
    } = {}
  ): void {
    this.baseLat = options.lat ?? 42.3898
    this.baseLon = options.lon ?? -71.1476
    this.baseAlt = options.alt ?? 14
    this.armed = options.armed ?? false
    this.flightMode = this.armed ? COPTER_MODE_GUIDED : COPTER_MODE_STABILIZE
    this.startTime = Date.now() / 1000

    // Heartbeat uses current armed/mode state
    this.intervals.push(setInterval(() => this.sendHeartbeat(), 1000))
    this.intervals.push(
      setInterval(() => {
        const t = Date.now() / 1000
        this.sendAttitude(Math.sin(t * 0.7) * 0.05, Math.cos(t * 0.5) * 0.03, -1.5)
      }, 100)
    )

    // Position: orbit when armed, stationary when disarmed
    this.intervals.push(
      setInterval(() => {
        const t = Date.now() / 1000 - this.startTime
        const angle = t * this.orbitSpeed
        let curLat = this.baseLat
        let curLon = this.baseLon
        let curHdg = 0

        if (this.armed) {
          curLat += Math.sin(angle) * this.orbitRadius
          curLon += Math.cos(angle) * this.orbitRadius
          curHdg = ((((-angle * 180) / Math.PI) % 360) + 360) % 360
        }

        this.sendPosition(curLat, curLon, this.baseAlt, curHdg)
      }, 250)
    )
    this.intervals.push(
      setInterval(() => {
        const t = Date.now() / 1000
        const groundspeed = this.armed ? 2 + Math.sin(t * 0.3) * 1.5 : 0
        const climb = this.armed ? Math.sin(t * 0.2) * 0.5 : 0
        const throttle = this.armed ? 35 + Math.sin(t * 0.4) * 10 : 0
        const angle = (t - this.startTime) * this.orbitSpeed
        const hdg = this.armed ? ((((-angle * 180) / Math.PI) % 360) + 360) % 360 : 0
        this.sendVfrHud({
          groundspeed,
          airspeed: groundspeed * 1.1,
          heading: Math.round(hdg),
          throttle,
          alt: this.baseAlt,
          climb
        })
      }, 200)
    )
    this.intervals.push(
      setInterval(() => {
        const t = Date.now() / 1000 - this.startTime
        const angle = t * this.orbitSpeed
        let curLat = this.baseLat
        let curLon = this.baseLon
        if (this.armed) {
          curLat += Math.sin(angle) * this.orbitRadius
          curLon += Math.cos(angle) * this.orbitRadius
        }
        this.sendGpsRaw(curLat, curLon, this.baseAlt)
      }, 1000)
    )
    this.intervals.push(
      setInterval(() => {
        const remaining = Math.max(10, 85 - ((Date.now() / 1000) % 60))
        this.sendBatteryStatus(Math.round(remaining))
      }, 2000)
    )

    // Initial burst
    this.sendHeartbeat()
    this.sendAttitude(0, 0, -1.5)
    this.sendPosition(this.baseLat, this.baseLon, this.baseAlt, 0)
    this.sendVfrHud({ groundspeed: 0, heading: 0, throttle: 0, alt: this.baseAlt, climb: 0 })
    this.sendGpsRaw(this.baseLat, this.baseLon, this.baseAlt)
    this.sendBatteryStatus(85)
  }

  // ── Mission protocol ────────────────────────────────────────

  private _handleMissionProtocol(msgid: number, data: any): void {
    switch (msgid) {
      case MSGID_MISSION_COUNT: {
        // GCS is uploading: it sent us the count, now we request each item
        const count = data.count as number
        this.missionItems = []
        this.missionExpectedCount = count
        console.log(`[SyntheticVehicle ${this.sysid}] MISSION_COUNT received: ${count} items`)
        if (count > 0) {
          this._sendMissionRequestInt(0)
        } else {
          this._sendMissionAck(0)
        }
        break
      }
      case MSGID_MISSION_ITEM_INT: {
        // GCS sent us a mission item
        const item: StoredMissionItem = {
          seq: data.seq,
          frame: data.frame,
          command: data.command,
          param1: data.param1,
          param2: data.param2,
          param3: data.param3,
          param4: data.param4,
          x: data.x,
          y: data.y,
          z: data.z
        }
        this.missionItems.push(item)
        console.log(
          `[SyntheticVehicle ${this.sysid}] MISSION_ITEM_INT seq=${item.seq} cmd=${item.command} (${item.x / 1e7},${item.y / 1e7}) alt=${item.z}`
        )

        if (this.missionItems.length >= this.missionExpectedCount) {
          // All items received
          this._sendMissionAck(0) // ACCEPTED
          console.log(
            `[SyntheticVehicle ${this.sysid}] Mission upload complete: ${this.missionItems.length} items`
          )
        } else {
          // Request next
          this._sendMissionRequestInt(this.missionItems.length)
        }
        break
      }
      case MSGID_MISSION_REQUEST_LIST: {
        // GCS wants to download our mission
        const count = new common.MissionCount()
        count.targetSystem = 255
        count.targetComponent = 0
        count.count = this.missionItems.length
        this.send(count)
        console.log(
          `[SyntheticVehicle ${this.sysid}] Sending MISSION_COUNT: ${this.missionItems.length}`
        )
        break
      }
      case MSGID_MISSION_REQUEST_INT: {
        // GCS requesting a specific item
        const seq = data.seq as number
        const item = this.missionItems[seq]
        if (item) {
          const mi = new common.MissionItemInt()
          mi.targetSystem = 255
          mi.targetComponent = 0
          mi.seq = item.seq
          mi.frame = item.frame
          mi.command = item.command
          mi.current = seq === this.missionCurrentIndex ? 1 : 0
          mi.autocontinue = 1
          mi.param1 = item.param1
          mi.param2 = item.param2
          mi.param3 = item.param3
          mi.param4 = item.param4
          mi.x = item.x
          mi.y = item.y
          mi.z = item.z
          this.send(mi)
        }
        break
      }
      case MSGID_MISSION_ACK: {
        // GCS acknowledged our download
        console.log(`[SyntheticVehicle ${this.sysid}] MISSION_ACK type=${data.type}`)
        break
      }
    }
  }

  private _sendMissionRequestInt(seq: number): void {
    const req = new common.MissionRequestInt()
    req.targetSystem = 255
    req.targetComponent = 0
    req.seq = seq
    this.send(req)
  }

  private _sendMissionAck(result: number): void {
    const ack = new common.MissionAck()
    ack.targetSystem = 255
    ack.targetComponent = 0
    ack.type = result
    this.send(ack)
  }

  private _sendMissionCurrent(seq: number): void {
    const mc = new common.MissionCurrent()
    mc.seq = seq
    this.send(mc)
  }

  // ── Mission execution (AUTO mode) ────────────────────────────

  private _startMission(): void {
    if (this.missionItems.length === 0) {
      console.log(`[SyntheticVehicle ${this.sysid}] No mission items, cannot start AUTO`)
      return
    }
    this.missionRunning = true
    this.missionCurrentIndex = 0
    this._flyToCurrentWaypoint()
    console.log(
      `[SyntheticVehicle ${this.sysid}] AUTO mission started, ${this.missionItems.length} waypoints`
    )
  }

  private _stopMission(): void {
    this.missionRunning = false
    if (this.missionTimer) {
      clearTimeout(this.missionTimer)
      this.missionTimer = null
    }
  }

  private _flyToCurrentWaypoint(): void {
    if (!this.missionRunning || this.missionCurrentIndex >= this.missionItems.length) {
      // Mission complete
      this.missionRunning = false
      this.flightMode = COPTER_MODE_GUIDED
      console.log(`[SyntheticVehicle ${this.sysid}] Mission complete`)
      this._sendMissionCurrent(0)
      return
    }

    const wp = this.missionItems[this.missionCurrentIndex]!
    this._sendMissionCurrent(this.missionCurrentIndex)

    // Navigate to waypoint: set base position and alt
    const targetLat = wp.x / 1e7
    const targetLon = wp.y / 1e7
    const targetAlt = wp.z

    // Simulate flying to waypoint over ~3 seconds
    this.baseLat = targetLat
    this.baseLon = targetLon
    this.baseAlt = targetAlt
    this.orbitSpeed = 0 // fly straight, no orbiting
    this.startTime = Date.now() / 1000

    console.log(
      `[SyntheticVehicle ${this.sysid}] Flying to WP${this.missionCurrentIndex}: (${targetLat.toFixed(6)}, ${targetLon.toFixed(6)}) alt=${targetAlt}m`
    )

    // After "arrival", advance to next waypoint
    this.missionTimer = setTimeout(() => {
      this.missionCurrentIndex++
      this._flyToCurrentWaypoint()
    }, 3000) // 3 seconds per waypoint
  }

  /** Stop streaming and close the socket. */
  stop(): void {
    this._stopMission()
    for (const iv of this.intervals) clearInterval(iv)
    this.intervals = []
    this.socket.close()
  }
}
