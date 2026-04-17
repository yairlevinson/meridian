import { app, shell, BrowserWindow, net, protocol, session } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { MavLinkProtocolV2 } from 'node-mavlink'
import { common, minimal } from 'mavlink-mappings'
import { VehicleManager } from './vehicle/VehicleManager'
import { LinkManager } from './links/LinkManager'
import { MavlinkProtocol } from './mavlink/MavlinkProtocol'
import { LinkType, type TcpLinkConfig } from '@shared/ipc/LinkState'
import { UdpLink } from './links/UdpLink'
import type { StreamRequest } from '@shared/ipc/geo'
import { startIpcBridge } from './ipcBridge'
import { GCS_SYSID, GCS_COMPID } from './mavlink/constants'
import { resolveTileUrl } from '@shared/ipc/tileProviders'
import { VideoManager } from './video/VideoManager'
import { mavLog } from './mavlink/trafficLog'
import { SettingsManager } from './settings/SettingsManager'
import { MavlinkForwarder } from './forwarding/MavlinkForwarder'
import { RadarManager } from './radar/RadarManager'
import { registerIpcModule } from './ipc/registerIpcModule'
import { popoutModule } from '@shared/ipc/modules/popout'
import { createLogger } from './logger'

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

// MAV_DATA_STREAM IDs used by ArduPilot
const MAV_DATA_STREAM_POSITION = 6 // GLOBAL_POSITION_INT
const MAV_DATA_STREAM_EXTRA1 = 10 // ATTITUDE
const MAV_DATA_STREAM_EXTRA2 = 11 // VFR_HUD

