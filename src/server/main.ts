import { createServer, type Server as HttpServer, type ServerResponse } from 'http'
import { readFile, stat } from 'fs/promises'
import { extname, join, resolve, sep } from 'path'
import { getMapProviderInfos, tileProviders } from '@shared/ipc/tileProviders'
import { settingsModule } from '@shared/ipc/modules/settings'
import { videoModule } from '@shared/ipc/modules/video'
import { linksModule } from '@shared/ipc/modules/links'
import { vehicleModule } from '@shared/ipc/modules/vehicle'
import type { AppSettings } from '@shared/ipc/AppSettings'
import { VideoSourceType } from '@shared/ipc/VideoTypes'
import { SettingsManager } from '../main/settings/SettingsManager'
import { VideoManager } from '../main/video/VideoManager'
import type { MeridianRuntime } from '../main/runtime/MeridianRuntime'
import { VehicleTelemetryPublisher } from '../main/vehicle/VehicleTelemetryPublisher'
import { RpcRealtimeServer } from './realtime/RpcRealtimeServer'
import { SerialPort } from 'serialport'

export interface MeridianServerOptions {
  port?: number
  host?: string
  staticDir?: string
  tileFetch?: typeof fetch
  runtime?: Pick<
    MeridianRuntime,
    'settingsManager' | 'videoManager' | 'linkManager' | 'vehicleManager' | 'trackingManager'
  >
  settingsManager?: SettingsManager
  videoManager?: VideoManager
}

export interface MeridianServerHandle {
  server: HttpServer
  realtime: RpcRealtimeServer
  port: number
  url: string
  close: () => Promise<void>
}

