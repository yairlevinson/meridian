import { useRef } from 'react'
import { useVideoStore } from '../store/videoStore'
import { useVideoStream } from '../hooks/useVideoStream'
import styles from './VideoView.module.css'

export function VideoView(): React.JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamState = useVideoStore((s) => s.streamState)
  const gridLines = useVideoStore((s) => s.gridLines)
  const wsPort = streamState?.wsPort ?? null
  const streaming = streamState?.streaming ?? false

  useVideoStream(videoRef, wsPort)

  return (
    <div className={styles.container}>
      <video ref={videoRef} className={styles.video} autoPlay muted playsInline />
      {gridLines && <div className={styles.grid} />}
      {!streaming && (
        <div className={styles.noVideo}>
          <div className={styles.noVideoText}>No Video</div>
          {streamState?.error && <div className={styles.errorText}>{streamState.error}</div>}
        </div>
      )}
    </div>
  )
}
