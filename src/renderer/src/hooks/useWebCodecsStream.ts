import { useEffect, useRef } from 'react'
import JMuxer from 'jmuxer'
import { VideoSourceType } from '../../../shared-types/ipc/VideoTypes'
import { unpackAv1Chunk } from '../../../shared-types/ipc/VideoChunkProtocol'

/**
 * Raw pipeline hook:
 * - H.264 UDP path: raw Annex-B over WebSocket, decoded via jmuxer + MSE.
 * - AV1 RTP/UDP path: depayloaded AV1 access units over WebSocket, decoded via WebCodecs.
 */
export function useWebCodecsStream(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  wsPort: number | null,
  sourceType?: VideoSourceType
): void {
  const cleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (!wsPort) return

    const video = videoRef.current
    const canvas = canvasRef.current
    if (sourceType === VideoSourceType.UDP_H264 && !video) return
    if (sourceType === VideoSourceType.AV1 && !canvas) return

    let destroyed = false
    let ws: WebSocket | null = null

    const cleanup = (): void => {
      if (destroyed) return
      destroyed = true
      ws?.close()
    }

    if (sourceType === VideoSourceType.UDP_H264) {
      const jmuxer = new JMuxer({
        node: video!,
        mode: 'video',
        flushingTime: 0,
        maxDelay: 500,
        fps: 30,
        debug: false
      })

      ws = new WebSocket(`ws://127.0.0.1:${wsPort}`)
      ws.binaryType = 'arraybuffer'

      ws.onmessage = (ev: MessageEvent) => {
        if (destroyed) return
        const data = new Uint8Array(ev.data as ArrayBuffer)
        jmuxer.feed({ video: data })
      }

      const jmuxerCleanup = cleanup
      cleanupRef.current = () => {
        jmuxerCleanup()
        jmuxer.destroy()
      }
      return cleanupRef.current
    }

    if (sourceType !== VideoSourceType.AV1) {
      cleanupRef.current = cleanup
      return cleanup
    }

    if (!('VideoDecoder' in window)) {
      console.error('[AV1] WebCodecs VideoDecoder is not available')
      cleanupRef.current = cleanup
      return cleanup
    }

    const ctx = canvas!.getContext('2d')
    if (!ctx) {
      console.error('[AV1] failed to get canvas 2D context')
      cleanupRef.current = cleanup
      return cleanup
    }

    let sawKey = false
    let resolvedConfig: VideoDecoderConfig | null = null

    const createDecoder = (): VideoDecoder =>
      new VideoDecoder({
        output: (frame) => {
          if (destroyed) {
            frame.close()
            return
          }
          if (canvas!.width !== frame.codedWidth || canvas!.height !== frame.codedHeight) {
            canvas!.width = frame.codedWidth
            canvas!.height = frame.codedHeight
          }
          ctx.drawImage(frame, 0, 0, canvas!.width, canvas!.height)
          frame.close()
        },
        error: (err) => {
          console.error('[AV1] decoder error:', err)
          sawKey = false
        }
      })

    let decoder = createDecoder()

    // Probe codec/hw-accel combinations from highest profile down.
    // The outer loop prioritises hardware decode; the inner loop tries
    // progressively lower AV1 profiles so we pick the best the platform
    // can accelerate.
    const codecs = ['av01.0.08M.08', 'av01.0.04M.08', 'av01.0.01M.08']
    const hwAccelOptions: HardwareAcceleration[] = [
      'prefer-hardware',
      'no-preference',
      'prefer-software'
    ]

    const connectWs = (): void => {
      if (destroyed) return
      ws = new WebSocket(`ws://127.0.0.1:${wsPort}`)
      ws.binaryType = 'arraybuffer'
      ws.onmessage = (ev: MessageEvent) => {
        if (destroyed) return
        const raw = new Uint8Array(ev.data as ArrayBuffer)
        const parsed = unpackAv1Chunk(raw)
        if (!parsed) return
        // Skip tiny payloads (e.g. lone temporal delimiter OBUs)
        if (parsed.payload.byteLength < 4) return

        // Must start with a keyframe — both initially and after decoder error
        if (!sawKey) {
          if (!parsed.key) return
          sawKey = true
        }

        // Recover from closed decoder on next keyframe
        if (decoder.state === 'closed') {
          if (!parsed.key || !resolvedConfig) return
          decoder = createDecoder()
          decoder.configure(resolvedConfig)
          sawKey = true
        }

        try {
          decoder.decode(
            new EncodedVideoChunk({
              type: parsed.key ? 'key' : 'delta',
              timestamp: parsed.timestampUs,
              data: parsed.payload
            })
          )
        } catch (err) {
          console.warn('[AV1] decode failed:', err)
          sawKey = false
        }
      }
    }

    void (async () => {
      for (const hw of hwAccelOptions) {
        for (const codec of codecs) {
          try {
            const config: VideoDecoderConfig = {
              codec,
              optimizeForLatency: true,
              hardwareAcceleration: hw
            }
            const support = await VideoDecoder.isConfigSupported(config)
            if (!support.supported) continue
            decoder.configure(config)
            resolvedConfig = config
            connectWs()
            return
          } catch {
            // try next combination
          }
        }
      }
      console.error('[AV1] no supported AV1 decoder configuration found')
    })()

    cleanupRef.current = () => {
      cleanup()
      try {
        decoder.close()
      } catch {
        // ignore
      }
    }
    return cleanupRef.current
  }, [canvasRef, sourceType, videoRef, wsPort])
}
