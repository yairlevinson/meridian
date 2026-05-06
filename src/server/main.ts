import { createServer, type Server as HttpServer } from 'http'
import { RpcRealtimeServer } from './realtime/RpcRealtimeServer'

export interface MeridianServerOptions {
  port?: number
  host?: string
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

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${host}`)
    if (req.method === 'GET' && url.pathname === '/api/health') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true, service: 'meridian-server' }))
      return
    }

    if (req.method === 'GET' && url.pathname === '/api/map/providers') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ providers: [] }))
      return
    }

    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'Not found' }))
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
