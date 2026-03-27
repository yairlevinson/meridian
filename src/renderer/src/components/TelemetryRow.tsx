import styles from './TelemetryRow.module.css'

/**
 * Shared label-value row used across telemetry panels.
 */
export function TelemetryRow({
  label,
  value,
  unit,
  color
}: {
  label: string
  value: string
  unit?: string
  color?: string
}): React.JSX.Element {
  return (
    <div className={styles.root}>
      <span className={styles.label}>{label}</span>
      <span>
        <span className={styles.value} style={{ color: color ?? '#fff' }}>
          {value}
        </span>
        {unit && <span className={styles.unit}>{unit}</span>}
      </span>
    </div>
  )
}
