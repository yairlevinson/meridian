// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { startMeridianServer, type MeridianServerHandle } from '../src/server/main'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { getMapProviderInfos } from '../src/shared-types/ipc/tileProviders'
import { SettingsManager } from '../src/main/settings/SettingsManager'
import { VideoManager } from '../src/main/video/VideoManager'
import { WebSocket } from 'ws'
import { LinkManager } from '../src/main/links/LinkManager'
import { MavlinkProtocol } from '../src/main/mavlink/MavlinkProtocol'

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

  it('registers settings RPC commands on the realtime socket', async () => {
    const settingsManager = new SettingsManager({ initial: { mapProvider: 'osm' } })
    handle = await startMeridianServer({ settingsManager })

    const ws = new WebSocket(`ws://127.0.0.1:${handle.port}/realtime`)
    await new Promise<void>((resolve) => ws.once('open', resolve))
    const message = new Promise<unknown>((resolve) => {
      ws.once('message', (data) => resolve(JSON.parse(data.toString())))
    })
    ws.send(
      JSON.stringify({
        id: 'settings-1',
        type: 'command',
        module: 'settings',
        command: 'getAll',
        args: []
      })
    )

    await expect(message).resolves.toMatchObject({
      id: 'settings-1',
      type: 'reply',
      ok: true,
      result: { mapProvider: 'osm' }
    })
    ws.close()
  })

  it('can use managers supplied by a runtime-like object', async () => {
    const settingsManager = new SettingsManager({ initial: { mapProvider: 'bing_satellite' } })
    const linkManager = new LinkManager(new MavlinkProtocol())
    handle = await startMeridianServer({
      runtime: {
        settingsManager,
        videoManager: new VideoManager(),
        linkManager
      }
    })

    const ws = new WebSocket(`ws://127.0.0.1:${handle.port}/realtime`)
    await new Promise<void>((resolve) => ws.once('open', resolve))
    const message = new Promise<unknown>((resolve) => {
      ws.once('message', (data) => resolve(JSON.parse(data.toString())))
    })
    ws.send(
      JSON.stringify({
        id: 'settings-runtime',
        type: 'command',
        module: 'settings',
        command: 'getAll',
        args: []
      })
    )

    await expect(message).resolves.toMatchObject({
      id: 'settings-runtime',
      type: 'reply',
      ok: true,
      result: { mapProvider: 'bing_satellite' }
    })
    ws.close()
    linkManager.disconnectAll()
  })

  it('publishes settings changed events to realtime subscribers', async () => {
    const settingsManager = new SettingsManager()
    handle = await startMeridianServer({ settingsManager })

    const ws = new WebSocket(`ws://127.0.0.1:${handle.port}/realtime`)
    await new Promise<void>((resolve) => ws.once('open', resolve))
    ws.send(JSON.stringify({ type: 'subscribe', topics: ['settings:changed'] }))
    await new Promise<void>((resolve) => setTimeout(resolve, 25))
    const message = new Promise<unknown>((resolve) => {
      ws.once('message', (data) => resolve(JSON.parse(data.toString())))
    })

    settingsManager.set('mapProvider', 'google_satellite')

    await expect(message).resolves.toEqual({
      type: 'event',
      topic: 'settings:changed',
      payload: { key: 'mapProvider', value: 'google_satellite' }
    })
    ws.close()
  })

  it('registers video RPC commands on the realtime socket', async () => {
    handle = await startMeridianServer()

    const ws = new WebSocket(`ws://127.0.0.1:${handle.port}/realtime`)
    await new Promise<void>((resolve) => ws.once('open', resolve))
    const message = new Promise<unknown>((resolve) => {
      ws.once('message', (data) => resolve(JSON.parse(data.toString())))
    })
    ws.send(
      JSON.stringify({
        id: 'video-1',
        type: 'command',
        module: 'video',
        command: 'getState',
        args: []
      })
    )

    await expect(message).resolves.toMatchObject({
      id: 'video-1',
      type: 'reply',
      ok: true,
      result: {
        sourceType: 'disabled',
        streaming: false,
        recording: false,
        error: null,
        pipeline: 'ffmpeg'
      }
    })
    ws.close()
  })

  it('publishes video state change events to realtime subscribers', async () => {
    handle = await startMeridianServer()

    const ws = new WebSocket(`ws://127.0.0.1:${handle.port}/realtime`)
    await new Promise<void>((resolve) => ws.once('open', resolve))
    ws.send(JSON.stringify({ type: 'subscribe', topics: ['video:stateChanged'] }))
    await new Promise<void>((resolve) => setTimeout(resolve, 25))
    const message = new Promise<unknown>((resolve) => {
      ws.once('message', (data) => resolve(JSON.parse(data.toString())))
    })
    ws.send(
      JSON.stringify({
        id: 'video-2',
        type: 'command',
        module: 'video',
        command: 'stop',
        args: []
      })
    )

    await expect(message).resolves.toMatchObject({
      type: 'event',
      topic: 'video:stateChanged',
      payload: { sourceType: 'disabled', streaming: false }
    })
    ws.close()
  })

  it('registers links RPC commands on the realtime socket', async () => {
    handle = await startMeridianServer()

    const ws = new WebSocket(`ws://127.0.0.1:${handle.port}/realtime`)
    await new Promise<void>((resolve) => ws.once('open', resolve))
    const message = new Promise<unknown>((resolve) => {
      ws.once('message', (data) => resolve(JSON.parse(data.toString())))
    })
    ws.send(
      JSON.stringify({
        id: 'links-1',
        type: 'command',
        module: 'links',
        command: 'getAll',
        args: []
      })
    )

    await expect(message).resolves.toEqual({
      id: 'links-1',
      type: 'reply',
      ok: true,
      result: []
    })
    ws.close()
  })

  it('returns a structured error for link creation without a runtime link manager', async () => {
    handle = await startMeridianServer()

    const ws = new WebSocket(`ws://127.0.0.1:${handle.port}/realtime`)
    await new Promise<void>((resolve) => ws.once('open', resolve))
    const message = new Promise<unknown>((resolve) => {
      ws.once('message', (data) => resolve(JSON.parse(data.toString())))
    })
    ws.send(
      JSON.stringify({
        id: 'links-2',
        type: 'command',
        module: 'links',
        command: 'create',
        args: [{ type: 'udp', name: 'Test UDP', listenPort: 15600 }]
      })
    )

    await expect(message).resolves.toEqual({
      id: 'links-2',
      type: 'reply',
      ok: false,
      error: 'LinkManager not available'
    })
    ws.close()
  })
})
