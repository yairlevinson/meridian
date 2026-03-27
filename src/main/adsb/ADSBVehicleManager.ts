import { EventEmitter } from 'events'

export interface ADSBVehicle {
  icaoAddress: number
  callsign: string
  lat: number
  lon: number
  altitude: number
  heading: number
  velocity: number
  verticalVelocity: number
  squawk: number
  altitudeType: number // 0 = barometric, 1 = geometric
  lastSeen: number // timestamp ms
}

const TIMEOUT_MS = 60000 // Remove after 60s without update

/**
 * Manages ADSB traffic received via MAVLink ADSB_VEHICLE messages (msgid=246).
 */
export class ADSBVehicleManager extends EventEmitter {
  private vehicles = new Map<number, ADSBVehicle>()
  private cleanupInterval: ReturnType<typeof setInterval> | null = null

  constructor() {
    super()
    this.cleanupInterval = setInterval(() => this._cleanupStale(), 10000)
  }

  /** Handle ADSB_VEHICLE message */
  handleADSBVehicle(data: {
    ICAOAddress: number
    callsign: string
    lat: number
    lon: number
    altitude: number
    heading: number
    horVelocity: number
    verVelocity: number
    squawk: number
    altitudeType: number
  }): void {
    const vehicle: ADSBVehicle = {
      icaoAddress: data.ICAOAddress,
      callsign: data.callsign.replace(/\0/g, '').trim(),
      lat: data.lat / 1e7,
      lon: data.lon / 1e7,
      altitude: data.altitude / 1000,
      heading: data.heading / 100,
      velocity: data.horVelocity / 100,
      verticalVelocity: data.verVelocity / 100,
      squawk: data.squawk,
      altitudeType: data.altitudeType,
      lastSeen: Date.now()
    }

    const isNew = !this.vehicles.has(vehicle.icaoAddress)
    this.vehicles.set(vehicle.icaoAddress, vehicle)

    if (isNew) {
      this.emit('vehicleAdded', vehicle)
    } else {
      this.emit('vehicleUpdated', vehicle)
    }
  }

  /** Get all current ADSB vehicles */
  getVehicles(): ADSBVehicle[] {
    return Array.from(this.vehicles.values())
  }

  /** Get a specific vehicle by ICAO address */
  getVehicle(icaoAddress: number): ADSBVehicle | undefined {
    return this.vehicles.get(icaoAddress)
  }

  get vehicleCount(): number {
    return this.vehicles.size
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }
  }

  private _cleanupStale(): void {
    const now = Date.now()
    for (const [icao, vehicle] of this.vehicles) {
      if (now - vehicle.lastSeen > TIMEOUT_MS) {
        this.vehicles.delete(icao)
        this.emit('vehicleRemoved', icao)
      }
    }
  }
}
