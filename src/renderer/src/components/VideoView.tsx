import { useRef } from 'react'
import { useVideoStore } from '../store/videoStore'
import { useVideoStream } from '../hooks/useVideoStream'
import { useWebCodecsStream } from '../hooks/useWebCodecsStream'
import { VideoSourceType } from '../../../shared-types/ipc/VideoTypes'
import styles from './VideoView.module.css'

export function VideoView(): React.JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)
  const rawVideoRef = useRef<HTMLVideoElement>(null)
  const av1CanvasRef = useRef<HTMLCanvasElement>(null)
  const streamState = useVideoStore((s) => s.streamState)
  const gridLines = useVideoStore((s) => s.gridLines)
  const wsPort = streamState?.wsPort ?? null
  const wsUrl = streamState?.wsUrl ?? (wsPort ? `ws://127.0.0.1:${wsPort}` : null)
  const streaming = streamState?.streaming ?? false
  const pipeline = streamState?.pipeline ?? 'ffmpeg'

  // Use the appropriate hook based on the active pipeline
  useVideoStream(videoRef, pipeline === 'ffmpeg' ? wsUrl : null, streamState?.sourceType)
  useWebCodecsStream(
    rawVideoRef,
    av1CanvasRef,
    pipeline === 'webcodecs' ? wsUrl : null,
    streamState?.sourceType
  )

  return (
    <div className={styles.container}>
      {pipeline === 'ffmpeg' ? (
        <video ref={videoRef} className={styles.video} autoPlay muted playsInline />
      ) : streamState?.sourceType === VideoSourceType.AV1 ? (
        <canvas ref={av1CanvasRef} className={styles.video} />
      ) : (
        <video ref={rawVideoRef} className={styles.video} autoPlay muted playsInline />
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
