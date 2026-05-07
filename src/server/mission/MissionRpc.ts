import type { EventEmitter } from 'events'
import { missionModule } from '@shared/ipc/modules/mission'
import type { MissionItem } from '@shared/ipc/MissionTypes'
import { createMissionCommandHandlers } from '../../core/mission/MissionCommandHandlers'
import type { RpcRealtimeServer } from '../realtime/RpcRealtimeServer'
import { registerVehicleScopedListeners } from '../realtime/vehicleScopedListeners'

type MissionManagerLike = Pick<EventEmitter, 'on' | 'off' | 'once'> & {
  loadFromVehicle: () => void
  writeToVehicle: (items: MissionItem[]) => void
}

type MissionVehicleLike = {
  sysid: number
  missionManager?: MissionManagerLike
}

type MissionVehicleManagerLike = Pick<EventEmitter, 'on' | 'off'> & {
  getVehicle: (vehicleId: number) => MissionVehicleLike | undefined
  getAllVehicles: () => MissionVehicleLike[]
}

export function registerMissionRpc(
  realtime: RpcRealtimeServer,
  vehicleManager: MissionVehicleManagerLike | null
): () => void {
  realtime.registerModule(missionModule, {
    commands: createMissionCommandHandlers(vehicleManager, {
      savePlan: async () => {
        throw new Error('Plan file dialogs are not available in browser server mode')
      },
      openPlan: async () => {
        throw new Error('Plan file dialogs are not available in browser server mode')
      }
    })
  })

  if (!vehicleManager) return () => {}

  return registerVehicleScopedListeners(vehicleManager, (vehicleId) => {
    const missionManager = vehicleManager.getVehicle(vehicleId)?.missionManager
    if (!missionManager) return null

    const onProgress = (payload: { current: number; total: number }): void => {
      realtime.emitEvent('mission', 'progress', { vehicleId, ...payload })
    }
    const onComplete = (items: MissionItem[]): void => {
      realtime.emitEvent('mission', 'complete', { vehicleId, items })
    }
    const onCurrentChanged = (seq: number): void => {
      realtime.emitEvent('mission', 'currentChanged', { vehicleId, seq })
    }

    missionManager.on('progress', onProgress)
    missionManager.on('loadComplete', onComplete)
    missionManager.on('currentChanged', onCurrentChanged)
    return () => {
      missionManager.off('progress', onProgress)
      missionManager.off('loadComplete', onComplete)
      missionManager.off('currentChanged', onCurrentChanged)
    }
  })
}
