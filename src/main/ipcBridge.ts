import { ipcMain, dialog, BrowserWindow } from 'electron'
import type { VehicleManager } from './vehicle/VehicleManager'
import type { VideoManager } from './video/VideoManager'
import { IpcChannels } from '@shared/ipc/channels'
import { IpcEvents } from '@shared/ipc/events'
import type { IpcHandler } from '@shared/ipc/geo'
import type { MavCommandRequest, FlightModeRequest } from '@shared/ipc/MavCommandRequest'
import { VideoSourceType } from '@shared/ipc/VideoTypes'
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
  videoManager?: VideoManager
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
    }
  })

  vehicleManager.on('vehicleRemoved', (sysid: number) => {
    broadcast(IpcEvents.VehicleRemoved, { vehicleId: sysid })
  })

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
      channel: IpcChannels.ParametersRefresh,
      handler: () => console.log('[IPC] params refresh requested')
    },
    {
      channel: IpcChannels.ParametersSet,
      handler: () => console.log('[IPC] param set requested')
    },
    {
      channel: IpcChannels.ParametersGetAll,
      handler: () => ({})
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
