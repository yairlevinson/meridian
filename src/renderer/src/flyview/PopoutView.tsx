import { MapView } from '../components/MapView'
import { VideoView } from '../components/VideoView'
import styles from './PopoutView.module.css'

interface PopoutViewProps {
  view: 'video' | 'map'
}

export function PopoutView({ view }: PopoutViewProps): React.JSX.Element {
  return <div className={styles.root}>{view === 'video' ? <VideoView /> : <MapView />}</div>
}
