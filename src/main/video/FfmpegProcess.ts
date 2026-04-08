import { ChildProcess, spawn } from 'child_process'
import { EventEmitter } from 'events'
import { VideoSourceType } from '@shared/ipc/VideoTypes'
import { createLogger } from '../logger'

const log = createLogger('ffmpeg')

// ffmpeg-static provides the path to a bundled ffmpeg binary
const ffmpegPath: string = (() => {
  try {
    return require('ffmpeg-static') // eslint-disable-line @typescript-eslint/no-require-imports
  } catch {
    return 'ffmpeg'
  }
})()

export interface FfmpegOptions {
  sourceType: VideoSourceType
  uri: string
  lowLatency?: boolean
}

/**
 * Manages an ffmpeg child process that remuxes a video stream into
 * fragmented MP4 on stdout, suitable for feeding to MSE via WebSocket.
 */
export class FfmpegProcess extends EventEmitter {
  private process: ChildProcess | null = null
  private _running = false

  get running(): boolean {
    return this._running
  }

  /** Build ffmpeg CLI arguments for the given source. */
  static buildArgs(opts: FfmpegOptions): string[] {
    const args: string[] = ['-hide_banner', '-loglevel', 'warning']

    // Low-latency input flags
    if (opts.lowLatency !== false) {
      args.push('-fflags', 'nobuffer+discardcorrupt', '-flags', 'low_delay')
      args.push('-analyzeduration', '500000', '-probesize', '500000')
      args.push('-err_detect', 'ignore_err')
    }

    // Source-specific input options
    switch (opts.sourceType) {
      case VideoSourceType.RTSP:
        args.push('-rtsp_transport', 'tcp')
        break
      case VideoSourceType.UDP_H264:
        // UDP streams are typically MPEG-TS wrapped; force the demuxer
        // so ffmpeg doesn't misdetect the container format
        args.push('-f', 'mpegts')
        break
      case VideoSourceType.TCP_AV1:
        // AV1 is streamed over TCP in Matroska container (AV1 in MPEG-TS
        // is non-standard and not supported by most ffmpeg builds)
        break
      case VideoSourceType.TCP_MPEGTS:
        break
      default:
        break
    }

    args.push('-i', opts.uri)

    // Output: passthrough video, no audio
    args.push('-c:v', 'copy', '-an')
    // MPEG-TS uses codec tag 0x1b for H.264, incompatible with the MP4 muxer
    // that expects 'avc1'. AV1 doesn't need a tag override.
    if (opts.sourceType !== VideoSourceType.TCP_AV1) {
      args.push('-tag:v', 'avc1')
    }

    // Output: fragmented MP4 to stdout for WebSocket broadcast
    args.push('-f', 'mp4')
    args.push('-movflags', 'frag_keyframe+empty_moov+default_base_moof')
    args.push('pipe:1')

    return args
  }

  /** Build the full URI from source type and user-provided values. */
  static buildUri(
    sourceType: VideoSourceType,
    udpPort: number,
    rtspUrl: string,
    tcpUrl: string
  ): string {
    switch (sourceType) {
      case VideoSourceType.UDP_H264:
        return `udp://@:${udpPort}`
      case VideoSourceType.RTSP:
        return rtspUrl
      case VideoSourceType.TCP_MPEGTS:
      case VideoSourceType.TCP_AV1:
        return tcpUrl
      default:
        return ''
    }
  }

  start(opts: FfmpegOptions): void {
    if (this._running) this.stop()

    const args = FfmpegProcess.buildArgs(opts)
    log.log(`spawning: ${ffmpegPath} ${args.join(' ')}`)

    this.process = spawn(ffmpegPath, args, {
      stdio: ['pipe', 'pipe', 'pipe']
    })
    this._running = true

    this.process.stdout!.on('data', (chunk: Buffer) => {
      this.emit('data', chunk)
    })

    this.process.stderr!.on('data', (chunk: Buffer) => {
      const msg = chunk.toString().trim()
      if (msg) {
        log.log(msg)
        this.emit('stderr', msg)
      }
    })

    this.process.on('error', (err) => {
      log.error('process error:', err.message)
      this._running = false
      this.emit('error', err)
    })

    this.process.on('close', (code) => {
      log.log(`exited with code ${code}`)
      this._running = false
      // Defer close event to allow remaining stderr data to flush first
      setImmediate(() => this.emit('close', code))
    })

    this.emit('started')
  }

  stop(): void {
    if (!this.process) return
    const proc = this.process
    this.process = null
    this._running = false
    // Send 'q' to stdin for graceful shutdown (ffmpeg convention)
    try {
      proc.stdin?.write('q')
    } catch {
      // stdin may be closed
    }
    // Force kill after 3s if it doesn't exit
    const timer = setTimeout(() => {
      try {
        proc.kill('SIGKILL')
      } catch {
        /* already dead */
      }
    }, 3000)
    proc.once('close', () => clearTimeout(timer))
  }

  /**
   * Stop using SIGINT so ffmpeg finalizes output files (e.g. recording).
   * Unlike stop() which sends 'q' (only works in terminal mode), SIGINT
   * reliably triggers ffmpeg's graceful shutdown on all platforms.
   */
  stopWithSigint(): void {
    if (!this.process) return
    const proc = this.process
    this.process = null
    this._running = false
    try {
      proc.kill('SIGINT')
    } catch {
      /* already dead */
    }
    // Force kill after 3s if SIGINT doesn't work
    const timer = setTimeout(() => {
      try {
        proc.kill('SIGKILL')
      } catch {
        /* already dead */
      }
    }, 3000)
    proc.once('close', () => clearTimeout(timer))
  }

  destroy(): void {
    this.stop()
    this.removeAllListeners()
  }
}
