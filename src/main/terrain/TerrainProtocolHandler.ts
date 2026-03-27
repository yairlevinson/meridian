import { EventEmitter } from 'events'

export interface TerrainTile {
  lat: number
  lon: number
  gridSpacing: number
  data: Int16Array // 16x16 elevation grid
}

/**
 * Handles terrain data requests from the vehicle.
 * Responds to TERRAIN_REQUEST with TERRAIN_DATA.
 */
export class TerrainProtocolHandler extends EventEmitter {
  private tiles = new Map<string, TerrainTile>()

  /** Add a terrain tile to the local cache */
  addTile(lat: number, lon: number, gridSpacing: number, elevations: Int16Array): void {
    const key = `${lat.toFixed(4)},${lon.toFixed(4)}`
    this.tiles.set(key, { lat, lon, gridSpacing, data: elevations })
  }

  /** Get elevation at a specific lat/lon (nearest tile interpolation) */
  getElevation(lat: number, lon: number): number | null {
    // Find nearest tile
    let nearest: TerrainTile | null = null
    let minDist = Infinity

    for (const tile of this.tiles.values()) {
      const dlat = lat - tile.lat
      const dlon = lon - tile.lon
      const dist = dlat * dlat + dlon * dlon
      if (dist < minDist) {
        minDist = dist
        nearest = tile
      }
    }

    if (!nearest) return null

    // Simple nearest-neighbor from the 16x16 grid
    const dlat = lat - nearest.lat
    const dlon = lon - nearest.lon
    const gridSize = nearest.gridSpacing * 16
    const row = Math.min(15, Math.max(0, Math.round((dlat / gridSize) * 15 * 111000)))
    const col = Math.min(
      15,
      Math.max(0, Math.round((dlon / gridSize) * 15 * 111000 * Math.cos((lat * Math.PI) / 180)))
    )

    return nearest.data[row * 16 + col] ?? null
  }

  /** Handle TERRAIN_REQUEST from vehicle (msgid=133) */
  handleTerrainRequest(lat: number, lon: number, gridSpacing: number): void {
    this.emit('terrainRequest', { lat, lon, gridSpacing })
  }

  get tileCount(): number {
    return this.tiles.size
  }
}
