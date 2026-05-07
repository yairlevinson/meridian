import type { EventEmitter } from 'events'
import { firmwareModule } from '@shared/ipc/modules/firmware'
import type { FirmwareUpgradeState } from '@shared/ipc/SetupTypes'
import { createFirmwareCommandHandlers } from '../../core/firmware/FirmwareCommandHandlers'
import type { RpcRealtimeServer } from '../realtime/RpcRealtimeServer'
import { registerVehicleScopedListeners } from '../realtime/vehicleScopedListeners'

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
  realtime.registerModule(firmwareModule, {
    commands: createFirmwareCommandHandlers(vehicleManager)
  })

  if (!vehicleManager) return () => {}

  return registerVehicleScopedListeners(vehicleManager, (vehicleId) => {
    const firmwareManager = vehicleManager.getVehicle(vehicleId)?.firmwareManager
    if (!firmwareManager) return null

    const onStateChanged = (state: FirmwareUpgradeState): void => {
      realtime.emitEvent('firmware', 'upgradeStateChanged', { vehicleId, state })
    }

    firmwareManager.on('stateChanged', onStateChanged)
    return () => {
      firmwareManager.off('stateChanged', onStateChanged)
    }
  })
}
