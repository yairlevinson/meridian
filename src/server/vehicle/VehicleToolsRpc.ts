import type { EventEmitter } from 'events'
import { actuatorModule } from '@shared/ipc/modules/actuator'
import { mavConsoleModule } from '@shared/ipc/modules/mavConsole'
import type { RpcRealtimeServer } from '../realtime/RpcRealtimeServer'

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
    commands: {
      write: async (vehicleId, text) => {
        vehicleManager?.getVehicle(vehicleId)?.sendConsoleText?.(text)
      }
    }
  })

  realtime.registerModule(actuatorModule, {
    commands: {
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
        const actuatorFunction = vehicle.actuatorMetadata.servoFunction(servoInstance)
        await vehicle.commandQueue.sendCommand(310, vehicleId, 1, {
          p1: normalized,
          p2: 1,
          p5: actuatorFunction
        })
      }
    }
  })

  if (!vehicleManager) return () => {}

  const consoleListenerDisposers = new Map<number, () => void>()

  const attachConsoleListener = (vehicleId: number): void => {
    if (consoleListenerDisposers.has(vehicleId)) return
    const vehicle = vehicleManager.getVehicle(vehicleId)
    if (!vehicle) return

    const onConsoleData = (payload: { text: string }): void => {
      realtime.emitEvent('mavConsole', 'data', { vehicleId, ...payload })
    }

    vehicle.on('consoleData', onConsoleData)
    consoleListenerDisposers.set(vehicleId, () => {
      vehicle.off('consoleData', onConsoleData)
    })
  }

  const detachConsoleListener = (vehicleId: number): void => {
    consoleListenerDisposers.get(vehicleId)?.()
    consoleListenerDisposers.delete(vehicleId)
  }

  const onVehicleAdded = (vehicleId: number): void => attachConsoleListener(vehicleId)
  const onVehicleRemoved = (vehicleId: number): void => detachConsoleListener(vehicleId)

  vehicleManager.on('vehicleAdded', onVehicleAdded)
  vehicleManager.on('vehicleRemoved', onVehicleRemoved)
  for (const vehicle of vehicleManager.getAllVehicles()) {
    attachConsoleListener(vehicle.sysid)
  }

  return () => {
    vehicleManager.off('vehicleAdded', onVehicleAdded)
    vehicleManager.off('vehicleRemoved', onVehicleRemoved)
    for (const dispose of consoleListenerDisposers.values()) {
      dispose()
    }
    consoleListenerDisposers.clear()
  }
}
