import type {
  MissionItem,
  EditableWaypoint,
  MissionStats
} from '../../../shared-types/ipc/MissionTypes'
import { AltitudeMode, MissionType } from '../../../shared-types/ipc/MissionTypes'

/** Map MAV_FRAME to AltitudeMode */
function frameToAltMode(frame: number): AltitudeMode {
  switch (frame) {
    case 3: // MAV_FRAME_GLOBAL_RELATIVE_ALT_INT
      return AltitudeMode.Relative
    case 0: // MAV_FRAME_GLOBAL_INT
    default:
      return AltitudeMode.AMSL
  }
}

/** Map AltitudeMode back to MAV_FRAME */
function altModeToFrame(mode: AltitudeMode): number {
  switch (mode) {
    case AltitudeMode.Relative:
      return 3
    case AltitudeMode.AMSL:
    default:
      return 0
  }
}

/** Human-readable name for common MAV_CMD values */
function commandName(cmd: number): string {
  switch (cmd) {
    case 16:
      return 'Waypoint'
    case 17:
      return 'Loiter Unlimited'
    case 18:
      return 'Loiter Turns'
    case 19:
      return 'Loiter Time'
    case 20:
      return 'Return to Launch'
    case 21:
      return 'Land'
    case 22:
      return 'Takeoff'
    default:
      return `CMD ${cmd}`
  }
}

/** Convert a MissionItem (MISSION_ITEM_INT format) to an EditableWaypoint */
export function missionItemToWaypoint(item: MissionItem): EditableWaypoint {
  return {
    seq: item.seq,
    lat: item.x / 1e7,
    lon: item.y / 1e7,
    alt: item.z,
    altMode: frameToAltMode(item.frame),
    command: item.command,
    commandName: commandName(item.command)
  }
}

/** Convert an EditableWaypoint back to a MissionItem */
export function waypointToMissionItem(wp: EditableWaypoint, seq: number): MissionItem {
  return {
    seq,
    frame: altModeToFrame(wp.altMode),
    command: wp.command,
    current: seq === 0,
    autocontinue: true,
    param1: 0,
    param2: 0,
    param3: 0,
    param4: 0,
    x: Math.round(wp.lat * 1e7),
    y: Math.round(wp.lon * 1e7),
    z: wp.alt,
    missionType: MissionType.Mission
  }
}

/** Haversine distance in meters between two lat/lon points */
function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000 // Earth radius in meters
  const toRad = (deg: number): number => (deg * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

const DEFAULT_SPEED_MS = 10 // m/s

/** Compute mission statistics from waypoints, optionally including home→WP1 distance */
export function computeMissionStats(
  waypoints: EditableWaypoint[],
  home?: { lat: number; lon: number } | null
): MissionStats {
  let totalDistanceM = 0
  // Include distance from home to first waypoint
  if (home && waypoints.length > 0) {
    const first = waypoints[0]!
    totalDistanceM += haversineDistance(home.lat, home.lon, first.lat, first.lon)
  }
  for (let i = 1; i < waypoints.length; i++) {
    const prev = waypoints[i - 1]!
    const curr = waypoints[i]!
    totalDistanceM += haversineDistance(prev.lat, prev.lon, curr.lat, curr.lon)
  }
  return {
    totalDistanceM,
    estimatedTimeSec: totalDistanceM / DEFAULT_SPEED_MS,
    waypointCount: waypoints.length
  }
}

/** Resequence waypoints 0..N-1 */
export function resequence(waypoints: EditableWaypoint[]): EditableWaypoint[] {
  return waypoints.map((wp, i) => ({ ...wp, seq: i }))
}

/** Convert waypoints to GeoJSON FeatureCollections for MapLibre rendering */
export function waypointsToGeoJSON(waypoints: EditableWaypoint[]): {
  points: GeoJSON.FeatureCollection
  line: GeoJSON.FeatureCollection
} {
  const points: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: waypoints.map((wp) => ({
      type: 'Feature' as const,
      geometry: {
        type: 'Point' as const,
        coordinates: [wp.lon, wp.lat, wp.alt]
      },
      properties: {
        seq: wp.seq,
        alt: wp.alt,
        command: wp.command,
        commandName: wp.commandName
      }
    }))
  }

  const lineCoordinates = waypoints.map((wp) => [wp.lon, wp.lat, wp.alt])
  const line: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features:
      lineCoordinates.length >= 2
        ? [
            {
              type: 'Feature' as const,
              geometry: {
                type: 'LineString' as const,
                coordinates: lineCoordinates
              },
              properties: {}
            }
          ]
        : []
  }

  return { points, line }
}
