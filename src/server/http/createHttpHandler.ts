import type { IncomingMessage, ServerResponse } from 'http'
import { readFile, stat } from 'fs/promises'
import { extname, join, resolve, sep } from 'path'
import { getMapProviderInfos } from '@shared/ipc/tileProviders'
import { TileCache, serveMapTile } from '../maps/TileProxy'

export interface HttpHandlerOptions {
  host: string
  staticRoot: string | null
  tileFetch: typeof fetch
}

export function createHttpHandler({
  host,
  staticRoot,
  tileFetch
}: HttpHandlerOptions): (req: IncomingMessage, res: ServerResponse) => void {
  const tileCache = new TileCache()

  return (req, res) => {
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
      void serveStaticFile(staticRoot, url.pathname, res, acceptsHtml(req))
      return
    }

    sendJson(res, 404, { error: 'Not found' })
  }
}

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  res.writeHead(statusCode, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

function acceptsHtml(req: IncomingMessage): boolean {
  const accept = req.headers.accept
  if (!accept) return false
  return accept.includes('text/html') || accept.includes('*/*')
}

async function serveStaticFile(
  staticRoot: string,
  pathname: string,
  res: ServerResponse,
  fallbackToIndex: boolean
): Promise<void> {
  const requestedPath = pathname === '/' ? '/index.html' : pathname
  let decodedPath: string
  try {
    decodedPath = decodeURIComponent(requestedPath)
  } catch {
    sendJson(res, 400, { error: 'Bad request' })
    return
  }
  const candidate = resolve(join(staticRoot, decodedPath))

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
    if (fallbackToIndex && extname(pathname) === '') {
      await serveIndexFallback(staticRoot, res)
      return
    }
    sendJson(res, 404, { error: 'Not found' })
  }
}

async function serveIndexFallback(staticRoot: string, res: ServerResponse): Promise<void> {
  try {
    const indexPath = resolve(join(staticRoot, 'index.html'))
    const body = await readFile(indexPath)
    res.writeHead(200, { 'content-type': contentTypeForPath(indexPath) })
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
