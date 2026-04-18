// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { EventEmitter } from 'events'
import { TargetTrackingManager } from '../src/main/tracking/TargetTrackingManager'
import type { VehicleManager } from '../src/main/vehicle/VehicleManager'
import type { RadarProxy } from '../src/main/radar/RadarProxy'
import type { SettingsManager } from '../src/main/settings/SettingsManager'
import type { RadarState, RadarTrack } from '../src/shared-types/ipc/RadarTypes'

type AltMode = 'hold-engagement' | 'match-track' | 'follow-vehicle'

interface Settings {
  trackingAltitudeMode: AltMode
  trackingAutoStopOnLost: boolean
  trackingAutoStopOnModeChange: boolean
  trackingAutoStopOnDisarm: boolean
}

function makeTrack(overrides: Partial<RadarTrack> = {}): RadarTrack {
  return {
    id: 1,
    sourceId: 1,
    affiliation: 'hostile',
    classification: 'uav',
    lat: 32.08,
    lon: 34.78,
    alt: 100,
    vn: 0,
    ve: 0,
    vd: 0,
    strength: 10,
    confidence: 90,
    lastSeenMs: Date.now(),
    ...overrides
  }
}

function makeRadarState(tracks: RadarTrack[]): RadarState {
  return {
    enabled: true,
    simulationActive: false,
    units: [{ id: 1, lat: 32.08, lon: 34.78, alt: 0 }],
    tracks
  }
}

function makeSnapshot(
  opts: {
    armed?: boolean
    modeName?: string
    alt?: number
    systemStatus?: number
    landedState?: number
    autopilot?: number
  } = {}
): {
  core: { armed: boolean; flightModeName: string; systemStatus: number; autopilot: number }
  extendedState: { landedState: number }
  gps: { alt: number }
  home: { alt: number; valid: boolean }
} {
  return {
    core: {
      armed: opts.armed ?? true,
      flightModeName: opts.modeName ?? 'Guided',
      systemStatus: opts.systemStatus ?? 4, // MAV_STATE_ACTIVE
      autopilot: opts.autopilot ?? 12 // MAV_AUTOPILOT_PX4 — drives isVehicleFlying via landedState
    },
    extendedState: { landedState: opts.landedState ?? 2 }, // MAV_LANDED_STATE_IN_AIR
    gps: { alt: opts.alt ?? 50 },
    home: { alt: 0, valid: true }
  }
}

interface Harness {
  tm: TargetTrackingManager
  radarProxy: RadarProxy & EventEmitter
  vehicleManager: VehicleManager & EventEmitter
  settings: Settings
  guidedGoto: ReturnType<typeof vi.fn>
  guidedPause: ReturnType<typeof vi.fn>
  guidedLaunch: ReturnType<typeof vi.fn>
  snapshot: ReturnType<typeof makeSnapshot>
  tick: () => void
}

function buildHarness(
  opts: { initialTracks?: RadarTrack[]; settings?: Partial<Settings> } = {}
): Harness {
  const initialState = makeRadarState(opts.initialTracks ?? [makeTrack()])
  const radarProxy = new EventEmitter() as RadarProxy & EventEmitter
  ;(radarProxy as unknown as { getState: () => RadarState }).getState = () => initialState

  const guidedGoto = vi.fn().mockResolvedValue({ result: 0 })
  const guidedPause = vi.fn().mockResolvedValue({ result: 0 })
  const guidedLaunch = vi.fn().mockResolvedValue({ result: 0 })
  const snapshot = makeSnapshot()

  const vehicle = {
    guidedGoto,
    guidedPause,
    guidedLaunch,
    state: { getSnapshot: () => snapshot }
  }

  const vehicleManager = new EventEmitter() as VehicleManager & EventEmitter
  ;(vehicleManager as unknown as { getVehicle: (id: number) => unknown }).getVehicle = (id) =>
    id === 1 ? vehicle : undefined

  const settings: Settings = {
    trackingAltitudeMode: 'hold-engagement',
    trackingAutoStopOnLost: true,
    trackingAutoStopOnModeChange: true,
    trackingAutoStopOnDisarm: true,
    ...opts.settings
  }
  const settingsManager = {
    get: <K extends keyof Settings>(key: K): Settings[K] => settings[key]
  } as unknown as SettingsManager

  vi.useFakeTimers()
  const tm = new TargetTrackingManager(vehicleManager, radarProxy, settingsManager)

  return {
    tm,
    radarProxy,
    vehicleManager,
    settings,
    guidedGoto,
    guidedPause,
    guidedLaunch,
    snapshot,
    tick: () => vi.advanceTimersByTime(1000)
  }
}

