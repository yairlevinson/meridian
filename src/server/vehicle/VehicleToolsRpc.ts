import type { EventEmitter } from 'events'
import { actuatorModule } from '@shared/ipc/modules/actuator'
import { mavConsoleModule } from '@shared/ipc/modules/mavConsole'
import {
  createActuatorCommandHandlers,
  createMavConsoleCommandHandlers
} from '../../core/vehicle/VehicleToolsCommandHandlers'
import type { RpcRealtimeServer } from '../realtime/RpcRealtimeServer'
import { registerVehicleScopedListeners } from '../realtime/vehicleScopedListeners'

type VehicleToolsVehicleLike = Pick<EventEmitter, 'on' | 'off'> & {
  sysid: number
  sendConsoleText?: (text: string) => void
  commandQueue?: {
    sendCommand: (
      command: number,
      vehicleId: number,
      componentId: number,
      params: { p1?: number; p2?: number; p5?: number }
    ) => Promise<unknown> | unknown
  }
  actuatorMetadata?: {
    motorFunction: (instance: number) => number
    servoFunction: (instance: number) => number
  }
}

type VehicleToolsVehicleManagerLike = Pick<EventEmitter, 'on' | 'off'> & {
  getVehicle: (vehicleId: number) => VehicleToolsVehicleLike | undefined
  getAllVehicles: () => VehicleToolsVehicleLike[]
}

export function registerVehicleToolsRpc(
  realtime: RpcRealtimeServer,
  vehicleManager: VehicleToolsVehicleManagerLike | null
): () => void {
  realtime.registerModule(mavConsoleModule, {
    commands: createMavConsoleCommandHandlers(vehicleManager)
  })

  realtime.registerModule(actuatorModule, {
    commands: createActuatorCommandHandlers(vehicleManager)
  })

  if (!vehicleManager) return () => {}

  return registerVehicleScopedListeners(vehicleManager, (vehicleId) => {
    const vehicle = vehicleManager.getVehicle(vehicleId)
    if (!vehicle) return null

    const onConsoleData = (payload: { text: string }): void => {
      realtime.emitEvent('mavConsole', 'data', { vehicleId, ...payload })
    }

    vehicle.on('consoleData', onConsoleData)
    return () => {
      vehicle.off('consoleData', onConsoleData)
    }
  })
}
