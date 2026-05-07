import { EventEmitter } from 'events'
import type { VehicleManager } from '../vehicle/VehicleManager'
import type { SettingsManager } from '../settings/SettingsManager'
import type { RadarState, RadarTrack } from '@shared/ipc/RadarTypes'
import { isVehicleFlying } from '@shared/ipc/vehicleStatus'
import { createLogger } from '../logger'

const log = createLogger('TargetTracking')

const TICK_MS = 1000
const MIN_SEND_GAP_MS = 900
const STATIONARY_THRESHOLD_M = 1

export type TrackingLostReason = 'stale' | 'mode-changed' | 'disarmed'

export interface TrackingEngagementChangedPayload {
  vehicleId: number
  trackId: number | null
}

export interface TrackingEngagementLostPayload {
  vehicleId: number
  trackId: number
  reason: TrackingLostReason
}

export type TrackingRadarSource = Pick<EventEmitter, 'on' | 'removeListener'> & {
  getState: () => RadarState
}

interface Engagement {
  trackId: number
  heldAltMsl: number
  lastSentAt: number
  lastLat: number
  lastLon: number
  /**
   * 'launching' = engage was issued while the vehicle was on the ground; we've
   * sent the launch sequence (mode → arm) and are waiting for landed_state to
   * become IN_AIR before sending the first goto.
   */
  phase: 'launching' | 'pursuing'
}

const GUIDED_MODES = new Set([
  // ArduPilot
  'Guided',
  'GuidedNoGPS',
  // PX4
  'Auto:Loiter',
  'Auto:Takeoff',
  'Auto:Mission',
  'Offboard'
])

