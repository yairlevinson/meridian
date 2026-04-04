import { useTelemetry } from '../hooks/useVehicle'
import { useHomePosition } from '../hooks/useVehicle'
import { TelemetryRow } from '../components/TelemetryRow'

/** Haversine distance in meters between two lat/lon points */
function distanceM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000
  const toRad = Math.PI / 180
  const dLat = (lat2 - lat1) * toRad
  const dLon = (lon2 - lon1) * toRad
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function formatDist(m: number): string {
  return m >= 1000 ? (m / 1000).toFixed(2) : m.toFixed(0)
}

function distUnit(m: number): string {
  return m >= 1000 ? 'km' : 'm'
}

export function InstrumentPanel(): React.JSX.Element {
  const vfrHud = useTelemetry('vfrHud')
  const gps = useTelemetry('gps')
  const home = useHomePosition()

  const distToHome = gps && home ? distanceM(gps.lat, gps.lon, home.lat, home.lon) : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
      <TelemetryRow label="SPD" value={vfrHud?.groundspeed?.toFixed(1) ?? '--'} unit="m/s" />
      <TelemetryRow
        label="ALT"
        value={gps?.relativeAlt?.toFixed(1) ?? vfrHud?.altitude?.toFixed(1) ?? '--'}
        unit="m"
      />
      <TelemetryRow label="HDG" value={vfrHud?.heading?.toFixed(0) ?? '--'} unit="°" />
      <TelemetryRow label="THR" value={vfrHud?.throttle?.toFixed(0) ?? '--'} unit="%" />
      <TelemetryRow label="VS" value={vfrHud?.climbRate?.toFixed(1) ?? '--'} unit="m/s" />
      <TelemetryRow
        label="HOME"
        value={distToHome != null ? formatDist(distToHome) : '--'}
        unit={distToHome != null ? distUnit(distToHome) : 'm'}
      />
    </div>
  )
}
