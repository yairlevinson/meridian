import type { LatLon } from './geo'

/** MAVLink mission types */
export enum MissionType {
  Mission = 0, // MAV_MISSION_TYPE_MISSION
  Fence = 1, // MAV_MISSION_TYPE_FENCE
  Rally = 2 // MAV_MISSION_TYPE_RALLY
}

/** A single mission item (mirrors MISSION_ITEM_INT) */
export interface MissionItem {
  seq: number
  frame: number // MAV_FRAME
  command: number // MAV_CMD
  current: boolean
  autocontinue: boolean
  param1: number
  param2: number
  param3: number
  param4: number
  x: number // lat * 1e7 (int)
  y: number // lon * 1e7 (int)
  z: number // altitude
  missionType: MissionType
}

/** Simple waypoint for UI display */
export interface Waypoint {
  seq: number
  lat: number
  lon: number
  alt: number
  command: number
  commandName: string
  params: Record<string, number>
}

/** Complex mission item types */
export enum ComplexItemType {
  Survey = 'survey',
  CorridorScan = 'corridorScan',
  StructureScan = 'structureScan',
  FixedWingLanding = 'fixedWingLanding'
}

/** Survey pattern parameters */
export interface SurveyPattern {
  type: ComplexItemType.Survey
  polygon: LatLon[]
  gridSpacing: number // meters
  gridAngle: number // degrees
  turnaroundDistance: number // meters
  altitude: number
  cameraShots: boolean
}

/** Mission protocol state */
export enum MissionProtocolState {
  Idle = 'idle',
  ReadingCount = 'readingCount',
  ReadingItems = 'readingItems',
  WritingCount = 'writingCount',
  WritingItems = 'writingItems',
  Error = 'error'
}

/** Mission protocol error codes */
export enum MissionError {
  None = 0,
  Timeout = 1,
  InvalidSequence = 2,
  Denied = 3,
  NoSpace = 4,
  InvalidParam = 5,
  Unsupported = 6,
  VehicleError = 7
}

/** GeoFence vertex */
export interface GeoFenceVertex {
  lat: number
  lon: number
}

/** GeoFence definition */
export interface GeoFencePolygon {
  inclusion: boolean
  vertices: GeoFenceVertex[]
}

export interface GeoFenceCircle {
  inclusion: boolean
  center: { lat: number; lon: number }
  radius: number // meters
}

/** Rally point */
export interface RallyPoint {
  lat: number
  lon: number
  alt: number
}

/** Altitude reference frame for editing */
export enum AltitudeMode {
  AMSL = 0, // MAV_FRAME_GLOBAL_INT
  Relative = 3 // MAV_FRAME_GLOBAL_RELATIVE_ALT_INT
}

/** Editable waypoint for the plan editor */
export interface EditableWaypoint {
  seq: number
  lat: number // degrees
  lon: number // degrees
  alt: number // meters
  altMode: AltitudeMode
  command: number // MAV_CMD (16 = NAV_WAYPOINT)
  commandName: string
}

/** Mission statistics */
export interface MissionStats {
  totalDistanceM: number
  estimatedTimeSec: number
  waypointCount: number
}

/** .plan file format */
export interface PlanFile {
  fileHeader: { version: number; createdBy: string }
  mission: { items: MissionItem[] }
  geoFence?: { polygons: GeoFencePolygon[]; circles: GeoFenceCircle[] }
  rallyPoints?: RallyPoint[]
}
