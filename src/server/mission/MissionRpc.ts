import type { EventEmitter } from 'events'
import { missionModule } from '@shared/ipc/modules/mission'
import type { MissionItem } from '@shared/ipc/MissionTypes'
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
    commands: {
      load: async (vehicleId) => {
        const missionManager = vehicleManager?.getVehicle(vehicleId)?.missionManager
        if (!missionManager) return { items: [], error: 'No vehicle' }
        return loadMission(missionManager)
      },
      write: async (vehicleId, items) => {
        const missionManager = vehicleManager?.getVehicle(vehicleId)?.missionManager
        if (!missionManager) return { error: 'No vehicle' }
        return writeMission(missionManager, items)
      },
      savePlan: async () => {
        throw new Error('Plan file dialogs are not available in browser server mode')
      },
      openPlan: async () => {
        throw new Error('Plan file dialogs are not available in browser server mode')
      }
    }
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

function loadMission(
  missionManager: MissionManagerLike
): Promise<{ items: MissionItem[]; error?: string }> {
  return new Promise((resolve) => {
    const cleanup = (): void => {
      clearTimeout(timeout)
      missionManager.off('loadComplete', onComplete)
      missionManager.off('error', onError)
    }
    const onComplete = (items: MissionItem[]): void => {
      cleanup()
      resolve({ items })
    }
    const onError = (code: number): void => {
      cleanup()
      resolve({ items: [], error: `Error code ${code}` })
    }
    const timeout = setTimeout(() => {
      cleanup()
      resolve({ items: [], error: 'Timeout' })
    }, 30000)

    missionManager.once('loadComplete', onComplete)
    missionManager.once('error', onError)
    missionManager.loadFromVehicle()
  })
}

function writeMission(
  missionManager: MissionManagerLike,
  items: MissionItem[]
): Promise<{ success: true } | { error: string }> {
  return new Promise((resolve) => {
    const cleanup = (): void => {
      clearTimeout(timeout)
      missionManager.off('writeComplete', onComplete)
      missionManager.off('error', onError)
    }
    const onComplete = (): void => {
      cleanup()
      resolve({ success: true })
    }
    const onError = (code: number): void => {
      cleanup()
      resolve({ error: `Error code ${code}` })
    }
    const timeout = setTimeout(() => {
      cleanup()
      resolve({ error: 'Timeout' })
    }, 30000)

    missionManager.once('writeComplete', onComplete)
    missionManager.once('error', onError)
    missionManager.writeToVehicle(items)
  })
}
