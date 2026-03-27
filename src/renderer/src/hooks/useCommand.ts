import { useCallback } from 'react'
import { useVehicleStore } from '../store/vehicleStore'

/** Hook: typed command dispatchers via bridge, targeting active vehicle */
export function useCommand(vehicleIdOverride?: number): {
  arm: () => Promise<void> | undefined
  disarm: () => Promise<void> | undefined
  setFlightMode: (modeName: string) => Promise<void> | undefined
  guidedTakeoff: (altitude: number) => Promise<void> | undefined
  guidedRTL: () => Promise<void> | undefined
  guidedLand: () => Promise<void> | undefined
  guidedGoto: (lat: number, lon: number, alt: number) => Promise<void> | undefined
  guidedPause: () => Promise<void> | undefined
  emergencyStop: () => Promise<void> | undefined
} {
  const activeId = useVehicleStore((s) => s.activeVehicleId)
  const vid = vehicleIdOverride ?? activeId ?? 1

  const arm = useCallback(() => {
    return window.bridge?.arm(vid)
  }, [vid])

  const disarm = useCallback(() => {
    return window.bridge?.disarm(vid)
  }, [vid])

  const setFlightMode = useCallback(
    (modeName: string) => {
      return window.bridge?.setFlightMode(vid, modeName)
    },
    [vid]
  )

  const guidedTakeoff = useCallback(
    (altitude: number) => {
      return window.bridge?.guidedTakeoff(vid, altitude)
    },
    [vid]
  )

  const guidedRTL = useCallback(() => {
    return window.bridge?.guidedRTL(vid)
  }, [vid])

  const guidedLand = useCallback(() => {
    return window.bridge?.guidedLand(vid)
  }, [vid])

  const guidedGoto = useCallback(
    (lat: number, lon: number, alt: number) => {
      return window.bridge?.guidedGoto(vid, lat, lon, alt)
    },
    [vid]
  )

  const guidedPause = useCallback(() => {
    return window.bridge?.guidedPause(vid)
  }, [vid])

  const emergencyStop = useCallback(() => {
    return window.bridge?.emergencyStop(vid)
  }, [vid])

  return {
    arm,
    disarm,
    setFlightMode,
    guidedTakeoff,
    guidedRTL,
    guidedLand,
    guidedGoto,
    guidedPause,
    emergencyStop
  }
}