function isGuidedMode(modeName: string): boolean {
  return GUIDED_MODES.has(modeName)
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000
  const toRad = Math.PI / 180
  const dLat = (lat2 - lat1) * toRad
  const dLon = (lon2 - lon1) * toRad
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

/**
 * Drives continuous target tracking: when a vehicle is engaged on a hostile
 * radar track, periodically re-sends `guidedGoto` with the track's latest
 * position. Auto-disengages based on user-configurable conditions (track lost,
 * flight mode change, disarm). Altitude behavior is settings-driven.
 */
export class TargetTrackingManager extends EventEmitter {
  private _vehicleManager: VehicleManager
  private _radarProxy: TrackingRadarSource
  private _settings: SettingsManager
  private _engagements = new Map<number, Engagement>()
  private _latestHostileTracks = new Map<number, RadarTrack>()
  private _tickInterval: ReturnType<typeof setInterval> | null = null

  private _onRadarState = (state: RadarState): void => {
    this._latestHostileTracks.clear()
    for (const track of state.tracks) {
      if (track.affiliation === 'hostile') {
        this._latestHostileTracks.set(track.id, track)
      }
    }
  }

  private _onVehicleRemoved = (sysid: number): void => {
    if (this._engagements.has(sysid)) {
      log.log(`vehicleRemoved: clearing engagement for vehicle ${sysid}`)
      this._engagements.delete(sysid)
      this.emit('engagementChanged', {
        vehicleId: sysid,
        trackId: null
      } satisfies TrackingEngagementChangedPayload)
    }
  }

  constructor(
    vehicleManager: VehicleManager,
    radarProxy: TrackingRadarSource,
    settings: SettingsManager
  ) {
    super()
    this._vehicleManager = vehicleManager
    this._radarProxy = radarProxy
    this._settings = settings

    // Seed hostile cache from whatever radar state has already been observed.
    const initial = radarProxy.getState()
    this._onRadarState(initial)

    this._radarProxy.on('stateChanged', this._onRadarState)
    this._vehicleManager.on('vehicleRemoved', this._onVehicleRemoved)

    this._tickInterval = setInterval(() => this._tick(), TICK_MS)
  }

  /**
   * Start tracking a hostile track for a given vehicle. Replaces any existing
   * engagement. Returns `{ok:false, error}` with human-readable reason on
   * validation failure.
   */
  engage(vehicleId: number, trackId: number): { ok: boolean; error?: string } {
    log.log(`engage attempt: vehicle=${vehicleId} track=${trackId}`)
    const track = this._latestHostileTracks.get(trackId)
    if (!track) {
      const hostiles = Array.from(this._latestHostileTracks.keys()).join(',') || 'none'
      log.warn(
        `engage rejected: track ${trackId} not in hostile cache (cached hostiles: ${hostiles})`
      )
      return { ok: false, error: 'Track is not hostile or no longer visible' }
    }

    const vehicle = this._vehicleManager.getVehicle(vehicleId)
    if (!vehicle) {
      log.warn(`engage rejected: vehicle ${vehicleId} not found`)
      return { ok: false, error: 'Vehicle not found' }
    }

    const snapshot = vehicle.state.getSnapshot()
    log.debug(
      `engage snapshot: armed=${snapshot.core.armed} mode="${snapshot.core.flightModeName}" ` +
        `systemStatus=${snapshot.core.systemStatus} landedState=${snapshot.extendedState.landedState} ` +
        `gpsAlt=${snapshot.gps.alt} home.valid=${snapshot.home.valid} home.alt=${snapshot.home.alt}`
    )
    if (!snapshot.core.armed) {
      log.warn(`engage rejected: vehicle ${vehicleId} not armed`)
      return { ok: false, error: 'Vehicle is not armed' }
    }

    const flying = isVehicleFlying(snapshot.core, snapshot.extendedState)
    const phase: Engagement['phase'] = flying ? 'pursuing' : 'launching'

    // Guided-mode gate only matters when already flying. When launching, we'll
    // override the mode (→ Auto:Takeoff) ourselves, then PX4 transitions to
    // Auto:Loiter on climb-out which is in GUIDED_MODES.
    if (phase === 'pursuing' && !isGuidedMode(snapshot.core.flightModeName)) {
      log.warn(
        `engage rejected: vehicle ${vehicleId} mode="${snapshot.core.flightModeName}" is not in GUIDED_MODES ` +
          `(allowed: ${Array.from(GUIDED_MODES).join(',')})`
      )
      return {
        ok: false,
        error: `Vehicle must be in Guided mode (is ${snapshot.core.flightModeName || 'unknown'})`
      }
    }

    const heldAltMsl = this._resolveEngagementAltitude(snapshot.gps.alt, snapshot.home)
    if (!Number.isFinite(heldAltMsl) || heldAltMsl === 0) {
      log.warn(
        `engage rejected: no valid altitude (gpsAlt=${snapshot.gps.alt} homeValid=${snapshot.home.valid} homeAlt=${snapshot.home.alt})`
      )
      return { ok: false, error: 'No valid altitude available' }
    }

    const now = Date.now()
    this._engagements.set(vehicleId, {
      trackId,
      heldAltMsl,
      lastSentAt: 0,
      lastLat: track.lat,
      lastLon: track.lon,
      phase
    })
    log.log(
      `engage accepted: vehicle=${vehicleId} track=${trackId} phase=${phase} ` +
        `trackLat=${track.lat.toFixed(6)} trackLon=${track.lon.toFixed(6)} trackAlt=${track.alt.toFixed(1)} ` +
        `heldAltMsl=${heldAltMsl.toFixed(1)}`
    )
    this.emit('engagementChanged', {
      vehicleId,
      trackId
    } satisfies TrackingEngagementChangedPayload)

    if (phase === 'launching') {
      // On-rail / on-ground: send launch sequence (PX4 plane: mode → arm) and
      // wait for landed_state=IN_AIR in the tick loop before the first goto.
      log.log(`launching: vehicle=${vehicleId} — waiting for IN_AIR before first guidedGoto`)
      vehicle
        .guidedLaunch()
        .then((result) =>
          log.debug(`guidedLaunch ack: vehicle=${vehicleId} result=${JSON.stringify(result)}`)
        )
        .catch((err) => log.warn(`guidedLaunch failed: ${err?.message ?? err}`))
      return { ok: true }
    }

    // phase === 'pursuing': send the first goto immediately so the vehicle
    // starts moving without waiting for the next tick.
    const altMode = this._settings.get('trackingAltitudeMode')
    const targetAlt = this._resolveTargetAlt(
      altMode,
      this._engagements.get(vehicleId)!,
      track,
      snapshot.gps.alt
    )
    log.debug(
      `initial guidedGoto: vehicle=${vehicleId} lat=${track.lat.toFixed(6)} lon=${track.lon.toFixed(6)} ` +
        `alt=${targetAlt.toFixed(1)} altMode=${altMode}`
    )
    vehicle
      .guidedGoto(track.lat, track.lon, targetAlt)
      .then((result) => {
        log.debug(`initial guidedGoto ack: vehicle=${vehicleId} result=${JSON.stringify(result)}`)
        const eng = this._engagements.get(vehicleId)
        if (eng) {
          eng.lastSentAt = Date.now()
          eng.lastLat = track.lat
          eng.lastLon = track.lon
        }
      })
      .catch((err) => log.warn(`initial guidedGoto failed: ${err?.message ?? err}`))
    // Approximate lastSentAt now to rate-limit subsequent tick even if the
    // promise resolves later than expected.
    this._engagements.get(vehicleId)!.lastSentAt = now

    return { ok: true }
  }

  /** Manual disengage: pause vehicle and clear engagement. */
  disengage(vehicleId: number): void {
    log.log(`disengage request: vehicle=${vehicleId}`)
    this._disengageInternal(vehicleId, { pause: true })
  }

  getEngagement(vehicleId: number): { trackId: number } | null {
    const e = this._engagements.get(vehicleId)
    return e ? { trackId: e.trackId } : null
  }

  destroy(): void {
    if (this._tickInterval) {
      clearInterval(this._tickInterval)
      this._tickInterval = null
    }
    this._radarProxy.removeListener('stateChanged', this._onRadarState)
    this._vehicleManager.removeListener('vehicleRemoved', this._onVehicleRemoved)
    this._engagements.clear()
    this._latestHostileTracks.clear()
    this.removeAllListeners()
  }

  private _disengageInternal(
    vehicleId: number,
    opts: { pause: boolean; lost?: TrackingLostReason }
  ): void {
    const engagement = this._engagements.get(vehicleId)
    if (!engagement) return
    this._engagements.delete(vehicleId)
    log.log(
      `disengage: vehicle=${vehicleId} track=${engagement.trackId} pause=${opts.pause} lost=${opts.lost ?? 'none'}`
    )

    if (opts.pause) {
      const vehicle = this._vehicleManager.getVehicle(vehicleId)
      vehicle
        ?.guidedPause()
        .then((result) =>
          log.debug(`guidedPause ack: vehicle=${vehicleId} result=${JSON.stringify(result)}`)
        )
        .catch((err) => log.warn(`guidedPause failed: ${err?.message ?? err}`))
    }

    this.emit('engagementChanged', {
      vehicleId,
      trackId: null
    } satisfies TrackingEngagementChangedPayload)

    if (opts.lost) {
      log.log(
        `auto-disengage: vehicle=${vehicleId} track=${engagement.trackId} reason=${opts.lost}`
      )
      this.emit('engagementLost', {
        vehicleId,
        trackId: engagement.trackId,
        reason: opts.lost
      } satisfies TrackingEngagementLostPayload)
    }
  }

  private _tick(): void {
    if (this._engagements.size === 0) return
    const altMode = this._settings.get('trackingAltitudeMode')
    const autoStopOnLost = this._settings.get('trackingAutoStopOnLost')
    const autoStopOnModeChange = this._settings.get('trackingAutoStopOnModeChange')
    const autoStopOnDisarm = this._settings.get('trackingAutoStopOnDisarm')
    const now = Date.now()

    for (const [vehicleId, engagement] of Array.from(this._engagements.entries())) {
      const track = this._latestHostileTracks.get(engagement.trackId)
      if (!track) {
        log.debug(
          `tick: vehicle=${vehicleId} track=${engagement.trackId} not in hostile cache ` +
            `(autoStopOnLost=${autoStopOnLost})`
        )
        if (autoStopOnLost) {
          this._disengageInternal(vehicleId, { pause: true, lost: 'stale' })
        }
        continue
      }

      const vehicle = this._vehicleManager.getVehicle(vehicleId)
      if (!vehicle) {
        log.warn(`tick: vehicle=${vehicleId} no longer exists, clearing engagement`)
        this._disengageInternal(vehicleId, { pause: false })
        continue
      }

      const snapshot = vehicle.state.getSnapshot()

      if (engagement.phase === 'launching') {
        // Don't auto-stop on mode-change while launching: PX4 is in Auto:Takeoff
        // by design until climb-out, when it transitions to Auto:Loiter (in
        // GUIDED_MODES). Wait for landed_state to flip to IN_AIR, then send the
        // first goto and continue normally.
        if (!snapshot.core.armed) {
          log.debug(`tick(launching): vehicle=${vehicleId} disarmed before takeoff`)
          if (autoStopOnDisarm) {
            this._disengageInternal(vehicleId, { pause: false, lost: 'disarmed' })
          }
          continue
        }
        if (!isVehicleFlying(snapshot.core, snapshot.extendedState)) {
          log.debug(
            `tick(launching): vehicle=${vehicleId} not yet airborne ` +
              `(mode="${snapshot.core.flightModeName}" landedState=${snapshot.extendedState.landedState})`
          )
          continue
        }
        // Airborne — promote to pursuing and send the first goto inline,
        // bypassing rate-limit and stationary filter (mirrors the initial
        // guidedGoto in engage()).
        engagement.phase = 'pursuing'
        log.log(
          `launching → pursuing: vehicle=${vehicleId} track=${engagement.trackId} ` +
            `(mode="${snapshot.core.flightModeName}" landedState=${snapshot.extendedState.landedState})`
        )
        const firstAlt = this._resolveTargetAlt(altMode, engagement, track, snapshot.gps.alt)
        engagement.lastSentAt = now
        engagement.lastLat = track.lat
        engagement.lastLon = track.lon
        log.debug(
          `first guidedGoto after launch: vehicle=${vehicleId} ` +
            `lat=${track.lat.toFixed(6)} lon=${track.lon.toFixed(6)} alt=${firstAlt.toFixed(1)} altMode=${altMode}`
        )
        vehicle
          .guidedGoto(track.lat, track.lon, firstAlt)
          .then((result) =>
            log.debug(`first guidedGoto ack: vehicle=${vehicleId} result=${JSON.stringify(result)}`)
          )
          .catch((err) => log.warn(`first guidedGoto failed: ${err?.message ?? err}`))
        continue
      } else if (!isGuidedMode(snapshot.core.flightModeName)) {
        log.debug(
          `tick: vehicle=${vehicleId} left guided mode (now "${snapshot.core.flightModeName}", ` +
            `autoStopOnModeChange=${autoStopOnModeChange})`
        )
        if (autoStopOnModeChange) {
          // Mode already changed — don't send a pause (would fight the user's
          // choice). Clear engagement silently and emit a notice.
          this._disengageInternal(vehicleId, { pause: false, lost: 'mode-changed' })
        }
        continue
      }

      if (!snapshot.core.armed) {
        log.debug(`tick: vehicle=${vehicleId} disarmed (autoStopOnDisarm=${autoStopOnDisarm})`)
        if (autoStopOnDisarm) {
          this._disengageInternal(vehicleId, { pause: false, lost: 'disarmed' })
        }
        continue
      }

      if (now - engagement.lastSentAt < MIN_SEND_GAP_MS) {
        log.debug(
          `tick: vehicle=${vehicleId} rate-limited (${now - engagement.lastSentAt}ms since last send < ${MIN_SEND_GAP_MS}ms)`
        )
        continue
      }

      // For hold-engagement, skip tiny horizontal jitter. For other modes the
      // target alt can change every tick so always resend.
      if (altMode === 'hold-engagement') {
        const moved = haversineMeters(engagement.lastLat, engagement.lastLon, track.lat, track.lon)
        if (moved < STATIONARY_THRESHOLD_M) {
          log.debug(
            `tick: vehicle=${vehicleId} track moved ${moved.toFixed(2)}m < ${STATIONARY_THRESHOLD_M}m (hold-engagement), skipping`
          )
          continue
        }
      }

      const targetAlt = this._resolveTargetAlt(altMode, engagement, track, snapshot.gps.alt)

      engagement.lastSentAt = now
      engagement.lastLat = track.lat
      engagement.lastLon = track.lon

      log.debug(
        `tick guidedGoto: vehicle=${vehicleId} track=${engagement.trackId} ` +
          `lat=${track.lat.toFixed(6)} lon=${track.lon.toFixed(6)} alt=${targetAlt.toFixed(1)} ` +
          `altMode=${altMode} vehAlt=${snapshot.gps.alt.toFixed(1)} vehMode="${snapshot.core.flightModeName}" ` +
          `vehStatus=${snapshot.core.systemStatus}`
      )
      vehicle
        .guidedGoto(track.lat, track.lon, targetAlt)
        .then((result) =>
          log.debug(`tick guidedGoto ack: vehicle=${vehicleId} result=${JSON.stringify(result)}`)
        )
        .catch((err) => log.warn(`guidedGoto failed: ${err?.message ?? err}`))
    }
  }

  private _resolveTargetAlt(
    mode: 'hold-engagement' | 'match-track' | 'follow-vehicle',
    engagement: Engagement,
    track: RadarTrack,
    liveVehicleMsl: number
  ): number {
    switch (mode) {
      case 'match-track':
        return track.alt
      case 'follow-vehicle':
        return Number.isFinite(liveVehicleMsl) && liveVehicleMsl !== 0
          ? liveVehicleMsl
          : engagement.heldAltMsl
      case 'hold-engagement':
      default:
        return engagement.heldAltMsl
    }
  }

  private _resolveEngagementAltitude(
    gpsAlt: number,
    home: { alt: number; valid: boolean }
  ): number {
    if (Number.isFinite(gpsAlt) && gpsAlt !== 0) return gpsAlt
    if (home.valid && Number.isFinite(home.alt)) return home.alt
    return NaN
  }
}
