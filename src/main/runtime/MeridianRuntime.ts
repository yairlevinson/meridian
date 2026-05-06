import { join } from 'path'
import { MavLinkProtocolV2 } from 'node-mavlink'
import { common, minimal } from 'mavlink-mappings'
import { LinkType, type TcpLinkConfig } from '@shared/ipc/LinkState'
import type { StreamRequest } from '@shared/ipc/geo'
import { GCS_COMPID, GCS_SYSID } from '../mavlink/constants'
import { VideoManager } from '../video/VideoManager'
import { SettingsManager } from '../settings/SettingsManager'
import { VehicleManager } from '../vehicle/VehicleManager'
import { LinkManager } from '../links/LinkManager'
import { MavlinkProtocol } from '../mavlink/MavlinkProtocol'
import { UdpLink } from '../links/UdpLink'
import { MavlinkForwarder } from '../forwarding/MavlinkForwarder'
import { RadarProxy } from '../radar/RadarProxy'
import { TargetTrackingManager } from '../tracking/TargetTrackingManager'
import { UtilityBridge } from '../utility/UtilityBridge'
import { createLogger } from '../logger'

const log = createLogger('runtime')

// MAV_DATA_STREAM IDs used by ArduPilot
const MAV_DATA_STREAM_POSITION = 6 // GLOBAL_POSITION_INT
const MAV_DATA_STREAM_EXTRA1 = 10 // ATTITUDE
const MAV_DATA_STREAM_EXTRA2 = 11 // VFR_HUD
const PX4_SITL_PORT = 18570

export interface MeridianRuntimeOptions {
  userDataPath: string
  udpPort: number
  tcpLinks?: string
}

export interface MeridianRuntime {
  utilityBridge: UtilityBridge
  videoManager: VideoManager
  settingsManager: SettingsManager
  vehicleManager: VehicleManager
  mavlinkProtocol: MavlinkProtocol
  linkManager: LinkManager
  forwarder: MavlinkForwarder
  radarManager: RadarProxy
  trackingManager: TargetTrackingManager
  dispose: () => void
}

function requestStreams(writeFn: (buf: Buffer) => void, targetSysId: number, label?: string): void {
  const proto = new MavLinkProtocolV2(GCS_SYSID, GCS_COMPID)
  let seq = 0

  // ArduPilot: REQUEST_DATA_STREAM
  const streams: StreamRequest[] = [
    { id: MAV_DATA_STREAM_POSITION, rate: 4 },
    { id: MAV_DATA_STREAM_EXTRA1, rate: 10 },
    { id: MAV_DATA_STREAM_EXTRA2, rate: 4 }
  ]

  for (const { id, rate } of streams) {
    const req = new common.RequestDataStream()
    req.targetSystem = targetSysId
    req.targetComponent = 0
    req.reqStreamId = id
    req.reqMessageRate = rate
    req.startStop = 1

    writeFn(proto.serialize(req, seq++ & 0xff))
    log.log(
      `requested stream id=${id} at ${rate}Hz for sysid=${targetSysId}${label ? ` on ${label}` : ''}`
    )
  }

  // PX4: MAV_CMD_SET_MESSAGE_INTERVAL via COMMAND_LONG
  // PX4 ignores REQUEST_DATA_STREAM — it uses COMMAND_LONG to set message intervals
  const px4Messages = [
    { msgId: common.GlobalPositionInt.MSG_ID, rate: 4 },
    { msgId: common.Attitude.MSG_ID, rate: 10 },
    { msgId: common.AttitudeQuaternion.MSG_ID, rate: 10 }, // PX4 SIH sends this instead of ATTITUDE
    { msgId: common.LocalPositionNed.MSG_ID, rate: 4 }, // fallback when no GLOBAL_POSITION_INT
    { msgId: common.VfrHud.MSG_ID, rate: 4 },
    { msgId: common.SysStatus.MSG_ID, rate: 2 },
    { msgId: common.GpsRawInt.MSG_ID, rate: 2 },
    { msgId: common.HomePosition.MSG_ID, rate: 0.2 },
    { msgId: minimal.Heartbeat.MSG_ID, rate: 1 }
  ]

  for (const { msgId, rate } of px4Messages) {
    const cmd = new common.CommandLong()
    cmd.targetSystem = targetSysId
    cmd.targetComponent = 0
    cmd.command = common.MavCmd.SET_MESSAGE_INTERVAL
    cmd.confirmation = 0
    cmd._param1 = msgId
    cmd._param2 = Math.round(1_000_000 / rate) // interval in microseconds
    cmd._param3 = 0
    cmd._param4 = 0
    cmd._param5 = 0
    cmd._param6 = 0
    cmd._param7 = 0

    writeFn(proto.serialize(cmd, seq++ & 0xff))
  }
  log.log(`requested PX4 message intervals for sysid=${targetSysId}${label ? ` on ${label}` : ''}`)

  // Request HOME_POSITION once (works on both ArduPilot and PX4)
  const reqHome = new common.CommandLong()
  reqHome.targetSystem = targetSysId
  reqHome.targetComponent = 0
  reqHome.command = common.MavCmd.REQUEST_MESSAGE
  reqHome.confirmation = 0
  reqHome._param1 = common.HomePosition.MSG_ID
  reqHome._param2 = 0
  reqHome._param3 = 0
  reqHome._param4 = 0
  reqHome._param5 = 0
  reqHome._param6 = 0
  reqHome._param7 = 0
  writeFn(proto.serialize(reqHome, seq++ & 0xff))
}

