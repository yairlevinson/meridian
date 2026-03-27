import { useTelemetry } from '../hooks/useVehicle'
import { useCommand } from '../hooks/useCommand'
import styles from './ArmedIndicator.module.css'

export function ArmedIndicator(): React.JSX.Element {
  const core = useTelemetry('core')
  const { arm, disarm } = useCommand()
  const armed = core?.armed ?? false

  const handleClick = (): void => {
    if (armed) {
      disarm()
    } else {
      arm()
    }
  }

  return (
    <button
      onClick={handleClick}
      className={`${styles.btn} ${armed ? styles.armed : styles.disarmed}`}
    >
      {armed ? 'ARMED' : 'DISARMED'}
    </button>
  )
}
