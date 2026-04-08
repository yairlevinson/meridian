import { EventEmitter } from 'events'
import { FfmpegProcess, type FfmpegOptions } from './FfmpegProcess'
import { VideoReceiver } from './VideoReceiver'
import { VideoWebSocketServer } from './VideoWebSocketServer'
import { VideoSourceType, type VideoStreamState } from '@shared/ipc/VideoTypes'
import { createLogger } from '../logger'

const log = createLogger('VideoManager')

/**
 * Pipelines:
 *  - 'ffmpeg': source → ffmpeg (remux to fMP4) → WebSocket → MSE (renderer)
 *  - 'webcodecs': source → raw socket → WebSocket → WebCodecs VideoDecoder (renderer)
 *
 * The ffmpeg pipeline handles container remuxing; the webcodecs pipeline sends
 * raw encoded data and relies on the renderer to decode via the WebCodecs API.
 * RTSP sources always use the ffmpeg pipeline.
 */
type Pipeline = 'ffmpeg' | 'webcodecs'

/**
 * Central video streaming orchestrator.
 *
 * Manages either an ffmpeg subprocess or a direct socket receiver,
 * plus a local WebSocket server that pushes data to the renderer.
 */
export class VideoManager extends EventEmitter {
  private ffmpeg = new FfmpegProcess()
  private receiver = new VideoReceiver()
  private wsServer = new VideoWebSocketServer()
  private _pipeline: Pipeline = 'ffmpeg'
  private _state: VideoStreamState = {
    sourceType: VideoSourceType.Disabled,
    uri: '',
    streaming: false,
    recording: false,
    wsPort: null,
    error: null,
    pipeline: 'ffmpeg'
  }

  private restartTimer: ReturnType<typeof setTimeout> | null = null
  private _autoRestartOpts: FfmpegOptions | null = null
  private _restartCount = 0
  private _lastStderrLines: string[] = []
  private static readonly MAX_RESTARTS = 5
  private static readonly RESTART_DELAY_MS = 5000

  get state(): VideoStreamState {
    return { ...this._state }
  }

  async init(): Promise<void> {
    const port = await this.wsServer.start()
    this._state.wsPort = port
    this._emitState()

    // ── ffmpeg pipeline wiring ──────────────────────────────────
    this.ffmpeg.on('data', (chunk: Buffer) => {
      this.wsServer.broadcast(chunk)
    })

    this.ffmpeg.on('started', () => {
      this._state.streaming = true
      this._state.error = null
      this._restartCount = 0
      this._lastStderrLines = []
      // New stream — clear cached init segment so it's re-captured from fresh data
      this.wsServer.resetInitSegment()
      this._emitState()
    })

    this.ffmpeg.on('stderr', (line: string) => {
      this._lastStderrLines.push(line)
      if (this._lastStderrLines.length > 10) this._lastStderrLines.shift()
    })

    this.ffmpeg.on('close', (code: number) => {
      this._state.streaming = false
      this._state.recording = false

      const stderrText = this._lastStderrLines.join('\n')
      const isConnectionRefused = stderrText.includes('Connection refused')
      const isNotFound = stderrText.includes('404') || stderrText.includes('Not Found')

      if (code !== 0 && code !== null) {
        this._state.error = isConnectionRefused
          ? 'Connection refused — is the video source running?'
          : `ffmpeg exited with code ${code}`
      }
      this._emitState()

      // Only auto-restart for transient failures, not permanent ones
      const shouldRestart =
        this._autoRestartOpts &&
        code !== 0 &&
        !isConnectionRefused &&
        !isNotFound &&
        this._restartCount < VideoManager.MAX_RESTARTS

      if (shouldRestart) {
        this._scheduleRestart()
      } else if (this._restartCount >= VideoManager.MAX_RESTARTS) {
        this._state.error = 'Max restart attempts reached'
        this._emitState()
      }
    })

    this.ffmpeg.on('error', (err: Error) => {
      this._state.streaming = false
      this._state.error = err.message
      this._emitState()
    })

    // ── WebCodecs pipeline wiring (direct socket) ──────────────
    this.receiver.on('data', (chunk: Buffer) => {
      this.wsServer.broadcast(chunk)
    })

    this.receiver.on('started', () => {
      this._state.streaming = true
      this._state.error = null
      this._emitState()
    })

    this.receiver.on('error', (err: Error) => {
      this._state.streaming = false
      this._state.error = err.message
      this._emitState()
    })

    this.receiver.on('close', () => {
      this._state.streaming = false
      this._emitState()
    })
  }

