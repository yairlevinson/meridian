import type { RpcCommandImpls } from '@shared/rpc'
import type { VehicleModule } from '@shared/ipc/modules/vehicle'
import type { MavCommandRequest } from '@shared/ipc/MavCommandRequest'

type CommandParams = {
  p1?: number
  p2?: number
  p3?: number
  p4?: number
  p5?: number
  p6?: number
  p7?: number
}

export interface VehicleCommandTargetLike {
  arm: () => Promise<unknown> | unknown
  forceArm: () => Promise<unknown> | unknown
  disarm: () => Promise<unknown> | unknown
  commandQueue: {
    sendCommand: (
      command: MavCommandRequest['command'],
      vehicleId: number,
      componentId: number,
      params: CommandParams
    ) => Promise<unknown> | unknown
  }
  setFlightModeByName: (modeName: string) => Promise<number | undefined> | number | undefined
  guidedTakeoff: (altitude: number) => Promise<number | undefined> | number | undefined
  guidedRTL: () => Promise<unknown> | unknown
  guidedLand: () => Promise<unknown> | unknown
  guidedGoto: (lat: number, lon: number, alt: number) => Promise<unknown> | unknown
  guidedPause: () => Promise<unknown> | unknown
  missionStart: () => Promise<unknown> | unknown
  emergencyStop: () => Promise<unknown> | unknown
  guidedChangeAltitude: (altitudeRel: number) => Promise<number | undefined> | number | undefined
  guidedChangeHeading: (headingDeg: number) => Promise<number | undefined> | number | undefined
  guidedChangeSpeed: (
    speed: number,
    speedType: 0 | 1
  ) => Promise<number | undefined> | number | undefined
  guidedOrbit: (
    lat: number,
    lon: number,
    radius: number,
    altitudeRel: number
  ) => Promise<number | undefined> | number | undefined
  landingGearDeploy: () => Promise<number | undefined> | number | undefined
  landingGearRetract: () => Promise<number | undefined> | number | undefined
}

export interface VehicleCommandManagerLike {
  getVehicle: (vehicleId: number) => VehicleCommandTargetLike | undefined
}

export interface TargetTrackingManagerLike {
  engage: (vehicleId: number, trackId: number) => { ok: boolean; error?: string }
  disengage: (vehicleId: number) => void
  getEngagement: (vehicleId: number) => { trackId: number } | null
}

export function createVehicleCommandHandlers(
  vehicleManager: VehicleCommandManagerLike | null,
  trackingManager: TargetTrackingManagerLike | null
): RpcCommandImpls<VehicleModule> {
  const requireVehicleManager = (): VehicleCommandManagerLike => {
    if (!vehicleManager) throw new Error('VehicleManager not available')
    return vehicleManager
  }

  const requireVehicle = (vehicleId: number) => {
    const vehicle = requireVehicleManager().getVehicle(vehicleId)
    if (!vehicle) throw new Error(`Vehicle ${vehicleId} not available`)
    return vehicle
  }

  return {
    arm: async (vehicleId) => {
      await requireVehicle(vehicleId).arm()
    },
    forceArm: async (vehicleId) => {
      await requireVehicle(vehicleId).forceArm()
    },
    disarm: async (vehicleId) => {
      await requireVehicle(vehicleId).disarm()
    },
    sendMavCommand: async (req) => {
      await requireVehicle(req.vehicleId).commandQueue.sendCommand(
        req.command,
        req.vehicleId,
        req.componentId,
        {
          p1: req.param1,
          p2: req.param2,
          p3: req.param3,
          p4: req.param4,
          p5: req.param5,
          p6: req.param6,
          p7: req.param7
        }
      )
    },
    setFlightMode: async (vehicleId, modeName) =>
      requireVehicle(vehicleId).setFlightModeByName(modeName),
    guidedTakeoff: async (vehicleId, altitude) => requireVehicle(vehicleId).guidedTakeoff(altitude),
    guidedRTL: async (vehicleId) => {
      await requireVehicle(vehicleId).guidedRTL()
    },
    guidedLand: async (vehicleId) => {
      await requireVehicle(vehicleId).guidedLand()
    },
    guidedGoto: async (vehicleId, lat, lon, alt) => {
      await requireVehicle(vehicleId).guidedGoto(lat, lon, alt)
    },
    guidedPause: async (vehicleId) => {
      await requireVehicle(vehicleId).guidedPause()
    },
    missionStart: async (vehicleId) => {
      await requireVehicle(vehicleId).missionStart()
    },
    emergencyStop: async (vehicleId) => {
      await requireVehicle(vehicleId).emergencyStop()
    },
    guidedChangeAltitude: async (vehicleId, altitudeRel) =>
      requireVehicle(vehicleId).guidedChangeAltitude(altitudeRel),
    guidedChangeHeading: async (vehicleId, headingDeg) =>
      requireVehicle(vehicleId).guidedChangeHeading(headingDeg),
    guidedChangeSpeed: async (vehicleId, speed, speedType) =>
      requireVehicle(vehicleId).guidedChangeSpeed(speed, speedType),
    guidedOrbit: async (vehicleId, lat, lon, radius, altitudeRel) =>
      requireVehicle(vehicleId).guidedOrbit(lat, lon, radius, altitudeRel),
    landingGearDeploy: async (vehicleId) => requireVehicle(vehicleId).landingGearDeploy(),
    landingGearRetract: async (vehicleId) => requireVehicle(vehicleId).landingGearRetract(),
    trackingEngage: async (vehicleId, trackId) => {
      if (!trackingManager) return { ok: false, error: 'Tracking manager not available' }
      return trackingManager.engage(vehicleId, trackId)
    },
    trackingDisengage: async (vehicleId) => {
      trackingManager?.disengage(vehicleId)
    },
    trackingGetEngagement: async (vehicleId) => trackingManager?.getEngagement(vehicleId) ?? null
  }
}
