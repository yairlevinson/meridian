import { useRef } from 'react'
import { useVideoStore } from '../store/videoStore'
import { useVideoStream } from '../hooks/useVideoStream'
import { useWebCodecsStream } from '../hooks/useWebCodecsStream'
import styles from './VideoView.module.css'

export function VideoView(): React.JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)
  const jmuxerVideoRef = useRef<HTMLVideoElement>(null)
  const streamState = useVideoStore((s) => s.streamState)
  const gridLines = useVideoStore((s) => s.gridLines)
  const wsPort = streamState?.wsPort ?? null
  const streaming = streamState?.streaming ?? false
  const pipeline = streamState?.pipeline ?? 'ffmpeg'

  // Use the appropriate hook based on the active pipeline
  useVideoStream(videoRef, pipeline === 'ffmpeg' ? wsPort : null, streamState?.sourceType)
  useWebCodecsStream(jmuxerVideoRef, pipeline === 'webcodecs' ? wsPort : null)

  return (
    <div className={styles.container}>
      {pipeline === 'ffmpeg' ? (
        <video ref={videoRef} className={styles.video} autoPlay muted playsInline />
      ) : (
        <video ref={jmuxerVideoRef} className={styles.video} autoPlay muted playsInline />
      )}
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
