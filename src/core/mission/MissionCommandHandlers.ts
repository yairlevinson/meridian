import type { EventEmitter } from 'events'
import type { RpcCommandImpls } from '@shared/rpc'
import type { MissionModule } from '@shared/ipc/modules/mission'
import type { MissionItem } from '@shared/ipc/MissionTypes'

type MissionManagerLike = Pick<EventEmitter, 'on' | 'off' | 'once'> & {
  loadFromVehicle: () => void
  writeToVehicle: (items: MissionItem[]) => void
}

type MissionVehicleManagerLike = {
  getVehicle: (vehicleId: number) => { missionManager?: MissionManagerLike } | undefined
}

type MissionFileCommands = Pick<RpcCommandImpls<MissionModule>, 'savePlan' | 'openPlan'>

export function createMissionCommandHandlers(
  vehicleManager: MissionVehicleManagerLike | null,
  fileCommands: MissionFileCommands
): RpcCommandImpls<MissionModule> {
  const getMissionManager = (vehicleId: number): MissionManagerLike | undefined =>
    vehicleManager?.getVehicle(vehicleId)?.missionManager

  return {
    load: async (vehicleId) => {
      const missionManager = getMissionManager(vehicleId)
      if (!missionManager) return { items: [], error: 'No vehicle' }
      return loadMission(missionManager)
    },
    write: async (vehicleId, items) => {
      const missionManager = getMissionManager(vehicleId)
      if (!missionManager) return { error: 'No vehicle' }
      return writeMission(missionManager, items)
    },
    savePlan: fileCommands.savePlan,
    openPlan: fileCommands.openPlan
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
