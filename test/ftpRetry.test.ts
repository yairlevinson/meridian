// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { FTPManager, FTP_OPCODE, FTP_ERROR, type FTPPayload } from '../src/main/ftp/FTPManager'
import { MockLink } from '../src/test-utils/MockLink/MockLink'
import { MockLinkFTP } from '../src/test-utils/MockLink/MockLinkFTP'

/** Helper: NAK a burst request with UNKNOWN_COMMAND to force sequential fallback */
function nakBurst(ftpManager: FTPManager, payload: FTPPayload): void {
  ftpManager.handleResponse({
    seqNumber: payload.seqNumber + 1,
    session: payload.session,
    opcode: FTP_OPCODE.NAK,
    size: 1,
    reqOpcode: payload.opcode,
    burstComplete: 0,
    offset: 0,
    data: Buffer.from([FTP_ERROR.UNKNOWN_COMMAND])
  })
}

describe('FTPManager — timeout and retry', () => {
  let ftpManager: FTPManager

  beforeEach(() => {
    vi.useFakeTimers()
    ftpManager = new FTPManager()
  })

  afterEach(() => {
    ftpManager.destroy()
    vi.useRealTimers()
  })

  it('retries on timeout up to DEFAULT_MAX_RETRIES (3)', async () => {
    const sendCalls: FTPPayload[] = []
    ftpManager.setSendFunction((payload) => {
      sendCalls.push(payload)
      // Never respond — simulates timeout
    })

    const downloadPromise = ftpManager.download('/test.txt')

    // Advance through 3 retries + initial = 4 sends
    // After the 4th timeout (retry 3+1), it should reject
    vi.advanceTimersByTime(2000) // retry 1
    vi.advanceTimersByTime(2000) // retry 2
    vi.advanceTimersByTime(2000) // retry 3
    vi.advanceTimersByTime(2000) // exceed max retries

    await expect(downloadPromise).rejects.toThrow('timeout after 3 retries')
    expect(sendCalls.length).toBe(4) // initial + 3 retries
  })

  it('succeeds if response arrives before timeout', async () => {
    ftpManager.setSendFunction((payload) => {
      if (payload.opcode === FTP_OPCODE.OPEN_FILE_RO) {
        const data = Buffer.alloc(4)
        data.writeUInt32LE(5, 0) // file size
        ftpManager.handleResponse({
          seqNumber: payload.seqNumber + 1,
          session: 1,
          opcode: FTP_OPCODE.ACK,
          size: 4,
          reqOpcode: payload.opcode,
          burstComplete: 0,
          offset: 0,
          data
        })
      } else if (payload.opcode === FTP_OPCODE.BURST_READ_FILE) {
        nakBurst(ftpManager, payload)
      } else if (payload.opcode === FTP_OPCODE.READ_FILE) {
        ftpManager.handleResponse({
          seqNumber: payload.seqNumber + 1,
          session: 1,
          opcode: FTP_OPCODE.ACK,
          size: 5,
          reqOpcode: payload.opcode,
          burstComplete: 0,
          offset: 0,
          data: Buffer.from('hello')
        })
      } else if (payload.opcode === FTP_OPCODE.TERMINATE) {
        ftpManager.handleResponse({
          seqNumber: payload.seqNumber + 1,
          session: 1,
          opcode: FTP_OPCODE.ACK,
          size: 0,
          reqOpcode: payload.opcode,
          burstComplete: 0,
          offset: 0,
          data: Buffer.alloc(0)
        })
      }
    })

    const result = await ftpManager.download('/test.txt')
    expect(result.toString()).toBe('hello')
  })

  it('clears retry timer when response arrives', async () => {
    let sendCount = 0
    ftpManager.setSendFunction((payload) => {
      sendCount++
      if (sendCount === 1 && payload.opcode === FTP_OPCODE.OPEN_FILE_RO) {
        // Respond after a short delay (before timeout)
        setTimeout(() => {
          const data = Buffer.alloc(4)
          data.writeUInt32LE(3, 0)
          ftpManager.handleResponse({
            seqNumber: payload.seqNumber + 1,
            session: 1,
            opcode: FTP_OPCODE.ACK,
            size: 4,
            reqOpcode: payload.opcode,
            burstComplete: 0,
            offset: 0,
            data
          })
        }, 500)
      } else if (payload.opcode === FTP_OPCODE.BURST_READ_FILE) {
        nakBurst(ftpManager, payload)
      } else if (payload.opcode === FTP_OPCODE.READ_FILE) {
        ftpManager.handleResponse({
          seqNumber: payload.seqNumber + 1,
          session: 1,
          opcode: FTP_OPCODE.ACK,
          size: 3,
          reqOpcode: payload.opcode,
          burstComplete: 0,
          offset: 0,
          data: Buffer.from('abc')
        })
      } else if (payload.opcode === FTP_OPCODE.TERMINATE) {
        ftpManager.handleResponse({
          seqNumber: payload.seqNumber + 1,
          session: 1,
          opcode: FTP_OPCODE.ACK,
          size: 0,
          reqOpcode: payload.opcode,
          burstComplete: 0,
          offset: 0,
          data: Buffer.alloc(0)
        })
      }
    })

    const downloadPromise = ftpManager.download('/test.txt')
    vi.advanceTimersByTime(500) // response arrives
    // Should NOT retry since response cleared the timer
    const result = await downloadPromise
    expect(result.toString()).toBe('abc')
    // OPEN + BURST(NAK) + READ + TERMINATE (no retries)
    expect(sendCount).toBe(4)
  })
})

