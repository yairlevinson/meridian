import { EventEmitter } from 'events'
import * as dgram from 'dgram'
import * as net from 'net'
import { VideoSourceType } from '@shared/ipc/VideoTypes'
import { createLogger } from '../logger'

const log = createLogger('VideoReceiver')

/**
 * Raw socket receiver for video streams.
 * Replaces ffmpeg for input when using WebCodecs decoding in the renderer.
 * Receives raw encoded data (H.264 Annex B, AV1 OBU) and emits 'data' events.
 */
// Batch interval for UDP packets — accumulate then emit once
const UDP_BATCH_INTERVAL_MS = 5

export class VideoReceiver extends EventEmitter {
  private udpSocket: dgram.Socket | null = null
  private tcpSocket: net.Socket | null = null
  private _running = false
  private _batchTimer: ReturnType<typeof setInterval> | null = null
  private _batchBufs: Buffer[] = []
  private _batchSize = 0

  get running(): boolean {
    return this._running
  }

  start(sourceType: VideoSourceType, uri: string): void {
    this.stop()

    switch (sourceType) {
      case VideoSourceType.UDP_H264:
        this._startUdp(uri)
        break
      case VideoSourceType.TCP_AV1:
      case VideoSourceType.TCP_MPEGTS:
        this._startTcp(uri)
        break
      case VideoSourceType.RTSP:
        // RTSP requires protocol handling beyond raw sockets;
        // fall back to ffmpeg pipeline for RTSP sources
        log.warn('RTSP not supported in direct receive mode')
        this.emit('error', new Error('RTSP requires ffmpeg pipeline'))
        return
      default:
        return
    }
  }

  private _startUdp(uri: string): void {
    // Parse port from uri like "udp://@:5600"
    const match = uri.match(/:(\d+)$/)
    if (!match) {
      this.emit('error', new Error(`Invalid UDP URI: ${uri}`))
      return
    }
    const port = parseInt(match[1]!, 10)

    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true })
    this.udpSocket = sock

    sock.on('message', (msg) => {
      // Accumulate packets and flush on a timer to avoid overwhelming
      // the event loop with per-packet WebSocket broadcasts
      this._batchBufs.push(msg)
      this._batchSize += msg.length
    })

    sock.on('error', (err) => {
      log.error('UDP error:', err.message)
      this._running = false
      this.emit('error', err)
    })

    sock.bind(port, () => {
      log.log(`UDP listening on port ${port}`)
      this._running = true
      this._batchTimer = setInterval(() => this._flushBatch(), UDP_BATCH_INTERVAL_MS)
      this.emit('started')
    })
  }

  private _startTcp(uri: string): void {
    // Parse host:port from uri like "tcp://192.168.1.1:5600"
    const match = uri.match(/tcp:\/\/([^:]+):(\d+)/)
    if (!match) {
      this.emit('error', new Error(`Invalid TCP URI: ${uri}`))
      return
    }
    const host = match[1]!
    const port = parseInt(match[2]!, 10)

    const sock = net.createConnection(port, host)
    this.tcpSocket = sock

    sock.on('connect', () => {
      log.log(`TCP connected to ${host}:${port}`)
      this._running = true
      this.emit('started')
    })

    sock.on('data', (chunk) => {
      this.emit('data', chunk)
    })

    sock.on('error', (err) => {
      log.error('TCP error:', err.message)
      this._running = false
      this.emit('error', err)
    })

    sock.on('close', () => {
      log.log('TCP connection closed')
      this._running = false
      this.emit('close', 0)
    })
  }

  private _flushCount = 0
  private _flushBytes = 0

  private _flushBatch(): void {
    if (this._batchBufs.length === 0) return
    const merged = Buffer.concat(this._batchBufs, this._batchSize)
    this._flushCount++
    this._flushBytes += merged.length
    if (this._flushCount % 200 === 0) {
      log.log(
        `flush #${this._flushCount}: ${this._batchBufs.length} packets, ` +
          `${merged.length} bytes this batch, ${(this._flushBytes / 1024).toFixed(0)} KB total`
      )
    }
    this._batchBufs = []
    this._batchSize = 0
    this.emit('data', merged)
  }

  stop(): void {
    if (this._batchTimer) {
      clearInterval(this._batchTimer)
      this._batchTimer = null
    }
    this._batchBufs = []
    this._batchSize = 0
    if (this.udpSocket) {
      try {
        this.udpSocket.close()
      } catch {
        /* already closed */
      }
      this.udpSocket = null
    }
    if (this.tcpSocket) {
      this.tcpSocket.destroy()
      this.tcpSocket = null
    }
    this._running = false
  }

  destroy(): void {
    this.stop()
    this.removeAllListeners()
  }
}
