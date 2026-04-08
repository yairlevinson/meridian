import { useCallback, useState } from 'react'
import { useVideoStore } from '../store/videoStore'
import { VideoSourceType } from '../../../shared-types/ipc/VideoTypes'
import styles from './VideoControls.module.css'

const DEFAULT_URIS: Record<VideoSourceType, string> = {
  [VideoSourceType.UDP_H264]: 'udp://@:5600',
  [VideoSourceType.AV1]: 'udp://@:5601',
  [VideoSourceType.RTSP]: 'rtsp://192.168.1.1:8554/live',
  [VideoSourceType.TCP_MPEGTS]: 'tcp://192.168.1.1:5000',
  [VideoSourceType.Disabled]: ''
}

const PLACEHOLDERS: Record<VideoSourceType, string> = {
  [VideoSourceType.UDP_H264]: 'udp://@:port (listens for incoming video)',
  [VideoSourceType.AV1]: 'udp://@:port or tcp://vehicle-ip:port',
  [VideoSourceType.RTSP]: 'rtsp://vehicle-ip:port/path',
  [VideoSourceType.TCP_MPEGTS]: 'tcp://vehicle-ip:port',
  [VideoSourceType.Disabled]: ''
}

export function VideoControls(): React.JSX.Element {
  const streamState = useVideoStore((s) => s.streamState)
  const gridLines = useVideoStore((s) => s.gridLines)
  const setGridLines = useVideoStore((s) => s.setGridLines)
  const streaming = streamState?.streaming ?? false
  const recording = streamState?.recording ?? false

  const [sourceType, setSourceType] = useState<VideoSourceType>(VideoSourceType.UDP_H264)
  const [uri, setUri] = useState(DEFAULT_URIS[VideoSourceType.UDP_H264])

  const handleSourceChange = useCallback((type: VideoSourceType) => {
    setSourceType(type)
    setUri(DEFAULT_URIS[type])
  }, [])

  const handleStart = useCallback(() => {
    window.bridge?.videoStart(sourceType, uri)
  }, [sourceType, uri])

  const handleStop = useCallback(() => {
    window.bridge?.videoStop()
  }, [])

  const handleRecord = useCallback(() => {
    if (recording) {
      window.bridge?.videoStopRecording()
    } else {
      const ts = new Date().toISOString().replace(/[:.]/g, '-')
      window.bridge?.videoStartRecording(`video-${ts}.mp4`)
    }
  }, [recording])

  return (
    <div className={styles.controls}>
      <div className={styles.row}>
        <select
          className={styles.select}
          value={sourceType}
          onChange={(e) => handleSourceChange(e.target.value as VideoSourceType)}
        >
          <option value={VideoSourceType.UDP_H264}>UDP H.264 (listen)</option>
          <option value={VideoSourceType.AV1}>AV1 RTP (UDP) / AV1 TCP</option>
          <option value={VideoSourceType.RTSP}>RTSP (connect)</option>
          <option value={VideoSourceType.TCP_MPEGTS}>TCP MPEG-TS</option>
        </select>
        <input
          className={styles.input}
          type="text"
          value={uri}
          onChange={(e) => setUri(e.target.value)}
          placeholder={PLACEHOLDERS[sourceType]}
        />
      </div>
      <div className={styles.row}>
        {!streaming ? (
          <button className={styles.btn} onClick={handleStart}>
            Start
          </button>
        ) : (
          <button className={styles.btn} onClick={handleStop}>
            Stop
          </button>
        )}
        <button
          className={`${styles.btn} ${recording ? styles.recording : ''}`}
          onClick={handleRecord}
          disabled={!streaming}
        >
          {recording ? 'Stop Rec' : 'Record'}
        </button>
        <button
          className={`${styles.btn} ${gridLines ? styles.active : ''}`}
          onClick={() => setGridLines(!gridLines)}
        >
          Grid
        </button>
      </div>
      {streaming && <div className={styles.status}>Streaming {streamState?.sourceType}</div>}
      {!streaming && streamState?.error && <div className={styles.error}>{streamState.error}</div>}
    </div>
  )
}
