import { useTelemetry } from '../hooks/useVehicle'
import { TelemetryRow } from '../components/TelemetryRow'

const FIX_NAMES: Record<number, string> = {
  0: 'No GPS',
  1: 'No Fix',
  2: '2D Fix',
  3: '3D Fix',
  4: 'DGPS',
  5: 'RTK Float',
  6: 'RTK Fix'
}

export function GpsStatus(): React.JSX.Element {
  const gpsRaw = useTelemetry('gpsRaw')

  if (!gpsRaw) {
    return <TelemetryRow label="GPS" value="--" color="#666" />
  }

  const fixName = FIX_NAMES[gpsRaw.fixType] ?? `Fix ${gpsRaw.fixType}`
  const color = gpsRaw.fixType >= 3 ? '#00ff88' : gpsRaw.fixType >= 2 ? '#ffaa00' : '#ff4444'

  return (
    <div className="panel">
      <TelemetryRow label="GPS" value={fixName} color={color} />
      <TelemetryRow label="SAT" value={String(gpsRaw.satelliteCount)} color="#fff" />
      <TelemetryRow
        label="HDOP"
        value={gpsRaw.hdop.toFixed(1)}
        color={gpsRaw.hdop < 2 ? '#00ff88' : '#ffaa00'}
      />
    </div>
  )
}
