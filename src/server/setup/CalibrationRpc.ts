import type { EventEmitter } from 'events'
import { calibrationModule } from '@shared/ipc/modules/calibration'
import { rcCalibrationModule } from '@shared/ipc/modules/rcCalibration'
import type {
  CalibrationSensor,
  CalibrationState,
  MagCalProgress,
  MagCalReport,
  RcCalibrationState
} from '@shared/ipc/SetupTypes'
import {
  createCalibrationCommandHandlers,
  createRcCalibrationCommandHandlers
} from '../../core/calibration/CalibrationCommandHandlers'
import type { RpcRealtimeServer } from '../realtime/RpcRealtimeServer'
import { registerVehicleScopedListeners } from '../realtime/vehicleScopedListeners'

type CalibrationManagerLike = Pick<EventEmitter, 'on' | 'off'> & {
  startCalibration: (sensor: CalibrationSensor) => void
  cancelCalibration: () => void
  state: CalibrationState
}

type RcCalibrationManagerLike = Pick<EventEmitter, 'on' | 'off'> & {
  start: () => void
  nextStep: () => void
  cancel: () => void
  save: () => Promise<void> | void
}

type SetupVehicleLike = {
  sysid: number
  calibrationManager?: CalibrationManagerLike
  rcCalibrationManager?: RcCalibrationManagerLike
}

type SetupVehicleManagerLike = Pick<EventEmitter, 'on' | 'off'> & {
  getVehicle: (vehicleId: number) => SetupVehicleLike | undefined
  getAllVehicles: () => SetupVehicleLike[]
}

export function registerCalibrationRpc(
  realtime: RpcRealtimeServer,
  vehicleManager: SetupVehicleManagerLike | null
): () => void {
  realtime.registerModule(calibrationModule, {
    commands: createCalibrationCommandHandlers(vehicleManager)
  })

  if (!vehicleManager) return () => {}

  return registerVehicleScopedListeners(vehicleManager, (vehicleId) => {
    const calibrationManager = vehicleManager.getVehicle(vehicleId)?.calibrationManager
    if (!calibrationManager) return null

    const onStateChanged = (state: CalibrationState): void => {
      realtime.emitEvent('calibration', 'stateChanged', { vehicleId, state })
    }
    const onMagProgress = (progress: MagCalProgress): void => {
      realtime.emitEvent('calibration', 'magProgress', { vehicleId, ...progress })
    }
    const onMagReport = (report: MagCalReport): void => {
      realtime.emitEvent('calibration', 'magReport', { vehicleId, ...report })
    }

    calibrationManager.on('stateChanged', onStateChanged)
    calibrationManager.on('magProgress', onMagProgress)
    calibrationManager.on('magReport', onMagReport)
    return () => {
      calibrationManager.off('stateChanged', onStateChanged)
      calibrationManager.off('magProgress', onMagProgress)
      calibrationManager.off('magReport', onMagReport)
    }
  })
}

export function registerRcCalibrationRpc(
  realtime: RpcRealtimeServer,
  vehicleManager: SetupVehicleManagerLike | null
): () => void {
  realtime.registerModule(rcCalibrationModule, {
    commands: createRcCalibrationCommandHandlers(vehicleManager)
  })

  if (!vehicleManager) return () => {}

  return registerVehicleScopedListeners(vehicleManager, (vehicleId) => {
    const rcCalibrationManager = vehicleManager.getVehicle(vehicleId)?.rcCalibrationManager
    if (!rcCalibrationManager) return null

    const onStateChanged = (state: RcCalibrationState): void => {
      realtime.emitEvent('rcCalibration', 'stateChanged', { vehicleId, state })
    }

    rcCalibrationManager.on('stateChanged', onStateChanged)
    return () => {
      rcCalibrationManager.off('stateChanged', onStateChanged)
    }
  })
}
