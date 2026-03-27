import { useTelemetry } from '../hooks/useVehicle'
import { TelemetryRow } from '../components/TelemetryRow'

export function InstrumentPanel(): React.JSX.Element {
  const vfrHud = useTelemetry('vfrHud')
  const gps = useTelemetry('gps')

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
    </div>
  )
}
