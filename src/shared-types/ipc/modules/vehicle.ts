import { command, event, defineIpcModule } from '../ipcModule'
import type { MavCommandRequest } from '../MavCommandRequest'
import type { VehicleDeltaPayload } from '../VehicleState'

export const vehicleModule = defineIpcModule({
  name: 'vehicle',
  commands: {
    arm: command<[vehicleId: number], void>(),
    forceArm: command<[vehicleId: number], void>(),
    disarm: command<[vehicleId: number], void>(),
    sendMavCommand: command<[req: MavCommandRequest], void>(),
    setFlightMode: command<[vehicleId: number, modeName: string], number | undefined>(),
    guidedTakeoff: command<[vehicleId: number, altitude: number], number | undefined>(),
    guidedRTL: command<[vehicleId: number], void>(),
    guidedLand: command<[vehicleId: number], void>(),
    guidedGoto: command<[vehicleId: number, lat: number, lon: number, alt: number], void>(),
    guidedPause: command<[vehicleId: number], void>(),
    missionStart: command<[vehicleId: number], void>(),
    emergencyStop: command<[vehicleId: number], void>(),
    guidedChangeAltitude: command<[vehicleId: number, altitudeRel: number], number | undefined>(),
    guidedChangeHeading: command<[vehicleId: number, headingDeg: number], number | undefined>(),
    guidedChangeSpeed: command<
      [vehicleId: number, speed: number, speedType: 0 | 1],
      number | undefined
    >(),
    guidedOrbit: command<
      [vehicleId: number, lat: number, lon: number, radius: number, altitudeRel: number],
      number | undefined
    >(),
    landingGearDeploy: command<[vehicleId: number], number | undefined>(),
    landingGearRetract: command<[vehicleId: number], number | undefined>(),
    trackingEngage: command<
      [vehicleId: number, trackId: number],
      { ok: boolean; error?: string }
    >(),
    trackingDisengage: command<[vehicleId: number], void>(),
    trackingGetEngagement: command<[vehicleId: number], { trackId: number } | null>()
  },
  events: {
    added: event<{ vehicleId: number }>(),
    removed: event<{ vehicleId: number }>(),
    delta: event<VehicleDeltaPayload>(),
    statusText: event<{ vehicleId: number; severity: number; text: string }>(),
    trackingChanged: event<{ vehicleId: number; trackId: number | null }>(),
    trackingLost: event<{
      vehicleId: number
      trackId: number
      reason: 'stale' | 'mode-changed' | 'disarmed'
    }>()
  }
})

export type VehicleModule = typeof vehicleModule
