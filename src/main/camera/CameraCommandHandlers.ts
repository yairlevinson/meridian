import type { RpcCommandImpls } from '@shared/rpc'
import type { CameraModule } from '@shared/ipc/modules/camera'
import type { CameraState } from '@shared/ipc/CameraTypes'

type CameraManagerLike = {
  handleCameraHeartbeat: () => void
  takePhoto: () => void
  stopCapture: () => void
  startRecording: () => void
  stopRecording: () => void
  setMode: (mode: number) => void
  formatStorage: (storageId?: number) => void
  state: CameraState
}

type CameraVehicleManagerLike = {
  getVehicle: (vehicleId: number) => { cameraManager?: CameraManagerLike } | undefined
}

export function createCameraCommandHandlers(
  vehicleManager: CameraVehicleManagerLike | null
): RpcCommandImpls<CameraModule> {
  const getCameraManager = (vehicleId: number) =>
    vehicleManager?.getVehicle(vehicleId)?.cameraManager

  return {
    requestInfo: async (vehicleId) => {
      getCameraManager(vehicleId)?.handleCameraHeartbeat()
    },
    takePhoto: async (vehicleId) => {
      getCameraManager(vehicleId)?.takePhoto()
    },
    stopCapture: async (vehicleId) => {
      getCameraManager(vehicleId)?.stopCapture()
    },
    startRecording: async (vehicleId) => {
      getCameraManager(vehicleId)?.startRecording()
    },
    stopRecording: async (vehicleId) => {
      getCameraManager(vehicleId)?.stopRecording()
    },
    setMode: async (vehicleId, mode) => {
      getCameraManager(vehicleId)?.setMode(mode)
    },
    formatStorage: async (vehicleId, storageId) => {
      getCameraManager(vehicleId)?.formatStorage(storageId)
    },
    getState: async (vehicleId) => getCameraManager(vehicleId)?.state ?? null
  }
}
