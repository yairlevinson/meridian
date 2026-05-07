import { SerialPort } from 'serialport'
import { settingsModule } from '@shared/ipc/modules/settings'
import { videoModule } from '@shared/ipc/modules/video'
import { linksModule } from '@shared/ipc/modules/links'
import { vehicleModule } from '@shared/ipc/modules/vehicle'
import type { AppSettings } from '@shared/ipc/AppSettings'
import { VideoSourceType } from '@shared/ipc/VideoTypes'
import type { SettingsManager } from '../../main/settings/SettingsManager'
import type { VideoManager } from '../../main/video/VideoManager'
import type { LinkManager } from '../../main/links/LinkManager'
import type { MavlinkForwarder } from '../../main/forwarding/MavlinkForwarder'
import type { TargetTrackingManager } from '../../main/tracking/TargetTrackingManager'
import type { VehicleManager } from '../../main/vehicle/VehicleManager'
import { VehicleTelemetryPublisher } from '../../main/vehicle/VehicleTelemetryPublisher'
import { registerCameraRpc } from '../camera/CameraRpc'
import { registerKmlRpc } from '../maps/KmlRpc'
import { registerMissionRpc } from '../mission/MissionRpc'
import { registerForwardingRpc, registerRadarRpc } from '../operations/OperationsRpc'
import type { RadarManagerLike } from '../operations/OperationsRpc'
import { registerParameterRpc } from '../parameters/ParameterRpc'
import { registerCalibrationRpc, registerRcCalibrationRpc } from '../setup/CalibrationRpc'
import { registerFirmwareRpc } from '../setup/FirmwareRpc'
import { registerMavInspectorRpc } from '../vehicle/MavInspectorRpc'
import { registerVehicleToolsRpc } from '../vehicle/VehicleToolsRpc'
import type { RpcRealtimeServer } from './RpcRealtimeServer'

export interface ServerModuleManagers {
  realtime: RpcRealtimeServer
  settingsManager: SettingsManager
  videoManager: VideoManager
  linkManager: LinkManager | null
  vehicleManager: VehicleManager | null
  trackingManager: TargetTrackingManager | null
  forwarder: MavlinkForwarder | null
  radarManager: RadarManagerLike | null
}

