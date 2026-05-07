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
} from '../../main/calibration/CalibrationCommandHandlers'
import type { RpcRealtimeServer } from '../realtime/RpcRealtimeServer'

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

  const listenerDisposers = new Map<number, () => void>()

  const attachListeners = (vehicleId: number): void => {
    if (listenerDisposers.has(vehicleId)) return
    const calibrationManager = vehicleManager.getVehicle(vehicleId)?.calibrationManager
    if (!calibrationManager) return

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
    listenerDisposers.set(vehicleId, () => {
      calibrationManager.off('stateChanged', onStateChanged)
      calibrationManager.off('magProgress', onMagProgress)
      calibrationManager.off('magReport', onMagReport)
    })
  }

  const detachListeners = (vehicleId: number): void => {
    listenerDisposers.get(vehicleId)?.()
    listenerDisposers.delete(vehicleId)
  }

  const onVehicleAdded = (vehicleId: number): void => attachListeners(vehicleId)
  const onVehicleRemoved = (vehicleId: number): void => detachListeners(vehicleId)

  vehicleManager.on('vehicleAdded', onVehicleAdded)
  vehicleManager.on('vehicleRemoved', onVehicleRemoved)
  for (const vehicle of vehicleManager.getAllVehicles()) {
    attachListeners(vehicle.sysid)
  }

  return () => {
    vehicleManager.off('vehicleAdded', onVehicleAdded)
    vehicleManager.off('vehicleRemoved', onVehicleRemoved)
    for (const dispose of listenerDisposers.values()) {
      dispose()
    }
    listenerDisposers.clear()
  }
}

export function registerRcCalibrationRpc(
  realtime: RpcRealtimeServer,
  vehicleManager: SetupVehicleManagerLike | null
): () => void {
  realtime.registerModule(rcCalibrationModule, {
    commands: createRcCalibrationCommandHandlers(vehicleManager)
  })

  if (!vehicleManager) return () => {}

  const listenerDisposers = new Map<number, () => void>()

  const attachListeners = (vehicleId: number): void => {
    if (listenerDisposers.has(vehicleId)) return
    const rcCalibrationManager = vehicleManager.getVehicle(vehicleId)?.rcCalibrationManager
    if (!rcCalibrationManager) return

    const onStateChanged = (state: RcCalibrationState): void => {
      realtime.emitEvent('rcCalibration', 'stateChanged', { vehicleId, state })
    }

    rcCalibrationManager.on('stateChanged', onStateChanged)
    listenerDisposers.set(vehicleId, () => {
      rcCalibrationManager.off('stateChanged', onStateChanged)
    })
  }

  const detachListeners = (vehicleId: number): void => {
    listenerDisposers.get(vehicleId)?.()
    listenerDisposers.delete(vehicleId)
  }

  const onVehicleAdded = (vehicleId: number): void => attachListeners(vehicleId)
  const onVehicleRemoved = (vehicleId: number): void => detachListeners(vehicleId)

  vehicleManager.on('vehicleAdded', onVehicleAdded)
  vehicleManager.on('vehicleRemoved', onVehicleRemoved)
  for (const vehicle of vehicleManager.getAllVehicles()) {
    attachListeners(vehicle.sysid)
  }

  return () => {
    vehicleManager.off('vehicleAdded', onVehicleAdded)
    vehicleManager.off('vehicleRemoved', onVehicleRemoved)
    for (const dispose of listenerDisposers.values()) {
      dispose()
    }
    listenerDisposers.clear()
  }
}
