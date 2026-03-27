import { useTelemetry } from '../hooks/useVehicle'
import { TelemetryRow } from '../components/TelemetryRow'

export function LinkQuality(): React.JSX.Element {
  const radio = useTelemetry('radio')

  if (!radio || (radio.rssi === 0 && radio.remrssi === 0)) {
    return <div className="no-data">No radio</div>
  }

  return (
    <div className="panel">
      <TelemetryRow label="RSSI" value={String(radio.rssi)} color="#ccc" />
      <TelemetryRow label="RemRSSI" value={String(radio.remrssi)} color="#ccc" />
      <TelemetryRow label="TxBuf" value={`${radio.txbuf}%`} color="#ccc" />
      <TelemetryRow label="Noise" value={String(radio.noise)} color="#ccc" />
      <TelemetryRow label="RxErr" value={String(radio.rxerrors)} color="#ccc" />
    </div>
  )
}
