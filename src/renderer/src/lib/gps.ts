/** Human-readable GPS fix type names (MAV_GPS_FIX_TYPE enum). */
export const GPS_FIX_NAMES: Record<number, string> = {
  0: 'No GPS',
  1: 'No Fix',
  2: '2D Fix',
  3: '3D Fix',
  4: 'DGPS',
  5: 'RTK Float',
  6: 'RTK Fix'
}
