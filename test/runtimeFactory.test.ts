// @vitest-environment node
import { describe, expect, it } from 'vitest'

describe('Meridian runtime factory', () => {
  it('exports a reusable runtime factory', async () => {
    const runtime = await import('../src/main/runtime/MeridianRuntime')

    expect(typeof runtime.createMeridianRuntime).toBe('function')
  })

  it('constructs a server runtime without Electron', async () => {
    const { createServerRuntime } = await import('../src/server/runtime/ServerRuntime')
    const runtime = await createServerRuntime({ udpPort: 0 })

    expect(runtime.linkManager.getAllStates()).toHaveLength(1)
    expect(runtime.vehicleManager).toBeDefined()
    expect(runtime.forwarder).toBeDefined()
    expect(runtime.trackingManager).toBeDefined()
    expect(runtime.radarManager.getState()).toMatchObject({ enabled: false })

    runtime.dispose()
  })
})
