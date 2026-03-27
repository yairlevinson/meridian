// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { FTPManager, type FTPPayload } from '../src/main/ftp/FTPManager'
import { MockLink } from '../src/test-utils/MockLink/MockLink'
import { MockLinkFTP } from '../src/test-utils/MockLink/MockLinkFTP'

describe('FTPManager with MockLinkFTP', () => {
  let ftpManager: FTPManager
  let link: MockLink
  let mockFTP: MockLinkFTP

  beforeEach(() => {
    link = new MockLink()
    mockFTP = new MockLinkFTP(link)
    ftpManager = new FTPManager()

    // Wire: FTPManager sends requests → MockLinkFTP handles → responses come back
    ftpManager.setSendFunction((payload: FTPPayload) => {
      mockFTP.handleFTPRequest(payload)
    })
    link.on('ftpResponse', (response: FTPPayload) => {
      ftpManager.handleResponse(response)
    })
  })

  afterEach(() => {
    ftpManager.destroy()
  })

  it('downloads a file successfully', async () => {
    const content = 'PARAM1=42.0\nPARAM2=3.14\nPARAM3=100'
    mockFTP.addFile('/APM.parm', content)

    const result = await ftpManager.download('/APM.parm')
    expect(result.toString()).toBe(content)
  })

  it('downloads a binary file', async () => {
    const binary = Buffer.from([0x00, 0xff, 0x55, 0xaa, 0x12, 0x34])
    mockFTP.addFile('/firmware.bin', binary)

    const result = await ftpManager.download('/firmware.bin')
    expect(result.equals(binary)).toBe(true)
  })

  it('throws on non-existent file', async () => {
    await expect(ftpManager.download('/nonexistent')).rejects.toThrow('failed to open')
  })

  it('uploads a file successfully', async () => {
    const content = Buffer.from('hello world upload')
    await ftpManager.upload('/upload.txt', content)

    const stored = mockFTP.getFile('/upload.txt')
    expect(stored?.toString()).toBe('hello world upload')
  })

  it('lists directory contents', async () => {
    mockFTP.addFile('/logs/log1.ulg', Buffer.alloc(1000))
    mockFTP.addFile('/logs/log2.ulg', Buffer.alloc(2000))

    const entries = await ftpManager.listDirectory('/logs')
    expect(entries.length).toBeGreaterThanOrEqual(1)
  })

  it('emits progress during download', async () => {
    const bigContent = Buffer.alloc(500, 'A')
    mockFTP.addFile('/big.bin', bigContent)

    const progressEvents: unknown[] = []
    ftpManager.on('progress', (p) => progressEvents.push(p))

    await ftpManager.download('/big.bin')
    expect(progressEvents.length).toBeGreaterThan(0)
  })
})
