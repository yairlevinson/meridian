import { useCallback } from 'react'
import { useVehicleStore } from '../store/vehicleStore'

/** Hook: typed command dispatchers via qgcBridge, targeting active vehicle */
export function useCommand(vehicleIdOverride?: number): {
  arm: () => Promise<void> | undefined
  disarm: () => Promise<void> | undefined
  setFlightMode: (modeName: string) => Promise<void> | undefined
  guidedTakeoff: (altitude: number) => Promise<void> | undefined
  guidedRTL: () => Promise<void> | undefined
  guidedLand: () => Promise<void> | undefined
  guidedGoto: (lat: number, lon: number, alt: number) => Promise<void> | undefined
  guidedPause: () => Promise<void> | undefined
} {
  const activeId = useVehicleStore((s) => s.activeVehicleId)
  const vid = vehicleIdOverride ?? activeId ?? 1

  const arm = useCallback(() => {
    return window.qgcBridge?.arm(vid)
  }, [vid])

  const disarm = useCallback(() => {
    return window.qgcBridge?.disarm(vid)
  }, [vid])

  const setFlightMode = useCallback(
    (modeName: string) => {
      return window.qgcBridge?.setFlightMode(vid, modeName)
    },
    [vid]
  )

  const guidedTakeoff = useCallback(
    (altitude: number) => {
      return window.qgcBridge?.guidedTakeoff(vid, altitude)
    },
    [vid]
  )

  const guidedRTL = useCallback(() => {
    return window.qgcBridge?.guidedRTL(vid)
  }, [vid])

  const guidedLand = useCallback(() => {
    return window.qgcBridge?.guidedLand(vid)
  }, [vid])

  const guidedGoto = useCallback(
    (lat: number, lon: number, alt: number) => {
      return window.qgcBridge?.guidedGoto(vid, lat, lon, alt)
    },
    [vid]
  )

  const guidedPause = useCallback(() => {
    return window.qgcBridge?.guidedPause(vid)
  }, [vid])

  return {
    arm,
    disarm,
    setFlightMode,
    guidedTakeoff,
    guidedRTL,
    guidedLand,
    guidedGoto,
    guidedPause
  }
}