describe('FTPManager — large file chunked transfer', () => {
  let ftpManager: FTPManager
  let link: MockLink
  let mockFTP: MockLinkFTP

  beforeEach(() => {
    link = new MockLink()
    mockFTP = new MockLinkFTP(link)
    ftpManager = new FTPManager()

    ftpManager.setSendFunction((payload: FTPPayload) => {
      mockFTP.handleFTPRequest(payload)
    })
    link.on('ftpResponse', (response: FTPPayload) => {
      ftpManager.handleResponse(response)
    })
  })

  afterEach(() => ftpManager.destroy())

  it('downloads file larger than MAX_DATA_LENGTH (239) in multiple chunks', async () => {
    // 500 bytes = 3 chunks (239 + 239 + 22)
    const content = Buffer.alloc(500, 0x42)
    mockFTP.addFile('/big.bin', content)

    const progressEvents: unknown[] = []
    ftpManager.on('progress', (p) => progressEvents.push(p))

    const result = await ftpManager.download('/big.bin')
    expect(result.length).toBe(500)
    expect(result.equals(content)).toBe(true)
    expect(progressEvents.length).toBeGreaterThanOrEqual(2)
  })

  it('uploads file larger than MAX_DATA_LENGTH in multiple chunks', async () => {
    const content = Buffer.alloc(600, 0xaa)
    await ftpManager.upload('/large-upload.bin', content)

    const stored = mockFTP.getFile('/large-upload.bin')
    expect(stored).toBeDefined()
    expect(stored!.length).toBe(600)
    // Verify content matches
    for (let i = 0; i < 600; i++) {
      expect(stored![i]).toBe(0xaa)
    }
  })

  it('handles 1-byte file correctly', async () => {
    const content = Buffer.from([0x55])
    mockFTP.addFile('/tiny.bin', content)

    const result = await ftpManager.download('/tiny.bin')
    expect(result.length).toBe(1)
    expect(result[0]).toBe(0x55)
  })

  it('handles exactly MAX_DATA_LENGTH file', async () => {
    const content = Buffer.alloc(239, 0xcc)
    mockFTP.addFile('/exact.bin', content)

    const result = await ftpManager.download('/exact.bin')
    expect(result.length).toBe(239)
    expect(result.equals(content)).toBe(true)
  })
})

