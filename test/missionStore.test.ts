// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { useMissionStore } from '../src/renderer/src/store/missionStore'
import type { MissionItem } from '../src/shared-types/ipc/MissionTypes'
import { AltitudeMode, MissionType } from '../src/shared-types/ipc/MissionTypes'

function makeItem(seq: number, lat = 42.389, lon = -71.147, alt = 50): MissionItem {
  return {
    seq,
    frame: 3,
    command: 16,
    current: seq === 0,
    autocontinue: true,
    param1: 0,
    param2: 0,
    param3: 0,
    param4: 0,
    x: Math.round(lat * 1e7),
    y: Math.round(lon * 1e7),
    z: alt,
    missionType: MissionType.Mission
  }
}

describe('missionStore — plan editor actions', () => {
  beforeEach(() => {
    useMissionStore.setState({
      plannedHome: null,
      editableWaypoints: [],
      selectedWaypointSeq: null,
      isDirty: false,
      defaultAltitude: 50,
      defaultAltMode: AltitudeMode.Relative,
      missionStats: { totalDistanceM: 0, estimatedTimeSec: 0, waypointCount: 0 }
    })
  })

  describe('addWaypoint', () => {
    it('appends a waypoint with default altitude and mode', () => {
      useMissionStore.getState().addWaypoint(42.0, -71.0)
      const state = useMissionStore.getState()
      expect(state.editableWaypoints).toHaveLength(1)
      expect(state.editableWaypoints[0]!.lat).toBe(42.0)
      expect(state.editableWaypoints[0]!.lon).toBe(-71.0)
      expect(state.editableWaypoints[0]!.alt).toBe(50)
      expect(state.editableWaypoints[0]!.altMode).toBe(AltitudeMode.Relative)
      expect(state.editableWaypoints[0]!.seq).toBe(0)
    })

    it('increments seq for subsequent waypoints', () => {
      useMissionStore.getState().addWaypoint(42.0, -71.0)
      useMissionStore.getState().addWaypoint(43.0, -72.0)
      const wps = useMissionStore.getState().editableWaypoints
      expect(wps).toHaveLength(2)
      expect(wps[0]!.seq).toBe(0)
      expect(wps[1]!.seq).toBe(1)
    })

    it('sets isDirty to true', () => {
      useMissionStore.getState().addWaypoint(42.0, -71.0)
      expect(useMissionStore.getState().isDirty).toBe(true)
    })

    it('updates mission stats', () => {
      useMissionStore.getState().addWaypoint(42.0, -71.0)
      useMissionStore.getState().addWaypoint(43.0, -72.0)
      const stats = useMissionStore.getState().missionStats
      expect(stats.waypointCount).toBe(2)
      expect(stats.totalDistanceM).toBeGreaterThan(0)
    })
  })

  describe('moveWaypoint', () => {
    it('updates position of the target waypoint', () => {
      useMissionStore.getState().addWaypoint(42.0, -71.0)
      useMissionStore.getState().moveWaypoint(0, 43.0, -72.0)
      const wp = useMissionStore.getState().editableWaypoints[0]!
      expect(wp.lat).toBe(43.0)
      expect(wp.lon).toBe(-72.0)
    })

    it('recalculates stats', () => {
      useMissionStore.getState().addWaypoint(42.0, -71.0)
      useMissionStore.getState().addWaypoint(42.0, -71.0) // same point, 0 distance
      const statsBefore = useMissionStore.getState().missionStats
      expect(statsBefore.totalDistanceM).toBe(0)

      useMissionStore.getState().moveWaypoint(1, 43.0, -72.0)
      const statsAfter = useMissionStore.getState().missionStats
      expect(statsAfter.totalDistanceM).toBeGreaterThan(0)
    })
  })

  describe('removeWaypoint', () => {
    it('removes the waypoint and resequences', () => {
      useMissionStore.getState().addWaypoint(42.0, -71.0)
      useMissionStore.getState().addWaypoint(43.0, -72.0)
      useMissionStore.getState().addWaypoint(44.0, -73.0)
      useMissionStore.getState().removeWaypoint(1)

      const wps = useMissionStore.getState().editableWaypoints
      expect(wps).toHaveLength(2)
      expect(wps[0]!.seq).toBe(0)
      expect(wps[1]!.seq).toBe(1)
      expect(wps[1]!.lat).toBe(44.0)
    })

    it('recalculates stats', () => {
      useMissionStore.getState().addWaypoint(42.0, -71.0)
      useMissionStore.getState().addWaypoint(43.0, -72.0)
      const _statsBefore = useMissionStore.getState().missionStats
      useMissionStore.getState().removeWaypoint(1)
      const statsAfter = useMissionStore.getState().missionStats
      expect(statsAfter.totalDistanceM).toBe(0)
      expect(statsAfter.waypointCount).toBe(1)
    })

    it('clears selectedWaypointSeq if removed waypoint was selected', () => {
      useMissionStore.getState().addWaypoint(42.0, -71.0)
      useMissionStore.getState().selectWaypoint(0)
      useMissionStore.getState().removeWaypoint(0)
      expect(useMissionStore.getState().selectedWaypointSeq).toBeNull()
    })
  })

  describe('updateWaypointAlt', () => {
    it('changes altitude of the target waypoint', () => {
      useMissionStore.getState().addWaypoint(42.0, -71.0)
      useMissionStore.getState().updateWaypointAlt(0, 100)
      expect(useMissionStore.getState().editableWaypoints[0]!.alt).toBe(100)
      expect(useMissionStore.getState().isDirty).toBe(true)
    })
  })

  describe('updateWaypointAltMode', () => {
    it('changes alt mode of the target waypoint', () => {
      useMissionStore.getState().addWaypoint(42.0, -71.0)
      useMissionStore.getState().updateWaypointAltMode(0, AltitudeMode.AMSL)
      expect(useMissionStore.getState().editableWaypoints[0]!.altMode).toBe(AltitudeMode.AMSL)
      expect(useMissionStore.getState().isDirty).toBe(true)
    })
  })

  describe('selectWaypoint', () => {
    it('sets selectedWaypointSeq', () => {
      useMissionStore.getState().selectWaypoint(3)
      expect(useMissionStore.getState().selectedWaypointSeq).toBe(3)
    })

    it('sets to null to deselect', () => {
      useMissionStore.getState().selectWaypoint(3)
      useMissionStore.getState().selectWaypoint(null)
      expect(useMissionStore.getState().selectedWaypointSeq).toBeNull()
    })
  })

  describe('clearMission', () => {
    it('resets to empty state', () => {
      useMissionStore.getState().addWaypoint(42.0, -71.0)
      useMissionStore.getState().addWaypoint(43.0, -72.0)
      useMissionStore.getState().selectWaypoint(0)
      useMissionStore.getState().clearMission()

      const state = useMissionStore.getState()
      expect(state.editableWaypoints).toHaveLength(0)
      expect(state.selectedWaypointSeq).toBeNull()
      expect(state.isDirty).toBe(false)
      expect(state.missionStats.waypointCount).toBe(0)
    })
  })

  describe('loadFromItems', () => {
    it('converts MissionItems to EditableWaypoints', () => {
      const items = [makeItem(0, 42.389, -71.147, 50), makeItem(1, 43.0, -72.0, 75)]
      useMissionStore.getState().loadFromItems(items)

      const state = useMissionStore.getState()
      expect(state.editableWaypoints).toHaveLength(2)
      expect(state.editableWaypoints[0]!.lat).toBeCloseTo(42.389, 5)
      expect(state.editableWaypoints[1]!.alt).toBe(75)
    })

    it('sets isDirty to false', () => {
      // First dirty the store
      useMissionStore.getState().addWaypoint(42.0, -71.0)
      expect(useMissionStore.getState().isDirty).toBe(true)

      useMissionStore.getState().loadFromItems([makeItem(0)])
      expect(useMissionStore.getState().isDirty).toBe(false)
    })

    it('computes stats from loaded items', () => {
      const items = [makeItem(0, 42.0, -71.0, 50), makeItem(1, 43.0, -72.0, 50)]
      useMissionStore.getState().loadFromItems(items)
      expect(useMissionStore.getState().missionStats.waypointCount).toBe(2)
      expect(useMissionStore.getState().missionStats.totalDistanceM).toBeGreaterThan(0)
    })

    it('clears selected waypoint', () => {
      useMissionStore.getState().selectWaypoint(5)
      useMissionStore.getState().loadFromItems([makeItem(0)])
      expect(useMissionStore.getState().selectedWaypointSeq).toBeNull()
    })

    it('includes plannedHome in stats when home is set', () => {
      useMissionStore.getState().setPlannedHome({ lat: 0, lon: 0, alt: 0 })
      const items = [makeItem(0, 0, 1, 50)] // WP at (0,1) — ~111km from home at (0,0)
      useMissionStore.getState().loadFromItems(items)
      const stats = useMissionStore.getState().missionStats
      expect(stats.totalDistanceM).toBeGreaterThan(100000)
    })
  })

  describe('plannedHome', () => {
    it('starts as null', () => {
      expect(useMissionStore.getState().plannedHome).toBeNull()
    })

    it('setPlannedHome sets the home position', () => {
      useMissionStore.getState().setPlannedHome({ lat: 32.1, lon: 34.8, alt: 50 })
      const home = useMissionStore.getState().plannedHome
      expect(home).toEqual({ lat: 32.1, lon: 34.8, alt: 50 })
    })

    it('movePlannedHome updates lat/lon preserving alt', () => {
      useMissionStore.getState().setPlannedHome({ lat: 32.1, lon: 34.8, alt: 50 })
      useMissionStore.getState().movePlannedHome(33.0, 35.0)
      const home = useMissionStore.getState().plannedHome
      expect(home).toEqual({ lat: 33.0, lon: 35.0, alt: 50 })
    })

    it('movePlannedHome creates home if none exists', () => {
      useMissionStore.getState().movePlannedHome(33.0, 35.0)
      const home = useMissionStore.getState().plannedHome
      expect(home).toEqual({ lat: 33.0, lon: 35.0, alt: 0 })
    })

    it('movePlannedHome recalculates mission stats', () => {
      useMissionStore.getState().addWaypoint(0, 1) // WP at (0,1)
      useMissionStore.getState().movePlannedHome(0, 0) // home at (0,0)
      const stats = useMissionStore.getState().missionStats
      // Home (0,0) → WP (0,1) is ~111km
      expect(stats.totalDistanceM).toBeGreaterThan(100000)
    })

    it('addWaypoint includes home in stats when home is set', () => {
      useMissionStore.getState().setPlannedHome({ lat: 0, lon: 0, alt: 0 })
      useMissionStore.getState().addWaypoint(0, 1)
      const stats = useMissionStore.getState().missionStats
      expect(stats.totalDistanceM).toBeGreaterThan(100000)
    })

    it('removeWaypoint recalculates with home', () => {
      useMissionStore.getState().setPlannedHome({ lat: 0, lon: 0, alt: 0 })
      useMissionStore.getState().addWaypoint(0, 1)
      useMissionStore.getState().addWaypoint(0, 2)
      useMissionStore.getState().removeWaypoint(0)
      const stats = useMissionStore.getState().missionStats
      // Home (0,0) → remaining WP (0,2) is ~222km
      expect(stats.totalDistanceM).toBeGreaterThan(200000)
      expect(stats.waypointCount).toBe(1)
    })
  })
})