function requestStreams(writeFn: (buf: Buffer) => void, targetSysId: number, label?: string): void {
  const proto = new MavLinkProtocolV2(GCS_SYSID, GCS_COMPID)
  let seq = 0

  // ArduPilot: REQUEST_DATA_STREAM
  const streams: StreamRequest[] = [
    { id: MAV_DATA_STREAM_POSITION, rate: 4 },
    { id: MAV_DATA_STREAM_EXTRA1, rate: 10 },
    { id: MAV_DATA_STREAM_EXTRA2, rate: 4 }
  ]

  for (const { id, rate } of streams) {
    const req = new common.RequestDataStream()
    req.targetSystem = targetSysId
    req.targetComponent = 0
    req.reqStreamId = id
    req.reqMessageRate = rate
    req.startStop = 1

    writeFn(proto.serialize(req, seq++ & 0xff))
    log.log(
      `requested stream id=${id} at ${rate}Hz for sysid=${targetSysId}${label ? ` on ${label}` : ''}`
    )
  }

  // PX4: MAV_CMD_SET_MESSAGE_INTERVAL via COMMAND_LONG
  // PX4 ignores REQUEST_DATA_STREAM — it uses COMMAND_LONG to set message intervals
  const px4Messages = [
    { msgId: common.GlobalPositionInt.MSG_ID, rate: 4 },
    { msgId: common.Attitude.MSG_ID, rate: 10 },
    { msgId: common.AttitudeQuaternion.MSG_ID, rate: 10 }, // PX4 SIH sends this instead of ATTITUDE
    { msgId: common.LocalPositionNed.MSG_ID, rate: 4 }, // fallback when no GLOBAL_POSITION_INT
    { msgId: common.VfrHud.MSG_ID, rate: 4 },
    { msgId: common.SysStatus.MSG_ID, rate: 2 },
    { msgId: common.GpsRawInt.MSG_ID, rate: 2 },
    { msgId: common.HomePosition.MSG_ID, rate: 0.2 },
    { msgId: minimal.Heartbeat.MSG_ID, rate: 1 }
  ]

  for (const { msgId, rate } of px4Messages) {
    const cmd = new common.CommandLong()
    cmd.targetSystem = targetSysId
    cmd.targetComponent = 0
    cmd.command = common.MavCmd.SET_MESSAGE_INTERVAL
    cmd.confirmation = 0
    cmd._param1 = msgId
    cmd._param2 = Math.round(1_000_000 / rate) // interval in microseconds
    cmd._param3 = 0
    cmd._param4 = 0
    cmd._param5 = 0
    cmd._param6 = 0
    cmd._param7 = 0

    writeFn(proto.serialize(cmd, seq++ & 0xff))
  }
  log.log(`requested PX4 message intervals for sysid=${targetSysId}${label ? ` on ${label}` : ''}`)

  // Request HOME_POSITION once (works on both ArduPilot and PX4)
  const reqHome = new common.CommandLong()
  reqHome.targetSystem = targetSysId
  reqHome.targetComponent = 0
  reqHome.command = common.MavCmd.REQUEST_MESSAGE
  reqHome.confirmation = 0
  reqHome._param1 = common.HomePosition.MSG_ID
  reqHome._param2 = 0
  reqHome._param3 = 0
  reqHome._param4 = 0
  reqHome._param5 = 0
  reqHome._param6 = 0
  reqHome._param7 = 0
  writeFn(proto.serialize(reqHome, seq++ & 0xff))
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

  // --- Video streaming ---
  const videoManager = new VideoManager()
  await videoManager.init()

  // --- MAVLink stack ---
  const settingsManager = new SettingsManager({
    filePath: join(app.getPath('userData'), 'settings.json')
  })
  const vehicleManager = new VehicleManager()

  // Parse TCP link targets
  const tcpTargets = TCP_LINKS
    ? TCP_LINKS.split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : []

  function writeToAllLinks(lm: LinkManager, buf: Buffer): void {
    for (const state of lm.getAllStates()) {
      const link = lm.getLink(state.id)
      if (link?.isConnected) {
        try {
          link.writeBytes(buf)
        } catch {
          /* link closed */
        }
      }
    }
  }

  // --- MAVLink stack (shared across TCP and UDP modes) ---
  const mavlinkProtocol = new MavlinkProtocol()
  const linkManager = new LinkManager(mavlinkProtocol)

  // Route all decoded messages to the VehicleManager
  linkManager.on('message', (msg, link) => {
    vehicleManager.handleMessage(msg, link.id)
  })

  // Track which link a vehicle came from
  const vehicleToLink = new Map<number, string>()
  linkManager.on('message', (msg, link) => {
    if (!vehicleToLink.has(msg.sysid)) {
      vehicleToLink.set(msg.sysid, link.id)
    }
  })

  // --- Mode-specific link creation ---
  let rootUdpLink: UdpLink | null = null

  if (tcpTargets.length > 0) {
    // TCP mode: connect to multiple SITL instances
    for (const target of tcpTargets) {
      const parts = target.split(':')
      const host = parts[0] ?? '127.0.0.1'
      const port = parseInt(parts[1] ?? '5760', 10)
      const config: TcpLinkConfig = {
        type: LinkType.TCP,
        name: `SITL ${host}:${port}`,
        host,
        port
      }
      try {
        const link = await linkManager.createLink(config)
        log.log(`TCP link connected: ${link.id} → ${host}:${port}`)
      } catch (err) {
        log.warn(`Failed to connect TCP ${host}:${port}:`, err)
      }
    }
    log.log(`Connected ${linkManager.getAllStates().length} TCP links`)
  } else {
    // UDP mode: listen for incoming MAVLink
    rootUdpLink = (await linkManager.createLink({
      type: LinkType.UDP,
      name: 'Root UDP',
      listenPort: UDP_PORT
    })) as UdpLink
    rootUdpLink.unref()
    log.log(`Listening for MAVLink on UDP port ${UDP_PORT}`)
  }

  // When a vehicle is discovered, assign its link and request data streams
  const streamRequestedFor = new Set<number>()
  vehicleManager.on('vehicleAdded', (sysid: number) => {
    log.log(`Vehicle added: sysid=${sysid}`)
    const linkId = vehicleToLink.get(sysid)
    const managedLink = linkId ? linkManager.getLink(linkId) : undefined
    const link = managedLink ?? rootUdpLink
    if (link) {
      vehicleManager.getVehicle(sysid)?.addLink(link)
      if (!streamRequestedFor.has(sysid)) {
        streamRequestedFor.add(sysid)
        requestStreams((buf) => link.writeBytes(buf), sysid, linkId)
      }
    }
  })

  // --- MAVLink forwarding ---
  const forwarder = new MavlinkForwarder(settingsManager, UDP_PORT)
  forwarder.attachLinkManager(linkManager)
  forwarder.setVehicleWriteFn((buf) => writeToAllLinks(linkManager, buf))

  // --- Radar ---
  const radarManager = new RadarManager(settingsManager)

  const cleanupIpcBridge = startIpcBridge(
    vehicleManager,
    videoManager,
    linkManager,
    forwarder,
    settingsManager,
    radarManager
  )

  // Auto-detect USB autopilot boards and connect via serial
  linkManager.startAutoConnect()

  // Send GCS heartbeats at 1Hz on all links.
  // PX4's TCP bridge (mavlink-routerd) and PX4 SITL require GCS heartbeats
  // before they start relaying vehicle data to the client.
  const PX4_SITL_PORT = 18570
  const gcsProto = new MavLinkProtocolV2(GCS_SYSID, GCS_COMPID)
  let gcsSeq = 0
  const heartbeatInterval = setInterval(() => {
    const hb = new minimal.Heartbeat()
    hb.type = minimal.MavType.GCS
    hb.autopilot = minimal.MavAutopilot.INVALID
    hb.baseMode = 0 as minimal.MavModeFlag
    hb.customMode = 0
    hb.systemStatus = minimal.MavState.ACTIVE
    hb.mavlinkVersion = 3
    const buf = gcsProto.serialize(hb, gcsSeq++ & 0xff)
    // In UDP mode, also send to PX4 SITL's default MAVLink port
    if (rootUdpLink) {
      rootUdpLink.sendTo(buf, PX4_SITL_PORT, '127.0.0.1')
    }
    // Send on all managed links
    for (const state of linkManager.getAllStates()) {
      const link = linkManager.getLink(state.id)
      if (link?.isConnected) {
        try {
          link.writeBytes(buf)
        } catch {
          /* link closed */
        }
      }
    }
  }, 1000)

  app.on('before-quit', () => {
    settingsManager.flush()
    clearInterval(heartbeatInterval)
    radarManager.destroy()
    forwarder.destroy()
    cleanupIpcBridge()
    vehicleManager.destroy()
    linkManager.disconnectAll()
    mavlinkProtocol.destroy()
    videoManager.destroy()
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
