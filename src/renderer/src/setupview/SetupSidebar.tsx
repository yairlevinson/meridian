import type { SetupPage } from '../../../shared-types/ipc/SetupTypes'
import styles from './SetupSidebar.module.css'

interface SidebarItem {
  page: SetupPage
  label: string
}

const items: SidebarItem[] = [
  { page: 'summary', label: 'Summary' },
  { page: 'firmware', label: 'Firmware' },
  { page: 'sensors', label: 'Sensors' },
  { page: 'radio', label: 'Radio' },
  { page: 'flightModes', label: 'Flight Modes' },
  { page: 'power', label: 'Power' },
  { page: 'safety', label: 'Safety' },
  { page: 'airframe', label: 'Airframe' },
  { page: 'tuning', label: 'Tuning' },
  { page: 'parameters', label: 'Parameters' }
]

interface Props {
  activePage: SetupPage
  onSelect: (page: SetupPage) => void
}

export function SetupSidebar({ activePage, onSelect }: Props): React.JSX.Element {
  return (
    <div className={styles.root}>
      <div className={styles.header}>VEHICLE SETUP</div>
      <div className={styles.list}>
        {items.map((item) => (
          <button
            key={item.page}
            className={`${styles.item} ${activePage === item.page ? styles.itemActive : ''}`}
            onClick={() => onSelect(item.page)}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  )
}
