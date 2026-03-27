/** Parameter value types matching MAVLink PARAM_TYPE */
export enum ParamValueType {
  UINT8 = 1,
  INT8 = 2,
  UINT16 = 3,
  INT16 = 4,
  UINT32 = 5,
  INT32 = 6,
  UINT64 = 7,
  INT64 = 8,
  REAL32 = 9,
  REAL64 = 10
}

/** A single parameter with value and metadata */
export interface Parameter {
  name: string
  value: number
  type: ParamValueType
  index: number
  componentId: number
}

/** Parameter metadata from firmware JSON */
export interface ParameterMetaData {
  name: string
  shortDescription: string
  longDescription: string
  units: string
  min?: number
  max?: number
  defaultValue?: number
  increment?: number
  decimalPlaces?: number
  enumValues?: Record<number, string>
  bitmaskValues?: Record<number, string>
  group: string
  category: string
  isReadOnly: boolean
  isVolatile: boolean
  rebootRequired: boolean
}

/** State of the parameter loading process */
export interface ParameterLoadState {
  totalCount: number
  receivedCount: number
  loadProgress: number // 0..1
  parametersReady: boolean
  missingParameters: boolean
  missingIndices: number[]
  retryCount: number
  pendingWrites: number
}

/** Parameter change request */
export interface ParameterSetRequest {
  vehicleId: number
  componentId: number
  name: string
  value: number
  type: ParamValueType
}
