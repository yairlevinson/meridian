import { join } from 'path'
import { homedir } from 'os'
import { MavLinkProtocolV2 } from 'node-mavlink'
import { common, minimal } from 'mavlink-mappings'
import { LinkType, type TcpLinkConfig } from '@shared/ipc/LinkState'
import type { StreamRequest } from '@shared/ipc/geo'
import { GCS_COMPID, GCS_SYSID } from '../../main/mavlink/constants'
import { MavlinkForwarder } from '../../main/forwarding/MavlinkForwarder'
import { LinkManager } from '../../main/links/LinkManager'
import { UdpLink } from '../../main/links/UdpLink'
import { createLogger } from '../../main/logger'
import { MavlinkProtocol } from '../../main/mavlink/MavlinkProtocol'
import { SettingsManager } from '../../main/settings/SettingsManager'
import { TargetTrackingManager } from '../../main/tracking/TargetTrackingManager'
import { VehicleManager } from '../../main/vehicle/VehicleManager'
import { VideoManager } from '../../main/video/VideoManager'
import { ServerRadarManager } from '../operations/ServerRadarManager'

const log = createLogger('server-runtime')

const MAV_DATA_STREAM_POSITION = 6
const MAV_DATA_STREAM_EXTRA1 = 10
const MAV_DATA_STREAM_EXTRA2 = 11
const PX4_SITL_PORT = 18570

export interface ServerRuntimeOptions {
  userDataPath?: string
  udpPort?: number
  tcpLinks?: string
}

export interface ServerRuntime {
  settingsManager: SettingsManager
  videoManager: VideoManager
  vehicleManager: VehicleManager
  mavlinkProtocol: MavlinkProtocol
  linkManager: LinkManager
  forwarder: MavlinkForwarder
  radarManager: ServerRadarManager
  trackingManager: TargetTrackingManager
  dispose: () => void
}

function requestStreams(writeFn: (buf: Buffer) => void, targetSysId: number, label?: string): void {
  const proto = new MavLinkProtocolV2(GCS_SYSID, GCS_COMPID)
  let seq = 0

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

  const px4Messages = [
    { msgId: common.GlobalPositionInt.MSG_ID, rate: 4 },
    { msgId: common.Attitude.MSG_ID, rate: 10 },
    { msgId: common.AttitudeQuaternion.MSG_ID, rate: 10 },
    { msgId: common.LocalPositionNed.MSG_ID, rate: 4 },
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
    cmd._param2 = Math.round(1_000_000 / rate)
    cmd._param3 = 0
    cmd._param4 = 0
    cmd._param5 = 0
    cmd._param6 = 0
    cmd._param7 = 0

    writeFn(proto.serialize(cmd, seq++ & 0xff))
  }
  log.log(`requested PX4 message intervals for sysid=${targetSysId}${label ? ` on ${label}` : ''}`)

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

function writeToAllLinks(linkManager: LinkManager, buf: Buffer): void {
  for (const state of linkManager.getAllStates()) {
    const link = linkManager.getLink(state.id)
    if (!link?.isConnected) continue
    try {
      link.writeBytes(buf)
    } catch {
      // link closed
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

export async function createServerRuntime(
  options: ServerRuntimeOptions = {}
): Promise<ServerRuntime> {
  const udpPort = options.udpPort ?? 14550
  const userDataPath = options.userDataPath ?? join(homedir(), '.meridian')

  const settingsManager = new SettingsManager({
    filePath: join(userDataPath, 'settings.json')
  })
  const videoManager = new VideoManager()
  videoManager.setRecordingDirectory(join(userDataPath, 'recordings'))
  await videoManager.init()

  const vehicleManager = new VehicleManager()
  const mavlinkProtocol = new MavlinkProtocol()
  const linkManager = new LinkManager(mavlinkProtocol)

  const vehicleToLink = new Map<number, string>()
  linkManager.on('message', (msg, link) => {
    if (!vehicleToLink.has(msg.sysid)) vehicleToLink.set(msg.sysid, link.id)
  })

  linkManager.on('message', (msg, link) => {
    vehicleManager.handleMessage(msg, link.id)
  })

  let rootUdpLink: UdpLink | null = null
  const tcpTargets = parseTcpTargets(options.tcpLinks)

  if (tcpTargets.length > 0) {
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
        log.log(`TCP link connected: ${link.id} -> ${host}:${port}`)
      } catch (err) {
        log.warn(`Failed to connect TCP ${host}:${port}:`, err)
      }
    }
    log.log(`Connected ${linkManager.getAllStates().length} TCP links`)
  } else {
    rootUdpLink = (await linkManager.createLink({
      type: LinkType.UDP,
      name: 'Root UDP',
      listenPort: udpPort
    })) as UdpLink
    rootUdpLink.unref()
    log.log(`Listening for MAVLink on UDP port ${udpPort}`)
  }

  const streamRequestedFor = new Set<number>()
  vehicleManager.on('vehicleAdded', (sysid: number) => {
    log.log(`Vehicle added: sysid=${sysid}`)
    const linkId = vehicleToLink.get(sysid)
    const managedLink = linkId ? linkManager.getLink(linkId) : undefined
    const link = managedLink ?? rootUdpLink
    if (!link) return
    vehicleManager.getVehicle(sysid)?.addLink(link)
    linkManager.associateVehicle(link.id, sysid)
    if (streamRequestedFor.has(sysid)) return
    streamRequestedFor.add(sysid)
    requestStreams((buf) => link.writeBytes(buf), sysid, linkId)
  })

  const forwarder = new MavlinkForwarder(settingsManager, udpPort)
  forwarder.attachLinkManager(linkManager)
  forwarder.setVehicleWriteFn((buf) => writeToAllLinks(linkManager, buf))

  const radarManager = new ServerRadarManager(settingsManager)
  const trackingManager = new TargetTrackingManager(vehicleManager, radarManager, settingsManager)

  linkManager.startAutoConnect()

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
    rootUdpLink?.sendTo(buf, PX4_SITL_PORT, '127.0.0.1')
    writeToAllLinks(linkManager, buf)
  }, 1000)

  return {
    settingsManager,
    videoManager,
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
    }
  }
}
