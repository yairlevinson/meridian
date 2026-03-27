import { useEffect, useRef } from 'react'

/**
 * Hook that connects a <video> element to the VideoManager's WebSocket server,
 * receiving fragmented MP4 data and feeding it to MSE for hardware-decoded playback.
 *
 * ffmpeg outputs fMP4 to stdout in arbitrary-sized chunks. MSE's SourceBuffer
 * can handle partial boxes, but we accumulate data and feed it in larger pieces
 * to reduce overhead and avoid edge-case parse errors.
 */
export function useVideoStream(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  wsPort: number | null
): void {
  const cleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video || !wsPort) return

    console.log('[VideoStream] init wsPort=', wsPort)

    let destroyed = false
    let sb: SourceBuffer | null = null
    let queue: Uint8Array[] = []
    let playAttempted = false
    let receivedBytes = 0

    const ms = new MediaSource()
    video.src = URL.createObjectURL(ms)

    const flush = (): void => {
      if (!sb || sb.updating || destroyed || ms.readyState !== 'open' || queue.length === 0) return
      // Merge all queued chunks into one buffer for efficient append
      const totalLen = queue.reduce((n, c) => n + c.byteLength, 0)
      const merged = new Uint8Array(totalLen)
      let offset = 0
      for (const chunk of queue) {
        merged.set(chunk, offset)
        offset += chunk.byteLength
      }
      queue = []
      try {
        sb.appendBuffer(merged)
      } catch (err) {
        console.warn('[VideoStream] appendBuffer error:', err)
      }
    }

    const tryPlay = (): void => {
      if (playAttempted || !sb || sb.buffered.length === 0) return
      playAttempted = true
      const buffEnd = sb.buffered.end(0)
      console.log(`[VideoStream] starting playback, buffered: ${buffEnd.toFixed(2)}s`)
      // Seek to near-live edge for low latency
      video.currentTime = Math.max(0, buffEnd - 0.1)
      video.play().catch((e) => console.warn('[VideoStream] play():', e.message))
    }

    ms.addEventListener('sourceopen', () => {
      if (destroyed) return
      console.log('[VideoStream] sourceopen')
      try {
        sb = ms.addSourceBuffer('video/mp4; codecs="avc1.42E01E"')
        sb.mode = 'segments'
        sb.addEventListener('updateend', () => {
          tryPlay()
          flush()
        })
        sb.addEventListener('error', () => {
          console.error('[VideoStream] SourceBuffer error event')
        })
        // Flush any chunks that arrived before sourceopen
        flush()
      } catch (err) {
        console.error('[VideoStream] addSourceBuffer failed:', err)
      }
    })

    const onVideoError = (): void => {
      console.error('[VideoStream] <video> error:', video.error?.code, video.error?.message)
    }
    video.addEventListener('error', onVideoError)

    // Connect WebSocket
    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`)
    ws.binaryType = 'arraybuffer'

    ws.onopen = () => console.log('[VideoStream] ws connected')

    ws.onmessage = (ev: MessageEvent) => {
      if (destroyed) return
      const chunk = new Uint8Array(ev.data as ArrayBuffer)
      receivedBytes += chunk.byteLength
      if (receivedBytes % 200000 < chunk.byteLength) {
        let buf = 'none'
        try {
          if (sb && ms.readyState === 'open' && sb.buffered.length > 0)
            buf = `${sb.buffered.start(0).toFixed(1)}-${sb.buffered.end(0).toFixed(1)}s`
        } catch {
          /* SourceBuffer may have been removed */
        }
        console.log(
          `[VideoStream] ${(receivedBytes / 1024).toFixed(0)} KB, buf=${buf}, q=${queue.length}`
        )
      }

      queue.push(chunk)
      // Cap queue size
      if (queue.length > 120) queue.splice(0, queue.length - 60)
      flush()
    }

    ws.onclose = () => console.log('[VideoStream] ws closed')
    ws.onerror = () => console.warn('[VideoStream] ws error')

    // Keep video near live edge to avoid growing latency
    const liveSyncInterval = setInterval(() => {
      if (destroyed || !sb || video.paused || ms.readyState !== 'open') return
      try {
        if (sb.buffered.length === 0) return
      } catch {
        return
      }
      const liveEdge = sb.buffered.end(sb.buffered.length - 1)
      const behind = liveEdge - video.currentTime
      if (behind > 2) {
        console.log(`[VideoStream] seeking to live edge (was ${behind.toFixed(1)}s behind)`)
        video.currentTime = liveEdge - 0.1
      }
    }, 3000)

    const cleanup = (): void => {
      if (destroyed) return
      destroyed = true
      console.log('[VideoStream] cleanup')
      clearInterval(liveSyncInterval)
      video.removeEventListener('error', onVideoError)
      ws.close()
      sb = null
      queue = []
      if (ms.readyState === 'open') {
        try {
          ms.endOfStream()
        } catch {
          /* ok */
        }
      }
      URL.revokeObjectURL(video.src)
      video.src = ''
    }

    cleanupRef.current = cleanup
    return cleanup
  }, [wsPort, videoRef])
}
