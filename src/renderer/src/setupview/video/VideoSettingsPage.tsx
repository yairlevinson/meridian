import { useCallback, useState, useEffect } from 'react'
import { useVideoStore } from '../../store/videoStore'
import { VideoSourceType } from '../../../../shared-types/ipc/VideoTypes'
import styles from './VideoSettingsPage.module.css'

const SOURCE_OPTIONS: Array<{ value: VideoSourceType; label: string; description: string }> = [
  {
    value: VideoSourceType.Disabled,
    label: 'Disabled',
    description: 'No video streaming'
  },
  {
    value: VideoSourceType.UDP_H264,
    label: 'UDP H.264 raw',
    description: 'Receive raw H.264 Annex-B over UDP'
  },
  {
    value: VideoSourceType.AV1,
    label: 'AV1 RTP',
    description: 'Receive AV1 RTP over UDP (low latency) or AV1 over TCP (ffmpeg fallback)'
  },
  {
    value: VideoSourceType.RTSP,
    label: 'RTSP',
    description: 'Connect to an RTSP server on the vehicle'
  },
  {
    value: VideoSourceType.TCP_MPEGTS,
    label: 'TCP MPEG-TS',
    description: 'Receive MPEG transport stream over TCP'
  }
]

const DEFAULT_URIS: Record<VideoSourceType, string> = {
  [VideoSourceType.Disabled]: '',
  [VideoSourceType.UDP_H264]: 'udp://@:5600',
  [VideoSourceType.AV1]: 'udp://@:5601',
  [VideoSourceType.RTSP]: 'rtsp://192.168.1.1:8554/live',
  [VideoSourceType.TCP_MPEGTS]: 'tcp://192.168.1.1:5000'
}

const PLACEHOLDERS: Record<VideoSourceType, string> = {
  [VideoSourceType.Disabled]: '',
  [VideoSourceType.UDP_H264]: 'udp://@:port (raw H.264 Annex-B)',
  [VideoSourceType.AV1]: 'udp://@:port or tcp://vehicle-ip:port',
  [VideoSourceType.RTSP]: 'rtsp://vehicle-ip:port/path',
  [VideoSourceType.TCP_MPEGTS]: 'tcp://vehicle-ip:port'
}

export function VideoSettingsPage(): React.JSX.Element {
  const streamState = useVideoStore((s) => s.streamState)
  const streaming = streamState?.streaming ?? false
  const recording = streamState?.recording ?? false
  const error = streamState?.error ?? null

  const [sourceType, setSourceType] = useState<VideoSourceType>(
    streamState?.sourceType ?? VideoSourceType.UDP_H264
  )
  const [uri, setUri] = useState(streamState?.uri ?? DEFAULT_URIS[VideoSourceType.UDP_H264])
  const [dirty, setDirty] = useState(false)

  // Sync from stream state on mount
  useEffect(() => {
    if (streamState?.sourceType && streamState.sourceType !== VideoSourceType.Disabled) {
      setSourceType(streamState.sourceType)
      setUri(streamState.uri)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSourceChange = useCallback((type: VideoSourceType) => {
    setSourceType(type)
    // Only reset URI if it's still the default for the old type
    setUri((prev) => {
      const isDefault = Object.values(DEFAULT_URIS).includes(prev)
      return isDefault ? DEFAULT_URIS[type] : prev
    })
    setDirty(true)
  }, [])

  const handleApply = useCallback(() => {
    if (sourceType === VideoSourceType.Disabled) {
      window.bridge?.videoStop()
    } else {
      // Stop current stream first, then start with new settings
      if (streaming) window.bridge?.videoStop()
      setTimeout(() => {
        window.bridge?.videoStart(sourceType, uri)
      }, 300)
    }
    setDirty(false)
  }, [sourceType, uri, streaming])

  const handleStop = useCallback(() => {
    window.bridge?.videoStop()
  }, [])

  const isDisabled = sourceType === VideoSourceType.Disabled

  return (
    <div className={styles.root}>
      <div className={styles.title}>Video</div>

      {/* Status indicator */}
      <div className={styles.statusBar}>
        <span className={streaming ? styles.statusDotOn : styles.statusDotOff} />
        <span className={streaming ? styles.statusTextOn : styles.statusTextOff}>
          {streaming ? `Streaming ${streamState?.sourceType ?? ''}` : 'Not streaming'}
        </span>
        {recording && <span className={styles.recordingBadge}>REC</span>}
      </div>

      {/* Source type */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Video Source</div>
        <div className={styles.sourceGrid}>
          {SOURCE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              className={`${styles.sourceCard} ${sourceType === opt.value ? styles.sourceCardActive : ''}`}
              onClick={() => handleSourceChange(opt.value)}
            >
              <span className={styles.sourceLabel}>{opt.label}</span>
              <span className={styles.sourceDesc}>{opt.description}</span>
            </button>
          ))}
        </div>
      </div>

      {/* URI */}
      {!isDisabled && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Stream URI</div>
          <input
            className={styles.uriInput}
            type="text"
            value={uri}
            placeholder={PLACEHOLDERS[sourceType]}
            onChange={(e) => {
              setUri(e.target.value)
              setDirty(true)
            }}
          />
        </div>
      )}

      {/* Actions */}
      <div className={styles.actions}>
        <button className={styles.applyBtn} onClick={handleApply} disabled={!dirty && streaming}>
          {streaming && !dirty ? 'Streaming' : isDisabled ? 'Stop' : 'Start Streaming'}
        </button>
        {streaming && (
          <button className={styles.stopBtn} onClick={handleStop}>
            Stop
          </button>
        )}
      </div>

      {/* Error */}
      {error && <div className={styles.error}>{error}</div>}
    </div>
  )
}
