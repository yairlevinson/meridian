import { create } from 'zustand'
import type { VehicleSnapshot, VehicleDelta } from '../../../shared-types/ipc/VehicleState'

export type { VehicleSnapshot, VehicleDelta }

type VehicleStore = {
  vehicles: Record<number, Partial<VehicleSnapshot>>
  activeVehicleId: number | null
  ipcLatency: number
  mergeCount: number

  mergeDelta: (vehicleId: number, delta: VehicleDelta, sentAt: number) => void
  addVehicle: (vehicleId: number) => void
  removeVehicle: (vehicleId: number) => void
  setActiveVehicle: (vehicleId: number) => void
}

export const useVehicleStore = create<VehicleStore>((set) => ({
  vehicles: {},
  activeVehicleId: null,
  ipcLatency: 0,
  mergeCount: 0,

  mergeDelta: (vehicleId, delta, sentAt) =>
    set((prev) => ({
      vehicles: {
        ...prev.vehicles,
        [vehicleId]: { ...prev.vehicles[vehicleId], ...delta }
      },
      ipcLatency: Date.now() - sentAt,
      mergeCount: prev.mergeCount + 1,
      // Auto-select first vehicle
      activeVehicleId: prev.activeVehicleId ?? vehicleId
    })),

  addVehicle: (vehicleId) =>
    set((prev) => ({
      vehicles: { ...prev.vehicles, [vehicleId]: prev.vehicles[vehicleId] ?? {} },
      activeVehicleId: prev.activeVehicleId ?? vehicleId
    })),

  removeVehicle: (vehicleId) =>
    set((prev) => {
      const { [vehicleId]: _removed, ...rest } = prev.vehicles
      const ids = Object.keys(rest).map(Number)
      return {
        vehicles: rest,
        activeVehicleId:
          prev.activeVehicleId === vehicleId ? (ids[0] ?? null) : prev.activeVehicleId
      }
    }),

  setActiveVehicle: (vehicleId) => set({ activeVehicleId: vehicleId })
}))

// Wire the IPC listeners once at module load, deferred to next tick
// so React has time to mount before any store updates arrive.
if (typeof window !== 'undefined' && window.bridge) {
  setTimeout(() => {
    window.bridge.onVehicleDelta(({ vehicleId, delta, sentAt }) => {
      useVehicleStore.getState().mergeDelta(vehicleId, delta, sentAt)
    })

    if (window.bridge.onVehicleAdded) {
      window.bridge.onVehicleAdded(({ vehicleId }) => {
        useVehicleStore.getState().addVehicle(vehicleId)
      })
    }

    if (window.bridge.onVehicleRemoved) {
      window.bridge.onVehicleRemoved(({ vehicleId }) => {
        useVehicleStore.getState().removeVehicle(vehicleId)
      })
    }
  }, 0)
}
