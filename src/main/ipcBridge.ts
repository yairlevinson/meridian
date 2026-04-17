import { ipcMain, dialog, BrowserWindow } from 'electron'
import type { VehicleManager } from './vehicle/VehicleManager'
import type { VideoManager } from './video/VideoManager'
import type { LinkManager } from './links/LinkManager'
import { SerialPort } from 'serialport'
import { IpcChannels } from '@shared/ipc/channels'
import { IpcEvents } from '@shared/ipc/events'
import type { IpcHandler } from '@shared/ipc/geo'
import {
  MavResult,
  type MavCommandRequest,
  type FlightModeRequest
} from '@shared/ipc/MavCommandRequest'
import type { LinkConfig } from '@shared/ipc/LinkState'
import { common } from 'mavlink-mappings'
import { VideoSourceType } from '@shared/ipc/VideoTypes'
import { CameraMode } from '@shared/ipc/CameraTypes'
import { savePlanFile, loadPlanFile } from './mission/PlanFileIO'
import { parseKmlFile } from './kml/KmlParser'
import type { MissionItem, PlanFile } from '@shared/ipc/MissionTypes'
import { MavlinkInspector } from './mavlink/MavlinkInspector'
import type { MavlinkForwarder } from './forwarding/MavlinkForwarder'
import type { SettingsManager } from './settings/SettingsManager'
import type { RadarManager } from './radar/RadarManager'
import { createLogger } from './logger'
import { registerIpcModule } from './ipc/registerIpcModule'
import { radarModule } from '@shared/ipc/modules/radar'
import { forwardingModule } from '@shared/ipc/modules/forwarding'
import { settingsModule } from '@shared/ipc/modules/settings'
import { kmlModule } from '@shared/ipc/modules/kml'
import { mavConsoleModule } from '@shared/ipc/modules/mavConsole'
import { mavInspectorModule } from '@shared/ipc/modules/mavInspector'
import { videoModule } from '@shared/ipc/modules/video'
import { calibrationModule } from '@shared/ipc/modules/calibration'
import type { VideoStreamState } from '@shared/ipc/VideoTypes'
import type { CalibrationState, MagCalProgress, MagCalReport } from '@shared/ipc/SetupTypes'
import type {
  InspectorSnapshotPayload,
  InspectorFieldsPayload
} from '@shared/ipc/MavInspectorTypes'
import type { AppSettings } from '@shared/ipc/AppSettings'

const log = createLogger('IPC')

// PX4 custom_mode encoding: main_mode in bits 16-23, sub_mode in bits 24-31
// See QGC px4_custom_mode.h
const PX4_MODES: Record<string, number> = {
  Manual: 1 << 16,
  AltCtl: 2 << 16,
  PosCtl: 3 << 16,
  Stabilized: 7 << 16,
  Acro: 5 << 16,
  Offboard: 6 << 16,
  Rattitude: 8 << 16,
  Mission: (4 << 16) | (4 << 24),
  Loiter: (4 << 16) | (3 << 24),
  RTL: (4 << 16) | (5 << 24),
  Land: (4 << 16) | (6 << 24),
  Takeoff: (4 << 16) | (2 << 24)
}

function resolvePx4Mode(name: string): number {
  return PX4_MODES[name] ?? -1
}

// ArduCopter name → custom_mode number
const ARDUPILOT_MODES: Record<string, number> = {
  Stabilize: 0,
  Acro: 1,
  AltHold: 2,
  Auto: 3,
  Guided: 4,
  Loiter: 5,
  RTL: 6,
  Circle: 7,
  Land: 9,
  Drift: 11,
  Sport: 13,
  Flip: 14,
  AutoTune: 15,
  PosHold: 16,
  Brake: 17,
  Throw: 18,
  Avoid: 19,
  GuidedNoGPS: 20,
  SmartRTL: 21
}

function resolveArduMode(name: string): number {
  // Accept both named modes and numeric strings for backward compat
  const num = ARDUPILOT_MODES[name]
  if (num !== undefined) return num
  const parsed = Number(name)
  return Number.isFinite(parsed) ? parsed : -1
}

const TICK_RATE_MS = 33 // ~30 Hz

/** Send an event to all open BrowserWindows */
function broadcast(channel: string, ...args: unknown[]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    const wc = win.webContents
    if (!wc.isDestroyed()) wc.send(channel, ...args)
  }
}

