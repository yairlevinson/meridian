import type { EventEmitter } from 'events'
import { cameraModule, type CameraImageCapturedPayload } from '@shared/ipc/modules/camera'
import type { CameraState } from '@shared/ipc/CameraTypes'
import { createCameraCommandHandlers } from '../../core/camera/CameraCommandHandlers'
import type { RpcRealtimeServer } from '../realtime/RpcRealtimeServer'
import { registerVehicleScopedListeners } from '../realtime/vehicleScopedListeners'

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

  return registerVehicleScopedListeners(vehicleManager, (vehicleId) => {
    const cameraManager = vehicleManager.getVehicle(vehicleId)?.cameraManager
    if (!cameraManager) return null

    const onStateChanged = (state: CameraState): void => {
      realtime.emitEvent('camera', 'stateChanged', { vehicleId, state })
    }
    const onImageCaptured = (payload: Omit<CameraImageCapturedPayload, 'vehicleId'>): void => {
      realtime.emitEvent('camera', 'imageCaptured', { vehicleId, ...payload })
    }

    cameraManager.on('stateChanged', onStateChanged)
    cameraManager.on('imageCaptured', onImageCaptured)
    return () => {
      cameraManager.off('stateChanged', onStateChanged)
      cameraManager.off('imageCaptured', onImageCaptured)
    }
  })
}