function writeToAllLinks(lm: LinkManager, buf: Buffer): void {
  for (const state of lm.getAllStates()) {
    const link = lm.getLink(state.id)
    if (link?.isConnected) {
      try {
        link.writeBytes(buf)
      } catch {
        /* link closed */
      }
    }
  }
}

function parseTcpTargets(tcpLinks = ''): string[] {
  return tcpLinks
    ? tcpLinks
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : []
}

export async function createMeridianRuntime(
  options: MeridianRuntimeOptions
): Promise<MeridianRuntime> {
  // --- Utility process (hosts the radar simulator, eventually the MAVLink stack) ---
  const utilityBridge = new UtilityBridge()
  utilityBridge.start()

  // --- Video streaming ---
  const videoManager = new VideoManager()
  await videoManager.init()

  // --- MAVLink stack ---
  const settingsManager = new SettingsManager({
    filePath: join(options.userDataPath, 'settings.json')
  })
  const vehicleManager = new VehicleManager()
  const mavlinkProtocol = new MavlinkProtocol()
  const linkManager = new LinkManager(mavlinkProtocol)

  // Track which link a vehicle came from. Must populate BEFORE routing to
  // VehicleManager: VehicleManager.handleMessage emits `vehicleAdded`
  // synchronously on the first heartbeat, and the `vehicleAdded` handler
  // reads this map to pick the vehicle's link. In TCP mode rootUdpLink is
  // null, so the fallback would leave commandQueue.link unset and every
  // subsequent command would fail with "No link available".
  const vehicleToLink = new Map<number, string>()
  linkManager.on('message', (msg, link) => {
    if (!vehicleToLink.has(msg.sysid)) {
      vehicleToLink.set(msg.sysid, link.id)
    }
  })

  // Route all decoded messages to the VehicleManager
  linkManager.on('message', (msg, link) => {
    vehicleManager.handleMessage(msg, link.id)
  })

  // --- Mode-specific link creation ---
  let rootUdpLink: UdpLink | null = null
  const tcpTargets = parseTcpTargets(options.tcpLinks)

  if (tcpTargets.length > 0) {
    // TCP mode: connect to multiple SITL instances
    for (const target of tcpTargets) {
      const parts = target.split(':')
      const host = parts[0] ?? '127.0.0.1'
      const port = parseInt(parts[1] ?? '5760', 10)
      const config: TcpLinkConfig = {
        type: LinkType.TCP,
        name: `SITL ${host}:${port}`,
        host,
        port
      }
      try {
        const link = await linkManager.createLink(config)
        log.log(`TCP link connected: ${link.id} → ${host}:${port}`)
      } catch (err) {
        log.warn(`Failed to connect TCP ${host}:${port}:`, err)
      }
    }
    log.log(`Connected ${linkManager.getAllStates().length} TCP links`)
  } else {
    // UDP mode: listen for incoming MAVLink
    rootUdpLink = (await linkManager.createLink({
      type: LinkType.UDP,
      name: 'Root UDP',
      listenPort: options.udpPort
    })) as UdpLink
    rootUdpLink.unref()
    log.log(`Listening for MAVLink on UDP port ${options.udpPort}`)
  }

  // When a vehicle is discovered, assign its link and request data streams
  const streamRequestedFor = new Set<number>()
  vehicleManager.on('vehicleAdded', (sysid: number) => {
    log.log(`Vehicle added: sysid=${sysid}`)
    const linkId = vehicleToLink.get(sysid)
    const managedLink = linkId ? linkManager.getLink(linkId) : undefined
    const link = managedLink ?? rootUdpLink
    if (link) {
      vehicleManager.getVehicle(sysid)?.addLink(link)
      if (!streamRequestedFor.has(sysid)) {
        streamRequestedFor.add(sysid)
        requestStreams((buf) => link.writeBytes(buf), sysid, linkId)
      }
    }
  })

  // --- MAVLink forwarding ---
  const forwarder = new MavlinkForwarder(settingsManager, options.udpPort)
  forwarder.attachLinkManager(linkManager)
  forwarder.setVehicleWriteFn((buf) => writeToAllLinks(linkManager, buf))

  // --- Radar (runs in utility process) ---
  const radarManager = new RadarProxy(utilityBridge, settingsManager)

  // --- Target tracking ---
  const trackingManager = new TargetTrackingManager(vehicleManager, radarManager, settingsManager)

  // Auto-detect USB autopilot boards and connect via serial
  linkManager.startAutoConnect()

  // Send GCS heartbeats at 1Hz on all links.
  // PX4's TCP bridge (mavlink-routerd) and PX4 SITL require GCS heartbeats
  // before they start relaying vehicle data to the client.
  const gcsProto = new MavLinkProtocolV2(GCS_SYSID, GCS_COMPID)
  let gcsSeq = 0
  const heartbeatInterval = setInterval(() => {
    const hb = new minimal.Heartbeat()
    hb.type = minimal.MavType.GCS
    hb.autopilot = minimal.MavAutopilot.INVALID
    hb.baseMode = 0 as minimal.MavModeFlag
    hb.customMode = 0
    hb.systemStatus = minimal.MavState.ACTIVE
    hb.mavlinkVersion = 3
    const buf = gcsProto.serialize(hb, gcsSeq++ & 0xff)
    // In UDP mode, also send to PX4 SITL's default MAVLink port
    if (rootUdpLink) {
      rootUdpLink.sendTo(buf, PX4_SITL_PORT, '127.0.0.1')
    }
    // Send on all managed links
    writeToAllLinks(linkManager, buf)
  }, 1000)

  return {
    utilityBridge,
    videoManager,
    settingsManager,
    vehicleManager,
    mavlinkProtocol,
    linkManager,
    forwarder,
    radarManager,
    trackingManager,
    dispose: () => {
      settingsManager.flush()
      clearInterval(heartbeatInterval)
      trackingManager.destroy()
      radarManager.destroy()
      forwarder.destroy()
      vehicleManager.destroy()
      linkManager.disconnectAll()
      mavlinkProtocol.destroy()
      videoManager.destroy()
      void utilityBridge.stop()
    }
  }
}
