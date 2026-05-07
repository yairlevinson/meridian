import { createServer, type IncomingMessage, type Server as HttpServer } from 'http'
import { resolve } from 'path'
import { SettingsManager } from '../main/settings/SettingsManager'
import { VideoManager } from '../main/video/VideoManager'
import { createHttpHandler } from './http/createHttpHandler'
import { ServerRadarManager } from './operations/ServerRadarManager'
import type { RadarManagerLike } from './operations/OperationsRpc'
import { RpcRealtimeServer } from './realtime/RpcRealtimeServer'
import { registerServerModules } from './realtime/registerServerModules'
import { createServerRuntime, type ServerRuntime } from './runtime/ServerRuntime'

type MeridianServerRuntime = Partial<
  Pick<
    ServerRuntime,
    | 'settingsManager'
    | 'videoManager'
    | 'linkManager'
    | 'vehicleManager'
    | 'trackingManager'
    | 'forwarder'
  >
> & { radarManager?: RadarManagerLike }

export interface MeridianServerOptions {
  port?: number
  host?: string
  staticDir?: string
  tileFetch?: typeof fetch
  accessToken?: string | null
  allowedOrigins?: string[]
  runtime?: MeridianServerRuntime
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

function isLoopbackHost(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]'
}

function isWildcardHost(host: string): boolean {
  return host === '0.0.0.0' || host === '::' || host === '[::]'
}

function normalizeOrigin(origin: string): string | null {
  try {
    const url = new URL(origin)
    return url.origin
  } catch {
    return null
  }
}

function tokenFromRequest(request: IncomingMessage): string | null {
  const auth = request.headers.authorization
  if (auth?.startsWith('Bearer ')) return auth.slice('Bearer '.length).trim()

  const url = new URL(request.url ?? '/', 'http://127.0.0.1')
  return url.searchParams.get('token')
}

function createUpgradeAuthorizer({
  host,
  port,
  accessToken,
  allowedOrigins
}: {
  host: string
  port: number | null
  accessToken: string | null
  allowedOrigins: string[]
}): (request: IncomingMessage) => boolean {
  const normalizedOrigins = new Set(allowedOrigins.map(normalizeOrigin).filter(Boolean))
  if (port !== null && !isWildcardHost(host)) {
    normalizedOrigins.add(`http://${host}:${port}`)
  }

  return (request) => {
    const origin = request.headers.origin
    if (origin) {
      const normalized = normalizeOrigin(origin)
      if (!normalized || (normalizedOrigins.size > 0 && !normalizedOrigins.has(normalized))) {
        return false
      }
    }

    if (!accessToken) return true
    return tokenFromRequest(request) === accessToken
  }
}

export async function startMeridianServer(
  options: MeridianServerOptions = {}
): Promise<MeridianServerHandle> {
  const host = options.host ?? '127.0.0.1'
  const accessToken = options.accessToken ?? process.env.MERIDIAN_SERVER_TOKEN ?? null
  if (!isLoopbackHost(host) && !accessToken) {
    throw new Error('MERIDIAN_SERVER_TOKEN is required when binding Meridian server off loopback')
  }
  const allowedOrigins = options.allowedOrigins ?? []
  const realtime = new RpcRealtimeServer()
  const staticRoot = options.staticDir ? resolve(options.staticDir) : null
  const tileFetch = options.tileFetch ?? fetch
  const settingsManager =
    options.settingsManager ?? options.runtime?.settingsManager ?? new SettingsManager()
  const ownsVideoManager = !options.videoManager && !options.runtime?.videoManager
  const videoManager = options.videoManager ?? options.runtime?.videoManager ?? new VideoManager()
  const linkManager = options.runtime?.linkManager ?? null
  const vehicleManager = options.runtime?.vehicleManager ?? null
  const trackingManager = options.runtime?.trackingManager ?? null
  const forwarder = options.runtime?.forwarder ?? null
  const ownedRadarManager = options.runtime?.radarManager
    ? null
    : new ServerRadarManager(settingsManager)
  const radarManager = options.runtime?.radarManager ?? ownedRadarManager
  if (ownsVideoManager) {
    await videoManager.init()
  }

  const disposeServerModules = registerServerModules({
    realtime,
    settingsManager,
    videoManager,
    linkManager,
    vehicleManager,
    trackingManager,
    forwarder,
    radarManager
  })

  const server = createServer(createHttpHandler({ host, staticRoot, tileFetch }))
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port ?? 0, host, () => {
      server.off('error', reject)
      resolve()
    })
  })

  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : options.port!
  const authorizeUpgrade = createUpgradeAuthorizer({
    host,
    port,
    accessToken,
    allowedOrigins
  })
  const disposeVideoWebSocket = videoManager.attachWebSocketServer(server, '/video/live', {
    authorizeUpgrade
  })

  const disposeRealtimeUpgrade = realtime.attach(server, '/realtime', { authorizeUpgrade })

  return {
    server,
    realtime,
    port,
    url: `http://${host}:${port}`,
    close: async () => {
      disposeServerModules()
      disposeVideoWebSocket()
      disposeRealtimeUpgrade()
      await realtime.close()
      ownedRadarManager?.destroy()
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

async function startServerCli(): Promise<void> {
  const port = Number(process.env.MERIDIAN_SERVER_PORT ?? 8080)
  const host = process.env.MERIDIAN_SERVER_HOST ?? '127.0.0.1'
  const staticDir = process.env.MERIDIAN_STATIC_DIR ?? resolve(__dirname, '../renderer')

  const runtime = await createServerRuntime({
    userDataPath: process.env.MERIDIAN_USER_DATA_DIR,
    udpPort: Number(process.env.GC_UDP_PORT ?? 14550),
    tcpLinks: process.env.GC_TCP_LINKS
  })
  const handle = await startMeridianServer({ port, host, staticDir, runtime })

  const shutdown = async (): Promise<void> => {
    await handle.close()
    runtime.dispose()
  }
  process.once('SIGINT', () => {
    void shutdown().finally(() => process.exit(0))
  })
  process.once('SIGTERM', () => {
    void shutdown().finally(() => process.exit(0))
  })

  console.log(`Meridian server listening on ${handle.url}`)
}

if (require.main === module) {
  startServerCli().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
