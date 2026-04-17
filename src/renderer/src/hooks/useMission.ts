import { useCallback } from 'react'
import { useVehicleStore } from '../store/vehicleStore'
import { useMissionStore } from '../store/missionStore'
import { waypointToMissionItem } from '../store/missionStoreHelpers'
import { MissionProtocolState, type MissionItem } from '../../../shared-types/ipc/MissionTypes'

export function useMission(): {
  uploadMission: () => Promise<unknown>
  downloadMission: () => Promise<void>
  savePlan: () => Promise<void>
  openPlan: () => Promise<void>
} {
  const activeId = useVehicleStore((s) => s.activeVehicleId)

  const uploadMission = useCallback(async () => {
    const vid = activeId
    if (vid == null) return undefined
    const store = useMissionStore.getState()
    const waypoints = store.editableWaypoints
    const items = waypoints.map((wp, i) => waypointToMissionItem(wp, i))
    store.setProtocolState(MissionProtocolState.WritingCount)
    try {
      const result = await window.bridge?.missionWrite(vid, items)
      useMissionStore.getState().setProtocolState(MissionProtocolState.Idle)
      return result
    } catch {
      useMissionStore.getState().setProtocolState(MissionProtocolState.Idle)
      return undefined
    }
  }, [activeId])

  const downloadMission = useCallback(async () => {
    const vid = activeId
    if (vid == null) return
    useMissionStore.getState().setProtocolState(MissionProtocolState.ReadingCount)
    try {
      const result = await window.bridge?.missionLoad(vid)
      if (
        result &&
        typeof result === 'object' &&
        'items' in result &&
        Array.isArray((result as { items: unknown[] }).items)
      ) {
        useMissionStore.getState().loadFromItems((result as { items: MissionItem[] }).items)
      }
    } finally {
      useMissionStore.getState().setProtocolState(MissionProtocolState.Idle)
    }
  }, [activeId])

  const savePlan = useCallback(async () => {
    const waypoints = useMissionStore.getState().editableWaypoints
    const items = waypoints.map((wp, i) => waypointToMissionItem(wp, i))
    await window.bridge?.missionSavePlan({
      fileHeader: { version: 1, createdBy: 'meridian' },
      mission: { items }
    })
  }, [])

  const openPlan = useCallback(async () => {
    const result = await window.bridge?.missionOpenPlan()
    if (result && typeof result === 'object' && 'mission' in result) {
      useMissionStore
        .getState()
        .loadFromItems((result as { mission: { items: MissionItem[] } }).mission.items)
    }
  }, [])

  return { uploadMission, downloadMission, savePlan, openPlan }
}