export function registerServerModules({
  realtime,
  settingsManager,
  videoManager,
  linkManager,
  vehicleManager,
  trackingManager,
  forwarder,
  radarManager
}: ServerModuleManagers): () => void {
  registerKmlRpc(realtime)

  realtime.registerModule(settingsModule, {
    commands: {
      getAll: async () => settingsManager.getAll(),
      set: async (key, value) => {
        settingsManager.set(key as keyof AppSettings, value as never)
      }
    }
  })

  const onSettingsChanged = (key: string, value: unknown): void => {
    realtime.emitEvent('settings', 'changed', { key, value })
  }
  settingsManager.on('changed', onSettingsChanged)

  realtime.registerModule(videoModule, {
    commands: {
      start: async (sourceType, uri) => {
        videoManager.start(sourceType as VideoSourceType, uri)
      },
      stop: async () => {
        videoManager.stop()
      },
      startRecording: async (fileName) => {
        return { filePath: videoManager.startRecording(fileName) }
      },
      stopRecording: async () => {
        videoManager.stopRecording()
      },
      getState: async () => videoManager.state
    }
  })

  const onVideoStateChanged = (state: unknown): void => {
    realtime.emitEvent('video', 'stateChanged', state)
  }
  videoManager.on('stateChanged', onVideoStateChanged)

  realtime.registerModule(linksModule, {
    commands: {
      create: async (config) => {
        if (!linkManager) throw new Error('LinkManager not available')
        const link = await linkManager.createLink(config)
        return { id: link.id, status: link.status }
      },
      disconnect: async (id) => {
        if (!linkManager) throw new Error('LinkManager not available')
        linkManager.disconnectLink(id)
      },
      getAll: async () => linkManager?.getAllStates() ?? [],
      listSerialPorts: async () => {
        const ports = await SerialPort.list()
        return ports.map((p) => ({
          path: p.path,
          manufacturer: p.manufacturer,
          serialNumber: p.serialNumber,
          vendorId: p.vendorId,
          productId: p.productId
        }))
      }
    }
  })

  const onLinkStateChanged = (): void => {
    realtime.emitEvent('links', 'stateChanged', linkManager?.getAllStates() ?? [])
  }
  linkManager?.on('linkStateChanged', onLinkStateChanged)

  const requireVehicleManager = (): NonNullable<typeof vehicleManager> => {
    if (!vehicleManager) throw new Error('VehicleManager not available')
    return vehicleManager
  }

  realtime.registerModule(vehicleModule, {
    commands: {
      arm: async (vehicleId) => {
        await requireVehicleManager().getVehicle(vehicleId)?.arm()
      },
      forceArm: async (vehicleId) => {
        await requireVehicleManager().getVehicle(vehicleId)?.forceArm()
      },
      disarm: async (vehicleId) => {
        await requireVehicleManager().getVehicle(vehicleId)?.disarm()
      },
      sendMavCommand: async (req) => {
        await requireVehicleManager()
          .getVehicle(req.vehicleId)
          ?.commandQueue.sendCommand(req.command, req.vehicleId, req.componentId, {
            p1: req.param1,
            p2: req.param2,
            p3: req.param3,
            p4: req.param4,
            p5: req.param5,
            p6: req.param6,
            p7: req.param7
          })
      },
      setFlightMode: async (vehicleId, modeName) =>
        requireVehicleManager().getVehicle(vehicleId)?.setFlightModeByName(modeName),
      guidedTakeoff: async (vehicleId, altitude) =>
        requireVehicleManager().getVehicle(vehicleId)?.guidedTakeoff(altitude),
      guidedRTL: async (vehicleId) => {
        await requireVehicleManager().getVehicle(vehicleId)?.guidedRTL()
      },
      guidedLand: async (vehicleId) => {
        await requireVehicleManager().getVehicle(vehicleId)?.guidedLand()
      },
      guidedGoto: async (vehicleId, lat, lon, alt) => {
        await requireVehicleManager().getVehicle(vehicleId)?.guidedGoto(lat, lon, alt)
      },
      guidedPause: async (vehicleId) => {
        await requireVehicleManager().getVehicle(vehicleId)?.guidedPause()
      },
      missionStart: async (vehicleId) => {
        await requireVehicleManager().getVehicle(vehicleId)?.missionStart()
      },
      emergencyStop: async (vehicleId) => {
        await requireVehicleManager().getVehicle(vehicleId)?.emergencyStop()
      },
      guidedChangeAltitude: async (vehicleId, altitudeRel) =>
        requireVehicleManager().getVehicle(vehicleId)?.guidedChangeAltitude(altitudeRel),
      guidedChangeHeading: async (vehicleId, headingDeg) =>
        requireVehicleManager().getVehicle(vehicleId)?.guidedChangeHeading(headingDeg),
      guidedChangeSpeed: async (vehicleId, speed, speedType) =>
        requireVehicleManager().getVehicle(vehicleId)?.guidedChangeSpeed(speed, speedType),
      guidedOrbit: async (vehicleId, lat, lon, radius, altitudeRel) =>
        requireVehicleManager().getVehicle(vehicleId)?.guidedOrbit(lat, lon, radius, altitudeRel),
      landingGearDeploy: async (vehicleId) =>
        requireVehicleManager().getVehicle(vehicleId)?.landingGearDeploy(),
      landingGearRetract: async (vehicleId) =>
        requireVehicleManager().getVehicle(vehicleId)?.landingGearRetract(),
      trackingEngage: async (vehicleId, trackId) => {
        if (!trackingManager) return { ok: false, error: 'Tracking manager not available' }
        return trackingManager.engage(vehicleId, trackId)
      },
      trackingDisengage: async (vehicleId) => {
        trackingManager?.disengage(vehicleId)
      },
      trackingGetEngagement: async (vehicleId) => trackingManager?.getEngagement(vehicleId) ?? null
    }
  })

  const disposers = [
    registerMissionRpc(realtime, vehicleManager),
    registerParameterRpc(realtime, vehicleManager),
    registerCameraRpc(realtime, vehicleManager),
    registerCalibrationRpc(realtime, vehicleManager),
    registerRcCalibrationRpc(realtime, vehicleManager),
    registerFirmwareRpc(realtime, vehicleManager),
    registerMavInspectorRpc(realtime, vehicleManager),
    registerVehicleToolsRpc(realtime, vehicleManager),
    registerForwardingRpc(realtime, forwarder),
    registerRadarRpc(realtime, radarManager)
  ]

  let vehicleTelemetryPublisher: VehicleTelemetryPublisher | null = null
  const vehicleStatusTextListeners = new Map<
    number,
    (payload: { severity: number; text: string }) => void
  >()
  const onVehicleAdded = (vehicleId: number): void => {
    realtime.emitEvent('vehicle', 'added', { vehicleId })
    const vehicle = vehicleManager?.getVehicle(vehicleId)
    if (!vehicle || vehicleStatusTextListeners.has(vehicleId)) return
    const onStatusText = (payload: { severity: number; text: string }): void => {
      realtime.emitEvent('vehicle', 'statusText', { vehicleId, ...payload })
    }
    vehicleStatusTextListeners.set(vehicleId, onStatusText)
    vehicle.on('statusText', onStatusText)
  }
  const onVehicleRemoved = (vehicleId: number): void => {
    realtime.emitEvent('vehicle', 'removed', { vehicleId })
    const listener = vehicleStatusTextListeners.get(vehicleId)
    const vehicle = vehicleManager?.getVehicle(vehicleId)
    if (listener && vehicle) vehicle.removeListener('statusText', listener)
    vehicleStatusTextListeners.delete(vehicleId)
  }
  if (vehicleManager) {
    vehicleManager.on('vehicleAdded', onVehicleAdded)
    vehicleManager.on('vehicleRemoved', onVehicleRemoved)
    vehicleTelemetryPublisher = new VehicleTelemetryPublisher(vehicleManager)
    vehicleTelemetryPublisher.on('delta', (payload) => {
      realtime.emitEvent('vehicle', 'delta', payload)
    })
    for (const vehicle of vehicleManager.getAllVehicles()) {
      onVehicleAdded(vehicle.sysid)
    }
  }

  return () => {
    settingsManager.removeListener('changed', onSettingsChanged)
    videoManager.removeListener('stateChanged', onVideoStateChanged)
    linkManager?.removeListener('linkStateChanged', onLinkStateChanged)
    for (const dispose of disposers) dispose()
    vehicleManager?.removeListener('vehicleAdded', onVehicleAdded)
    vehicleManager?.removeListener('vehicleRemoved', onVehicleRemoved)
    for (const [vehicleId, listener] of vehicleStatusTextListeners) {
      vehicleManager?.getVehicle(vehicleId)?.removeListener('statusText', listener)
    }
    vehicleStatusTextListeners.clear()
    vehicleTelemetryPublisher?.dispose()
  }
}
