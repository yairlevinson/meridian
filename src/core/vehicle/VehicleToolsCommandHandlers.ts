import type { RpcCommandImpls } from '@shared/rpc'
import type { ActuatorModule } from '@shared/ipc/modules/actuator'
import type { MavConsoleModule } from '@shared/ipc/modules/mavConsole'

type VehicleToolsVehicleLike = {
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

type VehicleToolsVehicleManagerLike = {
  getVehicle: (vehicleId: number) => VehicleToolsVehicleLike | undefined
}

export function createMavConsoleCommandHandlers(
  vehicleManager: VehicleToolsVehicleManagerLike | null
): RpcCommandImpls<MavConsoleModule> {
  return {
    write: async (vehicleId, text) => {
      vehicleManager?.getVehicle(vehicleId)?.sendConsoleText?.(text)
    }
  }
}

export function createActuatorCommandHandlers(
  vehicleManager: VehicleToolsVehicleManagerLike | null
): RpcCommandImpls<ActuatorModule> {
  return {
    motorTest: async (vehicleId, motorInstance, throttlePercent) => {
      const vehicle = vehicleManager?.getVehicle(vehicleId)
      if (!vehicle?.commandQueue || !vehicle.actuatorMetadata) return
      const throttleFraction = throttlePercent > 0 ? throttlePercent / 100 : NaN
      const timeout = throttlePercent > 0 ? 1 : 0
      const actuatorFunction = vehicle.actuatorMetadata.motorFunction(motorInstance)
      await vehicle.commandQueue.sendCommand(310, vehicleId, 1, {
        p1: throttleFraction,
        p2: timeout,
        p5: actuatorFunction
      })
    },
    servoTest: async (vehicleId, servoInstance, pwmValue) => {
      const vehicle = vehicleManager?.getVehicle(vehicleId)
      if (!vehicle?.commandQueue || !vehicle.actuatorMetadata) return
      const normalized = (pwmValue - 1500) / 500
      const timeout = 1
      const actuatorFunction = vehicle.actuatorMetadata.servoFunction(servoInstance)
      await vehicle.commandQueue.sendCommand(310, vehicleId, 1, {
        p1: normalized,
        p2: timeout,
        p5: actuatorFunction
      })
    }
  }
}
