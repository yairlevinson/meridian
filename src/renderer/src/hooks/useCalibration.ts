import { useCallback } from 'react'
import { useSetupStore } from '../store/setupStore'
import { useVehicleStore } from '../store/vehicleStore'
import type { CalibrationSensor, CalibrationState } from '../../../shared-types/ipc/SetupTypes'

export function useCalibration(vehicleId?: number): {
  calibrationState: CalibrationState | null
  startCalibration: (sensor: CalibrationSensor) => void
  cancelCalibration: () => void
} {
  const activeId = useVehicleStore((s) => s.activeVehicleId)
  const vid = vehicleId ?? activeId ?? 1
  const calibrationState = useSetupStore((s) => s.calibrationState)

  const startCalibration = useCallback(
    (sensor: CalibrationSensor) => {
      window.qgcBridge?.calibrationStart(vid, sensor)
    },
    [vid]
  )

  const cancelCalibration = useCallback(() => {
    window.qgcBridge?.calibrationCancel(vid)
  }, [vid])

  return { calibrationState, startCalibration, cancelCalibration }
}
