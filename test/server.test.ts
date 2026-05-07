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
import type { DecodedMessage } from '../src/main/mavlink/MavlinkChannel'
import { MissionType, type MissionItem } from '../src/shared-types/ipc/MissionTypes'
import { ParamValueType, type Parameter } from '../src/shared-types/ipc/ParameterTypes'
import { CameraMode, type CameraState } from '../src/shared-types/ipc/CameraTypes'
import type { ForwardingState } from '../src/shared-types/ipc/ForwardingTypes'
import type { RadarState } from '../src/shared-types/ipc/RadarTypes'
import {
  CalibrationSensor,
  CalibrationStatus,
  FirmwareUpgradeStatus,
  RcCalStep,
  type CalibrationState,
  type FirmwareUpgradeState,
  type MagCalProgress,
  type MagCalReport,
  type RcCalibrationState
} from '../src/shared-types/ipc/SetupTypes'

let handle: MeridianServerHandle | null = null
let tempDir: string | null = null

class FakeVehicle extends EventEmitter {
  sysid = 1
  private dirty = true
  consoleWrites: string[] = []
  commandCalls: Array<{
    command: number
    vehicleId: number
    componentId: number
    params: { p1?: number; p2?: number; p5?: number }
  }> = []
  missionManager = new FakeMissionManager()
  parameterManager = new FakeParameterManager()
  cameraManager = new FakeCameraManager()
  calibrationManager = new FakeCalibrationManager()
  rcCalibrationManager = new FakeRcCalibrationManager()
  firmwareManager = new FakeFirmwareManager()
  state = {
    getDelta: () => ({
      core: {
        firmwareVersionMajor: 1,
        firmwareVersionMinor: 2,
        firmwareVersionPatch: 3,
        vehicleType: 2,
        autopilot: 12
      }
    })
  }
  commandQueue = {
    sendCommand: (
      command: number,
      vehicleId: number,
      componentId: number,
      params: { p1?: number; p2?: number; p5?: number }
    ): void => {
      this.commandCalls.push({ command, vehicleId, componentId, params })
    }
  }
  actuatorMetadata = {
    motorFunction: (instance: number): number => 1100 + instance,
    servoFunction: (instance: number): number => 1200 + instance
  }

  sendConsoleText(text: string): void {
    this.consoleWrites.push(text)
  }

  hasDirty(): boolean {
    return this.dirty
  }

  getDelta(): unknown {
    this.dirty = false
    return { core: { sysid: this.sysid, armed: true } }
  }
}

const fakeCalibrationState: CalibrationState = {
  sensor: CalibrationSensor.Gyro,
  status: CalibrationStatus.Started,
  message: 'Starting gyro calibration...',
  messages: ['Starting gyro calibration...'],
  progress: 0.25,
  currentOrientationProgress: 0,
  orientationsCompleted: [],
  currentOrientation: null
}

class FakeCalibrationManager extends EventEmitter {
  state: CalibrationState = fakeCalibrationState
  startedSensor: CalibrationSensor | null = null
  cancelled = false

  startCalibration(sensor: CalibrationSensor): void {
    this.startedSensor = sensor
  }

  cancelCalibration(): void {
    this.cancelled = true
  }
}

const fakeRcCalibrationState: RcCalibrationState = {
  step: RcCalStep.Center,
  channels: {},
  channelCount: 0,
  stickMapping: {
    Roll: null,
    Pitch: null,
    Yaw: null,
    Throttle: null
  }
}

class FakeRcCalibrationManager extends EventEmitter {
  calls: string[] = []

  start(): void {
    this.calls.push('start')
  }

  nextStep(): void {
    this.calls.push('nextStep')
  }

  cancel(): void {
    this.calls.push('cancel')
  }

  async save(): Promise<void> {
    this.calls.push('save')
  }
}

class FakeFirmwareManager extends EventEmitter {
  uploadedFilePath: string | null = null
  cancelled = false
  rebooted = false

  async uploadFile(filePath: string): Promise<void> {
    this.uploadedFilePath = filePath
  }

