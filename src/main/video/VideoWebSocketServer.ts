import { WebSocketServer, WebSocket } from 'ws'
import { EventEmitter } from 'events'
import fs from 'fs'
import { createLogger } from '../logger'

const log = createLogger('VideoWS')

const MAX_BUFFERED = 1 * 1024 * 1024 // 1 MB backpressure threshold

/**
 * Read a 32-bit big-endian unsigned int from a buffer.
 */
function readU32(buf: Buffer | Uint8Array, offset: number): number {
  return (
    ((buf[offset]! << 24) |
      (buf[offset + 1]! << 16) |
      (buf[offset + 2]! << 8) |
      buf[offset + 3]!) >>>
    0
  )
}

/**
 * Extract the fMP4 init segment (ftyp + moov boxes) from accumulated data.
 * Returns the byte length of the init segment, or 0 if not yet complete.
 */
function findInitSegmentEnd(buf: Buffer): number {
  let offset = 0
  let ftypEnd = 0
  let moovEnd = 0

  while (offset + 8 <= buf.length) {
    const size = readU32(buf, offset)
    if (size < 8) break // invalid box
    const type = buf.toString('ascii', offset + 4, offset + 8)

    if (type === 'ftyp') ftypEnd = offset + size
    if (type === 'moov') moovEnd = offset + size

    // We have both ftyp and moov — init segment is complete
    if (ftypEnd > 0 && moovEnd > 0) return Math.max(ftypEnd, moovEnd)

    offset += size
  }

  return 0
}

/**
 * Lightweight WebSocket server that pushes binary video data
 * (fragmented MP4 from ffmpeg) to connected renderer clients.
 *
 * Caches the fMP4 init segment (ftyp+moov) and replays it to
 * late-joining clients so their MSE SourceBuffer can initialize.
 */
export class VideoWebSocketServer extends EventEmitter {
  private wss: WebSocketServer | null = null
  private clients = new Set<WebSocket>()
  private _port: number | null = null

  /** Cached fMP4 init segment (ftyp + moov). Sent to new clients on connect. */
  private initSegment: Buffer | null = null
  /** Accumulates early data until we can extract the init segment. */
  private initBuf: Buffer[] = []
  private initBufSize = 0
  /** When true, skip fMP4 init segment detection (raw data mode for WebCodecs). */
  private _rawMode = false
  private _broadcastCount = 0
  private _broadcastBytes = 0

  get port(): number | null {
    return this._port
  }

  async start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.wss = new WebSocketServer({ host: '127.0.0.1', port: 0 })

      this.wss.on('listening', () => {
        const addr = this.wss!.address()
        this._port = typeof addr === 'object' && addr !== null ? addr.port : null
        log.log(`listening on port ${this._port}`)
        resolve(this._port!)
      })

      this.wss.on('error', (err) => {
        log.error('server error:', err.message)
        reject(err)
      })

      this.wss.on('connection', (ws) => {
        this.clients.add(ws)
        log.log(`client connected (total: ${this.clients.size})`)

        // Send cached init segment so late-joining clients can start decoding
        if (this.initSegment && ws.readyState === WebSocket.OPEN) {
          log.log(`sending cached init segment (${this.initSegment.length} bytes)`)
          ws.send(this.initSegment, { binary: true })
        }

        ws.on('close', () => {
          this.clients.delete(ws)
          log.log(`client disconnected (total: ${this.clients.size})`)
        })

        ws.on('error', () => {
          this.clients.delete(ws)
        })
      })
    })
  }

  /** Enable raw mode — skips fMP4 init segment detection (for WebCodecs pipeline). */
  setRawMode(raw: boolean): void {
    this._rawMode = raw
    if (raw) {
      this.initBuf = []
      this.initBufSize = 0
    }
  }

  /** Broadcast binary data to all connected clients. */
  broadcast(data: Buffer): void {
    this._broadcastCount++
    this._broadcastBytes += data.length
    if (this._broadcastCount % 200 === 0) {
      log.log(
        `broadcast #${this._broadcastCount}: ${(this._broadcastBytes / 1024).toFixed(0)} KB total, ` +
          `clients=${this.clients.size}, chunk=${data.length} bytes, raw=${this._rawMode}, ` +
          `initBufSize=${this.initBufSize}`
      )
    }

    // Write to recording file if active
    if (this.recordingStream && !this.recordingStream.destroyed) {
      this.recordingStream.write(data)
    }

    // Capture the init segment from early data (fMP4 pipeline only)
    if (!this.initSegment && !this._rawMode) {
      this.initBuf.push(data)
      this.initBufSize += data.length
      const combined = Buffer.concat(this.initBuf, this.initBufSize)
      const end = findInitSegmentEnd(combined)
      if (end > 0) {
        this.initSegment = combined.subarray(0, end)
        this.initBuf = []
        this.initBufSize = 0
        log.log(`cached init segment: ${this.initSegment.length} bytes`)
      }
    }

    for (const ws of this.clients) {
      if (ws.readyState !== WebSocket.OPEN) continue

      // Backpressure: skip if client is falling behind
      if (ws.bufferedAmount > MAX_BUFFERED) {
        continue
      }

      ws.send(data, { binary: true })
    }
  }

  /** Clear cached init segment (call when ffmpeg restarts with a new stream). */
  resetInitSegment(): void {
    this.initSegment = null
    this.initBuf = []
    this.initBufSize = 0
  }

  // ── Recording ──────────────────────────────────────────────────
  private recordingStream: fs.WriteStream | null = null

  /** Start recording all broadcast data to a file. */
  startRecording(filePath: string): void {
    this.stopRecording()
    this.recordingStream = fs.createWriteStream(filePath)
    // Write the init segment first so the recording is a valid fMP4 file
    if (this.initSegment) {
      this.recordingStream.write(this.initSegment)
    }
    log.log(`recording to ${filePath}`)
  }

  /** Stop recording and close the file. */
  stopRecording(): void {
    if (this.recordingStream) {
      this.recordingStream.end()
      this.recordingStream = null
      log.log('recording stopped')
    }
  }

  stop(): void {
    for (const ws of this.clients) {
      ws.close()
    }
    this.clients.clear()
    this.resetInitSegment()

    if (this.wss) {
      this.wss.close()
      this.wss = null
    }
    this._port = null
  }

  destroy(): void {
    this.stop()
    this.removeAllListeners()
  }
}