  /** Choose which pipeline to use based on source type and URI. */
  private _selectPipeline(sourceType: VideoSourceType, uri: string): Pipeline {
    // RTSP and MPEG-TS/TCP are handled by ffmpeg remux path.
    if (sourceType === VideoSourceType.RTSP || sourceType === VideoSourceType.TCP_MPEGTS) {
      return 'ffmpeg'
    }

    // AV1 can run in two modes:
    // - udp://...  => direct AV1 RTP depayload + WebCodecs
    // - tcp://...  => ffmpeg remux fallback path
    if (sourceType === VideoSourceType.AV1) {
      return uri.startsWith('udp://') ? 'webcodecs' : 'ffmpeg'
    }

    // H.264 UDP → direct socket + jmuxer (no ffmpeg needed)
    return 'webcodecs'
  }

  /**
   * Start streaming from the given source.
   */
  start(sourceType: VideoSourceType, uri: string, lowLatency = true): void {
    if (sourceType === VideoSourceType.Disabled || !uri) {
      this.stop()
      return
    }

    this._pipeline = this._selectPipeline(sourceType, uri)
    this._state.sourceType = sourceType
    this._state.uri = uri
    this._state.error = null
    this._state.pipeline = this._pipeline
    this._emitState()

    if (this._pipeline === 'ffmpeg') {
      this.wsServer.setRawMode(false)
      const opts: FfmpegOptions = { sourceType, uri, lowLatency }
      this._autoRestartOpts = opts
      this._restartCount = 0
      this._lastStderrLines = []
      this.ffmpeg.start(opts)
    } else {
      this.wsServer.setRawMode(true)
      this.receiver.start(sourceType, uri)
    }
  }

  stop(): void {
    this._clearRestart()
    this._autoRestartOpts = null
    this._restartCount = 0

    this.wsServer.stopRecording()
    this.ffmpeg.stop()
    this.receiver.stop()
    this._state.sourceType = VideoSourceType.Disabled
    this._state.uri = ''
    this._state.streaming = false
    this._state.recording = false
    this._state.error = null
    this._emitState()
  }

  startRecording(filePath: string): void {
    if (!this._state.streaming) return
    this.wsServer.startRecording(filePath)
    this._state.recording = true
    this._emitState()
  }

  stopRecording(): void {
    this.wsServer.stopRecording()
    this._state.recording = false
    this._emitState()
  }

  private _scheduleRestart(): void {
    this._clearRestart()
    this._restartCount++
    log.log(
      `scheduling restart ${this._restartCount}/${VideoManager.MAX_RESTARTS} in ${VideoManager.RESTART_DELAY_MS}ms`
    )
    this.restartTimer = setTimeout(() => {
      if (this._autoRestartOpts) {
        this._lastStderrLines = []
        this.ffmpeg.start(this._autoRestartOpts)
      }
    }, VideoManager.RESTART_DELAY_MS)
  }

  private _clearRestart(): void {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }
  }

  private _emitState(): void {
    this.emit('stateChanged', this.state)
  }

  destroy(): void {
    this._clearRestart()
    this.ffmpeg.destroy()
    this.receiver.destroy()
    this.wsServer.destroy()
    this.removeAllListeners()
  }
}
