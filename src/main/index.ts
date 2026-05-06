import { app, shell, BrowserWindow, net, protocol, session } from 'electron'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { join } from 'path'
import { startIpcBridge } from './ipcBridge'
import { resolveTileUrl } from '@shared/ipc/tileProviders'
import { mavLog } from './mavlink/trafficLog'
import { registerIpcModule } from './ipc/registerIpcModule'
import { popoutModule } from '@shared/ipc/modules/popout'
import { createLogger } from './logger'
import { createMeridianRuntime } from './runtime/MeridianRuntime'

const log = createLogger('main')

// Prevent crashes from TCP socket errors (e.g. EPIPE, unexpected read errors
// when SITL container shuts down). These are non-fatal — the link will
// reconnect or the app will show disconnected state.
process.on('uncaughtException', (err) => {
  const code = (err as NodeJS.ErrnoException).code
  if (code === 'EPIPE' || code === 'ECONNRESET') {
    log.warn('Suppressed socket error:', err.message)
    return
  }
  // Unknown errors are fatal — log and exit cleanly
  log.error('Fatal uncaught exception:', err)
  process.exit(1)
})

const UDP_PORT = parseInt(process.env.GC_UDP_PORT || '14550', 10)

// TCP SITL connections: comma-separated "host:port" pairs
// e.g. GC_TCP_LINKS="127.0.0.1:5760,127.0.0.1:5761,..."
const TCP_LINKS = process.env.GC_TCP_LINKS || ''

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    title: 'Meridian',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  win.on('ready-to-show', () => win.show())

  win.webContents.setWindowOpenHandler((details) => {
    if (details.url.startsWith('https://')) {
      shell.openExternal(details.url)
    }
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

// Track active popout windows by view name
const popoutWindows = new Map<string, BrowserWindow>()

let emitPopoutClosed: (payload: { view: string }) => void = () => {}

function openPopoutWindow(view: string): BrowserWindow {
  // Close existing popout for the same view
  const existing = popoutWindows.get(view)
  if (existing && !existing.isDestroyed()) {
    existing.focus()
    return existing
  }

  const title = view === 'video' ? 'Video' : 'Map'
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    title: `Meridian — ${title}`,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  popoutWindows.set(view, win)

  win.on('closed', () => {
    popoutWindows.delete(view)
    emitPopoutClosed({ view })
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}?popout=${view}`)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), {
      query: { popout: view }
    })
  }

  return win
}

// Register a custom protocol that proxies OSM tile requests from the main process,
// bypassing renderer CORS restrictions entirely.
protocol.registerSchemesAsPrivileged([
  { scheme: 'tile', privileges: { secure: true, supportFetchAPI: true, corsEnabled: false } }
])

// ── Simple LRU tile cache ────────────────────────────────────────
const TILE_CACHE_MAX = 500
const tileCache = new Map<string, { headers: Record<string, string>; body: ArrayBuffer }>()

function tileCacheGet(key: string): Response | undefined {
  const entry = tileCache.get(key)
  if (!entry) return undefined
  // Move to end (most recently used)
  tileCache.delete(key)
  tileCache.set(key, entry)
  return new Response(entry.body, { headers: entry.headers })
}

function tileCachePut(key: string, headers: Record<string, string>, body: ArrayBuffer): void {
  if (tileCache.size >= TILE_CACHE_MAX) {
    // Evict oldest entry (first key in Map iteration order)
    const oldest = tileCache.keys().next().value
    if (oldest !== undefined) tileCache.delete(oldest)
  }
  tileCache.set(key, { headers, body })
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.meridian-gcs')

  // Start MAVLink traffic logger (writes to ~/meridian-mavlink.log)
  mavLog.start()

  // Grant geolocation permission so the renderer can get the GCS location
  // for the planned home position (QGC-style behavior)
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'geolocation')
  })

  // Handle tile:// requests — proxy tile fetches from main process to bypass CORS
  protocol.handle('tile', async (request) => {
    const url = resolveTileUrl(request.url)
    if (!url) {
      // Legacy fallback: tile://osm/{z}/{x}/{y}.png
      const legacyUrl = request.url.replace('tile://osm/', 'https://tile.openstreetmap.org/')
      if (legacyUrl !== request.url) {
        const legacyCached = tileCacheGet(legacyUrl)
        if (legacyCached) return legacyCached
        try {
          const resp = await net.fetch(legacyUrl, { headers: { 'User-Agent': 'Meridian/1.0' } })
          if (resp.ok) {
            const buf = await resp.arrayBuffer()
            const ct = resp.headers.get('content-type') ?? 'image/png'
            tileCachePut(legacyUrl, { 'content-type': ct }, buf)
            return new Response(buf, { headers: { 'content-type': ct } })
          }
          return resp
        } catch {
          return new Response(null, { status: 502 })
        }
      }
      return new Response(null, { status: 404 })
    }

    const cached = tileCacheGet(url)
    if (cached) return cached

    try {
      const response = await net.fetch(url, {
        headers: { 'User-Agent': 'Meridian/1.0' }
      })
      if (response.ok) {
        const buf = await response.arrayBuffer()
        const ct = response.headers.get('content-type') ?? 'image/png'
        tileCachePut(url, { 'content-type': ct }, buf)
        return new Response(buf, { headers: { 'content-type': ct } })
      }
      return response
    } catch (err) {
      log.warn('tile fetch error:', err)
      return new Response(null, { status: 502 })
    }
  })

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()

  // --- Popout windows ---
  registerIpcModule(popoutModule, {
    commands: {
      open: (view) => {
        openPopoutWindow(view)
      },
      close: (view) => {
        const win = popoutWindows.get(view)
        if (win && !win.isDestroyed()) win.close()
      }
    },
    events: {
      closed: (emit) => {
        emitPopoutClosed = emit
        return () => {
          emitPopoutClosed = () => {}
        }
      }
    }
  })

  const runtime = await createMeridianRuntime({
    userDataPath: app.getPath('userData'),
    udpPort: UDP_PORT,
    tcpLinks: TCP_LINKS
  })

  const cleanupIpcBridge = startIpcBridge(
    runtime.vehicleManager,
    runtime.videoManager,
    runtime.linkManager,
    runtime.forwarder,
    runtime.settingsManager,
    runtime.radarManager,
    runtime.trackingManager
  )

  app.on('before-quit', () => {
    cleanupIpcBridge()
    runtime.dispose()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  app.quit()
})
