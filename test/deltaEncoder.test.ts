// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest'
import { VehicleState } from '../src/main/vehicleState'

const MSG_HEARTBEAT = 0
const MSG_ATTITUDE = 30
const MSG_GLOBAL_POSITION_INT = 33
const MSG_SYS_STATUS = 1
const MSG_SERVO_OUTPUT_RAW = 36
const MSG_BATTERY_STATUS = 147
const MSG_VFR_HUD = 74
const MSG_GPS_RAW_INT = 24
const MSG_HOME_POSITION = 242
const MSG_RC_CHANNELS = 65
const MSG_WIND = 168
const MSG_RADIO_STATUS = 109
const MSG_VIBRATION = 241
const MSG_EXTENDED_SYS_STATE = 245
const MSG_MISSION_CURRENT = 42
const MSG_TERRAIN_REPORT = 136
const MSG_CAMERA_INFORMATION = 259
const MSG_CAMERA_SETTINGS = 260
const MSG_CAMERA_CAPTURE_STATUS = 262

describe('VehicleState — delta encoding', () => {
  let vs: VehicleState

  beforeEach(() => {
    vs = new VehicleState()
  })

  it('only includes attitude in delta when only attitude changed', () => {
    vs.handleMessage(MSG_ATTITUDE, {
      roll: 0.1,
      pitch: 0.05,
      yaw: 1.2,
      rollspeed: 0,
      pitchspeed: 0,
      yawspeed: 0
    })
    const delta = vs.getDelta()

    expect(delta.attitude).toBeDefined()
    expect(delta.gps).toBeUndefined()
    expect(delta.core).toBeUndefined()
  })

  it('only includes gps in delta when only gps changed', () => {
    vs.handleMessage(MSG_GLOBAL_POSITION_INT, {
      lat: 320000000,
      lon: 348000000,
      alt: 100000,
      relativeAlt: 50000,
      vx: 0,
      vy: 0,
      vz: 0,
      hdg: 18000
    })
    const delta = vs.getDelta()

    expect(delta.gps).toBeDefined()
    expect(delta.attitude).toBeUndefined()
    expect(delta.core).toBeUndefined()
  })

  it('only includes core in delta when only heartbeat received', () => {
    vs.handleMessage(MSG_HEARTBEAT, {
      baseMode: 0,
      customMode: 0,
      type: 2,
      autopilot: 3,
      systemStatus: 4,
      mavlinkVersion: 3
    })
    const delta = vs.getDelta()

    expect(delta.core).toBeDefined()
    expect(delta.attitude).toBeUndefined()
    expect(delta.gps).toBeUndefined()
  })

  it('clears dirty flags after getDelta()', () => {
    vs.handleMessage(MSG_ATTITUDE, {
      roll: 0.1,
      pitch: 0,
      yaw: 0,
      rollspeed: 0,
      pitchspeed: 0,
      yawspeed: 0
    })
    vs.getDelta()
    const delta2 = vs.getDelta()
    expect(Object.keys(delta2)).toHaveLength(0)
  })

  it('includes multiple groups when multiple messages received in one tick', () => {
    vs.handleMessage(MSG_ATTITUDE, {
      roll: 0.3,
      pitch: 0.1,
      yaw: 0,
      rollspeed: 0,
      pitchspeed: 0,
      yawspeed: 0
    })
    vs.handleMessage(MSG_GLOBAL_POSITION_INT, {
      lat: 320000000,
      lon: 348000000,
      alt: 150000,
      relativeAlt: 50000,
      vx: 0,
      vy: 0,
      vz: 0,
      hdg: 0
    })
    const delta = vs.getDelta()

    expect(delta.attitude).toBeDefined()
    expect(delta.gps).toBeDefined()
  })

  it('converts GLOBAL_POSITION_INT integer fields to float degrees and metres', () => {
    vs.handleMessage(MSG_GLOBAL_POSITION_INT, {
      lat: 320000000,
      lon: 348000000,
      alt: 150000,
      relativeAlt: 50000,
      vx: 0,
      vy: 0,
      vz: 0,
      hdg: 18000
    })
    const delta = vs.getDelta()

    expect(delta.gps?.lat).toBeCloseTo(32.0, 4)
    expect(delta.gps?.lon).toBeCloseTo(34.8, 4)
    expect(delta.gps?.alt).toBeCloseTo(150, 1)
    expect(delta.gps?.hdg).toBeCloseTo(180, 1)
  })

  it('armed flag is true when SAFETY_ARMED bit set in baseMode', () => {
    vs.handleMessage(MSG_HEARTBEAT, {
      baseMode: 128 | 4,
      customMode: 3,
      type: 2,
      autopilot: 3,
      systemStatus: 4,
      mavlinkVersion: 3
    })
    const delta = vs.getDelta()

    expect(delta.core?.armed).toBe(true)
    expect(delta.core?.flightMode).toBe(3)
  })

  it('armed flag is false when SAFETY_ARMED bit not set', () => {
    vs.handleMessage(MSG_HEARTBEAT, {
      baseMode: 4,
      customMode: 0,
      type: 2,
      autopilot: 3,
      systemStatus: 4,
      mavlinkVersion: 3
    })
    const delta = vs.getDelta()

    expect(delta.core?.armed).toBe(false)
  })

  it('seq increments on each message of the same type', () => {
    vs.handleMessage(MSG_ATTITUDE, {
      roll: 0,
      pitch: 0,
      yaw: 0,
      rollspeed: 0,
      pitchspeed: 0,
      yawspeed: 0
    })
    const d1 = vs.getDelta()
    vs.handleMessage(MSG_ATTITUDE, {
      roll: 0.1,
      pitch: 0,
      yaw: 0,
      rollspeed: 0,
      pitchspeed: 0,
      yawspeed: 0
    })
    const d2 = vs.getDelta()

    expect(d2.attitude!.seq).toBe(d1.attitude!.seq + 1)
  })

  it('getDelta returns empty object when nothing changed since last call', () => {
    const delta = vs.getDelta()
    expect(Object.keys(delta)).toHaveLength(0)
  })

  // New tests for expanded message handlers
  it('handles SYS_STATUS message', () => {
    vs.handleMessage(MSG_SYS_STATUS, {
      onboardControlSensorsPresent: 0xff,
      onboardControlSensorsEnabled: 0xfe,
      onboardControlSensorsHealth: 0xfd,
      load: 500,
      dropRateComm: 10,
      errorsComm: 2,
      voltageBattery: 12000,
      currentBattery: 5000,
      batteryRemaining: 80
    })
    const delta = vs.getDelta()
    expect(delta.sysStatus).toBeDefined()
    expect(delta.sysStatus?.load).toBe(500)
    expect(delta.sysStatus?.dropRateComm).toBe(10)
  })

  it('handles BATTERY_STATUS with multiple instances', () => {
    vs.handleMessage(MSG_BATTERY_STATUS, {
      id: 0,
      voltages: [4200, 4200, 4200, 65535],
      currentBattery: 1500,
      batteryRemaining: 75,
      temperature: 3500
    })
    vs.handleMessage(MSG_BATTERY_STATUS, {
      id: 1,
      voltages: [3800, 3800, 65535],
      currentBattery: 800,
      batteryRemaining: 40,
      temperature: 4000
    })
    const delta = vs.getDelta()
    expect(delta.battery?.batteries).toHaveLength(2)
    expect(delta.battery?.batteries[0].id).toBe(0)
    expect(delta.battery?.batteries[1].id).toBe(1)
    expect(delta.battery?.batteries[0].remaining).toBe(75)
  })

  it('handles VFR_HUD message', () => {
    vs.handleMessage(MSG_VFR_HUD, {
      airspeed: 15.5,
      groundspeed: 12.3,
      heading: 270,
      throttle: 65,
      alt: 120.5,
      climb: 2.1
    })
    const delta = vs.getDelta()
    expect(delta.vfrHud).toBeDefined()
    expect(delta.vfrHud?.airspeed).toBeCloseTo(15.5)
    expect(delta.vfrHud?.groundspeed).toBeCloseTo(12.3)
    expect(delta.vfrHud?.throttle).toBe(65)
  })

  it('setSysId only marks dirty if sysid actually changes', () => {
    vs.setSysId(1)
    vs.getDelta() // clear
    vs.setSysId(1) // same value
    const delta = vs.getDelta()
    expect(delta.core).toBeUndefined()
  })

  it('setCommunicationLost updates core group', () => {
    vs.setCommunicationLost(true)
    const delta = vs.getDelta()
    expect(delta.core?.communicationLost).toBe(true)
  })

  // --- SERVO_OUTPUT_RAW (36) ---

  it('handles SERVO_OUTPUT_RAW message', () => {
    vs.handleMessage(MSG_SERVO_OUTPUT_RAW, {
      timeUsec: 12345,
      port: 0,
      servo1Raw: 1100,
      servo2Raw: 1200,
      servo3Raw: 1300,
      servo4Raw: 1400,
      servo5Raw: 0,
      servo6Raw: 0,
      servo7Raw: 0,
      servo8Raw: 0,
      servo9Raw: 0,
      servo10Raw: 0,
      servo11Raw: 0,
      servo12Raw: 0,
      servo13Raw: 0,
      servo14Raw: 0,
      servo15Raw: 0,
      servo16Raw: 0
    })
    const delta = vs.getDelta()

    expect(delta.servoOutput).toBeDefined()
    expect(delta.servoOutput?.port).toBe(0)
    expect(delta.servoOutput?.outputs).toHaveLength(16)
    expect(delta.servoOutput?.outputs[0]).toBe(1100)
    expect(delta.servoOutput?.outputs[1]).toBe(1200)
    expect(delta.servoOutput?.outputs[2]).toBe(1300)
    expect(delta.servoOutput?.outputs[3]).toBe(1400)
  })

  it('only includes servoOutput in delta when only SERVO_OUTPUT_RAW received', () => {
    vs.handleMessage(MSG_SERVO_OUTPUT_RAW, {
      timeUsec: 0,
      port: 0,
      servo1Raw: 1500,
      servo2Raw: 1500,
      servo3Raw: 1500,
      servo4Raw: 1500,
      servo5Raw: 0,
      servo6Raw: 0,
      servo7Raw: 0,
      servo8Raw: 0,
      servo9Raw: 0,
      servo10Raw: 0,
      servo11Raw: 0,
      servo12Raw: 0,
      servo13Raw: 0,
      servo14Raw: 0,
      servo15Raw: 0,
      servo16Raw: 0
    })
    const delta = vs.getDelta()

    expect(delta.servoOutput).toBeDefined()
    expect(delta.attitude).toBeUndefined()
    expect(delta.core).toBeUndefined()
    expect(delta.gps).toBeUndefined()
  })

  it('servoOutput seq increments on each SERVO_OUTPUT_RAW', () => {
    const msg = {
      timeUsec: 0,
      port: 0,
      servo1Raw: 1500,
      servo2Raw: 1500,
      servo3Raw: 1500,
      servo4Raw: 1500,
      servo5Raw: 0,
      servo6Raw: 0,
      servo7Raw: 0,
      servo8Raw: 0,
      servo9Raw: 0,
      servo10Raw: 0,
      servo11Raw: 0,
      servo12Raw: 0,
      servo13Raw: 0,
      servo14Raw: 0,
      servo15Raw: 0,
      servo16Raw: 0
    }
    vs.handleMessage(MSG_SERVO_OUTPUT_RAW, msg)
    const d1 = vs.getDelta()
    vs.handleMessage(MSG_SERVO_OUTPUT_RAW, { ...msg, servo1Raw: 1600 })
    const d2 = vs.getDelta()

    expect(d2.servoOutput!.seq).toBe(d1.servoOutput!.seq + 1)
    expect(d2.servoOutput!.outputs[0]).toBe(1600)
  })

  it('servoOutput outputs array is a copy (not shared reference)', () => {
    vs.handleMessage(MSG_SERVO_OUTPUT_RAW, {
      timeUsec: 0,
      port: 0,
      servo1Raw: 1500,
      servo2Raw: 1500,
      servo3Raw: 1500,
      servo4Raw: 1500,
      servo5Raw: 0,
      servo6Raw: 0,
      servo7Raw: 0,
      servo8Raw: 0,
      servo9Raw: 0,
      servo10Raw: 0,
      servo11Raw: 0,
      servo12Raw: 0,
      servo13Raw: 0,
      servo14Raw: 0,
      servo15Raw: 0,
      servo16Raw: 0
    })
    const d1 = vs.getDelta()
    d1.servoOutput!.outputs[0] = 9999

    vs.handleMessage(MSG_SERVO_OUTPUT_RAW, {
      timeUsec: 0,
      port: 0,
      servo1Raw: 1500,
      servo2Raw: 1500,
      servo3Raw: 1500,
      servo4Raw: 1500,
      servo5Raw: 0,
      servo6Raw: 0,
      servo7Raw: 0,
      servo8Raw: 0,
      servo9Raw: 0,
      servo10Raw: 0,
      servo11Raw: 0,
      servo12Raw: 0,
      servo13Raw: 0,
      servo14Raw: 0,
      servo15Raw: 0,
      servo16Raw: 0
    })
    const d2 = vs.getDelta()

    // Should not be affected by mutation of d1
    expect(d2.servoOutput!.outputs[0]).toBe(1500)
  })

  // --- GPS_RAW_INT (24) ---

  it('handles GPS_RAW_INT message', () => {
    vs.handleMessage(MSG_GPS_RAW_INT, {
      fixType: 3,
      satellitesVisible: 12,
      eph: 150,
      epv: 200,
      lat: 320000000,
      lon: 348000000,
      alt: 150000
    })
    const delta = vs.getDelta()
    expect(delta.gpsRaw).toBeDefined()
    expect(delta.gpsRaw?.fixType).toBe(3)
    expect(delta.gpsRaw?.satelliteCount).toBe(12)
    expect(delta.gpsRaw?.hdop).toBeCloseTo(1.5)
    expect(delta.gpsRaw?.vdop).toBeCloseTo(2.0)
    expect(delta.gpsRaw?.lat).toBeCloseTo(32.0, 4)
  })

  // --- HOME_POSITION (242) ---

  it('handles HOME_POSITION message', () => {
    vs.handleMessage(MSG_HOME_POSITION, {
      latitude: 320000000,
      longitude: 348000000,
      altitude: 120000
    })
    const delta = vs.getDelta()
    expect(delta.home).toBeDefined()
    expect(delta.home?.lat).toBeCloseTo(32.0, 4)
    expect(delta.home?.lon).toBeCloseTo(34.8, 4)
    expect(delta.home?.alt).toBeCloseTo(120, 1)
    expect(delta.home?.valid).toBe(true)
  })

  // --- RC_CHANNELS (65) ---

  it('handles RC_CHANNELS message', () => {
    vs.handleMessage(MSG_RC_CHANNELS, {
      chancount: 4,
      chan1Raw: 1100,
      chan2Raw: 1200,
      chan3Raw: 1300,
      chan4Raw: 1400,
      chan5Raw: 0,
      rssi: 200
    })
    const delta = vs.getDelta()
    expect(delta.rc).toBeDefined()
    expect(delta.rc?.channels).toEqual([1100, 1200, 1300, 1400])
    expect(delta.rc?.channelCount).toBe(4)
    expect(delta.rc?.rssi).toBe(200)
  })

  it('rc channels array is a copy (not shared reference)', () => {
    vs.handleMessage(MSG_RC_CHANNELS, {
      chancount: 2,
      chan1Raw: 1500,
      chan2Raw: 1500,
      rssi: 100
    })
    const d1 = vs.getDelta()
    d1.rc!.channels[0] = 9999
    vs.handleMessage(MSG_RC_CHANNELS, {
      chancount: 2,
      chan1Raw: 1500,
      chan2Raw: 1500,
      rssi: 100
    })
    const d2 = vs.getDelta()
    expect(d2.rc!.channels[0]).toBe(1500)
  })

  // --- WIND (168) ---

  it('handles WIND message', () => {
    vs.handleMessage(MSG_WIND, { direction: 270, speed: 5.5, speed_z: 0.2 })
    const delta = vs.getDelta()
    expect(delta.wind?.direction).toBe(270)
    expect(delta.wind?.speed).toBeCloseTo(5.5)
    expect(delta.wind?.verticalSpeed).toBeCloseTo(0.2)
  })

  // --- RADIO_STATUS (109) ---

  it('handles RADIO_STATUS message', () => {
    vs.handleMessage(MSG_RADIO_STATUS, {
      rssi: 180,
      remrssi: 170,
      txbuf: 90,
      noise: 30,
      remnoise: 35,
      rxerrors: 2,
      fixed: 1
    })
    const delta = vs.getDelta()
    expect(delta.radio?.rssi).toBe(180)
    expect(delta.radio?.remrssi).toBe(170)
    expect(delta.radio?.txbuf).toBe(90)
    expect(delta.radio?.rxerrors).toBe(2)
  })

  // --- VIBRATION (241) ---

  it('handles VIBRATION message', () => {
    vs.handleMessage(MSG_VIBRATION, {
      vibrationX: 1.1,
      vibrationY: 1.2,
      vibrationZ: 1.3,
      clipping0: 5,
      clipping1: 6,
      clipping2: 7
    })
    const delta = vs.getDelta()
    expect(delta.vibration?.xVibration).toBeCloseTo(1.1)
    expect(delta.vibration?.yVibration).toBeCloseTo(1.2)
    expect(delta.vibration?.zVibration).toBeCloseTo(1.3)
    expect(delta.vibration?.clipping0).toBe(5)
  })

  // --- EXTENDED_SYS_STATE (245) ---

  it('handles EXTENDED_SYS_STATE message', () => {
    vs.handleMessage(MSG_EXTENDED_SYS_STATE, { vtolState: 2, landedState: 1 })
    const delta = vs.getDelta()
    expect(delta.extendedState?.vtolState).toBe(2)
    expect(delta.extendedState?.landedState).toBe(1)
  })

  // --- MISSION_CURRENT (42) ---

  it('handles MISSION_CURRENT message', () => {
    vs.handleMessage(MSG_MISSION_CURRENT, { seq: 7 })
    const delta = vs.getDelta()
    expect(delta.missionStatus?.currentIndex).toBe(7)
  })

  // --- TERRAIN_REPORT (136) ---

  it('handles TERRAIN_REPORT message', () => {
    vs.handleMessage(MSG_TERRAIN_REPORT, { terrainHeight: 50, currentHeight: 45 })
    const delta = vs.getDelta()
    expect(delta.terrain?.terrainAltitude).toBe(50)
    expect(delta.terrain?.terrainValid).toBe(true)
    expect(delta.terrain?.distanceToGround).toBe(45)
  })

  it('TERRAIN_REPORT with zero terrainHeight marks invalid', () => {
    vs.handleMessage(MSG_TERRAIN_REPORT, { terrainHeight: 0, currentHeight: 10 })
    const delta = vs.getDelta()
    expect(delta.terrain?.terrainValid).toBe(false)
  })

  // --- CAMERA_* ---

  it('CAMERA_INFORMATION sets discovered + capability flags', () => {
    vs.handleMessage(MSG_CAMERA_INFORMATION, { flags: 3 }) // video|image
    const delta = vs.getDelta()
    expect(delta.camera?.discovered).toBe(true)
    expect(delta.camera?.hasCapVideo).toBe(true)
    expect(delta.camera?.hasCapImage).toBe(true)
  })

  it('CAMERA_SETTINGS updates mode', () => {
    vs.handleMessage(MSG_CAMERA_SETTINGS, { modeId: 1 })
    const delta = vs.getDelta()
    expect(delta.camera?.mode).toBe(1)
  })

  it('CAMERA_CAPTURE_STATUS reflects recording + image status', () => {
    vs.handleMessage(MSG_CAMERA_CAPTURE_STATUS, {
      imageStatus: 1,
      videoStatus: 1,
      imageCount: 12,
      recordingTimeMs: 5000,
      availableCapacity: 2048
    })
    const delta = vs.getDelta()
    expect(delta.camera?.isCapturingImage).toBe(true)
    expect(delta.camera?.isRecordingVideo).toBe(true)
    expect(delta.camera?.photoCount).toBe(12)
    expect(delta.camera?.videoRecordingTimeMs).toBe(5000)
    expect(delta.camera?.availableCapacityMib).toBe(2048)
  })
})
