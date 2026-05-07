import type { EventEmitter } from 'events'
import { parametersModule } from '@shared/ipc/modules/parameters'
import type { Parameter, ParameterLoadState } from '@shared/ipc/ParameterTypes'
import { createParameterCommandHandlers } from '../../core/parameters/ParameterCommandHandlers'
import type { RpcRealtimeServer } from '../realtime/RpcRealtimeServer'
import { registerVehicleScopedListeners } from '../realtime/vehicleScopedListeners'

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

  return registerVehicleScopedListeners(vehicleManager, (vehicleId) => {
    const parameterManager = vehicleManager.getVehicle(vehicleId)?.parameterManager
    if (!parameterManager) return null

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
    return () => {
      parameterManager.off('parameterReceived', onChanged)
      parameterManager.off('parametersReady', onReady)
      parameterManager.off('progress', onProgress)
    }
  })
}
