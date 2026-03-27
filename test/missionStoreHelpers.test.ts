// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  missionItemToWaypoint,
  waypointToMissionItem,
  computeMissionStats,
  resequence,
  waypointsToGeoJSON
} from '../src/renderer/src/store/missionStoreHelpers'
import type { MissionItem, EditableWaypoint } from '../src/shared-types/ipc/MissionTypes'
import { AltitudeMode, MissionType } from '../src/shared-types/ipc/MissionTypes'

function makeItem(seq: number, lat = 42.389, lon = -71.147, alt = 50, frame = 3): MissionItem {
  return {
    seq,
    frame,
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

function makeWaypoint(seq: number, lat = 42.389, lon = -71.147, alt = 50): EditableWaypoint {
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

describe('missionItemToWaypoint', () => {
  it('converts lat/lon from 1e7 integer to degrees', () => {
    const item = makeItem(0, 42.389, -71.147, 100)
    const wp = missionItemToWaypoint(item)
    expect(wp.lat).toBeCloseTo(42.389, 5)
    expect(wp.lon).toBeCloseTo(-71.147, 5)
    expect(wp.alt).toBe(100)
    expect(wp.seq).toBe(0)
  })

  it('maps frame 3 to AltitudeMode.Relative', () => {
    const item = makeItem(0, 42, -71, 50, 3)
    expect(missionItemToWaypoint(item).altMode).toBe(AltitudeMode.Relative)
  })

  it('maps frame 0 to AltitudeMode.AMSL', () => {
    const item = makeItem(0, 42, -71, 50, 0)
    expect(missionItemToWaypoint(item).altMode).toBe(AltitudeMode.AMSL)
  })

  it('sets commandName for MAV_CMD 16', () => {
    const item = makeItem(0)
    expect(missionItemToWaypoint(item).commandName).toBe('Waypoint')
  })
})

describe('waypointToMissionItem', () => {
  it('converts lat/lon from degrees to 1e7 integer', () => {
    const wp = makeWaypoint(0, 42.389, -71.147, 100)
    const item = waypointToMissionItem(wp, 0)
    expect(item.x).toBe(Math.round(42.389 * 1e7))
    expect(item.y).toBe(Math.round(-71.147 * 1e7))
    expect(item.z).toBe(100)
    expect(item.frame).toBe(3) // Relative
  })

  it('maps AltitudeMode.AMSL to frame 0', () => {
    const wp = { ...makeWaypoint(0), altMode: AltitudeMode.AMSL }
    expect(waypointToMissionItem(wp, 0).frame).toBe(0)
  })

  it('round-trips correctly', () => {
    const original = makeItem(2, 33.456789, -117.123456, 75, 3)
    const wp = missionItemToWaypoint(original)
    const roundTrip = waypointToMissionItem(wp, 2)
    expect(roundTrip.x).toBe(original.x)
    expect(roundTrip.y).toBe(original.y)
    expect(roundTrip.z).toBe(original.z)
    expect(roundTrip.frame).toBe(original.frame)
    expect(roundTrip.seq).toBe(original.seq)
  })
})

describe('computeMissionStats', () => {
  it('returns zero stats for empty array', () => {
    const stats = computeMissionStats([])
    expect(stats.totalDistanceM).toBe(0)
    expect(stats.estimatedTimeSec).toBe(0)
    expect(stats.waypointCount).toBe(0)
  })

  it('returns zero distance for single waypoint', () => {
    const stats = computeMissionStats([makeWaypoint(0)])
    expect(stats.totalDistanceM).toBe(0)
    expect(stats.estimatedTimeSec).toBe(0)
    expect(stats.waypointCount).toBe(1)
  })

  it('computes reasonable distance for known points', () => {
    // New York (40.7128, -74.0060) to Boston (42.3601, -71.0589) ~ 306 km
    const wp1 = makeWaypoint(0, 40.7128, -74.006)
    const wp2 = makeWaypoint(1, 42.3601, -71.0589)
    const stats = computeMissionStats([wp1, wp2])
    expect(stats.totalDistanceM).toBeGreaterThan(290000)
    expect(stats.totalDistanceM).toBeLessThan(320000)
    expect(stats.waypointCount).toBe(2)
    // At 10 m/s, ~306km should take ~30600s
    expect(stats.estimatedTimeSec).toBeGreaterThan(29000)
    expect(stats.estimatedTimeSec).toBeLessThan(32000)
  })

  it('sums distances for multiple waypoints', () => {
    const wps = [makeWaypoint(0, 0, 0), makeWaypoint(1, 0, 1), makeWaypoint(2, 0, 2)]
    const stats = computeMissionStats(wps)
    // Two equal segments, total should be ~2x one segment
    const singleSeg = computeMissionStats([wps[0]!, wps[1]!])
    expect(stats.totalDistanceM).toBeCloseTo(singleSeg.totalDistanceM * 2, 0)
  })
})

describe('resequence', () => {
  it('renumbers seq 0..N-1', () => {
    const wps = [makeWaypoint(5), makeWaypoint(10), makeWaypoint(3)]
    const result = resequence(wps)
    expect(result.map((w) => w.seq)).toEqual([0, 1, 2])
  })

  it('preserves other properties', () => {
    const wps = [makeWaypoint(5, 42, -71, 100)]
    const result = resequence(wps)
    expect(result[0]!.lat).toBe(42)
    expect(result[0]!.lon).toBe(-71)
    expect(result[0]!.alt).toBe(100)
  })

  it('returns empty for empty input', () => {
    expect(resequence([])).toEqual([])
  })
})

describe('waypointsToGeoJSON', () => {
  it('returns FeatureCollection for points', () => {
    const wps = [makeWaypoint(0, 42, -71, 50), makeWaypoint(1, 43, -72, 60)]
    const { points, line: _line } = waypointsToGeoJSON(wps)

    expect(points.type).toBe('FeatureCollection')
    expect(points.features).toHaveLength(2)
    expect(points.features[0]!.geometry.type).toBe('Point')
    expect((points.features[0]!.geometry as GeoJSON.Point).coordinates).toEqual([-71, 42, 50])
    expect(points.features[0]!.properties!['seq']).toBe(0)
  })

  it('returns LineString for line with >= 2 waypoints', () => {
    const wps = [makeWaypoint(0, 42, -71, 50), makeWaypoint(1, 43, -72, 60)]
    const { line } = waypointsToGeoJSON(wps)

    expect(line.type).toBe('FeatureCollection')
    expect(line.features).toHaveLength(1)
    expect(line.features[0]!.geometry.type).toBe('LineString')
    const coords = (line.features[0]!.geometry as GeoJSON.LineString).coordinates
    expect(coords).toHaveLength(2)
    expect(coords[0]).toEqual([-71, 42, 50])
  })

  it('returns empty line features for single waypoint', () => {
    const { line } = waypointsToGeoJSON([makeWaypoint(0)])
    expect(line.features).toHaveLength(0)
  })

  it('handles empty array', () => {
    const { points, line } = waypointsToGeoJSON([])
    expect(points.features).toHaveLength(0)
    expect(line.features).toHaveLength(0)
  })
})
