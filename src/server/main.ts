import { createServer, type Server as HttpServer, type ServerResponse } from 'http'
import { readFile, stat } from 'fs/promises'
import { extname, join, resolve, sep } from 'path'
import { getMapProviderInfos } from '@shared/ipc/tileProviders'
import { RpcRealtimeServer } from './realtime/RpcRealtimeServer'

export interface MeridianServerOptions {
  port?: number
  host?: string
  staticDir?: string
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
      await realtime.close()
      await new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err)
          else resolve()
        })
      })
    }
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
