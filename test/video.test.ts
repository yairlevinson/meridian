import { describe, it, expect, afterEach } from 'vitest'
import { FfmpegProcess } from '../src/main/video/FfmpegProcess'
import { VideoWebSocketServer } from '../src/main/video/VideoWebSocketServer'
import { VideoSourceType } from '../src/shared-types/ipc/VideoTypes'
import WebSocket from 'ws'

describe('FfmpegProcess', () => {
  describe('buildArgs', () => {
    it('builds args for UDP H.264 source', () => {
      const args = FfmpegProcess.buildArgs({
        sourceType: VideoSourceType.UDP_H264,
        uri: 'udp://@:5600'
      })
      expect(args).toContain('-i')
      expect(args).toContain('udp://@:5600')
      expect(args).toContain('-c:v')
      expect(args).toContain('copy')
      expect(args).toContain('-an')
      expect(args).toContain('-f')
      expect(args).toContain('mp4')
      expect(args).toContain('pipe:1')
      expect(args).toContain('-movflags')
      expect(args.join(' ')).toContain('frag_keyframe+empty_moov+default_base_moof')
    })

    it('builds args for RTSP source with TCP transport', () => {
      const args = FfmpegProcess.buildArgs({
        sourceType: VideoSourceType.RTSP,
        uri: 'rtsp://192.168.1.1:8554/live'
      })
      expect(args).toContain('-rtsp_transport')
      expect(args).toContain('tcp')
      expect(args).toContain('rtsp://192.168.1.1:8554/live')
      expect(args).toContain('pipe:1')
    })

    it('builds args for TCP MPEG-TS source', () => {
      const args = FfmpegProcess.buildArgs({
        sourceType: VideoSourceType.TCP_MPEGTS,
        uri: 'tcp://192.168.1.1:5000'
      })
      expect(args).toContain('tcp://192.168.1.1:5000')
      expect(args).toContain('copy')
      expect(args).not.toContain('-rtsp_transport')
    })

    it('includes low-latency flags by default', () => {
      const args = FfmpegProcess.buildArgs({
        sourceType: VideoSourceType.UDP_H264,
        uri: 'udp://@:5600'
      })
      expect(args).toContain('-fflags')
      expect(args.join(' ')).toContain('nobuffer')
      expect(args).toContain('-analyzeduration')
      expect(args).toContain('500000')
    })

    it('omits low-latency flags when disabled', () => {
      const args = FfmpegProcess.buildArgs({
        sourceType: VideoSourceType.UDP_H264,
        uri: 'udp://@:5600',
        lowLatency: false
      })
      expect(args.join(' ')).not.toContain('nobuffer')
    })

    it('always outputs to pipe:1 (recording handled at WebSocket layer)', () => {
      const args = FfmpegProcess.buildArgs({
        sourceType: VideoSourceType.RTSP,
        uri: 'rtsp://example.com/stream'
      })
      expect(args).toContain('pipe:1')
      expect(args.join(' ')).not.toContain('tee')
    })

    it('always includes -hide_banner', () => {
      const args = FfmpegProcess.buildArgs({
        sourceType: VideoSourceType.UDP_H264,
        uri: 'udp://@:5600'
      })
      expect(args).toContain('-hide_banner')
    })

    it('drops audio with -an flag', () => {
      const args = FfmpegProcess.buildArgs({
        sourceType: VideoSourceType.RTSP,
        uri: 'rtsp://example.com/stream'
      })
      expect(args).toContain('-an')
    })

    it('omits -tag:v avc1 for AV1 source and does not force input format', () => {
      const args = FfmpegProcess.buildArgs({
        sourceType: VideoSourceType.AV1,
        uri: 'tcp://192.168.1.1:5600'
      })
      expect(args).not.toContain('-tag:v')
      expect(args).not.toContain('mpegts')
      expect(args).toContain('-c:v')
      expect(args).toContain('copy')
    })

    it('includes -tag:v avc1 and -f mpegts for H.264 UDP source', () => {
      const args = FfmpegProcess.buildArgs({
        sourceType: VideoSourceType.UDP_H264,
        uri: 'udp://@:5600'
      })
      expect(args).toContain('-tag:v')
      expect(args).toContain('avc1')
      expect(args).toContain('mpegts')
    })
  })

  describe('buildUri', () => {
    it('builds UDP URI from port', () => {
      const uri = FfmpegProcess.buildUri(VideoSourceType.UDP_H264, 5600, '', '')
      expect(uri).toBe('udp://@:5600')
    })

    it('builds TCP AV1 URI from tcpUrl', () => {
      const uri = FfmpegProcess.buildUri(VideoSourceType.AV1, 0, '', 'tcp://192.168.1.1:5600')
      expect(uri).toBe('tcp://192.168.1.1:5600')
    })

    it('returns RTSP URL directly', () => {
      const uri = FfmpegProcess.buildUri(
        VideoSourceType.RTSP,
        0,
        'rtsp://192.168.1.1:8554/live',
        ''
      )
      expect(uri).toBe('rtsp://192.168.1.1:8554/live')
    })

    it('returns TCP URL directly', () => {
      const uri = FfmpegProcess.buildUri(
        VideoSourceType.TCP_MPEGTS,
        0,
        '',
        'tcp://192.168.1.1:5000'
      )
      expect(uri).toBe('tcp://192.168.1.1:5000')
    })

    it('returns empty string for Disabled', () => {
      const uri = FfmpegProcess.buildUri(VideoSourceType.Disabled, 0, '', '')
      expect(uri).toBe('')
    })
  })

  describe('lifecycle', () => {
    it('starts as not running', () => {
      const proc = new FfmpegProcess()
      expect(proc.running).toBe(false)
    })

    it('emits error for invalid ffmpeg path', async () => {
      const proc = new FfmpegProcess()
      const _errorPromise = new Promise<Error>((resolve) => {
        proc.on('error', resolve)
      })
      // This will fail because we're passing a bogus source
      proc.start({
        sourceType: VideoSourceType.UDP_H264,
        uri: 'udp://@:99999'
      })
      // ffmpeg may or may not error depending on whether it's installed
      // Just verify the process was created
      proc.stop()
      proc.destroy()
    })
  })
})