describe('FTPManager — error handling', () => {
  let ftpManager: FTPManager

  beforeEach(() => {
    ftpManager = new FTPManager()
  })

  afterEach(() => ftpManager.destroy())

  it('rejects when no send function is set', async () => {
    await expect(ftpManager.download('/test')).rejects.toThrow('no send function')
  })

  it('rejects path traversal attempts on download', async () => {
    ftpManager.setSendFunction(() => {})
    await expect(ftpManager.download('/../../etc/passwd')).rejects.toThrow('Path traversal')
  })

  it('rejects path traversal attempts on upload', async () => {
    ftpManager.setSendFunction(() => {})
    await expect(ftpManager.upload('/../secret', Buffer.from('x'))).rejects.toThrow(
      'Path traversal'
    )
  })

  it('rejects path traversal attempts on listDirectory', async () => {
    ftpManager.setSendFunction(() => {})
    await expect(ftpManager.listDirectory('/logs/../..')).rejects.toThrow('Path traversal')
  })

  it('throws on NAK response during open', async () => {
    ftpManager.setSendFunction((payload) => {
      ftpManager.handleResponse({
        seqNumber: payload.seqNumber + 1,
        session: 0,
        opcode: FTP_OPCODE.NAK,
        size: 1,
        reqOpcode: payload.opcode,
        burstComplete: 0,
        offset: 0,
        data: Buffer.from([FTP_ERROR.FILE_NOT_FOUND])
      })
    })

    await expect(ftpManager.download('/missing')).rejects.toThrow('failed to open')
  })

  it('throws on NAK response during read', async () => {
    ftpManager.setSendFunction((payload) => {
      if (payload.opcode === FTP_OPCODE.OPEN_FILE_RO) {
        const data = Buffer.alloc(4)
        data.writeUInt32LE(100, 0)
        ftpManager.handleResponse({
          seqNumber: payload.seqNumber + 1,
          session: 1,
          opcode: FTP_OPCODE.ACK,
          size: 4,
          reqOpcode: payload.opcode,
          burstComplete: 0,
          offset: 0,
          data
        })
      } else if (payload.opcode === FTP_OPCODE.BURST_READ_FILE) {
        nakBurst(ftpManager, payload)
      } else if (payload.opcode === FTP_OPCODE.READ_FILE) {
        ftpManager.handleResponse({
          seqNumber: payload.seqNumber + 1,
          session: 1,
          opcode: FTP_OPCODE.NAK,
          size: 1,
          reqOpcode: payload.opcode,
          burstComplete: 0,
          offset: 0,
          data: Buffer.from([FTP_ERROR.FAIL])
        })
      }
    })

    await expect(ftpManager.download('/broken')).rejects.toThrow('read error')
  })

  it('returns empty array for empty directory listing', async () => {
    ftpManager.setSendFunction((payload) => {
      ftpManager.handleResponse({
        seqNumber: payload.seqNumber + 1,
        session: 0,
        opcode: FTP_OPCODE.NAK,
        size: 1,
        reqOpcode: payload.opcode,
        burstComplete: 0,
        offset: 0,
        data: Buffer.from([FTP_ERROR.EOF])
      })
    })

    const entries = await ftpManager.listDirectory('/empty')
    expect(entries).toEqual([])
  })
})

describe('FTPManager — burst mode', () => {
  let ftpManager: FTPManager
  let link: MockLink
  let mockFTP: MockLinkFTP

  beforeEach(() => {
    link = new MockLink()
    mockFTP = new MockLinkFTP(link)
    ftpManager = new FTPManager()

    ftpManager.setSendFunction((payload: FTPPayload) => {
      mockFTP.handleFTPRequest(payload)
    })
    link.on('ftpResponse', (response: FTPPayload) => {
      ftpManager.handleResponse(response)
    })
  })

  afterEach(() => ftpManager.destroy())

  it('downloads a file via burst mode', async () => {
    const content = Buffer.alloc(500, 0x42)
    mockFTP.addFile('/burst.bin', content)

    const result = await ftpManager.download('/burst.bin')
    expect(result.length).toBe(500)
    expect(result.equals(content)).toBe(true)
  })

  it('falls back to sequential when burst is not supported', async () => {
    mockFTP.supportsBurst = false
    const content = Buffer.from('sequential fallback')
    mockFTP.addFile('/seq.txt', content)

    const result = await ftpManager.download('/seq.txt')
    expect(result.toString()).toBe('sequential fallback')
  })

  it('downloads large file (>2390 bytes) requiring multiple burst batches', async () => {
    // 3000 bytes = more than 10 chunks * 239 per chunk = 2390, needs multiple burst requests
    const content = Buffer.alloc(3000)
    for (let i = 0; i < 3000; i++) content[i] = i & 0xff
    mockFTP.addFile('/large-burst.bin', content)

    const progressEvents: unknown[] = []
    ftpManager.on('progress', (p) => progressEvents.push(p))

    const result = await ftpManager.download('/large-burst.bin')
    expect(result.length).toBe(3000)
    expect(result.equals(content)).toBe(true)
    expect(progressEvents.length).toBeGreaterThan(0)
  })

  it('downloads empty file via burst mode', async () => {
    mockFTP.addFile('/empty.bin', Buffer.alloc(0))
    // Empty file: open returns size 0, burst sees nothing to read
    // The download should handle 0-byte files
    const result = await ftpManager.download('/empty.bin')
    expect(result.length).toBe(0)
  })
})
