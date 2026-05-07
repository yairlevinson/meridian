import type { EventEmitter } from 'events'
import { missionModule } from '@shared/ipc/modules/mission'
import type { MissionItem } from '@shared/ipc/MissionTypes'
import { createMissionCommandHandlers } from '../../core/mission/MissionCommandHandlers'
import type { RpcRealtimeServer } from '../realtime/RpcRealtimeServer'

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

  const missionListenerDisposers = new Map<number, () => void>()

  const attachMissionListeners = (vehicleId: number): void => {
    if (missionListenerDisposers.has(vehicleId)) return
    const missionManager = vehicleManager.getVehicle(vehicleId)?.missionManager
    if (!missionManager) return

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
    missionListenerDisposers.set(vehicleId, () => {
      missionManager.off('progress', onProgress)
      missionManager.off('loadComplete', onComplete)
      missionManager.off('currentChanged', onCurrentChanged)
    })
  }

  const detachMissionListeners = (vehicleId: number): void => {
    missionListenerDisposers.get(vehicleId)?.()
    missionListenerDisposers.delete(vehicleId)
  }

  const onVehicleAdded = (vehicleId: number): void => {
    attachMissionListeners(vehicleId)
  }
  const onVehicleRemoved = (vehicleId: number): void => {
    detachMissionListeners(vehicleId)
  }

  vehicleManager.on('vehicleAdded', onVehicleAdded)
  vehicleManager.on('vehicleRemoved', onVehicleRemoved)
  for (const vehicle of vehicleManager.getAllVehicles()) {
    attachMissionListeners(vehicle.sysid)
  }

  return () => {
    vehicleManager.off('vehicleAdded', onVehicleAdded)
    vehicleManager.off('vehicleRemoved', onVehicleRemoved)
    for (const dispose of missionListenerDisposers.values()) {
      dispose()
    }
    missionListenerDisposers.clear()
  }
}
