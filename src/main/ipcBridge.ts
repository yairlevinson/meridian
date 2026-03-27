import { ipcMain, dialog, BrowserWindow } from 'electron'
import type { VehicleManager } from './vehicle/VehicleManager'
import type { VideoManager } from './video/VideoManager'
import type { LinkManager } from './links/LinkManager'
import { SerialPort } from 'serialport'
import { IpcChannels } from '@shared/ipc/channels'
import { IpcEvents } from '@shared/ipc/events'
import type { IpcHandler } from '@shared/ipc/geo'
import type { MavCommandRequest, FlightModeRequest } from '@shared/ipc/MavCommandRequest'
import type { LinkConfig } from '@shared/ipc/LinkState'
import { VideoSourceType } from '@shared/ipc/VideoTypes'
import { CalibrationSensor } from '@shared/ipc/SetupTypes'
import { savePlanFile, loadPlanFile } from './mission/PlanFileIO'
import type { MissionItem, PlanFile } from '@shared/ipc/MissionTypes'

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
  linkManager?: LinkManager
): () => void {
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
      console.log(
        `[IPC] sent=${sentCount} skipped=${skippedCount} skip_ratio=${skipPct}% vehicles=${vehicleManager.vehicleCount}`
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
        console.log(
          `[IPC] setFlightMode vehicleId=${req.vehicleId} mode=${req.modeName} vehicleFound=${!!vehicle} pendingCmds=${vehicle?.commandQueue.pendingCount ?? 'N/A'}`
        )
        return vehicle?.commandQueue.sendCommand(
          176, // MAV_CMD_DO_SET_MODE
          req.vehicleId,
          0,
          { p1: 1, p2: Number(req.modeName) } // p1 = MAV_MODE_FLAG_CUSTOM_MODE_ENABLED, p2 = custom mode
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
        const req = args[0] as { vehicleId: number; componentId: number; name: string; value: number }
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
        console.log(
          `[IPC] missionWrite vehicleId=${req.vehicleId} items=${req.items?.length ?? 0} vehicleFound=${!!vehicle} hasLink=${!!(vehicle?.missionManager as unknown as Record<string, unknown>)?.link}`
        )
        if (!vehicle) return { error: 'No vehicle' }
        return new Promise((resolve) => {
          const timeout = setTimeout(() => {
            console.log(`[IPC] missionWrite TIMEOUT for vehicle ${req.vehicleId}`)
            vehicle.missionManager.removeAllListeners('writeComplete')
            vehicle.missionManager.removeAllListeners('error')
            resolve({ error: 'Timeout' })
          }, 30000)
          vehicle.missionManager.once('writeComplete', () => {
            console.log(`[IPC] missionWrite COMPLETE for vehicle ${req.vehicleId}`)
            clearTimeout(timeout)
            resolve({ success: true })
          })
          vehicle.missionManager.once('error', (code: number) => {
            console.log(`[IPC] missionWrite ERROR code=${code} for vehicle ${req.vehicleId}`)
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
          filters: [{ name: 'QGC Plan', extensions: ['plan'] }]
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
          filters: [{ name: 'QGC Plan', extensions: ['plan'] }],
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
        const modeChannel = pm.getParameter('FLTMODE_CH')?.value ?? 5
        const modes: Array<{ slot: number; modeNumber: number; modeName: string }> = []
        for (let i = 1; i <= 6; i++) {
          const modeNum = pm.getParameter(`FLTMODE${i}`)?.value ?? 0
          modes.push({ slot: i, modeNumber: modeNum, modeName: '' })
        }
        return { modeChannel, modes, activeSlot: 0 }
      }
    },
    {
      channel: IpcChannels.FlightModesSet,
      handler: (req: { vehicleId: number; config: { modeChannel: number; modes: Array<{ slot: number; modeNumber: number }> } }) => {
        const vehicle = vehicleManager.getVehicle(req.vehicleId)
        if (!vehicle) return
        const pm = vehicle.parameterManager
        pm.setParameter('FLTMODE_CH', req.config.modeChannel)
        for (const mode of req.config.modes) {
          pm.setParameter(`FLTMODE${mode.slot}`, mode.modeNumber)
        }
      }
    }
  ]

  for (const { channel, handler } of handlers) {
    ipcMain.handle(channel, (_event, ...args) => handler(...args))
  }

  return () => {
    clearInterval(interval)
    for (const { channel } of handlers) {
      ipcMain.removeHandler(channel)
    }
  }
}