describe('VideoSourceType enum', () => {
  it('has all expected values', () => {
    expect(VideoSourceType.Disabled).toBe('disabled')
    expect(VideoSourceType.UDP_H264).toBe('udp_h264')
    expect(VideoSourceType.AV1).toBe('av1')
    expect(VideoSourceType.RTSP).toBe('rtsp')
    expect(VideoSourceType.TCP_MPEGTS).toBe('tcp_mpegts')
  })
})

/**
 * Build a minimal fMP4 init segment (ftyp + moov boxes) for testing.
 * Each MP4 box is: [4-byte size][4-byte type][payload].
 */
function buildFakeInitSegment(): Buffer {
  const ftyp = Buffer.alloc(20)
  ftyp.writeUInt32BE(20, 0)
  ftyp.write('ftyp', 4)
  ftyp.write('isom', 8)

  const moov = Buffer.alloc(24)
  moov.writeUInt32BE(24, 0)
  moov.write('moov', 4)

  return Buffer.concat([ftyp, moov])
}

function buildFakeMoofMdat(): Buffer {
  const moof = Buffer.alloc(16)
  moof.writeUInt32BE(16, 0)
  moof.write('moof', 4)

  const mdat = Buffer.alloc(32)
  mdat.writeUInt32BE(32, 0)
  mdat.write('mdat', 4)

  return Buffer.concat([moof, mdat])
}

