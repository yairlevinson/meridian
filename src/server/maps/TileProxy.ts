import type { ServerResponse } from 'http'
import { tileProviders } from '@shared/ipc/tileProviders'

const TILE_CACHE_MAX = 500

interface TileCacheEntry {
  headers: Record<string, string>
  body: Buffer
}

export class TileCache {
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

export async function serveMapTile(
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
      sendJson(res, upstream.status, { error: `Tile provider returned ${upstream.status}` })
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