  cancel(): void {
    this.cancelled = true
  }

  async reboot(): Promise<void> {
    this.rebooted = true
  }
}

const fakeCameraState: CameraState = {
  discovered: true,
  info: null,
  mode: CameraMode.Photo,
  captureStatus: null,
  storage: null,
  photoCount: 0,
  isRecordingVideo: false,
  isCapturingImage: false,
  lastImageLat: 0,
  lastImageLon: 0,
  lastImageAlt: 0
}

class FakeCameraManager extends EventEmitter {
  state: CameraState = fakeCameraState
  calls: string[] = []
  mode: number | null = null
  formattedStorageId: number | undefined

  handleCameraHeartbeat(): void {
    this.calls.push('requestInfo')
  }

  takePhoto(): void {
    this.calls.push('takePhoto')
  }

  stopCapture(): void {
    this.calls.push('stopCapture')
  }

  startRecording(): void {
    this.calls.push('startRecording')
  }

  stopRecording(): void {
    this.calls.push('stopRecording')
  }

  setMode(mode: number): void {
    this.mode = mode
  }

  formatStorage(storageId?: number): void {
    this.formattedStorageId = storageId
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
  onRawMessage?: (msg: DecodedMessage) => void

  getAllVehicles(): FakeVehicle[] {
    return [this.vehicle]
  }

  getVehicle(vehicleId: number): FakeVehicle | undefined {
    return vehicleId === this.vehicle.sysid ? this.vehicle : undefined
  }
}

class FakeForwarder extends EventEmitter {
  state: ForwardingState = { enabled: false, targets: [] }
  addedTarget: { host: string; port: number } | null = null
  removedTargetId: string | null = null
  enabled: boolean | null = null
  targetEnabled: { id: string; enabled: boolean } | null = null

  getState(): ForwardingState {
    return this.state
  }

  addTarget(host: string, port: number): string {
    this.addedTarget = { host, port }
    return 'fwd-test'
  }

  removeTarget(id: string): void {
    this.removedTargetId = id
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
  }

  setTargetEnabled(id: string, enabled: boolean): void {
    this.targetEnabled = { id, enabled }
  }
}

class FakeRadarManager extends EventEmitter {
  state: RadarState = { enabled: false, units: [], tracks: [], simulationActive: false }
  enabled = false
  disabled = false
  simPosition: { lat: number; lon: number } | null = null

  enable(): void {
    this.enabled = true
  }

  disable(): void {
    this.disabled = true
  }

  getState(): RadarState {
    return this.state
  }

  setSimulationPosition(lat: number, lon: number): void {
    this.simPosition = { lat, lon }
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

  it('registers KML importFromPath on the realtime socket', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'meridian-kml-'))
    const kmlPath = join(tempDir, 'area.kml')
    await writeFile(
      kmlPath,
      `<?xml version="1.0" encoding="UTF-8"?>
      <kml xmlns="http://www.opengis.net/kml/2.2">
        <Document>
          <Placemark>
            <name>Survey Area</name>
            <Polygon>
              <outerBoundaryIs>
                <LinearRing>
                  <coordinates>34,32,0 34.1,32,0 34.1,32.1,0 34,32,0</coordinates>
                </LinearRing>
              </outerBoundaryIs>
            </Polygon>
          </Placemark>
        </Document>
      </kml>`
    )
    handle = await startMeridianServer()

    const ws = new WebSocket(`ws://127.0.0.1:${handle.port}/realtime`)
    await new Promise<void>((resolve) => ws.once('open', resolve))
    const message = new Promise<unknown>((resolve) => {
      ws.once('message', (data) => resolve(JSON.parse(data.toString())))
    })
    ws.send(
      JSON.stringify({
        id: 'kml-import-path',
        type: 'command',
        module: 'kml',
        command: 'importFromPath',
        args: [kmlPath]
      })
    )

