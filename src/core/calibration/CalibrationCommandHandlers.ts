import type { RpcCommandImpls } from '@shared/rpc'
import type { CalibrationModule } from '@shared/ipc/modules/calibration'
import type { RcCalibrationModule } from '@shared/ipc/modules/rcCalibration'
import type { CalibrationSensor, CalibrationState } from '@shared/ipc/SetupTypes'

type CalibrationManagerLike = {
  startCalibration: (sensor: CalibrationSensor) => void
  cancelCalibration: () => void
  state: CalibrationState
}

type RcCalibrationManagerLike = {
  start: () => void
  nextStep: () => void
  cancel: () => void
  save: () => Promise<void> | void
}

type SetupVehicleManagerLike = {
  getVehicle: (vehicleId: number) =>
    | {
        calibrationManager?: CalibrationManagerLike
        rcCalibrationManager?: RcCalibrationManagerLike
      }
    | undefined
}

export function createCalibrationCommandHandlers(
  vehicleManager: SetupVehicleManagerLike | null
): RpcCommandImpls<CalibrationModule> {
  const getCalibrationManager = (vehicleId: number) =>
    vehicleManager?.getVehicle(vehicleId)?.calibrationManager

  return {
    start: async (vehicleId, sensor) => {
      getCalibrationManager(vehicleId)?.startCalibration(sensor)
    },
    cancel: async (vehicleId) => {
      getCalibrationManager(vehicleId)?.cancelCalibration()
    },
    getState: async (vehicleId) => getCalibrationManager(vehicleId)?.state ?? null
  }
}

export function createRcCalibrationCommandHandlers(
  vehicleManager: SetupVehicleManagerLike | null
): RpcCommandImpls<RcCalibrationModule> {
  const getRcCalibrationManager = (vehicleId: number) =>
    vehicleManager?.getVehicle(vehicleId)?.rcCalibrationManager

  return {
    start: async (vehicleId) => {
      getRcCalibrationManager(vehicleId)?.start()
    },
    nextStep: async (vehicleId) => {
      getRcCalibrationManager(vehicleId)?.nextStep()
    },
    cancel: async (vehicleId) => {
      getRcCalibrationManager(vehicleId)?.cancel()
    },
    save: async (vehicleId) => {
      await getRcCalibrationManager(vehicleId)?.save()
    }
  }
}
