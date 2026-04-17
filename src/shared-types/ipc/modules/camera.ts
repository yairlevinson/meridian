import { command, event, defineIpcModule } from '../ipcModule'
import type { CameraState } from '../CameraTypes'

export interface CameraImageCapturedPayload {
  vehicleId: number
  lat: number
  lon: number
  alt: number
  imageIndex: number
  captureResult: number
}

export const cameraModule = defineIpcModule({
  name: 'camera',
  commands: {
    requestInfo: command<[vehicleId: number], void>(),
    takePhoto: command<[vehicleId: number], void>(),
    stopCapture: command<[vehicleId: number], void>(),
    startRecording: command<[vehicleId: number], void>(),
    stopRecording: command<[vehicleId: number], void>(),
    setMode: command<[vehicleId: number, mode: number], void>(),
    formatStorage: command<[vehicleId: number, storageId?: number], void>(),
    getState: command<[vehicleId: number], CameraState | null>()
  },
  events: {
    stateChanged: event<{ vehicleId: number; state: CameraState }>(),
    imageCaptured: event<CameraImageCapturedPayload>()
  }
})

export type CameraModule = typeof cameraModule
