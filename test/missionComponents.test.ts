// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { useMissionStore } from '../src/renderer/src/store/missionStore'
import { AltitudeMode, MissionProtocolState } from '../src/shared-types/ipc/MissionTypes'
import type { EditableWaypoint } from '../src/shared-types/ipc/MissionTypes'

function makeWaypoint(seq: number, lat: number, lon: number, alt = 50): EditableWaypoint {
  return {
    seq,
    lat,
    lon,
    alt,
    altMode: AltitudeMode.Relative,
    command: 16,
    commandName: 'Waypoint'
  }
}

describe('Mission Components — store-driven logic', () => {
  beforeEach(() => {
    useMissionStore.setState({
      editableWaypoints: [],
      selectedWaypointSeq: null,
      isDirty: false,
      missionStats: { totalDistanceM: 0, estimatedTimeSec: 0, waypointCount: 0 },
      protocolState: MissionProtocolState.Idle,
      error: null
    })
  })

  it('MissionStatsPanel reads distance/time/count from store state', () => {
    // Set up waypoints that produce known stats
    const _wp0 = makeWaypoint(0, 32.0, 34.8)
    const _wp1 = makeWaypoint(1, 32.001, 34.801)
    useMissionStore.getState().loadFromItems([])
    // Add waypoints via the store action
    useMissionStore.getState().addWaypoint(32.0, 34.8)
    useMissionStore.getState().addWaypoint(32.001, 34.801)

    const stats = useMissionStore.getState().missionStats
    expect(stats.waypointCount).toBe(2)
    expect(stats.totalDistanceM).toBeGreaterThan(0)
    // At 10 m/s default speed
    expect(stats.estimatedTimeSec).toBeCloseTo(stats.totalDistanceM / 10, 1)
  })

  it('MissionSidebar reads waypoint list from store', () => {
    useMissionStore.getState().addWaypoint(32.0, 34.8)
    useMissionStore.getState().addWaypoint(32.001, 34.801)
    useMissionStore.getState().addWaypoint(32.002, 34.802)

    const waypoints = useMissionStore.getState().editableWaypoints
    expect(waypoints).toHaveLength(3)
    expect(waypoints[0]!.seq).toBe(0)
    expect(waypoints[1]!.seq).toBe(1)
    expect(waypoints[2]!.seq).toBe(2)
    expect(waypoints[0]!.lat).toBeCloseTo(32.0)
    expect(waypoints[1]!.lon).toBeCloseTo(34.801)
  })

  it('MissionSidebar: clicking a waypoint calls selectWaypoint', () => {
    useMissionStore.getState().addWaypoint(32.0, 34.8)
    useMissionStore.getState().addWaypoint(32.001, 34.801)

    expect(useMissionStore.getState().selectedWaypointSeq).toBeNull()

    useMissionStore.getState().selectWaypoint(1)
    expect(useMissionStore.getState().selectedWaypointSeq).toBe(1)

    useMissionStore.getState().selectWaypoint(0)
    expect(useMissionStore.getState().selectedWaypointSeq).toBe(0)

    useMissionStore.getState().selectWaypoint(null)
    expect(useMissionStore.getState().selectedWaypointSeq).toBeNull()
  })

  it('WaypointEditor: changing altitude calls updateWaypointAlt', () => {
    useMissionStore.getState().addWaypoint(32.0, 34.8)
    useMissionStore.getState().addWaypoint(32.001, 34.801)

    // Default altitude is 50
    expect(useMissionStore.getState().editableWaypoints[0]!.alt).toBe(50)

    useMissionStore.getState().updateWaypointAlt(0, 100)
    expect(useMissionStore.getState().editableWaypoints[0]!.alt).toBe(100)
    expect(useMissionStore.getState().isDirty).toBe(true)

    useMissionStore.getState().updateWaypointAlt(1, 75)
    expect(useMissionStore.getState().editableWaypoints[1]!.alt).toBe(75)
  })

  it('WaypointEditor: changing altitude mode calls updateWaypointAltMode', () => {
    useMissionStore.getState().addWaypoint(32.0, 34.8)

    expect(useMissionStore.getState().editableWaypoints[0]!.altMode).toBe(AltitudeMode.Relative)

    useMissionStore.getState().updateWaypointAltMode(0, AltitudeMode.AMSL)
    expect(useMissionStore.getState().editableWaypoints[0]!.altMode).toBe(AltitudeMode.AMSL)
    expect(useMissionStore.getState().isDirty).toBe(true)
  })

  it('clearMission resets all plan state', () => {
    useMissionStore.getState().addWaypoint(32.0, 34.8)
    useMissionStore.getState().addWaypoint(32.001, 34.801)
    useMissionStore.getState().selectWaypoint(1)

    expect(useMissionStore.getState().editableWaypoints.length).toBe(2)
    expect(useMissionStore.getState().isDirty).toBe(true)

    useMissionStore.getState().clearMission()

    expect(useMissionStore.getState().editableWaypoints).toHaveLength(0)
    expect(useMissionStore.getState().selectedWaypointSeq).toBeNull()
    expect(useMissionStore.getState().isDirty).toBe(false)
    expect(useMissionStore.getState().missionStats.waypointCount).toBe(0)
  })

  it('removeWaypoint resequences correctly', () => {
    useMissionStore.getState().addWaypoint(32.0, 34.8)
    useMissionStore.getState().addWaypoint(32.001, 34.801)
    useMissionStore.getState().addWaypoint(32.002, 34.802)

    useMissionStore.getState().removeWaypoint(1)

    const wps = useMissionStore.getState().editableWaypoints
    expect(wps).toHaveLength(2)
    expect(wps[0]!.seq).toBe(0)
    expect(wps[1]!.seq).toBe(1)
    // The third original waypoint (lat ~32.002) should now be seq 1
    expect(wps[1]!.lat).toBeCloseTo(32.002)
  })
})
