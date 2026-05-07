import type { RpcCommandImpls } from '@shared/rpc'
import type { VehicleModule } from '@shared/ipc/modules/vehicle'
import type { TargetTrackingManager } from '../../main/tracking/TargetTrackingManager'
import type { VehicleManager } from '../../main/vehicle/VehicleManager'

export function createVehicleCommandHandlers(
  vehicleManager: VehicleManager | null,
  trackingManager: TargetTrackingManager | null
): RpcCommandImpls<VehicleModule> {
  const requireVehicleManager = (): VehicleManager => {
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
