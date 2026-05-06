// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { startMeridianServer, type MeridianServerHandle } from '../src/server/main'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { getMapProviderInfos } from '../src/shared-types/ipc/tileProviders'

let handle: MeridianServerHandle | null = null
let tempDir: string | null = null

afterEach(async () => {
  if (handle) {
    await handle.close()
    handle = null
  }
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true })
    tempDir = null
  }
})

describe('Meridian server skeleton', () => {
  it('serves a health endpoint', async () => {
    handle = await startMeridianServer()

    const response = await fetch(`${handle.url}/api/health`)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, service: 'meridian-server' })
  })

  it('serves map provider metadata', async () => {
    handle = await startMeridianServer()

    const response = await fetch(`${handle.url}/api/map/providers`)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ providers: getMapProviderInfos() })
  })

  it('serves static files when configured', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'meridian-server-'))
    await writeFile(join(tempDir, 'index.html'), '<main>Meridian</main>')
    await writeFile(join(tempDir, 'app.js'), 'window.__meridian = true')
    handle = await startMeridianServer({ staticDir: tempDir })

    const indexResponse = await fetch(`${handle.url}/`)
    expect(indexResponse.status).toBe(200)
    expect(indexResponse.headers.get('content-type')).toContain('text/html')
    await expect(indexResponse.text()).resolves.toBe('<main>Meridian</main>')

    const jsResponse = await fetch(`${handle.url}/app.js`)
    expect(jsResponse.status).toBe(200)
    expect(jsResponse.headers.get('content-type')).toContain('text/javascript')
    await expect(jsResponse.text()).resolves.toBe('window.__meridian = true')
  })

  it('blocks static path traversal', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'meridian-server-'))
    await writeFile(join(tempDir, 'index.html'), '<main>Meridian</main>')
    handle = await startMeridianServer({ staticDir: tempDir })

    const response = await fetch(`${handle.url}/%2e%2e%2fpackage.json`)
    expect(response.status).toBe(403)
  })
})