    await expect(message).resolves.toMatchObject({
      id: 'kml-import-path',
      type: 'reply',
      ok: true,
      result: {
        fileName: 'area.kml',
        geometries: [
          {
            name: 'Survey Area',
            type: 'polygon',
            vertices: [
              { lat: 32, lon: 34 },
              { lat: 32, lon: 34.1 },
              { lat: 32.1, lon: 34.1 },
              { lat: 32, lon: 34 }
            ]
          }
        ]
      }
    })
    ws.close()
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

  it('registers camera RPC commands and events on the realtime socket', async () => {
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
    ws.send(
      JSON.stringify({ type: 'subscribe', topics: ['camera:stateChanged', 'camera:imageCaptured'] })
    )
    await new Promise<void>((resolve) => setTimeout(resolve, 25))

    const sendCommand = (id: string, command: string, args: unknown[]): void => {
      ws.send(JSON.stringify({ id, type: 'command', module: 'camera', command, args }))
    }

    sendCommand('camera-get', 'getState', [1])
    sendCommand('camera-info', 'requestInfo', [1])
    sendCommand('camera-photo', 'takePhoto', [1])
    sendCommand('camera-stop-capture', 'stopCapture', [1])
    sendCommand('camera-record-start', 'startRecording', [1])
    sendCommand('camera-record-stop', 'stopRecording', [1])
    sendCommand('camera-mode', 'setMode', [1, CameraMode.Video])
    sendCommand('camera-format', 'formatStorage', [1, 2])
    await new Promise<void>((resolve) => setTimeout(resolve, 25))

    vehicleManager.vehicle.cameraManager.emit('stateChanged', fakeCameraState)
    vehicleManager.vehicle.cameraManager.emit('imageCaptured', {
      lat: 32,
      lon: 34,
      alt: 50,
      imageIndex: 3,
      captureResult: 0
    })
    await new Promise<void>((resolve) => setTimeout(resolve, 25))

    expect(messages).toContainEqual({
      id: 'camera-get',
      type: 'reply',
      ok: true,
      result: fakeCameraState
    })
    for (const id of [
      'camera-info',
      'camera-photo',
      'camera-stop-capture',
      'camera-record-start',
      'camera-record-stop',
      'camera-mode',
      'camera-format'
    ]) {
      expect(messages).toContainEqual({ id, type: 'reply', ok: true })
    }
    expect(vehicleManager.vehicle.cameraManager.calls).toEqual([
      'requestInfo',
      'takePhoto',
      'stopCapture',
      'startRecording',
      'stopRecording'
    ])
    expect(vehicleManager.vehicle.cameraManager.mode).toBe(CameraMode.Video)
    expect(vehicleManager.vehicle.cameraManager.formattedStorageId).toBe(2)
    expect(messages).toContainEqual({
      type: 'event',
      topic: 'camera:stateChanged',
      payload: { vehicleId: 1, state: fakeCameraState }
    })
    expect(messages).toContainEqual({
      type: 'event',
      topic: 'camera:imageCaptured',
      payload: {
        vehicleId: 1,
        lat: 32,
        lon: 34,
        alt: 50,
        imageIndex: 3,
        captureResult: 0
      }
    })

    ws.close()
  })

  it('registers calibration RPC commands and events on the realtime socket', async () => {
    const vehicleManager = new FakeVehicleManager()
    const magProgress: MagCalProgress = {
      compassId: 1,
      completionPct: 45,
      directionX: 0.1,
      directionY: 0.2,
      directionZ: 0.3
    }
    const magReport: MagCalReport = {
      compassId: 1,
      calStatus: 4,
      fitness: 0.02,
      ofsX: 10,
      ofsY: 11,
      ofsZ: 12
    }
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
        topics: ['calibration:stateChanged', 'calibration:magProgress', 'calibration:magReport']
      })
    )
    await new Promise<void>((resolve) => setTimeout(resolve, 25))

    ws.send(
      JSON.stringify({
        id: 'calibration-get',
        type: 'command',
        module: 'calibration',
        command: 'getState',
        args: [1]
      })
    )
    ws.send(
      JSON.stringify({
        id: 'calibration-start',
        type: 'command',
        module: 'calibration',
        command: 'start',
        args: [1, CalibrationSensor.Compass]
      })
    )
    ws.send(
      JSON.stringify({
        id: 'calibration-cancel',
        type: 'command',
        module: 'calibration',
        command: 'cancel',
        args: [1]
      })
    )
    await new Promise<void>((resolve) => setTimeout(resolve, 25))

