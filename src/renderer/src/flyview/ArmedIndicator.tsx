import { useTelemetry } from '../hooks/useVehicle'
import { useCommand } from '../hooks/useCommand'
import { HoldButton } from '../components/HoldButton'
import styles from './ArmedIndicator.module.css'

export function ArmedIndicator(): React.JSX.Element {
  const core = useTelemetry('core')
  const { arm, disarm } = useCommand()
  const armed = core?.armed ?? false

  if (!armed) {
    return (
      <HoldButton
        className={`${styles.btn} ${styles.disarmed}`}
        onConfirm={() => arm()}
        holdDurationMs={1000}
      >
        Hold to ARM
      </HoldButton>
    )
  }

  return (
    <button
      onClick={() => disarm()}
      className={`${styles.btn} ${styles.armed}`}
    >
      ARMED
    </button>
  )
}
