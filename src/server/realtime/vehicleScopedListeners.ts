import type { EventEmitter } from 'events'

export type VehicleScopedManagerLike<TVehicle extends { sysid: number }> = Pick<
  EventEmitter,
  'on' | 'off'
> & {
  getAllVehicles: () => TVehicle[]
}

export function registerVehicleScopedListeners<TVehicle extends { sysid: number }>(
  vehicleManager: VehicleScopedManagerLike<TVehicle>,
  attachListeners: (vehicleId: number) => (() => void) | null | undefined
): () => void {
  const listenerDisposers = new Map<number, () => void>()

  const attach = (vehicleId: number): void => {
    if (listenerDisposers.has(vehicleId)) return
    const dispose = attachListeners(vehicleId)
    if (dispose) listenerDisposers.set(vehicleId, dispose)
  }

  const detach = (vehicleId: number): void => {
    listenerDisposers.get(vehicleId)?.()
    listenerDisposers.delete(vehicleId)
  }

  vehicleManager.on('vehicleAdded', attach)
  vehicleManager.on('vehicleRemoved', detach)
  for (const vehicle of vehicleManager.getAllVehicles()) {
    attach(vehicle.sysid)
  }

  return () => {
    vehicleManager.off('vehicleAdded', attach)
    vehicleManager.off('vehicleRemoved', detach)
    for (const dispose of listenerDisposers.values()) {
      dispose()
    }
    listenerDisposers.clear()
  }
}
