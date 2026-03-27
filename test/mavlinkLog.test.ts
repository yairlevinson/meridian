// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { MAVLinkLogManager } from '../src/main/mavlinklog/MAVLinkLogManager'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('MAVLinkLogManager', () => {
  let logMgr: MAVLinkLogManager
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'meridian-log-test-'))
    logMgr = new MAVLinkLogManager(tempDir)
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('starts and stops logging', () => {
    logMgr.start()
    expect(logMgr.active).toBe(true)
    logMgr.stop()
    expect(logMgr.active).toBe(false)
  })

  it('receives and writes LOGGING_DATA messages', () => {
    logMgr.start()

    for (let i = 0; i < 10; i++) {
      logMgr.handleLoggingData({
        sequence: i,
        length: 50,
        firstMessageOffset: 0,
        data: Buffer.alloc(50, i)
      })
    }

    const filepath = logMgr.stop()
    expect(filepath).not.toBeNull()
    expect(existsSync(filepath!)).toBe(true)

    const content = readFileSync(filepath!)
    expect(content.length).toBe(500) // 10 * 50
    expect(logMgr.stats.totalReceived).toBe(10)
    expect(logMgr.stats.dropCount).toBe(0)
  })

  it('detects sequence gaps', () => {
    logMgr.start()

    logMgr.handleLoggingData({
      sequence: 0,
      length: 10,
      firstMessageOffset: 0,
      data: Buffer.alloc(10)
    })
    // Skip sequence 1, 2
    logMgr.handleLoggingData({
      sequence: 3,
      length: 10,
      firstMessageOffset: 0,
      data: Buffer.alloc(10)
    })

    expect(logMgr.stats.dropCount).toBe(2)
    expect(logMgr.stats.totalReceived).toBe(2)
    logMgr.stop()
  })

  it('handles sequence wrap around (65535 → 0)', () => {
    logMgr.start()

    logMgr.handleLoggingData({
      sequence: 65535,
      length: 10,
      firstMessageOffset: 0,
      data: Buffer.alloc(10)
    })
    logMgr.handleLoggingData({
      sequence: 0,
      length: 10,
      firstMessageOffset: 0,
      data: Buffer.alloc(10)
    })

    expect(logMgr.stats.dropCount).toBe(0)
    logMgr.stop()
  })

  it('returns null when stopping with no data', () => {
    logMgr.start()
    const result = logMgr.stop()
    expect(result).toBeNull()
  })

  it('emits data events', () => {
    const events: unknown[] = []
    logMgr.on('data', (e) => events.push(e))

    logMgr.start()
    logMgr.handleLoggingData({
      sequence: 0,
      length: 20,
      firstMessageOffset: 0,
      data: Buffer.alloc(20)
    })

    expect(events).toHaveLength(1)
    logMgr.stop()
  })
})
