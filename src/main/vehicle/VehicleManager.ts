import { EventEmitter } from 'events'
import { Vehicle } from './Vehicle'
import type { DecodedMessage } from '../mavlink/MavlinkChannel'

/**
 * Manages all connected vehicles, keyed by MAVLink system ID.
 * Auto-creates Vehicle instances on first HEARTBEAT from an autopilot component.
 */
export class VehicleManager extends EventEmitter {
  private vehicles = new Map<number, Vehicle>()

  /** Route a decoded message to the correct vehicle. Auto-creates on first heartbeat. */
  handleMessage(msg: DecodedMessage, linkId: string): void {
    const sysid = msg.sysid
    // Filter out GCS sysids (>= 200) and broadcast (sysid 0)
    if (sysid === 0 || sysid >= 200) return

    let vehicle = this.vehicles.get(sysid)
    if (!vehicle) {
      // Only auto-create on HEARTBEAT (msgid 0) from autopilot component (compid 1)
      if (msg.msgid !== 0 || msg.compid !== 1) return
      vehicle = new Vehicle(sysid)
      this.vehicles.set(sysid, vehicle)
      this.emit('vehicleAdded', sysid)
    }
    vehicle.handleMessage(msg, linkId)
  }

  getVehicle(sysid: number): Vehicle | undefined {
    return this.vehicles.get(sysid)
  }

  getAllVehicles(): Vehicle[] {
    return Array.from(this.vehicles.values())
  }

  getAllSysIds(): number[] {
    return Array.from(this.vehicles.keys())
  }

  get vehicleCount(): number {
    return this.vehicles.size
  }

  removeVehicle(sysid: number): void {
    const vehicle = this.vehicles.get(sysid)
    if (!vehicle) return
    vehicle.destroy()
    this.vehicles.delete(sysid)
    this.emit('vehicleRemoved', sysid)
  }

  destroy(): void {
    for (const vehicle of this.vehicles.values()) {
      vehicle.destroy()
    }
    this.vehicles.clear()
  }
}