export async function startMeridianServer(
  options: MeridianServerOptions = {}
): Promise<MeridianServerHandle> {
  const host = options.host ?? '127.0.0.1'
  const realtime = new RpcRealtimeServer()
  const staticRoot = options.staticDir ? resolve(options.staticDir) : null
  const tileFetch = options.tileFetch ?? fetch
  const tileCache = new TileCache()
  const settingsManager =
    options.settingsManager ?? options.runtime?.settingsManager ?? new SettingsManager()
  const ownsVideoManager = !options.videoManager && !options.runtime?.videoManager
  const videoManager = options.videoManager ?? options.runtime?.videoManager ?? new VideoManager()
  const linkManager = options.runtime?.linkManager ?? null
  const vehicleManager = options.runtime?.vehicleManager ?? null
  const trackingManager = options.runtime?.trackingManager ?? null
  if (ownsVideoManager) {
    await videoManager.init()
  }

  realtime.registerModule(settingsModule, {
    commands: {
      getAll: async () => settingsManager.getAll(),
      set: async (key, value) => {
        settingsManager.set(key as keyof AppSettings, value as never)
      }
    }
  })

  const onSettingsChanged = (key: string, value: unknown): void => {
    realtime.emitEvent('settings', 'changed', { key, value })
  }
  settingsManager.on('changed', onSettingsChanged)

  realtime.registerModule(videoModule, {
    commands: {
      start: async (sourceType, uri) => {
        videoManager.start(sourceType as VideoSourceType, uri)
      },
      stop: async () => {
        videoManager.stop()
      },
      startRecording: async (filePath) => {
        videoManager.startRecording(filePath)
      },
      stopRecording: async () => {
        videoManager.stopRecording()
      },
      getState: async () => videoManager.state
    }
  })

  const onVideoStateChanged = (state: unknown): void => {
    realtime.emitEvent('video', 'stateChanged', state)
  }
  videoManager.on('stateChanged', onVideoStateChanged)

  realtime.registerModule(linksModule, {
    commands: {
      create: async (config) => {
        if (!linkManager) throw new Error('LinkManager not available')
        const link = await linkManager.createLink(config)
        return { id: link.id, status: link.status }
      },
      disconnect: async (id) => {
        if (!linkManager) throw new Error('LinkManager not available')
        linkManager.disconnectLink(id)
      },
      getAll: async () => linkManager?.getAllStates() ?? [],
      listSerialPorts: async () => {
        const ports = await SerialPort.list()
        return ports.map((p) => ({
          path: p.path,
          manufacturer: p.manufacturer,
          serialNumber: p.serialNumber,
          vendorId: p.vendorId,
          productId: p.productId
        }))
      }
    }
  })

  const onLinkStateChanged = (): void => {
    realtime.emitEvent('links', 'stateChanged', linkManager?.getAllStates() ?? [])
  }
  linkManager?.on('linkStateChanged', onLinkStateChanged)

  const requireVehicleManager = (): NonNullable<typeof vehicleManager> => {
    if (!vehicleManager) throw new Error('VehicleManager not available')
    return vehicleManager
  }

  realtime.registerModule(vehicleModule, {
    commands: {
      arm: async (vehicleId) => {
        await requireVehicleManager().getVehicle(vehicleId)?.arm()
      },
      forceArm: async (vehicleId) => {
        await requireVehicleManager().getVehicle(vehicleId)?.forceArm()
      },
      disarm: async (vehicleId) => {
        await requireVehicleManager().getVehicle(vehicleId)?.disarm()
      },
      sendMavCommand: async (req) => {
        await requireVehicleManager()
          .getVehicle(req.vehicleId)
          ?.commandQueue.sendCommand(req.command, req.vehicleId, req.componentId, {
            p1: req.param1,
            p2: req.param2,
            p3: req.param3,
            p4: req.param4,
            p5: req.param5,
            p6: req.param6,
            p7: req.param7
          })
      },
      setFlightMode: async (vehicleId, modeName) =>
        requireVehicleManager().getVehicle(vehicleId)?.setFlightModeByName(modeName),
      guidedTakeoff: async (vehicleId, altitude) =>
        requireVehicleManager().getVehicle(vehicleId)?.guidedTakeoff(altitude),
      guidedRTL: async (vehicleId) => {
        await requireVehicleManager().getVehicle(vehicleId)?.guidedRTL()
      },
      guidedLand: async (vehicleId) => {
        await requireVehicleManager().getVehicle(vehicleId)?.guidedLand()
      },
      guidedGoto: async (vehicleId, lat, lon, alt) => {
        await requireVehicleManager().getVehicle(vehicleId)?.guidedGoto(lat, lon, alt)
      },
      guidedPause: async (vehicleId) => {
        await requireVehicleManager().getVehicle(vehicleId)?.guidedPause()
      },
      missionStart: async (vehicleId) => {
        await requireVehicleManager().getVehicle(vehicleId)?.missionStart()
      },
      emergencyStop: async (vehicleId) => {
        await requireVehicleManager().getVehicle(vehicleId)?.emergencyStop()
      },
      guidedChangeAltitude: async (vehicleId, altitudeRel) =>
        requireVehicleManager().getVehicle(vehicleId)?.guidedChangeAltitude(altitudeRel),
      guidedChangeHeading: async (vehicleId, headingDeg) =>
        requireVehicleManager().getVehicle(vehicleId)?.guidedChangeHeading(headingDeg),
      guidedChangeSpeed: async (vehicleId, speed, speedType) =>
        requireVehicleManager().getVehicle(vehicleId)?.guidedChangeSpeed(speed, speedType),
      guidedOrbit: async (vehicleId, lat, lon, radius, altitudeRel) =>
        requireVehicleManager().getVehicle(vehicleId)?.guidedOrbit(lat, lon, radius, altitudeRel),
      landingGearDeploy: async (vehicleId) =>
        requireVehicleManager().getVehicle(vehicleId)?.landingGearDeploy(),
      landingGearRetract: async (vehicleId) =>
        requireVehicleManager().getVehicle(vehicleId)?.landingGearRetract(),
      trackingEngage: async (vehicleId, trackId) => {
        if (!trackingManager) return { ok: false, error: 'Tracking manager not available' }
        return trackingManager.engage(vehicleId, trackId)
      },
      trackingDisengage: async (vehicleId) => {
        trackingManager?.disengage(vehicleId)
      },
      trackingGetEngagement: async (vehicleId) => trackingManager?.getEngagement(vehicleId) ?? null
    }
  })

  let vehicleTelemetryPublisher: VehicleTelemetryPublisher | null = null
  const vehicleStatusTextListeners = new Map<
    number,
    (payload: { severity: number; text: string }) => void
  >()
  const onVehicleAdded = (vehicleId: number): void => {
    realtime.emitEvent('vehicle', 'added', { vehicleId })
    const vehicle = vehicleManager?.getVehicle(vehicleId)
    if (!vehicle || vehicleStatusTextListeners.has(vehicleId)) return
    const onStatusText = (payload: { severity: number; text: string }): void => {
      realtime.emitEvent('vehicle', 'statusText', { vehicleId, ...payload })
    }
    vehicleStatusTextListeners.set(vehicleId, onStatusText)
    vehicle.on('statusText', onStatusText)
  }
  const onVehicleRemoved = (vehicleId: number): void => {
    realtime.emitEvent('vehicle', 'removed', { vehicleId })
    const listener = vehicleStatusTextListeners.get(vehicleId)
    const vehicle = vehicleManager?.getVehicle(vehicleId)
    if (listener && vehicle) vehicle.removeListener('statusText', listener)
    vehicleStatusTextListeners.delete(vehicleId)
  }
  if (vehicleManager) {
    vehicleManager.on('vehicleAdded', onVehicleAdded)
    vehicleManager.on('vehicleRemoved', onVehicleRemoved)
    vehicleTelemetryPublisher = new VehicleTelemetryPublisher(vehicleManager)
    vehicleTelemetryPublisher.on('delta', (payload) => {
      realtime.emitEvent('vehicle', 'delta', payload)
    })
    for (const vehicle of vehicleManager.getAllVehicles()) {
      onVehicleAdded(vehicle.sysid)
    }
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${host}`)
    if (req.method === 'GET' && url.pathname === '/api/health') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true, service: 'meridian-server' }))
      return
    }

    if (req.method === 'GET' && url.pathname === '/api/map/providers') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ providers: getMapProviderInfos() }))
      return
    }

    if (req.method === 'GET' && url.pathname.startsWith('/api/tiles/')) {
      void serveMapTile(url.pathname, res, tileFetch, tileCache)
      return
    }

    if (req.method === 'GET' && staticRoot) {
      void serveStaticFile(staticRoot, url.pathname, res)
      return
    }

    sendJson(res, 404, { error: 'Not found' })
  })

  realtime.attach(server)

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port ?? 0, host, () => {
      server.off('error', reject)
      resolve()
    })
  })

  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : options.port!

  return {
    server,
    realtime,
    port,
    url: `http://${host}:${port}`,
    close: async () => {
      settingsManager.removeListener('changed', onSettingsChanged)
      videoManager.removeListener('stateChanged', onVideoStateChanged)
      linkManager?.removeListener('linkStateChanged', onLinkStateChanged)
      vehicleManager?.removeListener('vehicleAdded', onVehicleAdded)
      vehicleManager?.removeListener('vehicleRemoved', onVehicleRemoved)
      for (const [vehicleId, listener] of vehicleStatusTextListeners) {
        vehicleManager?.getVehicle(vehicleId)?.removeListener('statusText', listener)
      }
      vehicleStatusTextListeners.clear()
      vehicleTelemetryPublisher?.dispose()
      await realtime.close()
      if (ownsVideoManager) {
        videoManager.destroy()
      }
      await new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err)
          else resolve()
        })
      })
    }
  }
}

