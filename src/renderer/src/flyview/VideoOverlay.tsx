import { useCallback } from 'react'
import { useVideoStore } from '../store/videoStore'
import styles from './VideoOverlay.module.css'

export function VideoOverlay(): React.JSX.Element {
  const streamState = useVideoStore((s) => s.streamState)
  const gridLines = useVideoStore((s) => s.gridLines)
  const setGridLines = useVideoStore((s) => s.setGridLines)
  const streaming = streamState?.streaming ?? false
  const recording = streamState?.recording ?? false

  const handleRecord = useCallback(() => {
    if (recording) {
      window.bridge?.videoStopRecording()
    } else {
      const ts = new Date().toISOString().replace(/[:.]/g, '-')
      window.bridge?.videoStartRecording(`video-${ts}.mp4`)
    }
  }, [recording])

  if (!streaming) return <></>

  return (
    <div className={styles.overlay}>
      <button
        className={`${styles.btn} ${recording ? styles.recording : ''}`}
        onClick={handleRecord}
        title={recording ? 'Stop Recording' : 'Record'}
      >
        <span className={recording ? styles.recDotActive : styles.recDot} />
        {recording ? 'REC' : 'REC'}
      </button>
      <button
        className={`${styles.btn} ${gridLines ? styles.active : ''}`}
        onClick={() => setGridLines(!gridLines)}
        title="Toggle grid overlay"
      >
        &#x25A6;
      </button>
    </div>
  )
}
