import { useVehicleStore } from '../store/vehicleStore'
import type {
  VehicleSnapshot,
  VehicleGroupName,
  VehiclePosition
} from '../../../shared-types/ipc/VehicleState'

const EMPTY_SNAPSHOT: Partial<VehicleSnapshot> = {}

/** Hook: get the active (or specified) vehicle's snapshot */
export function useVehicle(vehicleId?: number): Partial<VehicleSnapshot> {
  return useVehicleStore((s) => {
    const id = vehicleId ?? s.activeVehicleId
    return id != null ? (s.vehicles[id] ?? EMPTY_SNAPSHOT) : EMPTY_SNAPSHOT
  })
}

/** Hook: get a specific telemetry group for active (or specified) vehicle */
export function useTelemetry<K extends VehicleGroupName>(
  group: K,
  vehicleId?: number
): VehicleSnapshot[K] | undefined {
  return useVehicleStore((s) => {
    const id = vehicleId ?? s.activeVehicleId
    return id != null ? s.vehicles[id]?.[group] : undefined
  })
}

/** Hook: list of all vehicle IDs (stable reference via JSON comparison) */
export function useVehicleIds(): number[] {
  const keys = useVehicleStore((s) => Object.keys(s.vehicles).join(','))
  return keys ? keys.split(',').map(Number) : []
}

/** Hook: active vehicle ID */
export function useActiveVehicleId(): number | null {
  return useVehicleStore((s) => s.activeVehicleId)
}

/** Hook: set active vehicle */
export function useSetActiveVehicle(): (id: number) => void {
  return useVehicleStore((s) => s.setActiveVehicle)
}

/** Hook: is any vehicle connected */
export function useConnected(): boolean {
  return useVehicleStore((s) => Object.keys(s.vehicles).length > 0)
}

/** Hook: get all vehicles' positions and headings.
 * Uses JSON.stringify as selector return so Zustand gets a stable primitive for comparison.
 * Parsed outside the selector for the component to consume.
 */
export function useAllVehiclePositions(): VehiclePosition[] {
  const json = useVehicleStore((s) => {
    const result: VehiclePosition[] = []
    for (const [idStr, snap] of Object.entries(s.vehicles)) {
      if (snap.gps) {
        result.push({
          id: Number(idStr),
          lat: snap.gps.lat,
          lon: snap.gps.lon,
          hdg: snap.gps.hdg ?? 0
        })
      }
    }
    return JSON.stringify(result)
  })
  return JSON.parse(json) as VehiclePosition[]
}