    vehicleManager.vehicle.calibrationManager.emit('stateChanged', fakeCalibrationState)
    vehicleManager.vehicle.calibrationManager.emit('magProgress', magProgress)
    vehicleManager.vehicle.calibrationManager.emit('magReport', magReport)
    await new Promise<void>((resolve) => setTimeout(resolve, 25))

    expect(messages).toContainEqual({
      id: 'calibration-get',
      type: 'reply',
      ok: true,
      result: fakeCalibrationState
    })
    expect(messages).toContainEqual({ id: 'calibration-start', type: 'reply', ok: true })
    expect(messages).toContainEqual({ id: 'calibration-cancel', type: 'reply', ok: true })
    expect(vehicleManager.vehicle.calibrationManager.startedSensor).toBe(CalibrationSensor.Compass)
    expect(vehicleManager.vehicle.calibrationManager.cancelled).toBe(true)
    expect(messages).toContainEqual({
      type: 'event',
      topic: 'calibration:stateChanged',
      payload: { vehicleId: 1, state: fakeCalibrationState }
    })
    expect(messages).toContainEqual({
      type: 'event',
      topic: 'calibration:magProgress',
      payload: { vehicleId: 1, ...magProgress }
    })
    expect(messages).toContainEqual({
      type: 'event',
      topic: 'calibration:magReport',
      payload: { vehicleId: 1, ...magReport }
    })

