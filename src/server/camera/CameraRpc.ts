import type { EventEmitter } from 'events'
import { cameraModule, type CameraImageCapturedPayload } from '@shared/ipc/modules/camera'
import type { CameraState } from '@shared/ipc/CameraTypes'
import { createCameraCommandHandlers } from '../../main/camera/CameraCommandHandlers'
import type { RpcRealtimeServer } from '../realtime/RpcRealtimeServer'

type CameraManagerLike = Pick<EventEmitter, 'on' | 'off'> & {
  handleCameraHeartbeat: () => void
  takePhoto: () => void
  stopCapture: () => void
  startRecording: () => void
  stopRecording: () => void
  setMode: (mode: number) => void
  formatStorage: (storageId?: number) => void
  state: CameraState
}

type CameraVehicleLike = {
  sysid: number
  cameraManager?: CameraManagerLike
}

type CameraVehicleManagerLike = Pick<EventEmitter, 'on' | 'off'> & {
  getVehicle: (vehicleId: number) => CameraVehicleLike | undefined
  getAllVehicles: () => CameraVehicleLike[]
}

export function registerCameraRpc(
  realtime: RpcRealtimeServer,
  vehicleManager: CameraVehicleManagerLike | null
): () => void {
  realtime.registerModule(cameraModule, {
    commands: createCameraCommandHandlers(vehicleManager)
  })

  if (!vehicleManager) return () => {}

  const cameraListenerDisposers = new Map<number, () => void>()

  const attachCameraListeners = (vehicleId: number): void => {
    if (cameraListenerDisposers.has(vehicleId)) return
    const cameraManager = vehicleManager.getVehicle(vehicleId)?.cameraManager
    if (!cameraManager) return

    const onStateChanged = (state: CameraState): void => {
      realtime.emitEvent('camera', 'stateChanged', { vehicleId, state })
    }
    const onImageCaptured = (payload: Omit<CameraImageCapturedPayload, 'vehicleId'>): void => {
      realtime.emitEvent('camera', 'imageCaptured', { vehicleId, ...payload })
    }

    cameraManager.on('stateChanged', onStateChanged)
    cameraManager.on('imageCaptured', onImageCaptured)
    cameraListenerDisposers.set(vehicleId, () => {
      cameraManager.off('stateChanged', onStateChanged)
      cameraManager.off('imageCaptured', onImageCaptured)
    })
  }

  const detachCameraListeners = (vehicleId: number): void => {
    cameraListenerDisposers.get(vehicleId)?.()
    cameraListenerDisposers.delete(vehicleId)
  }

  const onVehicleAdded = (vehicleId: number): void => {
    attachCameraListeners(vehicleId)
  }
  const onVehicleRemoved = (vehicleId: number): void => {
    detachCameraListeners(vehicleId)
  }

  vehicleManager.on('vehicleAdded', onVehicleAdded)
  vehicleManager.on('vehicleRemoved', onVehicleRemoved)
  for (const vehicle of vehicleManager.getAllVehicles()) {
    attachCameraListeners(vehicle.sysid)
  }

  return () => {
    vehicleManager.off('vehicleAdded', onVehicleAdded)
    vehicleManager.off('vehicleRemoved', onVehicleRemoved)
    for (const dispose of cameraListenerDisposers.values()) {
      dispose()
    }
    cameraListenerDisposers.clear()
  }
}
