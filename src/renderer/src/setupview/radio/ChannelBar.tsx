import styles from './RadioCalibrationPage.module.css'

interface Props {
  index: number
  value: number
  min?: number
  max?: number
}

const PWM_MIN = 800
const PWM_MAX = 2200
const PWM_RANGE = PWM_MAX - PWM_MIN

function pct(value: number): number {
  return ((value - PWM_MIN) / PWM_RANGE) * 100
}

export function ChannelBar({ index, value, min, max }: Props): React.JSX.Element {
  const valuePct = pct(Math.max(PWM_MIN, Math.min(PWM_MAX, value)))
  const hasRange = min !== undefined && max !== undefined && max > min
  const rangePctLeft = hasRange ? pct(min) : 0
  const rangePctWidth = hasRange ? pct(max) - pct(min) : 0

  return (
    <div className={styles.channelRow}>
      <span className={styles.channelLabel}>{index + 1}</span>
      <div className={styles.channelBarWrap}>
        {hasRange && (
          <div
            className={styles.channelBarRange}
            style={{ left: `${rangePctLeft}%`, width: `${rangePctWidth}%` }}
          />
        )}
        <div className={styles.channelBarValue} style={{ left: `${valuePct}%` }} />
      </div>
      <span className={styles.channelValue}>{value}</span>
    </div>
  )
}
