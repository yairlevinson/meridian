// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { MavCommandQueue } from '../src/main/vehicle/MavCommandQueue'
import { MockLink } from '../src/test-utils/MockLink/MockLink'
import { MavResult } from '../src/shared-types/ipc/MavCommandRequest'

describe('MavCommandQueue edge cases', () => {
  let link: MockLink
  let queue: MavCommandQueue

  const savedTimeout = MavCommandQueue.DEFAULT_TIMEOUT_MS
  const savedRetries = MavCommandQueue.DEFAULT_MAX_RETRIES

  beforeEach(() => {
    link = new MockLink()
    queue = new MavCommandQueue()
    queue.setLink(link)
  })

  afterEach(() => {
    queue.clear()
    MavCommandQueue.DEFAULT_TIMEOUT_MS = savedTimeout
    MavCommandQueue.DEFAULT_MAX_RETRIES = savedRetries
  })

  it('times out after exhausting retries and rejects with error', async () => {
    MavCommandQueue.DEFAULT_TIMEOUT_MS = 50
    MavCommandQueue.DEFAULT_MAX_RETRIES = 1

    const resultPromise = queue.sendCommand(400, 1, 0, { p1: 1 })

    await expect(resultPromise).rejects.toThrow('timed out')
    // initial send + 1 retry = 2 total
    expect(link.sentBuffers.length).toBe(2)
    expect(queue.pendingCount).toBe(0)
  })

  it('retries the exact number of times configured', async () => {
    MavCommandQueue.DEFAULT_TIMEOUT_MS = 30
    MavCommandQueue.DEFAULT_MAX_RETRIES = 4

    const resultPromise = queue.sendCommand(22, 1, 0)

    await expect(resultPromise).rejects.toThrow('timed out')
    // initial + 4 retries = 5
    expect(link.sentBuffers.length).toBe(5)
  })

  it('IN_PROGRESS re-queues the command for continued waiting', async () => {
    MavCommandQueue.DEFAULT_TIMEOUT_MS = 200

    const resultPromise = queue.sendCommand(22, 1, 0, { p7: 10 })

    // Wait for command to be sent
    await new Promise((r) => setTimeout(r, 30))
    expect(queue.pendingCount).toBe(1)

    // Send IN_PROGRESS — should re-queue, not resolve
    queue.handleCommandAck({ command: 22, result: MavResult.IN_PROGRESS })
    expect(queue.pendingCount).toBe(1) // still pending

    // Now send ACCEPTED — should resolve
    await new Promise((r) => setTimeout(r, 10))
    queue.handleCommandAck({ command: 22, result: MavResult.ACCEPTED })

    const result = await resultPromise
    expect(result).toBe(MavResult.ACCEPTED)
    expect(queue.pendingCount).toBe(0)
  })

  it('IN_PROGRESS still times out if no final ACK arrives', async () => {
    MavCommandQueue.DEFAULT_TIMEOUT_MS = 50
    MavCommandQueue.DEFAULT_MAX_RETRIES = 0 // no retries after re-queue timeout

    const resultPromise = queue.sendCommand(22, 1, 0)

    await new Promise((r) => setTimeout(r, 20))
    queue.handleCommandAck({ command: 22, result: MavResult.IN_PROGRESS })

    // After IN_PROGRESS, a new timer is set. If it expires with 0 retries left, rejects.
    await expect(resultPromise).rejects.toThrow('timed out')
  })

  it('clear() rejects all pending commands', async () => {
    MavCommandQueue.DEFAULT_TIMEOUT_MS = 5000

    const p1 = queue.sendCommand(400, 1, 0, { p1: 1 })
    const p2 = queue.sendCommand(22, 1, 0, { p7: 10 })
    const p3 = queue.sendCommand(21, 1, 0)

    await new Promise((r) => setTimeout(r, 20))
    expect(queue.pendingCount).toBe(3)

    queue.clear()

    await expect(p1).rejects.toThrow('queue cleared')
    await expect(p2).rejects.toThrow('queue cleared')
    await expect(p3).rejects.toThrow('queue cleared')
    expect(queue.pendingCount).toBe(0)
  })

  it('no link available rejects immediately', async () => {
    const noLinkQueue = new MavCommandQueue()
    // Don't set link
    const result = noLinkQueue.sendCommand(400, 1, 0)
    await expect(result).rejects.toThrow('No link available')
  })

  it('handles ACK for unknown command gracefully', () => {
    // Should not throw
    queue.handleCommandAck({ command: 999, result: MavResult.ACCEPTED })
    expect(queue.pendingCount).toBe(0)
  })
})
