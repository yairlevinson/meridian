// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
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
import { EventEmitter } from 'events'
import { MissionType, type MissionItem } from '../src/shared-types/ipc/MissionTypes'
import { ParamValueType, type Parameter } from '../src/shared-types/ipc/ParameterTypes'

let handle: MeridianServerHandle | null = null
let tempDir: string | null = null

class FakeVehicle extends EventEmitter {
  sysid = 1
  private dirty = true
  missionManager = new FakeMissionManager()
  parameterManager = new FakeParameterManager()

  hasDirty(): boolean {
    return this.dirty
  }

  getDelta(): unknown {
    this.dirty = false
    return { core: { sysid: this.sysid, armed: true } }
  }
}

class FakeParameterManager extends EventEmitter {
  parameters: Parameter[] = []
  setCalls: Array<{ name: string; value: number }> = []
  refreshCount = 0

  getAllParameters(): Parameter[] {
    return this.parameters
  }

  setParameter(name: string, value: number): void {
    this.setCalls.push({ name, value })
  }

  requestAllParameters(): void {
    this.refreshCount++
  }
}

class FakeMissionManager extends EventEmitter {
  loadedItems: MissionItem[] = []
  writtenItems: MissionItem[] | null = null

  loadFromVehicle(): void {
    this.emit('progress', { current: this.loadedItems.length, total: this.loadedItems.length })
    this.emit('loadComplete', this.loadedItems)
  }

  writeToVehicle(items: MissionItem[]): void {
    this.writtenItems = items
    this.emit('writeComplete')
  }
}

class FakeVehicleManager extends EventEmitter {
  vehicle = new FakeVehicle()
  vehicleCount = 1

  getAllVehicles(): FakeVehicle[] {
    return [this.vehicle]
  }