const TILE_CACHE_MAX = 500

interface TileCacheEntry {
  headers: Record<string, string>
  body: Buffer
}

class TileCache {
  private entries = new Map<string, TileCacheEntry>()

  get(key: string): TileCacheEntry | undefined {
    const entry = this.entries.get(key)
    if (!entry) return undefined
    this.entries.delete(key)
    this.entries.set(key, entry)
    return entry
  }

  put(key: string, entry: TileCacheEntry): void {
    if (this.entries.size >= TILE_CACHE_MAX) {
      const oldest = this.entries.keys().next().value
      if (oldest !== undefined) this.entries.delete(oldest)
    }
    this.entries.set(key, entry)
  }
}

async function serveMapTile(
  pathname: string,
  res: ServerResponse,
  tileFetch: typeof fetch,
  tileCache: TileCache
): Promise<void> {
  const match = pathname.match(/^\/api\/tiles\/([^/]+)\/(\d+)\/(\d+)\/(\d+)(?:\.[a-zA-Z0-9]+)?$/)
  if (!match) {
    sendJson(res, 404, { error: 'Tile not found' })
    return
  }

  const [, providerName, zStr, xStr, yStr] = match
  const provider = tileProviders[providerName!]
  if (!provider) {
    sendJson(res, 404, { error: 'Unknown tile provider' })
    return
  }

  const z = parseInt(zStr!, 10)
  const x = parseInt(xStr!, 10)
  const y = parseInt(yStr!, 10)
  const upstreamUrl = provider.resolveUrl(x, y, z)
  const cached = tileCache.get(upstreamUrl)
  if (cached) {
    res.writeHead(200, cached.headers)
    res.end(cached.body)
    return
  }

  try {
    const upstream = await tileFetch(upstreamUrl, {
      headers: { 'User-Agent': 'Meridian/1.0' }
    })
    if (!upstream.ok) {
      res.writeHead(upstream.status, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: `Tile provider returned ${upstream.status}` }))
      return
    }

    const body = Buffer.from(await upstream.arrayBuffer())
    const contentType = upstream.headers.get('content-type') ?? 'image/png'
    const headers = { 'content-type': contentType }
    tileCache.put(upstreamUrl, { headers, body })
    res.writeHead(200, headers)
    res.end(body)
  } catch {
    sendJson(res, 502, { error: 'Tile fetch failed' })
  }
}

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  res.writeHead(statusCode, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

async function serveStaticFile(
  staticRoot: string,
  pathname: string,
  res: ServerResponse
): Promise<void> {
  const requestedPath = pathname === '/' ? '/index.html' : pathname
  const candidate = resolve(join(staticRoot, decodeURIComponent(requestedPath)))

  if (candidate !== staticRoot && !candidate.startsWith(`${staticRoot}${sep}`)) {
    sendJson(res, 403, { error: 'Forbidden' })
    return
  }

  try {
    const info = await stat(candidate)
    if (!info.isFile()) {
      sendJson(res, 404, { error: 'Not found' })
      return
    }
    const body = await readFile(candidate)
    res.writeHead(200, { 'content-type': contentTypeForPath(candidate) })
    res.end(body)
  } catch {
    sendJson(res, 404, { error: 'Not found' })
  }
}

function contentTypeForPath(pathname: string): string {
  switch (extname(pathname)) {
    case '.html':
      return 'text/html; charset=utf-8'
    case '.js':
      return 'text/javascript; charset=utf-8'
    case '.css':
      return 'text/css; charset=utf-8'
    case '.json':
      return 'application/json; charset=utf-8'
    case '.svg':
      return 'image/svg+xml'
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    default:
      return 'application/octet-stream'
  }
}

if (require.main === module) {
  const port = Number(process.env.MERIDIAN_SERVER_PORT ?? 8080)
  startMeridianServer({ port })
    .then((handle) => {
      console.log(`Meridian server listening on ${handle.url}`)
    })
    .catch((err) => {
      console.error(err)
      process.exit(1)
    })
}
