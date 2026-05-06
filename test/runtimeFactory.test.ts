// @vitest-environment node
import { describe, expect, it } from 'vitest'

describe('Meridian runtime factory', () => {
  it('exports a reusable runtime factory', async () => {
    const runtime = await import('../src/main/runtime/MeridianRuntime')

    expect(typeof runtime.createMeridianRuntime).toBe('function')
  })
})
