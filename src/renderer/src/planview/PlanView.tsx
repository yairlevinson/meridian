import { MapView } from '../components/MapView'
import { MissionToolbar } from './MissionToolbar'
import { MissionSidebar } from './MissionSidebar'
import { OverlayPanel } from '../components/OverlayPanel'
import styles from './PlanView.module.css'

export function PlanView(): React.JSX.Element {
  return (
    <div className={styles.root}>
      <div className={styles.mapArea}>
        <MapView editMode />
        <MissionToolbar />
        <OverlayPanel />
      </div>
      <MissionSidebar />
    </div>
  )
}