  getVehicle(vehicleId: number): FakeVehicle | undefined {
    return vehicleId === this.vehicle.sysid ? this.vehicle : undefined
  }
}

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

  it('proxies and caches map tiles', async () => {
    const tileFetch = vi.fn(async () => {
      return new Response(Buffer.from('tile-data'), {
        status: 200,
        headers: { 'content-type': 'image/png' }
      })
    })
    handle = await startMeridianServer({ tileFetch: tileFetch as unknown as typeof fetch })

    const first = await fetch(`${handle.url}/api/tiles/osm/3/4/5`)
    const second = await fetch(`${handle.url}/api/tiles/osm/3/4/5`)

    expect(first.status).toBe(200)
    expect(first.headers.get('content-type')).toContain('image/png')
    await expect(first.text()).resolves.toBe('tile-data')
    expect(second.status).toBe(200)
    await expect(second.text()).resolves.toBe('tile-data')
    expect(tileFetch).toHaveBeenCalledTimes(1)
    expect(tileFetch.mock.calls[0]?.[0]).toBe('https://tile.openstreetmap.org/3/4/5.png')
  })

  it('returns 404 for unknown tile providers', async () => {
    handle = await startMeridianServer()

    const response = await fetch(`${handle.url}/api/tiles/missing/3/4/5`)

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Unknown tile provider' })
  })

  it('returns 502 when upstream tile fetch fails', async () => {
    const tileFetch = vi.fn(async () => {
      throw new Error('offline')
    })
    handle = await startMeridianServer({ tileFetch: tileFetch as unknown as typeof fetch })

    const response = await fetch(`${handle.url}/api/tiles/osm/3/4/5`)

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({ error: 'Tile fetch failed' })
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

  it('returns a structured error for vehicle commands without a runtime vehicle manager', async () => {
    handle = await startMeridianServer()

    const ws = new WebSocket(`ws://127.0.0.1:${handle.port}/realtime`)
    await new Promise<void>((resolve) => ws.once('open', resolve))
    const message = new Promise<unknown>((resolve) => {
      ws.once('message', (data) => resolve(JSON.parse(data.toString())))
    })
    ws.send(
      JSON.stringify({
        id: 'vehicle-1',
        type: 'command',
        module: 'vehicle',
        command: 'arm',
        args: [1]
      })
    )

    await expect(message).resolves.toEqual({
      id: 'vehicle-1',
      type: 'reply',
      ok: false,
      error: 'VehicleManager not available'
    })
    ws.close()
  })

  it('publishes runtime vehicle lifecycle and delta events', async () => {
    const vehicleManager = new FakeVehicleManager()
    handle = await startMeridianServer({
      runtime: {
        settingsManager: new SettingsManager(),
        videoManager: new VideoManager(),
        linkManager: new LinkManager(new MavlinkProtocol()),
        vehicleManager,
        trackingManager: null as never
      }
    })

    const ws = new WebSocket(`ws://127.0.0.1:${handle.port}/realtime`)
    await new Promise<void>((resolve) => ws.once('open', resolve))
    const messages: unknown[] = []
    ws.on('message', (data) => messages.push(JSON.parse(data.toString())))
    ws.send(JSON.stringify({ type: 'subscribe', topics: ['vehicle:added', 'vehicle:delta'] }))
    await new Promise<void>((resolve) => setTimeout(resolve, 25))

    vehicleManager.emit('vehicleAdded', 1)
    await new Promise<void>((resolve) => setTimeout(resolve, 50))

    expect(messages).toContainEqual({
      type: 'event',
      topic: 'vehicle:added',
      payload: { vehicleId: 1 }
    })
    expect(messages).toContainEqual(
      expect.objectContaining({
        type: 'event',
        topic: 'vehicle:delta',
        payload: expect.objectContaining({
          vehicleId: 1,
          delta: { core: { sysid: 1, armed: true } }
        })
      })
    )
    ws.close()
  })

  it('registers mission RPC commands and events on the realtime socket', async () => {
    const vehicleManager = new FakeVehicleManager()
    const missionItem: MissionItem = {
      seq: 0,
      frame: 3,
      command: 16,
      current: true,
      autocontinue: true,
      param1: 0,
      param2: 0,
      param3: 0,
      param4: 0,
      x: 320000000,
      y: 340000000,
      z: 50,
      missionType: MissionType.Mission
    }
    vehicleManager.vehicle.missionManager.loadedItems = [missionItem]
    handle = await startMeridianServer({
      runtime: {
        settingsManager: new SettingsManager(),
        videoManager: new VideoManager(),
        linkManager: new LinkManager(new MavlinkProtocol()),
        vehicleManager,
        trackingManager: null as never
      }
    })

    const ws = new WebSocket(`ws://127.0.0.1:${handle.port}/realtime`)
    await new Promise<void>((resolve) => ws.once('open', resolve))
    const messages: unknown[] = []
    ws.on('message', (data) => messages.push(JSON.parse(data.toString())))
    ws.send(
      JSON.stringify({
        type: 'subscribe',
        topics: ['mission:progress', 'mission:complete', 'mission:currentChanged']
      })
    )
    await new Promise<void>((resolve) => setTimeout(resolve, 25))

    ws.send(
      JSON.stringify({
        id: 'mission-load',
        type: 'command',
        module: 'mission',
        command: 'load',
        args: [1]
      })
    )
    await new Promise<void>((resolve) => setTimeout(resolve, 25))
    vehicleManager.vehicle.missionManager.emit('currentChanged', 0)
    await new Promise<void>((resolve) => setTimeout(resolve, 25))

    expect(messages).toContainEqual({
      id: 'mission-load',
      type: 'reply',
      ok: true,
      result: { items: [missionItem] }
    })
    expect(messages).toContainEqual({
      type: 'event',
      topic: 'mission:progress',
      payload: { vehicleId: 1, current: 1, total: 1 }
    })
    expect(messages).toContainEqual({
      type: 'event',
      topic: 'mission:complete',
      payload: { vehicleId: 1, items: [missionItem] }
    })
    expect(messages).toContainEqual({
      type: 'event',
      topic: 'mission:currentChanged',
      payload: { vehicleId: 1, seq: 0 }
    })

    ws.send(
      JSON.stringify({
        id: 'mission-write',
        type: 'command',
        module: 'mission',
        command: 'write',
        args: [1, [missionItem]]
      })
    )
    await new Promise<void>((resolve) => setTimeout(resolve, 25))

    expect(messages).toContainEqual({
      id: 'mission-write',
      type: 'reply',
      ok: true,
      result: { success: true }
    })
    expect(vehicleManager.vehicle.missionManager.writtenItems).toEqual([missionItem])

    ws.close()
  })

  it('registers parameter RPC commands and events on the realtime socket', async () => {
    const vehicleManager = new FakeVehicleManager()
    const parameter: Parameter = {
      name: 'SYS_AUTOSTART',
      value: 4001,
      type: ParamValueType.INT32,
      index: 0,
      componentId: 1
    }
    const loadState = {
      totalCount: 1,
      receivedCount: 1,
      loadProgress: 1,
      parametersReady: true,
      missingParameters: false,
      missingIndices: [],
      retryCount: 0,
      pendingWrites: 0
    }
    vehicleManager.vehicle.parameterManager.parameters = [parameter]
    handle = await startMeridianServer({
      runtime: {
        settingsManager: new SettingsManager(),
        videoManager: new VideoManager(),
        linkManager: new LinkManager(new MavlinkProtocol()),
        vehicleManager,
        trackingManager: null as never
      }
    })

    const ws = new WebSocket(`ws://127.0.0.1:${handle.port}/realtime`)
    await new Promise<void>((resolve) => ws.once('open', resolve))
    const messages: unknown[] = []
    ws.on('message', (data) => messages.push(JSON.parse(data.toString())))
    ws.send(
      JSON.stringify({
        type: 'subscribe',
        topics: ['parameters:changed', 'parameters:ready', 'parameters:progress']
      })
    )
    await new Promise<void>((resolve) => setTimeout(resolve, 25))

    ws.send(
      JSON.stringify({
        id: 'parameters-get',
        type: 'command',
        module: 'parameters',
        command: 'getAll',
        args: [1]
      })
    )
    ws.send(
      JSON.stringify({
        id: 'parameters-set',
        type: 'command',
        module: 'parameters',
        command: 'set',
        args: [1, 'SYS_AUTOSTART', 4002]
      })
    )
    ws.send(
      JSON.stringify({
        id: 'parameters-refresh',
        type: 'command',
        module: 'parameters',
        command: 'refresh',
        args: [1]
      })
    )
    await new Promise<void>((resolve) => setTimeout(resolve, 25))

    vehicleManager.vehicle.parameterManager.emit('parameterReceived', parameter)
    vehicleManager.vehicle.parameterManager.emit('progress', loadState)
    vehicleManager.vehicle.parameterManager.emit('parametersReady')
    await new Promise<void>((resolve) => setTimeout(resolve, 25))

    expect(messages).toContainEqual({
      id: 'parameters-get',
      type: 'reply',
      ok: true,
      result: [parameter]
    })
    expect(messages).toContainEqual({
      id: 'parameters-set',
      type: 'reply',
      ok: true
    })
    expect(messages).toContainEqual({
      id: 'parameters-refresh',
      type: 'reply',
      ok: true
    })
    expect(vehicleManager.vehicle.parameterManager.setCalls).toEqual([
      { name: 'SYS_AUTOSTART', value: 4002 }
    ])
    expect(vehicleManager.vehicle.parameterManager.refreshCount).toBe(1)
    expect(messages).toContainEqual({
      type: 'event',
      topic: 'parameters:changed',
      payload: { vehicleId: 1, parameter }
    })
    expect(messages).toContainEqual({
      type: 'event',
      topic: 'parameters:progress',
      payload: { vehicleId: 1, loadState }
    })
    expect(messages).toContainEqual({
      type: 'event',
      topic: 'parameters:ready',
      payload: { vehicleId: 1 }
    })

    ws.close()
  })
})
