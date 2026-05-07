import { settingsModule } from '@shared/ipc/modules/settings'
import { videoModule } from '@shared/ipc/modules/video'
import { linksModule } from '@shared/ipc/modules/links'
import { vehicleModule } from '@shared/ipc/modules/vehicle'
import type { SettingsManager } from '../../main/settings/SettingsManager'
import type { VideoManager } from '../../main/video/VideoManager'
import type { LinkManager } from '../../main/links/LinkManager'
import type { MavlinkForwarder } from '../../main/forwarding/MavlinkForwarder'
import type { TargetTrackingManager } from '../../main/tracking/TargetTrackingManager'
import type { VehicleManager } from '../../main/vehicle/VehicleManager'
import { createVehicleCommandHandlers } from '../../core/vehicle/VehicleCommandHandlers'
import { createSettingsCommandHandlers } from '../../core/settings/SettingsCommandHandlers'
import { createVideoCommandHandlers } from '../../core/video/VideoCommandHandlers'
import { createLinksCommandHandlers } from '../../core/links/LinksCommandHandlers'
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
    commands: createSettingsCommandHandlers(settingsManager)
  })

  const onSettingsChanged = (key: string, value: unknown): void => {
    realtime.emitEvent('settings', 'changed', { key, value })
  }
  settingsManager.on('changed', onSettingsChanged)

  realtime.registerModule(videoModule, {
    commands: createVideoCommandHandlers(videoManager)
  })

  const onVideoStateChanged = (state: unknown): void => {
    realtime.emitEvent('video', 'stateChanged', state)
  }
  videoManager.on('stateChanged', onVideoStateChanged)

  realtime.registerModule(linksModule, {
    commands: createLinksCommandHandlers(linkManager)
  })

  const onLinkStateChanged = (): void => {
    realtime.emitEvent('links', 'stateChanged', linkManager?.getAllStates() ?? [])
  }
  linkManager?.on('linkStateChanged', onLinkStateChanged)

  realtime.registerModule(vehicleModule, {
    commands: createVehicleCommandHandlers(vehicleManager, trackingManager)
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
  const vehicleStatusTextDisposers = new Map<number, () => void>()
  const onVehicleAdded = (vehicleId: number): void => {
    realtime.emitEvent('vehicle', 'added', { vehicleId })
    const vehicle = vehicleManager?.getVehicle(vehicleId)
    if (!vehicle || vehicleStatusTextDisposers.has(vehicleId)) return
    const onStatusText = (payload: { severity: number; text: string }): void => {
      realtime.emitEvent('vehicle', 'statusText', { vehicleId, ...payload })
    }
    vehicle.on('statusText', onStatusText)
    vehicleStatusTextDisposers.set(vehicleId, () => {
      vehicle.removeListener('statusText', onStatusText)
    })
  }
  const onVehicleRemoved = (vehicleId: number): void => {
    realtime.emitEvent('vehicle', 'removed', { vehicleId })
    vehicleStatusTextDisposers.get(vehicleId)?.()
    vehicleStatusTextDisposers.delete(vehicleId)
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
    for (const dispose of vehicleStatusTextDisposers.values()) dispose()
    vehicleStatusTextDisposers.clear()
    vehicleTelemetryPublisher?.dispose()
  }
}