describe('TargetTrackingManager', () => {
  let h: Harness

  beforeEach(() => {
    h = buildHarness()
  })

  afterEach(() => {
    h.tm.destroy()
    vi.useRealTimers()
  })

  it('engage rejects when track is not in the hostile cache', () => {
    const result = h.tm.engage(1, 999)
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/not hostile/)
  })

  it('engage rejects when vehicle is missing', () => {
    // Add a hostile track then engage for a non-existent vehicle
    h.radarProxy.emit('stateChanged', makeRadarState([makeTrack({ id: 5 })]))
    const result = h.tm.engage(999, 5)
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/Vehicle not found/)
  })

  it('engage rejects when vehicle is not armed', () => {
    h.snapshot.core.armed = false
    const result = h.tm.engage(1, 1)
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/not armed/)
  })

  it('engage on armed-ground vehicle calls guidedLaunch and does NOT send guidedGoto yet', () => {
    h.snapshot.extendedState.landedState = 1 // MAV_LANDED_STATE_ON_GROUND
    h.snapshot.core.flightModeName = 'Manual' // pre-launch mode is not in GUIDED_MODES
    const result = h.tm.engage(1, 1)
    expect(result.ok).toBe(true)
    expect(h.guidedLaunch).toHaveBeenCalledTimes(1)
    expect(h.guidedGoto).not.toHaveBeenCalled()
  })

  it('tick while launching (still on ground in Auto:Takeoff): no mode-change auto-stop, no goto', () => {
    h.snapshot.extendedState.landedState = 1 // ON_GROUND
    h.snapshot.core.flightModeName = 'Manual'
    h.tm.engage(1, 1)
    h.guidedLaunch.mockClear()

    const lost: Array<{ reason: string }> = []
    h.tm.on('engagementLost', (p) => lost.push(p))

    // PX4 has switched us to Auto:Takeoff but we're still on the rail —
    // landed_state still ON_GROUND. Tick must not auto-stop and must not goto.
    h.snapshot.core.flightModeName = 'Auto:Takeoff'
    h.tick()

    expect(lost).toEqual([])
    expect(h.tm.getEngagement(1)).toEqual({ trackId: 1 })
    expect(h.guidedGoto).not.toHaveBeenCalled()
  })

  it('tick after landed_state ON_GROUND→IN_AIR: promotes to pursuing and sends first guidedGoto', () => {
    h.snapshot.extendedState.landedState = 1
    h.snapshot.core.flightModeName = 'Manual'
    h.tm.engage(1, 1)
    h.guidedGoto.mockClear()

    // Still on the ground: tick must NOT send goto.
    h.snapshot.core.flightModeName = 'Auto:Takeoff'
    h.tick()
    expect(h.guidedGoto).not.toHaveBeenCalled()

    // Now airborne — PX4 typically transitions to Auto:Loiter after climb-out.
    h.snapshot.extendedState.landedState = 2 // IN_AIR
    h.snapshot.core.flightModeName = 'Auto:Loiter'
    h.tick()
    expect(h.guidedGoto).toHaveBeenCalledTimes(1)
    expect(h.guidedGoto).toHaveBeenLastCalledWith(32.08, 34.78, 50)
  })

  it('engage rejects when vehicle is not in Guided mode', () => {
    h.snapshot.core.flightModeName = 'Loiter'
    const result = h.tm.engage(1, 1)
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/Guided/)
  })

  it('engage accepts hostile track, emits engagementChanged, and sends initial guidedGoto', async () => {
    const emitted: Array<{ vehicleId: number; trackId: number | null }> = []
    h.tm.on('engagementChanged', (p) => emitted.push(p))

    const result = h.tm.engage(1, 1)
    expect(result.ok).toBe(true)
    expect(emitted).toEqual([{ vehicleId: 1, trackId: 1 }])
    expect(h.guidedGoto).toHaveBeenCalledTimes(1)
    expect(h.guidedGoto).toHaveBeenCalledWith(32.08, 34.78, 50)
  })

  it('hold-engagement mode: held alt is reused across ticks even as track.alt drifts', () => {
    h.tm.engage(1, 1)
    expect(h.guidedGoto).toHaveBeenLastCalledWith(32.08, 34.78, 50)
    h.guidedGoto.mockClear()

    // Track moves horizontally (so stationary filter doesn't skip) and changes altitude
    h.radarProxy.emit(
      'stateChanged',
      makeRadarState([makeTrack({ lat: 32.09, lon: 34.79, alt: 999 })])
    )
    h.tick()
    expect(h.guidedGoto).toHaveBeenCalledTimes(1)
    expect(h.guidedGoto).toHaveBeenLastCalledWith(32.09, 34.79, 50) // held alt, not 999
  })

  it('match-track mode: target alt mirrors track.alt each tick', () => {
    h.settings.trackingAltitudeMode = 'match-track'
    h.tm.engage(1, 1)
    // Initial call uses track.alt = 100
    expect(h.guidedGoto).toHaveBeenLastCalledWith(32.08, 34.78, 100)
    h.guidedGoto.mockClear()

    h.radarProxy.emit(
      'stateChanged',
      makeRadarState([makeTrack({ lat: 32.09, lon: 34.79, alt: 250 })])
    )
    h.tick()
    expect(h.guidedGoto).toHaveBeenLastCalledWith(32.09, 34.79, 250)
  })

  it('follow-vehicle mode: target alt mirrors live vehicle alt each tick', () => {
    h.settings.trackingAltitudeMode = 'follow-vehicle'
    h.tm.engage(1, 1)
    h.guidedGoto.mockClear()

    h.snapshot.gps.alt = 77
    h.radarProxy.emit('stateChanged', makeRadarState([makeTrack({ lat: 32.09, lon: 34.79 })]))
    h.tick()
    expect(h.guidedGoto).toHaveBeenLastCalledWith(32.09, 34.79, 77)
  })

  it('hold-engagement: skips resend when track moves < 1m', () => {
    h.tm.engage(1, 1)
    h.guidedGoto.mockClear()

    // Tiny jitter (< 1m)
    h.radarProxy.emit(
      'stateChanged',
      makeRadarState([makeTrack({ lat: 32.080001, lon: 34.780001 })])
    )
    h.tick()
    expect(h.guidedGoto).not.toHaveBeenCalled()
  })

  it('auto-stop on stale: disengages + emits engagementLost + pauses', () => {
    const lost: Array<{ vehicleId: number; trackId: number; reason: string }> = []
    h.tm.on('engagementLost', (p) => lost.push(p))
    h.tm.engage(1, 1)

    // Track disappears
    h.radarProxy.emit('stateChanged', makeRadarState([]))
    h.tick()

    expect(lost).toEqual([{ vehicleId: 1, trackId: 1, reason: 'stale' }])
    expect(h.guidedPause).toHaveBeenCalledTimes(1)
    expect(h.tm.getEngagement(1)).toBeNull()
  })

  it('auto-stop on mode-change: emits reason mode-changed, does NOT call guidedPause', () => {
    const lost: Array<{ reason: string }> = []
    h.tm.on('engagementLost', (p) => lost.push(p))
    h.tm.engage(1, 1)

    h.snapshot.core.flightModeName = 'Loiter'
    h.tick()

    expect(lost).toEqual([expect.objectContaining({ reason: 'mode-changed' })])
    expect(h.guidedPause).not.toHaveBeenCalled()
    expect(h.tm.getEngagement(1)).toBeNull()
  })

  it('auto-stop on disarm: emits reason disarmed, does NOT call guidedPause', () => {
    const lost: Array<{ reason: string }> = []
    h.tm.on('engagementLost', (p) => lost.push(p))
    h.tm.engage(1, 1)

    h.snapshot.core.armed = false
    h.tick()

    expect(lost).toEqual([expect.objectContaining({ reason: 'disarmed' })])
    expect(h.guidedPause).not.toHaveBeenCalled()
  })

  it('auto-stop disabled: stale track does NOT disengage', () => {
    h.tm.destroy()
    vi.useRealTimers()
    h = buildHarness({ settings: { trackingAutoStopOnLost: false } })

    const lost = vi.fn()
    h.tm.on('engagementLost', lost)
    h.tm.engage(1, 1)
    h.guidedGoto.mockClear()

    h.radarProxy.emit('stateChanged', makeRadarState([]))
    h.tick()

    expect(lost).not.toHaveBeenCalled()
    expect(h.guidedGoto).not.toHaveBeenCalled()
    expect(h.tm.getEngagement(1)).toEqual({ trackId: 1 })
  })

  it('manual disengage: clears engagement and issues guidedPause', () => {
    h.tm.engage(1, 1)
    h.tm.disengage(1)
    expect(h.guidedPause).toHaveBeenCalledTimes(1)
    expect(h.tm.getEngagement(1)).toBeNull()
  })

  it('re-engage with a different track emits engagementChanged twice', () => {
    const emitted: Array<{ trackId: number | null }> = []
    h.tm.on('engagementChanged', (p) => emitted.push(p))

    h.radarProxy.emit('stateChanged', makeRadarState([makeTrack({ id: 1 }), makeTrack({ id: 2 })]))
    h.tm.engage(1, 1)
    h.tm.engage(1, 2)

    expect(emitted).toEqual([
      { vehicleId: 1, trackId: 1 },
      { vehicleId: 1, trackId: 2 }
    ])
    expect(h.tm.getEngagement(1)).toEqual({ trackId: 2 })
  })

  it('vehicleRemoved clears engagement silently', () => {
    const emitted: Array<{ trackId: number | null }> = []
    h.tm.on('engagementChanged', (p) => emitted.push(p))
    h.tm.engage(1, 1)
    expect(emitted).toEqual([{ vehicleId: 1, trackId: 1 }])

    h.vehicleManager.emit('vehicleRemoved', 1)
    expect(emitted).toEqual([
      { vehicleId: 1, trackId: 1 },
      { vehicleId: 1, trackId: null }
    ])
    expect(h.tm.getEngagement(1)).toBeNull()
  })

  it('destroy stops the tick loop and clears engagements', () => {
    h.tm.engage(1, 1)
    h.guidedGoto.mockClear()
    h.tm.destroy()

    h.radarProxy.emit('stateChanged', makeRadarState([makeTrack({ lat: 32.1, lon: 34.9 })]))
    vi.advanceTimersByTime(5000)
    expect(h.guidedGoto).not.toHaveBeenCalled()
  })
})
