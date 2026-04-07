/** Affiliation of a tracked object */
export type TrackAffiliation = 'friendly' | 'hostile'

/** Classification of a tracked object */
export type TrackClassification = 'uav' | 'unknown'

/** The physical radar unit (mapped from AS_POI_SOURCE msg 20000) */
export interface RadarUnit {
  id: number
  lat: number // degrees
  lon: number // degrees
  alt: number // meters MSL
}

/** A tracked object detected by the radar (mapped from AS_POI msg 20001) */
export interface RadarTrack {
  id: number
  sourceId: number
  affiliation: TrackAffiliation
  classification: TrackClassification
  lat: number // degrees
  lon: number // degrees
  alt: number // meters MSL
  vn: number // velocity north m/s
  ve: number // velocity east m/s
  vd: number // velocity down m/s
  strength: number // RCS in dBsm
  confidence: number // 0-100 %
  lastSeenMs: number // Date.now() when last updated
}

/** Full radar state pushed to renderer */
export interface RadarState {
  enabled: boolean
  units: RadarUnit[]
  tracks: RadarTrack[]
  simulationActive: boolean
}