    ws.close()
  })

  it('registers RC calibration RPC commands and events on the realtime socket', async () => {
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
    ws.send(JSON.stringify({ type: 'subscribe', topics: ['rcCalibration:stateChanged'] }))
    await new Promise<void>((resolve) => setTimeout(resolve, 25))

    const sendCommand = (id: string, command: string): void => {
      ws.send(JSON.stringify({ id, type: 'command', module: 'rcCalibration', command, args: [1] }))
    }
    sendCommand('rc-start', 'start')
    sendCommand('rc-next', 'nextStep')
    sendCommand('rc-cancel', 'cancel')
    sendCommand('rc-save', 'save')
    await new Promise<void>((resolve) => setTimeout(resolve, 25))

    vehicleManager.vehicle.rcCalibrationManager.emit('stateChanged', fakeRcCalibrationState)
    await new Promise<void>((resolve) => setTimeout(resolve, 25))

    for (const id of ['rc-start', 'rc-next', 'rc-cancel', 'rc-save']) {
      expect(messages).toContainEqual({ id, type: 'reply', ok: true })
    }
    expect(vehicleManager.vehicle.rcCalibrationManager.calls).toEqual([
      'start',
      'nextStep',
      'cancel',
      'save'
    ])
    expect(messages).toContainEqual({
      type: 'event',
      topic: 'rcCalibration:stateChanged',
      payload: { vehicleId: 1, state: fakeRcCalibrationState }
    })

    ws.close()
  })

  it('registers firmware RPC commands and events on the realtime socket', async () => {
    const vehicleManager = new FakeVehicleManager()
    const upgradeState: FirmwareUpgradeState = {
      status: FirmwareUpgradeStatus.Uploading,
      progress: 0.5,
      message: 'Uploading firmware.bin... 50%',
      fileName: 'firmware.bin',
      fileSize: 1024
    }
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
    ws.send(JSON.stringify({ type: 'subscribe', topics: ['firmware:upgradeStateChanged'] }))
    await new Promise<void>((resolve) => setTimeout(resolve, 25))

    ws.send(
      JSON.stringify({
        id: 'firmware-board',
        type: 'command',
        module: 'firmware',
        command: 'getBoardInfo',
        args: [1]
      })
    )
    ws.send(
      JSON.stringify({
        id: 'firmware-upload',
        type: 'command',
        module: 'firmware',
        command: 'uploadFile',
        args: [1, '/tmp/firmware.bin']
      })
    )
    ws.send(
      JSON.stringify({
        id: 'firmware-cancel',
        type: 'command',
        module: 'firmware',
        command: 'cancel',
        args: [1]
      })
    )
    ws.send(
      JSON.stringify({
        id: 'firmware-reboot',
        type: 'command',
        module: 'firmware',
        command: 'reboot',
        args: [1]
      })
    )
    await new Promise<void>((resolve) => setTimeout(resolve, 25))

    vehicleManager.vehicle.firmwareManager.emit('stateChanged', upgradeState)
    await new Promise<void>((resolve) => setTimeout(resolve, 25))

    expect(messages).toContainEqual({
      id: 'firmware-board',
      type: 'reply',
      ok: true,
      result: {
        firmwareVersionMajor: 1,
        firmwareVersionMinor: 2,
        firmwareVersionPatch: 3,
        vehicleType: 2,
        autopilot: 12
      }
    })
    for (const id of ['firmware-upload', 'firmware-cancel', 'firmware-reboot']) {
      expect(messages).toContainEqual({ id, type: 'reply', ok: true })
    }
    expect(vehicleManager.vehicle.firmwareManager.uploadedFilePath).toBe('/tmp/firmware.bin')
    expect(vehicleManager.vehicle.firmwareManager.cancelled).toBe(true)
    expect(vehicleManager.vehicle.firmwareManager.rebooted).toBe(true)
    expect(messages).toContainEqual({
      type: 'event',
      topic: 'firmware:upgradeStateChanged',
      payload: { vehicleId: 1, state: upgradeState }
    })

    ws.close()
  })

  it('registers MAV console and actuator RPC commands on the realtime socket', async () => {
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
    ws.send(JSON.stringify({ type: 'subscribe', topics: ['mavConsole:data'] }))
    await new Promise<void>((resolve) => setTimeout(resolve, 25))

    ws.send(
      JSON.stringify({
        id: 'console-write',
        type: 'command',
        module: 'mavConsole',
        command: 'write',
        args: [1, 'help']
      })
    )
    ws.send(
      JSON.stringify({
        id: 'motor-test',
        type: 'command',
        module: 'actuator',
        command: 'motorTest',
        args: [1, 2, 35, 1]
      })
    )
    ws.send(
      JSON.stringify({
        id: 'servo-test',
        type: 'command',
        module: 'actuator',
        command: 'servoTest',
        args: [1, 3, 1750]
      })
    )
    await new Promise<void>((resolve) => setTimeout(resolve, 25))

    vehicleManager.vehicle.emit('consoleData', { text: 'nsh> help' })
    await new Promise<void>((resolve) => setTimeout(resolve, 25))

    expect(messages).toContainEqual({ id: 'console-write', type: 'reply', ok: true })
    expect(messages).toContainEqual({ id: 'motor-test', type: 'reply', ok: true })
    expect(messages).toContainEqual({ id: 'servo-test', type: 'reply', ok: true })
    expect(vehicleManager.vehicle.consoleWrites).toEqual(['help'])
    expect(vehicleManager.vehicle.commandCalls).toEqual([
      {
        command: 310,
        vehicleId: 1,
        componentId: 1,
        params: { p1: 0.35, p2: 1, p5: 1102 }
      },
      {
        command: 310,
        vehicleId: 1,
        componentId: 1,
        params: { p1: 0.5, p2: 1, p5: 1203 }
      }
    ])
    expect(messages).toContainEqual({
      type: 'event',
      topic: 'mavConsole:data',
      payload: { vehicleId: 1, text: 'nsh> help' }
    })

    ws.close()
  })

  it('registers MAVLink inspector RPC commands and events on the realtime socket', async () => {
    const vehicleManager = new FakeVehicleManager()
    handle = await startMeridianServer({
      runtime: {
        settingsManager: new SettingsManager(),
        videoManager: new VideoManager(),
        linkManager: new LinkManager(new MavlinkProtocol()),
        vehicleManager,
        trackingManager: null as never,
        forwarder: null as never,
        radarManager: null as never
      }
    })

    const ws = new WebSocket(`ws://127.0.0.1:${handle.port}/realtime`)
    await new Promise<void>((resolve) => ws.once('open', resolve))
    const messages: unknown[] = []
    ws.on('message', (data) => messages.push(JSON.parse(data.toString())))
    ws.send(
      JSON.stringify({
        type: 'subscribe',
        topics: ['mavInspector:snapshot', 'mavInspector:fields']
      })
    )
    await new Promise<void>((resolve) => setTimeout(resolve, 25))

    ws.send(
      JSON.stringify({
        id: 'inspector-enable',
        type: 'command',
        module: 'mavInspector',
        command: 'enable',
        args: []
      })
    )
    ws.send(
      JSON.stringify({
        id: 'inspector-select',
        type: 'command',
        module: 'mavInspector',
        command: 'select',
        args: [1, 1, 999999]
      })
    )
    await new Promise<void>((resolve) => setTimeout(resolve, 25))

    vehicleManager.onRawMessage?.({
      sysid: 1,
      compid: 1,
      msgid: 999999,
      data: { fooBar: 12 }
    } as DecodedMessage)
    await new Promise<void>((resolve) => setTimeout(resolve, 1200))

    expect(messages).toContainEqual({ id: 'inspector-enable', type: 'reply', ok: true })
    expect(messages).toContainEqual({ id: 'inspector-select', type: 'reply', ok: true })
    expect(messages).toContainEqual({
      type: 'event',
      topic: 'mavInspector:snapshot',
      payload: {
        messages: [
          {
            sysid: 1,
            compid: 1,
            msgid: 999999,
            name: 'MSG_999999',
            count: 1,
            rateHz: 0.8
          }
        ]
      }
    })
    expect(messages).toContainEqual({
      type: 'event',
      topic: 'mavInspector:fields',
      payload: {
        sysid: 1,
        compid: 1,
        msgid: 999999,
        fields: [{ name: 'foo_bar', value: '12', type: 'number' }]
      }
    })

    ws.close()
  })

  it('registers forwarding RPC commands and events on the realtime socket', async () => {
    const forwarder = new FakeForwarder()
    forwarder.state = {
      enabled: true,
      targets: [
        {
          id: 'fwd-1',
          host: '127.0.0.1',
          port: 14550,
          enabled: true,
          active: false,
          bytesForwarded: 0,
          packetsForwarded: 0,
          bytesReceived: 0,
          packetsReceived: 0,
          lastActivityMs: 0
        }
      ]
    }
    handle = await startMeridianServer({
      runtime: {
        settingsManager: new SettingsManager(),
        videoManager: new VideoManager(),
        linkManager: new LinkManager(new MavlinkProtocol()),
        vehicleManager: new FakeVehicleManager(),
        trackingManager: null as never,
        forwarder,
        radarManager: null as never
      }
    })

    const ws = new WebSocket(`ws://127.0.0.1:${handle.port}/realtime`)
    await new Promise<void>((resolve) => ws.once('open', resolve))
    const messages: unknown[] = []
    ws.on('message', (data) => messages.push(JSON.parse(data.toString())))
    ws.send(JSON.stringify({ type: 'subscribe', topics: ['forwarding:stateChanged'] }))
    await new Promise<void>((resolve) => setTimeout(resolve, 25))

    ws.send(
      JSON.stringify({
        id: 'forwarding-get',
        type: 'command',
        module: 'forwarding',
        command: 'getState',
        args: []
      })
    )
    ws.send(
      JSON.stringify({
        id: 'forwarding-add',
        type: 'command',
        module: 'forwarding',
        command: 'addTarget',
        args: ['192.168.1.10', 14550]
      })
    )
    ws.send(
      JSON.stringify({
        id: 'forwarding-enabled',
        type: 'command',
        module: 'forwarding',
        command: 'setEnabled',
        args: [true]
      })
    )
    ws.send(
      JSON.stringify({
        id: 'forwarding-target-enabled',
        type: 'command',
        module: 'forwarding',
        command: 'setTargetEnabled',
        args: ['fwd-1', false]
      })
    )
    ws.send(
      JSON.stringify({
        id: 'forwarding-remove',
        type: 'command',
        module: 'forwarding',
        command: 'removeTarget',
        args: ['fwd-1']
      })
    )
    await new Promise<void>((resolve) => setTimeout(resolve, 25))

    forwarder.emit('stateChanged', forwarder.state)
    await new Promise<void>((resolve) => setTimeout(resolve, 25))

    expect(messages).toContainEqual({
      id: 'forwarding-get',
      type: 'reply',
      ok: true,
      result: forwarder.state
    })
    expect(messages).toContainEqual({
      id: 'forwarding-add',
      type: 'reply',
      ok: true,
      result: 'fwd-test'
    })
    for (const id of ['forwarding-enabled', 'forwarding-target-enabled', 'forwarding-remove']) {
      expect(messages).toContainEqual({ id, type: 'reply', ok: true })
    }
    expect(forwarder.addedTarget).toEqual({ host: '192.168.1.10', port: 14550 })
    expect(forwarder.enabled).toBe(true)
    expect(forwarder.targetEnabled).toEqual({ id: 'fwd-1', enabled: false })
    expect(forwarder.removedTargetId).toBe('fwd-1')
    expect(messages).toContainEqual({
      type: 'event',
      topic: 'forwarding:stateChanged',
      payload: forwarder.state
    })

    ws.close()
  })

  it('registers radar RPC commands and events on the realtime socket', async () => {
    const radarManager = new FakeRadarManager()
    radarManager.state = {
      enabled: true,
      units: [{ id: 1, lat: 32, lon: 34, alt: 100 }],
      tracks: [],
      simulationActive: true
    }
    handle = await startMeridianServer({
      runtime: {
        settingsManager: new SettingsManager(),
        videoManager: new VideoManager(),
        linkManager: new LinkManager(new MavlinkProtocol()),
        vehicleManager: new FakeVehicleManager(),
        trackingManager: null as never,
        forwarder: null as never,
        radarManager
      }
    })

    const ws = new WebSocket(`ws://127.0.0.1:${handle.port}/realtime`)
    await new Promise<void>((resolve) => ws.once('open', resolve))
    const messages: unknown[] = []
    ws.on('message', (data) => messages.push(JSON.parse(data.toString())))
    ws.send(JSON.stringify({ type: 'subscribe', topics: ['radar:stateChanged'] }))
    await new Promise<void>((resolve) => setTimeout(resolve, 25))

    ws.send(
      JSON.stringify({
        id: 'radar-get',
        type: 'command',
        module: 'radar',
        command: 'getState',
        args: []
      })
    )
    ws.send(
      JSON.stringify({
        id: 'radar-enable',
        type: 'command',
        module: 'radar',
        command: 'enable',
        args: []
      })
    )
    ws.send(
      JSON.stringify({
        id: 'radar-disable',
        type: 'command',
        module: 'radar',
        command: 'disable',
        args: []
      })
    )
    ws.send(
      JSON.stringify({
        id: 'radar-position',
        type: 'command',
        module: 'radar',
        command: 'setSimPosition',
        args: [32.1, 34.2]
      })
    )
    await new Promise<void>((resolve) => setTimeout(resolve, 25))

    radarManager.emit('stateChanged', radarManager.state)
    await new Promise<void>((resolve) => setTimeout(resolve, 25))

    expect(messages).toContainEqual({
      id: 'radar-get',
      type: 'reply',
      ok: true,
      result: radarManager.state
    })
    for (const id of ['radar-enable', 'radar-disable', 'radar-position']) {
      expect(messages).toContainEqual({ id, type: 'reply', ok: true })
    }
    expect(radarManager.enabled).toBe(true)
    expect(radarManager.disabled).toBe(true)
    expect(radarManager.simPosition).toEqual({ lat: 32.1, lon: 34.2 })
    expect(messages).toContainEqual({
      type: 'event',
      topic: 'radar:stateChanged',
      payload: radarManager.state
    })

    ws.close()
  })
})
