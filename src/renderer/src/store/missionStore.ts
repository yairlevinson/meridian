import { create } from 'zustand'
import { rlog } from '../lib/rlog'

const log = rlog('MissionStore')
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

export interface PlannedHome {
  lat: number
  lon: number
  alt: number
}

interface MissionStore {
  missionItems: MissionItem[]
  currentIndex: number
  protocolState: MissionProtocolState
  error: string | null
  fencePolygons: GeoFencePolygon[]
  fenceCircles: GeoFenceCircle[]
  rallyPoints: RallyPoint[]

  // Plan editor state
  plannedHome: PlannedHome | null
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
  setPlannedHome: (home: PlannedHome) => void
  movePlannedHome: (lat: number, lon: number) => void
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

  plannedHome: null,
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

  setPlannedHome: (home) => set({ plannedHome: home }),
  movePlannedHome: (lat, lon) =>
    set((state) => {
      const home = state.plannedHome ? { ...state.plannedHome, lat, lon } : { lat, lon, alt: 0 }
      return {
        plannedHome: home,
        missionStats: computeMissionStats(state.editableWaypoints, home)
      }
    }),

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
        missionStats: computeMissionStats(updated, state.plannedHome),
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
        missionStats: computeMissionStats(updated, state.plannedHome),
        isDirty: true
      }
    }),

  removeWaypoint: (seq) =>
    set((state) => {
      const filtered = state.editableWaypoints.filter((wp) => wp.seq !== seq)
      const updated = resequence(filtered)
      return {
        editableWaypoints: updated,
        missionStats: computeMissionStats(updated, state.plannedHome),
        isDirty: true,
        selectedWaypointSeq: state.selectedWaypointSeq === seq ? null : state.selectedWaypointSeq
      }
    }),

  updateWaypointAlt: (seq, alt) =>
    set((state) => {
      const updated = state.editableWaypoints.map((wp) => (wp.seq === seq ? { ...wp, alt } : wp))
      return {
        editableWaypoints: updated,
        missionStats: computeMissionStats(updated, state.plannedHome),
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
        missionStats: computeMissionStats(updated, state.plannedHome),
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

  clearMission: () => {
    log.debug('[MissionStore] clearMission')
    return set({
      editableWaypoints: [],
      selectedWaypointSeq: null,
      isDirty: false,
      missionStats: emptyStats
    })
  },

  loadFromItems: (items) => {
    log.debug('[MissionStore] loadFromItems:', items.length, 'items')
    return set((state) => {
      const waypoints = items.map(missionItemToWaypoint)
      log.debug('[MissionStore] loadFromItems → editableWaypoints:', waypoints.length)
      return {
        editableWaypoints: waypoints,
        missionStats: computeMissionStats(waypoints, state.plannedHome),
        isDirty: false,
        selectedWaypointSeq: null
      }
    })
  }
}))

// Request GCS geolocation as default planned home position
if (typeof window !== 'undefined' && 'geolocation' in navigator) {
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const state = useMissionStore.getState()
      // Only set if no planned home has been set yet
      if (!state.plannedHome) {
        state.setPlannedHome({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          alt: pos.coords.altitude ?? 0
        })
        console.log(
          `[Mission] GCS location set as planned home: ${pos.coords.latitude.toFixed(6)}, ${pos.coords.longitude.toFixed(6)}`
        )
      }
    },
    (err) => {
      console.warn('[Mission] Geolocation unavailable:', err.message)
    },
    { enableHighAccuracy: false, timeout: 10000 }
  )
}

// Auto-load mission items when the main process pushes a completed download
if (typeof window !== 'undefined' && window.bridge?.onMissionComplete) {
  window.bridge.onMissionComplete(({ items }) => {
    log.debug('[MissionStore] onMissionComplete received:', items.length, 'items')
    useMissionStore.getState().loadFromItems(items)
  })
}

// Expose for E2E testing
if (typeof window !== 'undefined') {
  ;(window as unknown as Record<string, unknown>).__missionStore = useMissionStore
}
