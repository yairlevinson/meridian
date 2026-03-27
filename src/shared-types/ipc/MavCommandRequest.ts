/** A MAVLink command to send to a vehicle */
export interface MavCommandRequest {
  vehicleId: number
  componentId: number
  command: number // MAV_CMD
  confirmation: number
  param1: number
  param2: number
  param3: number
  param4: number
  param5: number
  param6: number
  param7: number
}

/** Result from MAV_CMD_ACK */
export enum MavResult {
  ACCEPTED = 0,
  TEMPORARILY_REJECTED = 1,
  DENIED = 2,
  UNSUPPORTED = 3,
  FAILED = 4,
  IN_PROGRESS = 5,
  CANCELLED = 6
}

/** Command result event payload */
export interface MavCommandResult {
  vehicleId: number
  command: number
  result: MavResult
  progress: number // 0-100 for IN_PROGRESS
  resultParam2: number
}

/** Flight mode change request */
export interface FlightModeRequest {
  vehicleId: number
  modeName: string
}

/** Guided mode action requests */
export interface GuidedTakeoffRequest {
  vehicleId: number
  altitude: number // meters AGL
}

export interface GuidedGotoRequest {
  vehicleId: number
  lat: number
  lon: number
  alt: number
}
