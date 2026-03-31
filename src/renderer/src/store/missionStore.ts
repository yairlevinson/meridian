import { create } from 'zustand'
import type {
  MissionItem,
  GeoFencePolygon,
  GeoFenceCircle,
  RallyPoint,
  EditableWaypoint,
  MissionStats
} from '../../../shared-types/ipc/MissionTypes'
import { MissionProtocolState, AltitudeMode } from '../../../shared-types/ipc/MissionTypes'
import { missionItemToWaypoint, computeMissionStats, resequence } from './missionStoreHelpers'

const emptyStats: MissionStats = { totalDistanceM: 0, estimatedTimeSec: 0, waypointCount: 0 }

interface MissionStore {
  missionItems: MissionItem[]
  currentIndex: number
  protocolState: MissionProtocolState
  error: string | null
  fencePolygons: GeoFencePolygon[]
  fenceCircles: GeoFenceCircle[]
  rallyPoints: RallyPoint[]

  // Plan editor state
  editableWaypoints: EditableWaypoint[]
  selectedWaypointSeq: number | null
  isDirty: boolean
  defaultAltitude: number
  defaultAltMode: AltitudeMode
  missionStats: MissionStats

  // Existing actions
  setMissionItems: (items: MissionItem[]) => void
  setCurrentIndex: (index: number) => void
  setProtocolState: (state: MissionProtocolState) => void
  setError: (error: string | null) => void
  setFence: (polygons: GeoFencePolygon[], circles: GeoFenceCircle[]) => void
  setRallyPoints: (points: RallyPoint[]) => void

  // Plan editor actions
  addWaypoint: (lat: number, lon: number) => void
  moveWaypoint: (seq: number, lat: number, lon: number) => void
  removeWaypoint: (seq: number) => void
  updateWaypointAlt: (seq: number, alt: number) => void
  updateWaypointAltMode: (seq: number, mode: AltitudeMode) => void
  updateWaypointCommand: (seq: number, command: number, commandName: string) => void
  selectWaypoint: (seq: number | null) => void
  clearMission: () => void
  loadFromItems: (items: MissionItem[]) => void
}

export const useMissionStore = create<MissionStore>((set) => ({
  missionItems: [],
  currentIndex: 0,
  protocolState: MissionProtocolState.Idle,
  error: null,
  fencePolygons: [],
  fenceCircles: [],
  rallyPoints: [],

  editableWaypoints: [],
  selectedWaypointSeq: null,
  isDirty: false,
  defaultAltitude: 50,
  defaultAltMode: AltitudeMode.Relative,
  missionStats: emptyStats,

  setMissionItems: (items) => set({ missionItems: items }),
  setCurrentIndex: (index) => set({ currentIndex: index }),
  setProtocolState: (state) => set({ protocolState: state }),
  setError: (error) => set({ error }),
  setFence: (polygons, circles) => set({ fencePolygons: polygons, fenceCircles: circles }),
  setRallyPoints: (points) => set({ rallyPoints: points }),

  addWaypoint: (lat, lon) =>
    set((state) => {
      const newWp: EditableWaypoint = {
        seq: state.editableWaypoints.length,
        lat,
        lon,
        alt: state.defaultAltitude,
        altMode: state.defaultAltMode,
        command: 16,
        commandName: 'Waypoint'
      }
      const updated = [...state.editableWaypoints, newWp]
      return {
        editableWaypoints: updated,
        missionStats: computeMissionStats(updated),
        isDirty: true
      }
    }),

  moveWaypoint: (seq, lat, lon) =>
    set((state) => {
      const updated = state.editableWaypoints.map((wp) =>
        wp.seq === seq ? { ...wp, lat, lon } : wp
      )
      return {
        editableWaypoints: updated,
        missionStats: computeMissionStats(updated),
        isDirty: true
      }
    }),

  removeWaypoint: (seq) =>
    set((state) => {
      const filtered = state.editableWaypoints.filter((wp) => wp.seq !== seq)
      const updated = resequence(filtered)
      return {
        editableWaypoints: updated,
        missionStats: computeMissionStats(updated),
        isDirty: true,
        selectedWaypointSeq: state.selectedWaypointSeq === seq ? null : state.selectedWaypointSeq
      }
    }),

  updateWaypointAlt: (seq, alt) =>
    set((state) => {
      const updated = state.editableWaypoints.map((wp) => (wp.seq === seq ? { ...wp, alt } : wp))
      return {
        editableWaypoints: updated,
        missionStats: computeMissionStats(updated),
        isDirty: true
      }
    }),

  updateWaypointAltMode: (seq, mode) =>
    set((state) => {
      const updated = state.editableWaypoints.map((wp) =>
        wp.seq === seq ? { ...wp, altMode: mode } : wp
      )
      return {
        editableWaypoints: updated,
        missionStats: computeMissionStats(updated),
        isDirty: true
      }
    }),

  updateWaypointCommand: (seq, command, commandName) =>
    set((state) => {
      const updated = state.editableWaypoints.map((wp) =>
        wp.seq === seq ? { ...wp, command, commandName } : wp
      )
      return { editableWaypoints: updated, isDirty: true }
    }),

  selectWaypoint: (seq) => set({ selectedWaypointSeq: seq }),

  clearMission: () =>
    set({
      editableWaypoints: [],
      selectedWaypointSeq: null,
      isDirty: false,
      missionStats: emptyStats
    }),

  loadFromItems: (items) =>
    set(() => {
      const waypoints = items.map(missionItemToWaypoint)
      return {
        editableWaypoints: waypoints,
        missionStats: computeMissionStats(waypoints),
        isDirty: false,
        selectedWaypointSeq: null
      }
    })
}))

// Expose for E2E testing
if (typeof window !== 'undefined') {
  ;(window as unknown as Record<string, unknown>).__missionStore = useMissionStore
}