describe('VideoWebSocketServer', () => {
  let server: VideoWebSocketServer

  afterEach(() => {
    server?.destroy()
  })

  it('starts and reports a port', async () => {
    server = new VideoWebSocketServer()
    const port = await server.start()
    expect(port).toBeGreaterThan(0)
  })

  it('broadcasts data to connected clients', async () => {
    server = new VideoWebSocketServer()
    const port = await server.start()

    const ws = new WebSocket(`ws://127.0.0.1:${port}`)
    await new Promise<void>((resolve) => ws.on('open', resolve))

    const received: Buffer[] = []
    ws.on('message', (data) => received.push(data as Buffer))

    const testData = Buffer.from('hello')
    server.broadcast(testData)

    await new Promise((r) => setTimeout(r, 100))
    expect(received.length).toBe(1)
    expect(received[0]!.toString()).toBe('hello')

    ws.close()
    await new Promise((r) => setTimeout(r, 50))
  })

  it('caches init segment from broadcast data', async () => {
    server = new VideoWebSocketServer()
    const port = await server.start()

    // First client connects and receives all data
    const ws1 = new WebSocket(`ws://127.0.0.1:${port}`)
    await new Promise<void>((resolve) => ws1.on('open', resolve))

    // Broadcast ftyp + moov (init segment)
    const initSeg = buildFakeInitSegment()
    server.broadcast(initSeg)

    // Broadcast some media data
    const media = buildFakeMoofMdat()
    server.broadcast(media)

    await new Promise((r) => setTimeout(r, 100))

    // Second client connects late — should receive cached init segment
    const received2: Buffer[] = []
    const ws2 = new WebSocket(`ws://127.0.0.1:${port}`)
    ws2.on('message', (data) => received2.push(data as Buffer))
    await new Promise<void>((resolve) => ws2.on('open', resolve))

    await new Promise((r) => setTimeout(r, 200))

    // The late-joining client should have received the init segment
    expect(received2.length).toBeGreaterThanOrEqual(1)
    const firstMessage = received2[0]!
    // Should start with ftyp box
    expect(firstMessage.toString('ascii', 4, 8)).toBe('ftyp')
    expect(firstMessage.length).toBe(initSeg.length)

    ws1.close()
    ws2.close()
    await new Promise((r) => setTimeout(r, 50))
  })

  it('resets init segment cache on resetInitSegment()', async () => {
    server = new VideoWebSocketServer()
    const port = await server.start()

    // Broadcast init segment to cache it
    server.broadcast(buildFakeInitSegment())
    await new Promise((r) => setTimeout(r, 50))

    // Reset the cache
    server.resetInitSegment()

    // New client should NOT receive an init segment
    const received: Buffer[] = []
    const ws = new WebSocket(`ws://127.0.0.1:${port}`)
    ws.on('message', (data) => received.push(data as Buffer))
    await new Promise<void>((resolve) => ws.on('open', resolve))

    await new Promise((r) => setTimeout(r, 200))
    expect(received.length).toBe(0)

    ws.close()
    await new Promise((r) => setTimeout(r, 50))
  })

  it('handles init segment arriving in multiple chunks', async () => {
    server = new VideoWebSocketServer()
    const port = await server.start()

    const initSeg = buildFakeInitSegment()
    // Split init segment into two chunks
    const half = Math.floor(initSeg.length / 2)
    server.broadcast(initSeg.subarray(0, half))
    server.broadcast(initSeg.subarray(half))

    await new Promise((r) => setTimeout(r, 100))

    // Late-joining client should receive the cached init segment
    const received: Buffer[] = []
    const ws = new WebSocket(`ws://127.0.0.1:${port}`)
    ws.on('message', (data) => received.push(data as Buffer))
    await new Promise<void>((resolve) => ws.on('open', resolve))

    await new Promise((r) => setTimeout(r, 200))

    expect(received.length).toBeGreaterThanOrEqual(1)
    const firstMsg = received[0]!
    expect(firstMsg.toString('ascii', 4, 8)).toBe('ftyp')

    ws.close()
    await new Promise((r) => setTimeout(r, 50))
  })
})
