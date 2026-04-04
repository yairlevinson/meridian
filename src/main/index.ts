import { app, shell, BrowserWindow, ipcMain, net, protocol, session } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { MavLinkProtocolV2 } from 'node-mavlink'
import { common, minimal } from 'mavlink-mappings'
import { UdpLink } from './udpLink'
import { createPipeline } from './mavlinkPipeline'
import { VehicleManager } from './vehicle/VehicleManager'
import { LinkManager } from './links/LinkManager'
import { MavlinkProtocol } from './mavlink/MavlinkProtocol'
import { LinkType, type TcpLinkConfig } from '@shared/ipc/LinkState'
import type { StreamRequest } from '@shared/ipc/geo'
import { startIpcBridge } from './ipcBridge'
import { GCS_SYSID, GCS_COMPID } from './mavlink/constants'
import { resolveTileUrl } from '@shared/ipc/tileProviders'
import { VideoManager } from './video/VideoManager'
import { mavLog } from './mavlink/trafficLog'
import { SettingsManager } from './settings/SettingsManager'
import { MavlinkForwarder } from './forwarding/MavlinkForwarder'

// Prevent crashes from TCP socket errors (e.g. EPIPE, unexpected read errors
// when SITL container shuts down). These are non-fatal — the link will
// reconnect or the app will show disconnected state.
process.on('uncaughtException', (err) => {
  if (err.code === 'EPIPE' || err.code === 'ECONNRESET' || err.code === 'ERR_OUT_OF_RANGE') {
    console.warn('[main] Suppressed socket error:', err.message)
    return
  }
  // Re-throw unknown errors
  throw err
})

const UDP_PORT = parseInt(process.env.GC_UDP_PORT || '14550', 10)

// TCP SITL connections: comma-separated "host:port" pairs
// e.g. GC_TCP_LINKS="127.0.0.1:5760,127.0.0.1:5761,..."
const TCP_LINKS = process.env.GC_TCP_LINKS || ''

let _mainWindow: BrowserWindow | null = null

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

