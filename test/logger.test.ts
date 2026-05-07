// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLogger } from '../src/main/logger'

describe('createLogger', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('formats printf-style placeholders for console and file messages', () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const log = createLogger('TestLogger')

    log.debug('reconnect in %dms -> %s:%d', 15000, '127.0.0.1', 5760)

    expect(debugSpy).toHaveBeenCalledWith('[TestLogger] reconnect in 15000ms -> 127.0.0.1:5760')
  })
})