export function startIpcBridge(
  vehicleManager: VehicleManager,
  videoManager?: VideoManager,
  linkManager?: LinkManager,
  forwarder?: MavlinkForwarder,
  settingsManager?: SettingsManager,
  radarManager?: RadarManager
): () => void {
  // Track disposers so shutdown can fully unwire
  const disposers: Array<() => void> = []

  // Captured by mavConsoleModule event wire so per-vehicle consoleData can
  // fan out through the module's emit (registered below).
  let emitMavConsoleData: ((payload: { vehicleId: number; text: string }) => void) | null = null

  // Captured by calibrationModule event wires so per-vehicle calibration
  // manager events can fan out through the module's emit (registered below).
  let emitCalibrationStateChanged: (p: {
    vehicleId: number
    state: CalibrationState
  }) => void = () => {}
  let emitCalibrationMagProgress: (p: { vehicleId: number } & MagCalProgress) => void = () => {}
  let emitCalibrationMagReport: (p: { vehicleId: number } & MagCalReport) => void = () => {}

  // Inspector emits are populated by the mavInspectorModule event wires below.
  // They're no-ops until registration completes (all before any renderer-driven enable()).
  let emitInspectorSnapshot: (p: InspectorSnapshotPayload) => void = () => {}
  let emitInspectorFields: (p: InspectorFieldsPayload) => void = () => {}
  const inspector = new MavlinkInspector(
    (p) => emitInspectorSnapshot(p),
    (p) => emitInspectorFields(p)
  )
  vehicleManager.onRawMessage = inspector.handleMessage

  // Forward renderer logs to main process log file
  const rendererLog = createLogger('renderer')
  const onRendererLog = (
    _event: Electron.IpcMainEvent,
    { level, tag, message }: { level: string; tag: string; message: string }
  ): void => {
    const tagged = `[${tag}] ${message}`
    if (level === 'error') rendererLog.error(tagged)
    else if (level === 'warn') rendererLog.warn(tagged)
    else rendererLog.log(tagged)
  }
  ipcMain.on('renderer:log', onRendererLog)
  disposers.push(() => ipcMain.removeListener('renderer:log', onRendererLog))

  let sentCount = 0
  let skippedCount = 0
  let lastLogTime = Date.now()

  // Forward vehicle lifecycle events to all renderer windows
  const onVehicleAdded = (sysid: number): void => {
    broadcast(IpcEvents.VehicleAdded, { vehicleId: sysid })
    const vehicle = vehicleManager.getVehicle(sysid)
    if (vehicle) {
      vehicle.missionManager.on('progress', (p: { current: number; total: number }) => {
        broadcast('mission:progress', { vehicleId: sysid, ...p })
      })
      vehicle.missionManager.on('loadComplete', (items: MissionItem[]) => {
        broadcast(IpcEvents.MissionComplete, { vehicleId: sysid, items })
      })
      vehicle.missionManager.on('currentChanged', (seq: number) => {
        broadcast('mission:currentChanged', { vehicleId: sysid, seq })
      })

      // Forward parameter events
      vehicle.parameterManager.on('parameterReceived', (param) => {
        broadcast(IpcEvents.ParameterChanged, { vehicleId: sysid, parameter: param })
      })
      vehicle.parameterManager.on('parametersReady', () => {
        broadcast(IpcEvents.ParametersReady, { vehicleId: sysid })
      })
      vehicle.parameterManager.on('progress', (loadState) => {
        broadcast(IpcEvents.ParametersProgress, { vehicleId: sysid, loadState })
      })

      // Forward STATUSTEXT
      vehicle.on('statusText', (payload: { severity: number; text: string }) => {
        broadcast(IpcEvents.StatusText, { vehicleId: sysid, ...payload })
      })

      // Forward calibration events via calibrationModule's captured emits
      vehicle.calibrationManager.on('stateChanged', (state) => {
        emitCalibrationStateChanged({ vehicleId: sysid, state })
      })
      vehicle.calibrationManager.on('magProgress', (progress) => {
        emitCalibrationMagProgress({ vehicleId: sysid, ...progress })
      })
      vehicle.calibrationManager.on('magReport', (report) => {
        emitCalibrationMagReport({ vehicleId: sysid, ...report })
      })

      // Forward RC calibration events
      vehicle.rcCalibrationManager.on('stateChanged', (state) => {
        broadcast(IpcEvents.RcCalibrationStateChanged, { vehicleId: sysid, state })
      })

      // Forward firmware upgrade events
      vehicle.firmwareManager.on('stateChanged', (state) => {
        broadcast(IpcEvents.FirmwareUpgradeStateChanged, { vehicleId: sysid, state })
      })

      // Forward camera events
      vehicle.cameraManager.on('stateChanged', (state) => {
        broadcast(IpcEvents.CameraStateChanged, { vehicleId: sysid, state })
      })
      vehicle.cameraManager.on('imageCaptured', (data) => {
        broadcast(IpcEvents.CameraImageCaptured, { vehicleId: sysid, ...data })
      })

      // Forward MAVLink console data
      const emitConsole = emitMavConsoleData
      if (emitConsole) {
        vehicle.on('consoleData', (payload: { text: string }) => {
          emitConsole({ vehicleId: sysid, ...payload })
        })
      }
    }
  }
  vehicleManager.on('vehicleAdded', onVehicleAdded)
  disposers.push(() => vehicleManager.removeListener('vehicleAdded', onVehicleAdded))

  const onVehicleRemoved = (sysid: number): void => {
    broadcast(IpcEvents.VehicleRemoved, { vehicleId: sysid })
  }
  vehicleManager.on('vehicleRemoved', onVehicleRemoved)
  disposers.push(() => vehicleManager.removeListener('vehicleRemoved', onVehicleRemoved))

  // Forward link state changes to all renderer windows
  if (linkManager) {
    const onLinkStateChanged = (): void => {
      broadcast(IpcEvents.LinkStateChanged, linkManager.getAllStates())
    }
    linkManager.on('linkStateChanged', onLinkStateChanged)
    disposers.push(() => linkManager.removeListener('linkStateChanged', onLinkStateChanged))
  }

  // Video IPC module (commands + stateChanged event)
  if (videoManager) {
    const vm = videoManager
    disposers.push(
      registerIpcModule(videoModule, {
        commands: {
          start: (sourceType, uri) => {
            vm.start(sourceType as VideoSourceType, uri)
          },
          stop: () => {
            vm.stop()
          },
          startRecording: (filePath) => {
            vm.startRecording(filePath)
          },
          stopRecording: () => {
            vm.stopRecording()
          },
          getState: () => vm.state
        },
        events: {
          stateChanged: (emit) => {
            const handler = (state: VideoStreamState): void => emit(state)
            vm.on('stateChanged', handler)
            return () => {
              vm.removeListener('stateChanged', handler)
            }
          }
        }
      })
    )
  }

  // Forwarding IPC module (commands + stateChanged event)
  if (forwarder) {
    const fw = forwarder
    disposers.push(
      registerIpcModule(forwardingModule, {
        commands: {
          getState: async () => fw.getState(),
          addTarget: async (host, port) => fw.addTarget(host, port),
          removeTarget: async (id) => {
            fw.removeTarget(id)
          },
          setEnabled: async (enabled) => {
            fw.setEnabled(enabled)
          },
          setTargetEnabled: async (id, enabled) => {
            fw.setTargetEnabled(id, enabled)
          }
        },
        events: {
          stateChanged: (emit) => {
            const handler = (state: unknown): void => emit(state as ReturnType<typeof fw.getState>)
            fw.on('stateChanged', handler)
            return () => {
              fw.removeListener('stateChanged', handler)
            }
          }
        }
      })
    )
  }

  // Radar IPC module (commands + stateChanged event)
  if (radarManager) {
    const rm = radarManager
    disposers.push(
      registerIpcModule(radarModule, {
        commands: {
          enable: async () => {
            rm.enable()
          },
          disable: async () => {
            rm.disable()
          },
          getState: async () => rm.getState(),
          setSimPosition: async (lat, lon) => {
            rm.setSimulationPosition(lat, lon)
          }
        },
        events: {
          stateChanged: (emit) => {
            const handler = (state: unknown): void => emit(state as ReturnType<typeof rm.getState>)
            rm.on('stateChanged', handler)
            return () => {
              rm.removeListener('stateChanged', handler)
            }
          }
        }
      })
    )
  }

  // KML IPC module (file-import commands, no events)
  disposers.push(
    registerIpcModule(kmlModule, {
      commands: {
        import: async () => {
          const result = await dialog.showOpenDialog({
            filters: [{ name: 'KML Files', extensions: ['kml'] }],
            properties: ['openFile']
          })
          if (result.canceled || result.filePaths.length === 0) return { cancelled: true as const }
          return parseKmlFile(result.filePaths[0]!)
        },
        importFromPath: async (filePath) => parseKmlFile(filePath)
      },
      events: {}
    })
  )

  // MAVLink Console IPC module — commands target a vehicle; the `data` event
  // is emitted from per-vehicle `consoleData` listeners attached in
  // onVehicleAdded via the captured emit callback.
  disposers.push(
    registerIpcModule(mavConsoleModule, {
      commands: {
        write: async (vehicleId, text) => {
          const vehicle = vehicleManager.getVehicle(vehicleId)
          vehicle?.sendConsoleText(text)
        }
      },
      events: {
        data: (emit) => {
          emitMavConsoleData = emit
          return () => {
            emitMavConsoleData = null
          }
        }
      }
    })
  )

  // MAVLink Inspector IPC module — commands proxy to the inspector instance
  // above; emits are captured so the inspector's periodic pushes reach renderers.
  disposers.push(
    registerIpcModule(mavInspectorModule, {
      commands: {
        enable: async () => inspector.enable(),
        disable: async () => inspector.disable(),
        select: async (sysid, compid, msgid) => inspector.select(sysid, compid, msgid),
        deselect: async () => inspector.deselect()
      },
      events: {
        snapshot: (emit) => {
          emitInspectorSnapshot = emit
          return () => {
            emitInspectorSnapshot = () => {}
          }
        },
        fields: (emit) => {
          emitInspectorFields = emit
          return () => {
            emitInspectorFields = () => {}
          }
        }
      }
    })
  )

  // Calibration IPC module — commands target a vehicle; events are emitted
  // from per-vehicle calibrationManager listeners attached in onVehicleAdded
  // via the captured emit callbacks.
  disposers.push(
    registerIpcModule(calibrationModule, {
      commands: {
        start: async (vehicleId, sensor) => {
          vehicleManager.getVehicle(vehicleId)?.calibrationManager.startCalibration(sensor)
        },
        cancel: async (vehicleId) => {
          vehicleManager.getVehicle(vehicleId)?.calibrationManager.cancelCalibration()
        },
        getState: async (vehicleId) =>
          vehicleManager.getVehicle(vehicleId)?.calibrationManager.state ?? null
      },
      events: {
        stateChanged: (emit) => {
          emitCalibrationStateChanged = emit
          return () => {
            emitCalibrationStateChanged = () => {}
          }
        },
        magProgress: (emit) => {
          emitCalibrationMagProgress = emit
          return () => {
            emitCalibrationMagProgress = () => {}
          }
        },
        magReport: (emit) => {
          emitCalibrationMagReport = emit
          return () => {
            emitCalibrationMagReport = () => {}
          }
        }
      }
    })
  )

  // Delta tick: iterate all vehicles, broadcast to all windows
  const interval = setInterval(() => {
    const windows = BrowserWindow.getAllWindows()
    if (windows.length === 0) return

    let anySent = false
    for (const vehicle of vehicleManager.getAllVehicles()) {
      if (!vehicle.hasDirty()) continue
      const delta = vehicle.getDelta()
      const payload = { vehicleId: vehicle.sysid, delta, sentAt: Date.now() }
      for (const win of windows) {
        const wc = win.webContents
        if (!wc.isDestroyed()) wc.send(IpcEvents.VehicleDelta, payload)
      }
      anySent = true
    }

    if (anySent) {
      sentCount++
    } else {
      skippedCount++
    }

    const now = Date.now()
    if (now - lastLogTime >= 5000) {
      const total = sentCount + skippedCount
      const skipPct = total > 0 ? ((skippedCount / total) * 100).toFixed(1) : '0.0'
      log.log(
        `sent=${sentCount} skipped=${skippedCount} skip_ratio=${skipPct}% vehicles=${vehicleManager.vehicleCount}`
      )
      sentCount = 0
      skippedCount = 0
      lastLogTime = now
    }
  }, TICK_RATE_MS)

  // Register all IPC command handlers
  const handlers: IpcHandler[] = [
    {
      channel: IpcChannels.VehicleArm,
      handler: (vehicleId: number) => vehicleManager.getVehicle(vehicleId)?.arm()
    },
    {
      channel: IpcChannels.VehicleForceArm,
      handler: (vehicleId: number) => vehicleManager.getVehicle(vehicleId)?.forceArm()
    },
    {
      channel: IpcChannels.VehicleDisarm,
      handler: (vehicleId: number) => vehicleManager.getVehicle(vehicleId)?.disarm()
    },
    {
      channel: IpcChannels.VehicleSendMavCommand,
      handler: (req: MavCommandRequest) =>
        vehicleManager
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
    {
      channel: IpcChannels.VehicleSetFlightMode,
      handler: (req: FlightModeRequest) => {
        const vehicle = vehicleManager.getVehicle(req.vehicleId)
        if (!vehicle) return undefined
        const pm = vehicle.parameterManager
        const isPX4 = pm.getParameter('RC_MAP_FLTMODE') !== undefined
        const customMode = isPX4 ? resolvePx4Mode(req.modeName) : resolveArduMode(req.modeName)
        log.log(
          `setFlightMode vehicleId=${req.vehicleId} mode=${req.modeName} isPX4=${isPX4} customMode=${customMode}`
        )
        if (customMode < 0) {
          log.error(`setFlightMode: unknown mode name '${req.modeName}'`)
          return Promise.resolve(MavResult.UNSUPPORTED)
        }
        if (isPX4) {
          // PX4 requires SET_MODE message (id 11), not DO_SET_MODE command
          vehicle.sendSetMode(1, customMode) // 1 = MAV_MODE_FLAG_CUSTOM_MODE_ENABLED
          return Promise.resolve(MavResult.ACCEPTED)
        }
        return vehicle.commandQueue.sendCommand(
          common.MavCmd.DO_SET_MODE,
          req.vehicleId,
          0,
          { p1: 1, p2: customMode } // p1 = MAV_MODE_FLAG_CUSTOM_MODE_ENABLED, p2 = custom mode
        )
      }
    },
    {
      channel: IpcChannels.VehicleGuidedTakeoff,
      handler: (req: { vehicleId: number; altitude: number }) =>
        vehicleManager.getVehicle(req.vehicleId)?.guidedTakeoff(req.altitude)
    },
    {
      channel: IpcChannels.VehicleGuidedRTL,
      handler: (vehicleId: number) => vehicleManager.getVehicle(vehicleId)?.guidedRTL()
    },
    {
      channel: IpcChannels.VehicleGuidedLand,
      handler: (vehicleId: number) => vehicleManager.getVehicle(vehicleId)?.guidedLand()
    },
    {
      channel: IpcChannels.VehicleGuidedGoto,
      handler: (req: { vehicleId: number; lat: number; lon: number; alt: number }) =>
        vehicleManager.getVehicle(req.vehicleId)?.guidedGoto(req.lat, req.lon, req.alt)
    },
    {
      channel: IpcChannels.VehicleGuidedPause,
      handler: (vehicleId: number) => vehicleManager.getVehicle(vehicleId)?.guidedPause()
    },
    {
      channel: IpcChannels.VehicleMissionStart,
      handler: (vehicleId: number) => vehicleManager.getVehicle(vehicleId)?.missionStart()
    },
    {
      channel: IpcChannels.VehicleEmergencyStop,
      handler: (vehicleId: number) => vehicleManager.getVehicle(vehicleId)?.emergencyStop()
    },
    {
      channel: IpcChannels.VehicleGuidedChangeAltitude,
      handler: (req: { vehicleId: number; altitudeRel: number }) =>
        vehicleManager.getVehicle(req.vehicleId)?.guidedChangeAltitude(req.altitudeRel)
    },
    {
      channel: IpcChannels.VehicleGuidedChangeHeading,
      handler: (req: { vehicleId: number; headingDeg: number }) =>
        vehicleManager.getVehicle(req.vehicleId)?.guidedChangeHeading(req.headingDeg)
    },
    {
      channel: IpcChannels.VehicleGuidedChangeSpeed,
      handler: (req: { vehicleId: number; speed: number; speedType: 0 | 1 }) =>
        vehicleManager.getVehicle(req.vehicleId)?.guidedChangeSpeed(req.speed, req.speedType)
    },
    {
      channel: IpcChannels.VehicleGuidedOrbit,
      handler: (req: {
        vehicleId: number
        lat: number
        lon: number
        radius: number
        altitudeRel: number
      }) =>
        vehicleManager
          .getVehicle(req.vehicleId)
          ?.guidedOrbit(req.lat, req.lon, req.radius, req.altitudeRel)
    },
    {
      channel: IpcChannels.VehicleLandingGearDeploy,
      handler: (vehicleId: number) => vehicleManager.getVehicle(vehicleId)?.landingGearDeploy()
    },
    {
      channel: IpcChannels.VehicleLandingGearRetract,
      handler: (vehicleId: number) => vehicleManager.getVehicle(vehicleId)?.landingGearRetract()
    },
    {
      channel: IpcChannels.ParametersRefresh,
      handler: (...args: unknown[]) => {
        const vehicleId = args[0] as number
        const vehicle = vehicleManager.getVehicle(vehicleId)
        if (!vehicle) return
        vehicle.parameterManager.requestAllParameters()
      }
    },
    {
      channel: IpcChannels.ParametersSet,
      handler: (...args: unknown[]) => {
        const req = args[0] as {
          vehicleId: number
          componentId: number
          name: string
          value: number
        }
        const vehicle = vehicleManager.getVehicle(req.vehicleId)
        if (!vehicle) return
        vehicle.parameterManager.setParameter(req.name, req.value)
      }
    },
    {
      channel: IpcChannels.ParametersGetAll,
      handler: (...args: unknown[]) => {
        const vehicleId = args[0] as number
        const vehicle = vehicleManager.getVehicle(vehicleId)
        if (!vehicle) return []
        return vehicle.parameterManager.getAllParameters()
      }
    },
    {
      channel: IpcChannels.MissionLoad,
      handler: (vehicleId: number) => {
        const vehicle = vehicleManager.getVehicle(vehicleId)
        if (!vehicle) return Promise.resolve({ items: [], error: 'No vehicle' })
        return new Promise((resolve) => {
          const mm = vehicle.missionManager
          const onComplete = (items: MissionItem[]): void => {
            clearTimeout(timeout)
            mm.off('error', onError)
            resolve({ items })
          }
          const onError = (code: number): void => {
            clearTimeout(timeout)
            mm.off('loadComplete', onComplete)
            resolve({ items: [], error: `Error code ${code}` })
          }
          const timeout = setTimeout(() => {
            mm.off('loadComplete', onComplete)
            mm.off('error', onError)
            resolve({ items: [], error: 'Timeout' })
          }, 30000)
          mm.once('loadComplete', onComplete)
          mm.once('error', onError)
          mm.loadFromVehicle()
        })
      }
    },
    {
      channel: IpcChannels.MissionWrite,
      handler: (req: { vehicleId: number; items: MissionItem[] }) => {
        const vehicle = vehicleManager.getVehicle(req.vehicleId)
        if (!vehicle) return Promise.resolve({ error: 'No vehicle' })
        return new Promise((resolve) => {
          const mm = vehicle.missionManager
          const onComplete = (): void => {
            clearTimeout(timeout)
            mm.off('error', onError)
            resolve({ success: true })
          }
          const onError = (code: number): void => {
            clearTimeout(timeout)
            mm.off('writeComplete', onComplete)
            resolve({ error: `Error code ${code}` })
          }
          const timeout = setTimeout(() => {
            mm.off('writeComplete', onComplete)
            mm.off('error', onError)
            resolve({ error: 'Timeout' })
          }, 30000)
          mm.once('writeComplete', onComplete)
          mm.once('error', onError)
          mm.writeToVehicle(req.items)
        })
      }
    },
    {
      channel: IpcChannels.MissionSavePlan,
      handler: async (planData: PlanFile) => {
        const result = await dialog.showSaveDialog({
          filters: [{ name: 'Plan', extensions: ['plan'] }]
        })
        if (result.canceled || !result.filePath) return { cancelled: true }
        await savePlanFile(result.filePath, planData)
        return { filePath: result.filePath }
      }
    },
    {
      channel: IpcChannels.MissionOpenPlan,
      handler: async () => {
        const result = await dialog.showOpenDialog({
          filters: [{ name: 'Plan', extensions: ['plan'] }],
          properties: ['openFile']
        })
        if (result.canceled || result.filePaths.length === 0) return { cancelled: true }
        return loadPlanFile(result.filePaths[0]!)
      }
    },
    // Video: now owned by videoModule (src/shared-types/ipc/modules/video.ts)

    // Serial port enumeration
    {
      channel: IpcChannels.SerialListPorts,
      handler: async () => {
        const ports = await SerialPort.list()
        return ports.map((p) => ({
          path: p.path,
          manufacturer: p.manufacturer,
          serialNumber: p.serialNumber,
          vendorId: p.vendorId,
          productId: p.productId
        }))
      }
    },
    // Link management
    {
      channel: IpcChannels.LinksCreate,
      handler: async (config: LinkConfig) => {
        if (!linkManager) throw new Error('LinkManager not available')
        const link = await linkManager.createLink(config)
        return { id: link.id, status: link.status }
      }
    },
    {
      channel: IpcChannels.LinksDisconnect,
      handler: (id: string) => linkManager?.disconnectLink(id)
    },
    {
      channel: IpcChannels.LinksGetAll,
      handler: () => linkManager?.getAllStates() ?? []
    },
    // (Calibration: now registered via registerIpcModule above)
    // RC Calibration
    {
      channel: IpcChannels.RcCalibrationStart,
      handler: (vehicleId: number) => {
        vehicleManager.getVehicle(vehicleId)?.rcCalibrationManager.start()
      }
    },
    {
      channel: IpcChannels.RcCalibrationNextStep,
      handler: (vehicleId: number) => {
        vehicleManager.getVehicle(vehicleId)?.rcCalibrationManager.nextStep()
      }
    },
    {
      channel: IpcChannels.RcCalibrationCancel,
      handler: (vehicleId: number) => {
        vehicleManager.getVehicle(vehicleId)?.rcCalibrationManager.cancel()
      }
    },
    {
      channel: IpcChannels.RcCalibrationSave,
      handler: (vehicleId: number) => {
        return vehicleManager.getVehicle(vehicleId)?.rcCalibrationManager.save()
      }
    },
    // Firmware upgrade
    {
      channel: IpcChannels.FirmwareUploadFile,
      handler: async (req: { vehicleId: number; filePath: string }) => {
        const vehicle = vehicleManager.getVehicle(req.vehicleId)
        if (!vehicle) throw new Error('No vehicle')
        await vehicle.firmwareManager.uploadFile(req.filePath)
      }
    },
    {
      channel: IpcChannels.FirmwareCancel,
      handler: (vehicleId: number) => {
        vehicleManager.getVehicle(vehicleId)?.firmwareManager.cancel()
      }
    },
    {
      channel: IpcChannels.FirmwareReboot,
      handler: async (vehicleId: number) => {
        const vehicle = vehicleManager.getVehicle(vehicleId)
        if (!vehicle) throw new Error('No vehicle')
        await vehicle.firmwareManager.reboot()
      }
    },
    // Camera
    {
      channel: IpcChannels.CameraRequestInfo,
      handler: (vehicleId: number) => {
        vehicleManager.getVehicle(vehicleId)?.cameraManager.handleCameraHeartbeat()
      }
    },
    {
      channel: IpcChannels.CameraTakePhoto,
      handler: (vehicleId: number) => {
        vehicleManager.getVehicle(vehicleId)?.cameraManager.takePhoto()
      }
    },
    {
      channel: IpcChannels.CameraStopCapture,
      handler: (vehicleId: number) => {
        vehicleManager.getVehicle(vehicleId)?.cameraManager.stopCapture()
      }
    },
    {
      channel: IpcChannels.CameraStartRecording,
      handler: (vehicleId: number) => {
        vehicleManager.getVehicle(vehicleId)?.cameraManager.startRecording()
      }
    },
    {
      channel: IpcChannels.CameraStopRecording,
      handler: (vehicleId: number) => {
        vehicleManager.getVehicle(vehicleId)?.cameraManager.stopRecording()
      }
    },
    {
      channel: IpcChannels.CameraSetMode,
      handler: (req: { vehicleId: number; mode: number }) => {
        vehicleManager.getVehicle(req.vehicleId)?.cameraManager.setMode(req.mode as CameraMode)
      }
    },
    {
      channel: IpcChannels.CameraFormatStorage,
      handler: (req: { vehicleId: number; storageId?: number }) => {
        vehicleManager.getVehicle(req.vehicleId)?.cameraManager.formatStorage(req.storageId)
      }
    },
    {
      channel: IpcChannels.CameraGetState,
      handler: (vehicleId: number) => {
        return vehicleManager.getVehicle(vehicleId)?.cameraManager.state ?? null
      }
    },
    // Actuator testing — uses MAV_CMD_ACTUATOR_TEST (310).
    // Matches QGC implementation (src/Vehicle/Actuators/ActuatorTesting.cc):
    //   p1 = output value (-1.0..1.0 for servos, 0.0..1.0 for motors, NaN = stop)
    //   p2 = timeout in seconds (0 = stop immediately)
    //   p5 = 1000 + actuator function (loaded from vehicle metadata, defaults: motor1=101→1101, servo1=201→1201)
    // Must be refreshed every ~100ms or PX4 auto-stops the output.
    {
      channel: IpcChannels.ActuatorMotorTest,
      handler: (req: {
        vehicleId: number
        motorInstance: number
        throttlePercent: number
        timeoutSeconds: number
      }) => {
        const vehicle = vehicleManager.getVehicle(req.vehicleId)
        if (!vehicle) return
        const throttleFraction = req.throttlePercent > 0 ? req.throttlePercent / 100 : NaN
        const timeout = req.throttlePercent > 0 ? 1 : 0
        const actuatorFunction = vehicle.actuatorMetadata.motorFunction(req.motorInstance)
        return vehicle.commandQueue.sendCommand(
          310, // MAV_CMD_ACTUATOR_TEST
          req.vehicleId,
          1,
          { p1: throttleFraction, p2: timeout, p5: actuatorFunction }
        )
      }
    },
    {
      channel: IpcChannels.ActuatorServoTest,
      handler: (req: { vehicleId: number; servoInstance: number; pwmValue: number }) => {
        const vehicle = vehicleManager.getVehicle(req.vehicleId)
        if (!vehicle) return
        const normalized = (req.pwmValue - 1500) / 500
        const timeout = 1
        const actuatorFunction = vehicle.actuatorMetadata.servoFunction(req.servoInstance)
        return vehicle.commandQueue.sendCommand(
          310, // MAV_CMD_ACTUATOR_TEST
          req.vehicleId,
          1,
          { p1: normalized, p2: timeout, p5: actuatorFunction }
        )
      }
    },
    // (MAVLink Console: now registered via registerIpcModule above)
    // (MAVLink Inspector: now registered via registerIpcModule above)
    // (Forwarding: now registered via registerIpcModule above)
    {
      channel: IpcChannels.FirmwareGetBoardInfo,
      handler: (vehicleId: number) => {
        const vehicle = vehicleManager.getVehicle(vehicleId)
        if (!vehicle) return null
        const core = vehicle.state.getDelta().core
        return core
          ? {
              firmwareVersionMajor: core.firmwareVersionMajor,
              firmwareVersionMinor: core.firmwareVersionMinor,
              firmwareVersionPatch: core.firmwareVersionPatch,
              vehicleType: core.vehicleType,
              autopilot: core.autopilot
            }
          : null
      }
    }

    // (Radar: now registered via registerIpcModule above)
    // (Settings: now registered via registerIpcModule above)

    // (KML Import: now registered via registerIpcModule above)
  ]

  for (const { channel, handler } of handlers) {
    ipcMain.handle(channel, (_event, ...args) => handler(...args))
  }

  // Settings IPC module (getAll/set + changed event)
  if (settingsManager) {
    const sm = settingsManager
    disposers.push(
      registerIpcModule(settingsModule, {
        commands: {
          getAll: async () => sm.getAll(),
          set: async (key, value) => {
            sm.set(key as keyof AppSettings, value as never)
          }
        },
        events: {
          changed: (emit) => {
            const handler = (key: string, value: unknown): void => emit({ key, value })
            sm.on('changed', handler)
            return () => {
              sm.removeListener('changed', handler)
            }
          }
        }
      })
    )
  }

  return () => {
    inspector.disable()
    clearInterval(interval)
    for (const dispose of disposers) dispose()
    for (const { channel } of handlers) {
      ipcMain.removeHandler(channel)
    }
  }
}
