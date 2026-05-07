import type { RpcCommandImpls } from '@shared/rpc'
import type { ParametersModule } from '@shared/ipc/modules/parameters'
import type { Parameter } from '@shared/ipc/ParameterTypes'

type ParameterManagerLike = {
  getAllParameters: () => Parameter[]
  setParameter: (name: string, value: number) => void
  requestAllParameters: () => void
}

type ParameterVehicleManagerLike = {
  getVehicle: (vehicleId: number) => { parameterManager?: ParameterManagerLike } | undefined
}

export function createParameterCommandHandlers(
  vehicleManager: ParameterVehicleManagerLike | null
): RpcCommandImpls<ParametersModule> {
  const getParameterManager = (vehicleId: number) =>
    vehicleManager?.getVehicle(vehicleId)?.parameterManager

  return {
    getAll: async (vehicleId) => getParameterManager(vehicleId)?.getAllParameters() ?? [],
    set: async (vehicleId, name, value) => {
      getParameterManager(vehicleId)?.setParameter(name, value)
    },
    refresh: async (vehicleId) => {
      getParameterManager(vehicleId)?.requestAllParameters()
    }
  }
}
