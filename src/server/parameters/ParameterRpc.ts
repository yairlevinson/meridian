import type { EventEmitter } from 'events'
import { parametersModule } from '@shared/ipc/modules/parameters'
import type { Parameter, ParameterLoadState } from '@shared/ipc/ParameterTypes'
import { createParameterCommandHandlers } from '../../main/parameters/ParameterCommandHandlers'
import type { RpcRealtimeServer } from '../realtime/RpcRealtimeServer'

type ParameterManagerLike = Pick<EventEmitter, 'on' | 'off'> & {
  getAllParameters: () => Parameter[]
  setParameter: (name: string, value: number) => void
  requestAllParameters: () => void
}

type ParameterVehicleLike = {
  sysid: number
  parameterManager?: ParameterManagerLike
}

type ParameterVehicleManagerLike = Pick<EventEmitter, 'on' | 'off'> & {
  getVehicle: (vehicleId: number) => ParameterVehicleLike | undefined
  getAllVehicles: () => ParameterVehicleLike[]
}

export function registerParameterRpc(
  realtime: RpcRealtimeServer,
  vehicleManager: ParameterVehicleManagerLike | null
): () => void {
  realtime.registerModule(parametersModule, {
    commands: createParameterCommandHandlers(vehicleManager)
  })

  if (!vehicleManager) return () => {}

  const parameterListenerDisposers = new Map<number, () => void>()

  const attachParameterListeners = (vehicleId: number): void => {
    if (parameterListenerDisposers.has(vehicleId)) return
    const parameterManager = vehicleManager.getVehicle(vehicleId)?.parameterManager
    if (!parameterManager) return

    const onChanged = (parameter: Parameter): void => {
      realtime.emitEvent('parameters', 'changed', { vehicleId, parameter })
    }
    const onReady = (): void => {
      realtime.emitEvent('parameters', 'ready', { vehicleId })
    }
    const onProgress = (loadState: ParameterLoadState): void => {
      realtime.emitEvent('parameters', 'progress', { vehicleId, loadState })
    }

    parameterManager.on('parameterReceived', onChanged)
    parameterManager.on('parametersReady', onReady)
    parameterManager.on('progress', onProgress)
    parameterListenerDisposers.set(vehicleId, () => {
      parameterManager.off('parameterReceived', onChanged)
      parameterManager.off('parametersReady', onReady)
      parameterManager.off('progress', onProgress)
    })
  }

  const detachParameterListeners = (vehicleId: number): void => {
    parameterListenerDisposers.get(vehicleId)?.()
    parameterListenerDisposers.delete(vehicleId)
  }

  const onVehicleAdded = (vehicleId: number): void => {
    attachParameterListeners(vehicleId)
  }
  const onVehicleRemoved = (vehicleId: number): void => {
    detachParameterListeners(vehicleId)
  }

  vehicleManager.on('vehicleAdded', onVehicleAdded)
  vehicleManager.on('vehicleRemoved', onVehicleRemoved)
  for (const vehicle of vehicleManager.getAllVehicles()) {
    attachParameterListeners(vehicle.sysid)
  }

  return () => {
    vehicleManager.off('vehicleAdded', onVehicleAdded)
    vehicleManager.off('vehicleRemoved', onVehicleRemoved)
    for (const dispose of parameterListenerDisposers.values()) {
      dispose()
    }
    parameterListenerDisposers.clear()
  }
}
