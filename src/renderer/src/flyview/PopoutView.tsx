import { MapView } from '../components/MapView'
import { VideoView } from '../components/VideoView'
import { VideoControls } from '../components/VideoControls'
import styles from './PopoutView.module.css'

interface PopoutViewProps {
  view: 'video' | 'map'
}

export function PopoutView({ view }: PopoutViewProps): React.JSX.Element {
  return (
    <div className={styles.root}>
      {view === 'video' ? (
        <>
          <VideoView />
          <VideoControls />
        </>
      ) : (
        <MapView />
      )}
    </div>
  )
}
