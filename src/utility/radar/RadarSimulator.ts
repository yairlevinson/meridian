import { RadarProvider } from './RadarProvider'
import type { RadarUnit, RadarTrack, TrackAffiliation } from '@shared/ipc/RadarTypes'
import { createLogger } from '../logger'

const log = createLogger('RadarSimulator')

const DEG_TO_RAD = Math.PI / 180
const METERS_PER_DEG_LAT = 111_111

interface SimTrack {
  id: number
  affiliation: TrackAffiliation
  lat: number
  lon: number
  alt: number
  heading: number // degrees
  speed: number // m/s
  baseStrength: number
  baseConfidence: number
}

export class RadarSimulator extends RadarProvider {
  private _interval: ReturnType<typeof setInterval> | null = null
  private _tracks: SimTrack[] = []
  private _nextId = 1
  private _centerLat: number
  private _centerLon: number
  private _centerAlt = 0
  private _radiusMeters: number
  private _friendlyCount: number
  private _hostileCount: number
  private _minSpeedMs: number
  private _maxSpeedMs: number
  private _tickRateHz = 4

  constructor(opts: {
    centerLat: number
    centerLon: number
    radiusMeters: number
    friendlyCount: number
    hostileCount: number
    minSpeedMs: number
    maxSpeedMs: number
  }) {
    super()
    this._centerLat = opts.centerLat
    this._centerLon = opts.centerLon
    this._radiusMeters = opts.radiusMeters
    this._friendlyCount = opts.friendlyCount
    this._hostileCount = opts.hostileCount
    this._minSpeedMs = Math.max(0, opts.minSpeedMs)
    this._maxSpeedMs = Math.max(this._minSpeedMs, opts.maxSpeedMs)
  }

  start(): void {
    if (this._interval) return
    this._initTracks()
    log.log(
      `started simulation: ${this._friendlyCount} friendly, ${this._hostileCount} hostile, radius=${this._radiusMeters}m`
    )
    this._interval = setInterval(() => this._tick(), 1000 / this._tickRateHz)
  }

  stop(): void {
    if (this._interval) {
      clearInterval(this._interval)
      this._interval = null
    }
    this._tracks = []
  }

  destroy(): void {
    this.stop()
    this.removeAllListeners()
  }

  setCenter(lat: number, lon: number): void {
    const dLat = lat - this._centerLat
    const dLon = lon - this._centerLon
    // Shift all tracks by the same delta so they follow the radar
    for (const t of this._tracks) {
      t.lat += dLat
      t.lon += dLon
    }
    this._centerLat = lat
    this._centerLon = lon
  }

  setRadius(meters: number): void {
    this._radiusMeters = meters
  }

  setSpeedRange(minMs: number, maxMs: number): void {
    this._minSpeedMs = Math.max(0, minMs)
    this._maxSpeedMs = Math.max(this._minSpeedMs, maxMs)
    // Re-clamp existing tracks into the new range so UI updates immediately
    // rather than waiting for the random-walk to drift targets into bounds.
    for (const t of this._tracks) {
      if (t.speed < this._minSpeedMs) t.speed = this._minSpeedMs
      else if (t.speed > this._maxSpeedMs) t.speed = this._maxSpeedMs
    }
  }

  private _initTracks(): void {
    this._tracks = []
    for (let i = 0; i < this._friendlyCount; i++) {
      this._tracks.push(this._createTrack('friendly'))
    }
    for (let i = 0; i < this._hostileCount; i++) {
      this._tracks.push(this._createTrack('hostile'))
    }
  }

  private _createTrack(affiliation: TrackAffiliation): SimTrack {
    const angle = Math.random() * 2 * Math.PI
    const dist = (0.3 + Math.random() * 0.6) * this._radiusMeters
    const dLat = (dist * Math.cos(angle)) / METERS_PER_DEG_LAT
    const dLon =
      (dist * Math.sin(angle)) / (METERS_PER_DEG_LAT * Math.cos(this._centerLat * DEG_TO_RAD))

    return {
      id: this._nextId++,
      affiliation,
      lat: this._centerLat + dLat,
      lon: this._centerLon + dLon,
      alt: 30 + Math.random() * 120,
      heading: Math.random() * 360,
      speed: this._minSpeedMs + Math.random() * (this._maxSpeedMs - this._minSpeedMs),
      baseStrength: -15 + Math.random() * 20,
      baseConfidence: 80 + Math.random() * 19
    }
  }

  private _tick(): void {
    const dt = 1 / this._tickRateHz

    // Emit radar unit
    const unit: RadarUnit = {
      id: 1,
      lat: this._centerLat,
      lon: this._centerLon,
      alt: this._centerAlt
    }
    this.emit('unitUpdate', unit)

    for (const t of this._tracks) {
      // Random-walk heading
      t.heading += (Math.random() - 0.5) * 30
      t.heading = ((t.heading % 360) + 360) % 360

      // Velocity from heading + speed
      const vn = t.speed * Math.cos(t.heading * DEG_TO_RAD)
      const ve = t.speed * Math.sin(t.heading * DEG_TO_RAD)
      const vd = (Math.random() - 0.5) * 0.5

      // Update position
      t.lat += (vn * dt) / METERS_PER_DEG_LAT
      t.lon += (ve * dt) / (METERS_PER_DEG_LAT * Math.cos(t.lat * DEG_TO_RAD))
      t.alt = Math.max(10, t.alt - vd * dt)

      // Boundary enforcement: steer back toward center when far out
      const dLat = t.lat - this._centerLat
      const dLon = t.lon - this._centerLon
      const dxMeters = dLon * METERS_PER_DEG_LAT * Math.cos(this._centerLat * DEG_TO_RAD)
      const dyMeters = dLat * METERS_PER_DEG_LAT
      const dist = Math.sqrt(dxMeters * dxMeters + dyMeters * dyMeters)

      if (dist > this._radiusMeters * 0.85) {
        const bearingToCenter = (Math.atan2(-dxMeters, -dyMeters) * (180 / Math.PI) + 360) % 360
        // Blend heading toward center
        let diff = bearingToCenter - t.heading
        if (diff > 180) diff -= 360
        if (diff < -180) diff += 360
        t.heading += diff * 0.15
      }

      const track: RadarTrack = {
        id: t.id,
        sourceId: 1,
        affiliation: t.affiliation,
        classification: 'uav',
        lat: t.lat,
        lon: t.lon,
        alt: t.alt,
        vn,
        ve,
        vd,
        strength: t.baseStrength + (Math.random() - 0.5) * 2,
        confidence: Math.max(50, Math.min(100, t.baseConfidence + (Math.random() - 0.5) * 5)),
        lastSeenMs: Date.now()
      }
      this.emit('trackUpdate', track)
    }
  }
}
