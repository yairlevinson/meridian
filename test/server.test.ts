// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { startMeridianServer, type MeridianServerHandle } from '../src/server/main'

let handle: MeridianServerHandle | null = null

afterEach(async () => {
  if (handle) {
    await handle.close()
    handle = null
  }
})

describe('Meridian server skeleton', () => {
  it('serves a health endpoint', async () => {
    handle = await startMeridianServer()

    const response = await fetch(`${handle.url}/api/health`)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, service: 'meridian-server' })
  })

  it('serves placeholder map provider metadata', async () => {
    handle = await startMeridianServer()

    const response = await fetch(`${handle.url}/api/map/providers`)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ providers: [] })
  })
})
