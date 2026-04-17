import { useCallback } from 'react'
import { useVehicleStore } from '../store/vehicleStore'

/** Hook: typed command dispatchers via bridge, targeting active vehicle */
export function useCommand(vehicleIdOverride?: number): {
  arm: () => Promise<void> | undefined
  forceArm: () => Promise<void> | undefined
  disarm: () => Promise<void> | undefined
  setFlightMode: (modeName: string) => Promise<number | undefined> | undefined
  guidedTakeoff: (altitude: number) => Promise<number | undefined> | undefined
  guidedRTL: () => Promise<void> | undefined
  guidedLand: () => Promise<void> | undefined
  guidedGoto: (lat: number, lon: number, alt: number) => Promise<void> | undefined
  guidedPause: () => Promise<void> | undefined
  emergencyStop: () => Promise<void> | undefined
  guidedChangeAltitude: (altitudeRel: number) => Promise<number | undefined> | undefined
  guidedChangeHeading: (headingDeg: number) => Promise<number | undefined> | undefined
  guidedChangeSpeed: (speed: number, speedType: 0 | 1) => Promise<number | undefined> | undefined
  guidedOrbit: (
    lat: number,
    lon: number,
    radius: number,
    altitudeRel: number
  ) => Promise<number | undefined> | undefined
  landingGearDeploy: () => Promise<number | undefined> | undefined
  landingGearRetract: () => Promise<number | undefined> | undefined
} {
  const activeId = useVehicleStore((s) => s.activeVehicleId)
  const vid = vehicleIdOverride ?? activeId ?? 1

  const arm = useCallback(() => {
    return window.bridge?.vehicleArm(vid)
  }, [vid])

  const forceArm = useCallback(() => {
    return window.bridge?.vehicleForceArm(vid)
  }, [vid])

  const disarm = useCallback(() => {
    return window.bridge?.vehicleDisarm(vid)
  }, [vid])

  const setFlightMode = useCallback(
    (modeName: string) => {
      return window.bridge?.vehicleSetFlightMode(vid, modeName)
    },
    [vid]
  )

  const guidedTakeoff = useCallback(
    (altitude: number) => {
      return window.bridge?.vehicleGuidedTakeoff(vid, altitude)
    },
    [vid]
  )

  const guidedRTL = useCallback(() => {
    return window.bridge?.vehicleGuidedRTL(vid)
  }, [vid])

  const guidedLand = useCallback(() => {
    return window.bridge?.vehicleGuidedLand(vid)
  }, [vid])

  const guidedGoto = useCallback(
    (lat: number, lon: number, alt: number) => {
      return window.bridge?.vehicleGuidedGoto(vid, lat, lon, alt)
    },
    [vid]
  )

  const guidedPause = useCallback(() => {
    return window.bridge?.vehicleGuidedPause(vid)
  }, [vid])

  const emergencyStop = useCallback(() => {
    return window.bridge?.vehicleEmergencyStop(vid)
  }, [vid])

  const guidedChangeAltitude = useCallback(
    (altitudeRel: number) => {
      return window.bridge?.vehicleGuidedChangeAltitude(vid, altitudeRel)
    },
    [vid]
  )

  const guidedChangeHeading = useCallback(
    (headingDeg: number) => {
      return window.bridge?.vehicleGuidedChangeHeading(vid, headingDeg)
    },
    [vid]
  )

  const guidedChangeSpeed = useCallback(
    (speed: number, speedType: 0 | 1) => {
      return window.bridge?.vehicleGuidedChangeSpeed(vid, speed, speedType)
    },
    [vid]
  )

  const guidedOrbit = useCallback(
    (lat: number, lon: number, radius: number, altitudeRel: number) => {
      return window.bridge?.vehicleGuidedOrbit(vid, lat, lon, radius, altitudeRel)
    },
    [vid]
  )

  const landingGearDeploy = useCallback(() => {
    return window.bridge?.vehicleLandingGearDeploy(vid)
  }, [vid])

  const landingGearRetract = useCallback(() => {
    return window.bridge?.vehicleLandingGearRetract(vid)
  }, [vid])

  return {
    arm,
    forceArm,
    disarm,
    setFlightMode,
    guidedTakeoff,
    guidedRTL,
    guidedLand,
    guidedGoto,
    guidedPause,
    emergencyStop,
    guidedChangeAltitude,
    guidedChangeHeading,
    guidedChangeSpeed,
    guidedOrbit,
    landingGearDeploy,
    landingGearRetract
  }
}
