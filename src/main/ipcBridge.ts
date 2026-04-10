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
import { CalibrationSensor } from '@shared/ipc/SetupTypes'
import { CameraMode } from '@shared/ipc/CameraTypes'
import { savePlanFile, loadPlanFile } from './mission/PlanFileIO'
import { parseKmlFile } from './kml/KmlParser'
import type { MissionItem, PlanFile } from '@shared/ipc/MissionTypes'
import { MavlinkInspector } from './mavlink/MavlinkInspector'
import type { MavlinkForwarder } from './forwarding/MavlinkForwarder'
import type { SettingsManager } from './settings/SettingsManager'
import type { RadarManager } from './radar/RadarManager'
import { createLogger } from './logger'

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
  const inspector = new MavlinkInspector(broadcast)
  vehicleManager.onRawMessage = inspector.handleMessage

  // Forward renderer logs to main process log file
  const rendererLog = createLogger('renderer')
  ipcMain.on(
    'renderer:log',
    (_event, { level, tag, message }: { level: string; tag: string; message: string }) => {
      const tagged = `[${tag}] ${message}`
      if (level === 'error') rendererLog.error(tagged)
      else if (level === 'warn') rendererLog.warn(tagged)
      else rendererLog.log(tagged)
    }
  )

  let sentCount = 0
  let skippedCount = 0
  let lastLogTime = Date.now()

  // Forward vehicle lifecycle events to all renderer windows
  vehicleManager.on('vehicleAdded', (sysid: number) => {
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

      // Forward calibration events
      vehicle.calibrationManager.on('stateChanged', (state) => {
        broadcast(IpcEvents.CalibrationStateChanged, { vehicleId: sysid, state })
      })
      vehicle.calibrationManager.on('magProgress', (progress) => {
        broadcast(IpcEvents.CalibrationMagProgress, { vehicleId: sysid, ...progress })
      })
      vehicle.calibrationManager.on('magReport', (report) => {
        broadcast(IpcEvents.CalibrationMagReport, { vehicleId: sysid, ...report })
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
      vehicle.on('consoleData', (payload: { text: string }) => {
        broadcast(IpcEvents.MavConsoleData, { vehicleId: sysid, ...payload })
      })
    }
  })

  vehicleManager.on('vehicleRemoved', (sysid: number) => {
    broadcast(IpcEvents.VehicleRemoved, { vehicleId: sysid })
  })

  // Forward link state changes to all renderer windows
  if (linkManager) {
    linkManager.on('linkStateChanged', () => {
      broadcast(IpcEvents.LinkStateChanged, linkManager.getAllStates())
    })
  }

  // Forward video state changes to all renderer windows
  if (videoManager) {
    videoManager.on('stateChanged', (state) => {
      broadcast(IpcEvents.VideoStateChanged, state)
    })
  }

  // Forward MAVLink forwarding state changes to all renderer windows
  if (forwarder) {
    forwarder.on('stateChanged', (state) => {
      broadcast(IpcEvents.ForwardingStateChanged, state)
    })
  }

  // Forward radar state changes to all renderer windows
  if (radarManager) {
    radarManager.on('stateChanged', (state) => {
      broadcast(IpcEvents.RadarStateChanged, state)
    })
  }

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
        if (!vehicle) return { items: [], error: 'No vehicle' }
        return new Promise((resolve) => {
          const timeout = setTimeout(() => {
            vehicle.missionManager.removeAllListeners('loadComplete')
            vehicle.missionManager.removeAllListeners('error')
            resolve({ items: [], error: 'Timeout' })
          }, 30000)
          vehicle.missionManager.once('loadComplete', (items: MissionItem[]) => {
            clearTimeout(timeout)
            resolve({ items })
          })
          vehicle.missionManager.once('error', (code: number) => {
            clearTimeout(timeout)
            resolve({ items: [], error: `Error code ${code}` })
          })
          vehicle.missionManager.loadFromVehicle()
        })
      }
    },
    {
      channel: IpcChannels.MissionWrite,
      handler: (req: { vehicleId: number; items: MissionItem[] }) => {
        const vehicle = vehicleManager.getVehicle(req.vehicleId)
        log.log(
          `missionWrite vehicleId=${req.vehicleId} items=${req.items?.length ?? 0} vehicleFound=${!!vehicle} hasLink=${!!(vehicle?.missionManager as unknown as Record<string, unknown>)?.link}`
        )
        if (!vehicle) return { error: 'No vehicle' }
        return new Promise((resolve) => {
          const timeout = setTimeout(() => {
            log.log(`missionWrite TIMEOUT for vehicle ${req.vehicleId}`)
            vehicle.missionManager.removeAllListeners('writeComplete')
            vehicle.missionManager.removeAllListeners('error')
            resolve({ error: 'Timeout' })
          }, 30000)
          vehicle.missionManager.once('writeComplete', () => {
            log.log(`missionWrite COMPLETE for vehicle ${req.vehicleId}`)
            clearTimeout(timeout)
            resolve({ success: true })
          })
          vehicle.missionManager.once('error', (code: number) => {
            log.log(`missionWrite ERROR code=${code} for vehicle ${req.vehicleId}`)
            clearTimeout(timeout)
            resolve({ error: `Error code ${code}` })
          })
          vehicle.missionManager.writeToVehicle(req.items)
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
    // Video streaming
    {
      channel: IpcChannels.VideoStart,
      handler: (req: { sourceType: string; uri: string }) => {
        videoManager?.start(req.sourceType as VideoSourceType, req.uri)
      }
    },
    {
      channel: IpcChannels.VideoStop,
      handler: () => videoManager?.stop()
    },
    {
      channel: IpcChannels.VideoStartRecording,
      handler: (filePath: string) => videoManager?.startRecording(filePath)
    },
    {
      channel: IpcChannels.VideoStopRecording,
      handler: () => videoManager?.stopRecording()
    },
    {
      channel: IpcChannels.VideoGetState,
      handler: () => videoManager?.state ?? null
    },
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
    // Calibration
    {
      channel: IpcChannels.CalibrationStart,
      handler: (req: { vehicleId: number; sensor: string }) => {
        const vehicle = vehicleManager.getVehicle(req.vehicleId)
        if (!vehicle) return
        vehicle.calibrationManager.startCalibration(req.sensor as CalibrationSensor)
      }
    },
    {
      channel: IpcChannels.CalibrationCancel,
      handler: (vehicleId: number) => {
        vehicleManager.getVehicle(vehicleId)?.calibrationManager.cancelCalibration()
      }
    },
    {
      channel: IpcChannels.CalibrationGetState,
      handler: (vehicleId: number) => {
        return vehicleManager.getVehicle(vehicleId)?.calibrationManager.state ?? null
      }
    },
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
    // Flight Modes
    {
      channel: IpcChannels.FlightModesGet,
      handler: (vehicleId: number) => {
        const vehicle = vehicleManager.getVehicle(vehicleId)
        if (!vehicle) return null
        const pm = vehicle.parameterManager
        // Detect PX4 vs ArduPilot by checking for PX4-specific param
        const isPX4 = pm.getParameter('RC_MAP_FLTMODE') !== undefined
        const chParam = isPX4 ? 'RC_MAP_FLTMODE' : 'FLTMODE_CH'
        const modePrefix = isPX4 ? 'COM_FLTMODE' : 'FLTMODE'
        const modeChannel = pm.getParameter(chParam)?.value ?? (isPX4 ? 0 : 5)
        const modes: Array<{ slot: number; modeNumber: number; modeName: string }> = []
        for (let i = 1; i <= 6; i++) {
          const modeNum = pm.getParameter(`${modePrefix}${i}`)?.value ?? (isPX4 ? -1 : 0)
          modes.push({ slot: i, modeNumber: modeNum, modeName: '' })
        }
        return { modeChannel, modes, activeSlot: 0 }
      }
    },
    {
      channel: IpcChannels.FlightModesSet,
      handler: (req: {
        vehicleId: number
        config: { modeChannel: number; modes: Array<{ slot: number; modeNumber: number }> }
      }) => {
        const vehicle = vehicleManager.getVehicle(req.vehicleId)
        if (!vehicle) return
        const pm = vehicle.parameterManager
        // Detect PX4 vs ArduPilot by checking for PX4-specific param
        const isPX4 = pm.getParameter('RC_MAP_FLTMODE') !== undefined
        const chParam = isPX4 ? 'RC_MAP_FLTMODE' : 'FLTMODE_CH'
        const modePrefix = isPX4 ? 'COM_FLTMODE' : 'FLTMODE'
        pm.setParameter(chParam, req.config.modeChannel)
        for (const mode of req.config.modes) {
          pm.setParameter(`${modePrefix}${mode.slot}`, mode.modeNumber)
        }
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
    // MAVLink Console
    {
      channel: IpcChannels.MavConsoleWrite,
      handler: (req: { vehicleId: number; text: string }) => {
        const vehicle = vehicleManager.getVehicle(req.vehicleId)
        if (!vehicle) return
        vehicle.sendConsoleText(req.text)
      }
    },
    // MAVLink Inspector
    {
      channel: IpcChannels.MavInspectorEnable,
      handler: () => inspector.enable()
    },
    {
      channel: IpcChannels.MavInspectorDisable,
      handler: () => inspector.disable()
    },
    {
      channel: IpcChannels.MavInspectorSelect,
      handler: (req: { sysid: number; compid: number; msgid: number }) =>
        inspector.select(req.sysid, req.compid, req.msgid)
    },
    {
      channel: IpcChannels.MavInspectorDeselect,
      handler: () => inspector.deselect()
    },
    // MAVLink Forwarding
    {
      channel: IpcChannels.ForwardingGetState,
      handler: () => forwarder?.getState() ?? { enabled: false, targets: [] }
    },
    {
      channel: IpcChannels.ForwardingAddTarget,
      handler: (req: { host: string; port: number }) => {
        if (!forwarder) throw new Error('Forwarder not available')
        return forwarder.addTarget(req.host, req.port)
      }
    },
    {
      channel: IpcChannels.ForwardingRemoveTarget,
      handler: (id: string) => forwarder?.removeTarget(id)
    },
    {
      channel: IpcChannels.ForwardingSetEnabled,
      handler: (enabled: boolean) => forwarder?.setEnabled(enabled)
    },
    {
      channel: IpcChannels.ForwardingSetTargetEnabled,
      handler: (req: { id: string; enabled: boolean }) =>
        forwarder?.setTargetEnabled(req.id, req.enabled)
    },
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
    },

    // Radar
    {
      channel: IpcChannels.RadarEnable,
      handler: () => radarManager?.enable()
    },
    {
      channel: IpcChannels.RadarDisable,
      handler: () => radarManager?.disable()
    },
    {
      channel: IpcChannels.RadarGetState,
      handler: () =>
        radarManager?.getState() ?? {
          enabled: false,
          units: [],
          tracks: [],
          simulationActive: false
        }
    },
    {
      channel: IpcChannels.RadarSetSimPosition,
      handler: (req: { lat: number; lon: number }) =>
        radarManager?.setSimulationPosition(req.lat, req.lon)
    },

    // Settings
    {
      channel: IpcChannels.SettingsGetAll,
      handler: () => settingsManager?.getAll()
    },
    {
      channel: IpcChannels.SettingsSet,
      handler: (req: { key: string; value: unknown }) => {
        if (settingsManager) {
          settingsManager.set(
            req.key as keyof import('@shared/ipc/AppSettings').AppSettings,
            req.value as never
          )
        }
      }
    },

    // KML Import
    {
      channel: IpcChannels.KmlImport,
      handler: async () => {
        const result = await dialog.showOpenDialog({
          filters: [{ name: 'KML Files', extensions: ['kml'] }],
          properties: ['openFile']
        })
        if (result.canceled || result.filePaths.length === 0) return { cancelled: true }
        return parseKmlFile(result.filePaths[0]!)
      }
    },
    {
      channel: IpcChannels.KmlImportFromPath,
      handler: (filePath: string) => parseKmlFile(filePath)
    }
  ]

  for (const { channel, handler } of handlers) {
    ipcMain.handle(channel, (_event, ...args) => handler(...args))
  }

  // Broadcast settings changes to renderer
  const onSettingsChanged = (key: string, value: unknown): void => {
    broadcast(IpcEvents.SettingsChanged, { key, value })
  }
  settingsManager?.on('changed', onSettingsChanged)

  return () => {
    inspector.disable()
    clearInterval(interval)
    settingsManager?.removeListener('changed', onSettingsChanged)
    for (const { channel } of handlers) {
      ipcMain.removeHandler(channel)
    }
  }
}
