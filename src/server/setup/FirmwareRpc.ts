import type { EventEmitter } from 'events'
import { firmwareModule } from '@shared/ipc/modules/firmware'
import type { FirmwareUpgradeState } from '@shared/ipc/SetupTypes'
import type { RpcRealtimeServer } from '../realtime/RpcRealtimeServer'

type FirmwareManagerLike = Pick<EventEmitter, 'on' | 'off'> & {
  uploadFile: (filePath: string) => Promise<void> | void
  uploadData: (fileName: string, content: Uint8Array) => Promise<void> | void
  cancel: () => void
  reboot: () => Promise<void> | void
}

type FirmwareVehicleLike = {
  sysid: number
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

type FirmwareVehicleManagerLike = Pick<EventEmitter, 'on' | 'off'> & {
  getVehicle: (vehicleId: number) => FirmwareVehicleLike | undefined
  getAllVehicles: () => FirmwareVehicleLike[]
}

export function registerFirmwareRpc(
  realtime: RpcRealtimeServer,
  vehicleManager: FirmwareVehicleManagerLike | null
): () => void {
  const getFirmwareManager = (vehicleId: number): FirmwareManagerLike | undefined =>
    vehicleManager?.getVehicle(vehicleId)?.firmwareManager

  realtime.registerModule(firmwareModule, {
    commands: {
      uploadFile: async (vehicleId, filePath) => {
        const firmwareManager = getFirmwareManager(vehicleId)
        if (!firmwareManager) throw new Error('No vehicle')
        await firmwareManager.uploadFile(filePath)
      },
      uploadData: async (vehicleId, fileName, dataBase64) => {
        const firmwareManager = getFirmwareManager(vehicleId)
        if (!firmwareManager) throw new Error('No vehicle')
        await firmwareManager.uploadData(fileName, Buffer.from(dataBase64, 'base64'))
      },
      cancel: async (vehicleId) => {
        getFirmwareManager(vehicleId)?.cancel()
      },
      reboot: async (vehicleId) => {
        const firmwareManager = getFirmwareManager(vehicleId)
        if (!firmwareManager) throw new Error('No vehicle')
        await firmwareManager.reboot()
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
  })

  if (!vehicleManager) return () => {}

  const listenerDisposers = new Map<number, () => void>()

  const attachListeners = (vehicleId: number): void => {
    if (listenerDisposers.has(vehicleId)) return
    const firmwareManager = vehicleManager.getVehicle(vehicleId)?.firmwareManager
    if (!firmwareManager) return

    const onStateChanged = (state: FirmwareUpgradeState): void => {
      realtime.emitEvent('firmware', 'upgradeStateChanged', { vehicleId, state })
    }

    firmwareManager.on('stateChanged', onStateChanged)
    listenerDisposers.set(vehicleId, () => {
      firmwareManager.off('stateChanged', onStateChanged)
    })
  }

  const detachListeners = (vehicleId: number): void => {
    listenerDisposers.get(vehicleId)?.()
    listenerDisposers.delete(vehicleId)
  }

  const onVehicleAdded = (vehicleId: number): void => attachListeners(vehicleId)
  const onVehicleRemoved = (vehicleId: number): void => detachListeners(vehicleId)

  vehicleManager.on('vehicleAdded', onVehicleAdded)
  vehicleManager.on('vehicleRemoved', onVehicleRemoved)
  for (const vehicle of vehicleManager.getAllVehicles()) {
    attachListeners(vehicle.sysid)
  }

  return () => {
    vehicleManager.off('vehicleAdded', onVehicleAdded)
    vehicleManager.off('vehicleRemoved', onVehicleRemoved)
    for (const dispose of listenerDisposers.values()) {
      dispose()
    }
    listenerDisposers.clear()
  }
}
