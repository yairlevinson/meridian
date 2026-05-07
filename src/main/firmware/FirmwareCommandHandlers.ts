import type { RpcCommandImpls } from '@shared/rpc'
import type { FirmwareModule } from '@shared/ipc/modules/firmware'

type FirmwareManagerLike = {
  uploadFile: (filePath: string) => Promise<void> | void
  uploadData: (fileName: string, content: Uint8Array) => Promise<void> | void
  cancel: () => void
  reboot: () => Promise<void> | void
}

type FirmwareVehicleManagerLike = {
  getVehicle: (vehicleId: number) =>
    | {
        firmwareManager?: FirmwareManagerLike
        state?: {
          getDelta: () => {
            core?: {
              firmwareVersionMajor?: number
              firmwareVersionMinor?: number
              firmwareVersionPatch?: number
              vehicleType?: number
              autopilot?: number
            }
          }
        }
      }
    | undefined
}

export function createFirmwareCommandHandlers(
  vehicleManager: FirmwareVehicleManagerLike | null
): RpcCommandImpls<FirmwareModule> {
  const requireFirmwareManager = (vehicleId: number) => {
    const firmwareManager = vehicleManager?.getVehicle(vehicleId)?.firmwareManager
    if (!firmwareManager) throw new Error('No vehicle')
    return firmwareManager
  }

  return {
    uploadFile: async (vehicleId, filePath) => {
      await requireFirmwareManager(vehicleId).uploadFile(filePath)
    },
    uploadData: async (vehicleId, fileName, dataBase64) => {
      await requireFirmwareManager(vehicleId).uploadData(
        fileName,
        Buffer.from(dataBase64, 'base64')
      )
    },
    cancel: async (vehicleId) => {
      vehicleManager?.getVehicle(vehicleId)?.firmwareManager?.cancel()
    },
    reboot: async (vehicleId) => {
      await requireFirmwareManager(vehicleId).reboot()
    },
    getBoardInfo: async (vehicleId) => {
      const core = vehicleManager?.getVehicle(vehicleId)?.state?.getDelta().core
      return core
        ? {
            firmwareVersionMajor: core.firmwareVersionMajor,
            firmwareVersionMinor: core.firmwareVersionMinor,
            firmwareVersionPatch: core.firmwareVersionPatch,
            vehicleType: core.vehicleType,
            autopilot: core.autopilot
          }
        : null
    }
  }
}
