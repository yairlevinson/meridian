/** Basic lat/lon coordinate */
export interface LatLon {
  lat: number
  lon: number
}

/** Lat/lon with altitude */
export interface LatLonAlt extends LatLon {
  alt: number
}

/** FTP directory entry */
export interface FtpDirectoryEntry {
  name: string
  size: number
  isDir: boolean
}

/** MAVLink data stream request */
export interface StreamRequest {
  id: number
  rate: number
}