function createPopoutWindow(view: string): BrowserWindow {
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
    // Notify all remaining windows that the popout was closed
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.webContents.isDestroyed()) {
        w.webContents.send('popout:closed', { view })
      }
    }
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

    writeFn(proto.serialize(req, seq++))
    console.log(
      `[main] requested stream id=${id} at ${rate}Hz for sysid=${targetSysId}${label ? ` on ${label}` : ''}`
    )
  }

  // PX4: MAV_CMD_SET_MESSAGE_INTERVAL (511) via COMMAND_LONG
  // PX4 ignores REQUEST_DATA_STREAM — it uses COMMAND_LONG to set message intervals
  const px4Messages = [
    { msgId: 33, rate: 4 }, // GLOBAL_POSITION_INT
    { msgId: 30, rate: 10 }, // ATTITUDE
    { msgId: 74, rate: 4 }, // VFR_HUD
    { msgId: 1, rate: 2 }, // SYS_STATUS
    { msgId: 24, rate: 2 }, // GPS_RAW_INT
    { msgId: 242, rate: 0.2 }, // HOME_POSITION (every 5s)
    { msgId: 0, rate: 1 } // HEARTBEAT (keep-alive)
  ]

  for (const { msgId, rate } of px4Messages) {
    const cmd = new common.CommandLong()
    cmd.targetSystem = targetSysId
    cmd.targetComponent = 0
    cmd.command = 511 // MAV_CMD_SET_MESSAGE_INTERVAL
    cmd.confirmation = 0
    cmd.param1 = msgId
    cmd.param2 = Math.round(1_000_000 / rate) // interval in microseconds
    cmd.param3 = 0
    cmd.param4 = 0
    cmd.param5 = 0
    cmd.param6 = 0
    cmd.param7 = 0

    writeFn(proto.serialize(cmd, seq++))
  }
  console.log(
    `[main] requested PX4 message intervals for sysid=${targetSysId}${label ? ` on ${label}` : ''}`
  )

  // Request HOME_POSITION once (works on both ArduPilot and PX4)
  const reqHome = new common.CommandLong()
  reqHome.targetSystem = targetSysId
  reqHome.targetComponent = 0
  reqHome.command = 512 // MAV_CMD_REQUEST_MESSAGE
  reqHome.confirmation = 0
  reqHome.param1 = 242 // HOME_POSITION message id
  reqHome.param2 = 0
  reqHome.param3 = 0
  reqHome.param4 = 0
  reqHome.param5 = 0
  reqHome.param6 = 0
  reqHome.param7 = 0
  writeFn(proto.serialize(reqHome, seq++))
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
        try {
          const resp = await net.fetch(legacyUrl, { headers: { 'User-Agent': 'Meridian/1.0' } })
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
      console.warn('[tile] fetch error:', err)
      return new Response(null, { status: 502 })
    }
  })

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  _mainWindow = createWindow()

  // --- Popout windows ---
  ipcMain.handle('popout:open', (_event, view: string) => {
    createPopoutWindow(view)
  })
  ipcMain.handle('popout:close', (_event, view: string) => {
    const win = popoutWindows.get(view)
    if (win && !win.isDestroyed()) win.close()
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

  if (tcpTargets.length > 0) {
    // ---- TCP mode: connect to multiple SITL instances via LinkManager ----
    const mavlinkProtocol = new MavlinkProtocol()
    const linkManager = new LinkManager(mavlinkProtocol)

    // Route all decoded messages to the VehicleManager
    linkManager.on('message', (msg, link) => {
      vehicleManager.handleMessage(msg, link.id)
    })

    // When a vehicle is discovered, request data streams on the link that carries it
    const streamRequestedFor = new Set<number>()
    const vehicleToLink = new Map<number, string>()

    // Track which link a vehicle came from
    linkManager.on('message', (msg, link) => {
      if (!vehicleToLink.has(msg.sysid)) {
        vehicleToLink.set(msg.sysid, link.id)
      }
    })

    vehicleManager.on('vehicleAdded', (sysid: number) => {
      console.log(`[main] Vehicle added: sysid=${sysid}`)
      const linkId = vehicleToLink.get(sysid)
      const tcpLink = linkId ? linkManager.getLink(linkId) : undefined
      if (tcpLink) {
        // Give the vehicle a way to send commands back through its TCP link
        vehicleManager
          .getVehicle(sysid)
          ?.setCommandLink({ writeBytes: (buf) => tcpLink.writeBytes(buf) })
        if (!streamRequestedFor.has(sysid)) {
          streamRequestedFor.add(sysid)
          requestStreams((buf) => tcpLink.writeBytes(buf), sysid, linkId!)
        }
      }
    })

    // --- MAVLink forwarding ---
    const forwarder = new MavlinkForwarder(settingsManager, UDP_PORT)
    forwarder.attachLinkManager(linkManager)
    forwarder.setVehicleWriteFn((buf) => writeToAllLinks(linkManager, buf))

    const cleanupIpcBridge = startIpcBridge(vehicleManager, videoManager, linkManager, forwarder)

    // Connect to each TCP target
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
        console.log(`[main] TCP link connected: ${link.id} → ${host}:${port}`)
      } catch (err) {
        console.warn(`[main] Failed to connect TCP ${host}:${port}:`, err)
      }
    }

    console.log(`[main] Connected ${linkManager.getAllStates().length} TCP links`)

    // Auto-detect USB autopilot boards and connect via serial
    linkManager.startAutoConnect()

    // Send GCS heartbeats at 1Hz on all TCP links.
    // PX4's TCP bridge (mavlink-routerd) requires GCS heartbeats before
    // it starts relaying vehicle data to the client.
    const gcsProto = new MavLinkProtocolV2(GCS_SYSID, GCS_COMPID)
    let gcsSeq = 0
    const heartbeatInterval = setInterval(() => {
      const hb = new minimal.Heartbeat()
      hb.type = minimal.MavType.GCS
      hb.autopilot = minimal.MavAutopilot.INVALID
      hb.baseMode = 0
      hb.customMode = 0
      hb.systemStatus = minimal.MavState.ACTIVE
      hb.mavlinkVersion = 3
      const buf = gcsProto.serialize(hb, gcsSeq++)
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
      forwarder.destroy()
      cleanupIpcBridge()
      linkManager.disconnectAll()
      mavlinkProtocol.destroy()
      vehicleManager.destroy()
      videoManager.destroy()
    })
  } else {
    // ---- UDP mode: listen for incoming MAVLink (SyntheticVehicle / single SITL) ----
    const udpLink = new UdpLink(UDP_PORT)

    // Create LinkManager so serial (and future) links can be added via IPC
    const mavlinkProtocol = new MavlinkProtocol()
    const linkManager = new LinkManager(mavlinkProtocol)

    linkManager.on('message', (msg, link) => {
      vehicleManager.handleMessage(msg, link.id)
    })

    const vehicleToLink = new Map<number, string>()
    linkManager.on('message', (msg, link) => {
      if (!vehicleToLink.has(msg.sysid)) {
        vehicleToLink.set(msg.sysid, link.id)
      }
    })

    // Wrap UdpLink as a WritableLink for command queue
    const udpWritable = { writeBytes: (buf: Buffer) => udpLink.send(buf) }

    const streamRequestedFor = new Set<number>()
    vehicleManager.on('vehicleAdded', (sysid: number) => {
      console.log(`[main] Vehicle added: sysid=${sysid}`)
      // Check if vehicle came from a managed link (e.g. serial)
      const linkId = vehicleToLink.get(sysid)
      const managedLink = linkId ? linkManager.getLink(linkId) : undefined
      if (managedLink) {
        vehicleManager
          .getVehicle(sysid)
          ?.setCommandLink({ writeBytes: (buf) => managedLink.writeBytes(buf) })
      } else {
        // Default to UDP
        vehicleManager.getVehicle(sysid)?.setCommandLink(udpWritable)
      }
      if (!streamRequestedFor.has(sysid)) {
        streamRequestedFor.add(sysid)
        if (managedLink) {
          requestStreams((buf) => managedLink.writeBytes(buf), sysid, linkId!)
        } else {
          requestStreams((buf) => udpLink.send(buf), sysid)
        }
      }
    })

    const cleanupPipeline = createPipeline(udpLink, (msg) => {
      vehicleManager.handleMessage(msg, 'udp-0')
    })

    // --- MAVLink forwarding ---
    const forwarder = new MavlinkForwarder(settingsManager, UDP_PORT)
    forwarder.attachLinkManager(linkManager)
    forwarder.attachLegacyUdpLink(udpLink)
    forwarder.setVehicleWriteFn((buf) => {
      udpLink.send(buf)
      writeToAllLinks(linkManager, buf)
    })

    const cleanupIpcBridge = startIpcBridge(vehicleManager, videoManager, linkManager, forwarder)

    await udpLink.bind()
    udpLink.unref()
    console.log(`[main] Listening for MAVLink on UDP port ${UDP_PORT}`)

    // Auto-detect USB autopilot boards and connect via serial
    linkManager.startAutoConnect()

    // Send GCS heartbeats at 1Hz to PX4 SITL's default MAVLink port.
    // PX4 SITL (started without -o flag) only sends data after it receives
    // a packet from the GCS, so we need to initiate the connection.
    const PX4_SITL_PORT = 18570
    const gcsProto = new MavLinkProtocolV2(GCS_SYSID, GCS_COMPID)
    let gcsSeq = 0
    const heartbeatInterval = setInterval(() => {
      const hb = new minimal.Heartbeat()
      hb.type = minimal.MavType.GCS
      hb.autopilot = minimal.MavAutopilot.INVALID
      hb.baseMode = 0
      hb.customMode = 0
      hb.systemStatus = minimal.MavState.ACTIVE
      hb.mavlinkVersion = 3
      const buf = gcsProto.serialize(hb, gcsSeq++)
      // Send to PX4 SITL default port and also to all known senders
      udpLink.sendTo(buf, PX4_SITL_PORT, '127.0.0.1')
      udpLink.send(buf)
      // Send on all managed links (serial, TCP) so autopilot starts talking
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
      forwarder.destroy()
      cleanupIpcBridge()
      cleanupPipeline()
      linkManager.disconnectAll()
      mavlinkProtocol.destroy()
      vehicleManager.destroy()
      videoManager.destroy()
      udpLink.close()
    })
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      _mainWindow = createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  app.quit()
})
