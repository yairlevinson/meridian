import { createServer, type Server as HttpServer } from 'http'
import { resolve } from 'path'
import { SettingsManager } from '../main/settings/SettingsManager'
import { VideoManager } from '../main/video/VideoManager'
import type { MeridianRuntime } from '../main/runtime/MeridianRuntime'
import { createHttpHandler } from './http/createHttpHandler'
import { RpcRealtimeServer } from './realtime/RpcRealtimeServer'
import { registerServerModules } from './realtime/registerServerModules'

export interface MeridianServerOptions {
  port?: number
  host?: string
  staticDir?: string
  tileFetch?: typeof fetch
  runtime?: Pick<
    MeridianRuntime,
    | 'settingsManager'
    | 'videoManager'
    | 'linkManager'
    | 'vehicleManager'
    | 'trackingManager'
    | 'forwarder'
    | 'radarManager'
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
  const settingsManager =
    options.settingsManager ?? options.runtime?.settingsManager ?? new SettingsManager()
  const ownsVideoManager = !options.videoManager && !options.runtime?.videoManager
  const videoManager = options.videoManager ?? options.runtime?.videoManager ?? new VideoManager()
  const linkManager = options.runtime?.linkManager ?? null
  const vehicleManager = options.runtime?.vehicleManager ?? null
  const trackingManager = options.runtime?.trackingManager ?? null
  const forwarder = options.runtime?.forwarder ?? null
  const radarManager = options.runtime?.radarManager ?? null
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
  const disposeVideoWebSocket = videoManager.attachWebSocketServer(server, '/video/live')

  const disposeRealtimeUpgrade = realtime.attach(server)

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
      disposeServerModules()
      disposeVideoWebSocket()
      disposeRealtimeUpgrade()
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

if (require.main === module) {
  const port = Number(process.env.MERIDIAN_SERVER_PORT ?? 8080)
  const staticDir = process.env.MERIDIAN_STATIC_DIR ?? resolve(__dirname, '../renderer')
  startMeridianServer({ port, staticDir })
    .then((handle) => {
      console.log(`Meridian server listening on ${handle.url}`)
    })
    .catch((err) => {
      console.error(err)
      process.exit(1)
    })
}
