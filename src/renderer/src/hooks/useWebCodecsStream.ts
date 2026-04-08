import { useEffect, useRef } from 'react'
import JMuxer from 'jmuxer'

/**
 * Hook that connects a <video> element to the VideoManager's WebSocket server,
 * receiving raw H.264 Annex B data and decoding it via jmuxer + MSE.
 *
 * jmuxer handles all H.264 parsing (NAL unit detection, SPS/PPS extraction,
 * access unit grouping) and muxes into fMP4 for MSE — no ffmpeg subprocess needed.
 *
 * Pipeline: raw H.264 Annex B → WebSocket → jmuxer → MSE → <video>
 */
export function useWebCodecsStream(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  wsPort: number | null
): void {
  const cleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video || !wsPort) return

    console.log('[JMuxer] init wsPort=', wsPort)

    let destroyed = false

    const jmuxer = new JMuxer({
      node: video,
      mode: 'video',
      flushingTime: 0, // flush immediately for low latency
      maxDelay: 500,
      fps: 30,
      debug: false,
      onReady: () => console.log('[JMuxer] ready'),
      onError: (err) => console.error('[JMuxer] error:', err)
    })

    // ── WebSocket connection ───────────────────────────────────
    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`)
    ws.binaryType = 'arraybuffer'

    let receivedBytes = 0

    ws.onopen = () => console.log('[JMuxer] ws connected')

    ws.onmessage = (ev: MessageEvent) => {
      if (destroyed) return
      const data = new Uint8Array(ev.data as ArrayBuffer)
      receivedBytes += data.byteLength
      if (receivedBytes % 500000 < data.byteLength) {
        console.log(`[JMuxer] ${(receivedBytes / 1024).toFixed(0)} KB received`)
      }
      jmuxer.feed({ video: data })
    }

    ws.onclose = () => console.log('[JMuxer] ws closed')
    ws.onerror = () => console.warn('[JMuxer] ws error')

    // ── Cleanup ────────────────────────────────────────────────
    const cleanup = (): void => {
      if (destroyed) return
      destroyed = true
      console.log('[JMuxer] cleanup')
      ws.close()
      jmuxer.destroy()
    }

    cleanupRef.current = cleanup
    return cleanup
  }, [wsPort, videoRef])
}
