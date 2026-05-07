import { ipcMain, dialog, BrowserWindow } from 'electron'
import type { EventEmitter } from 'events'
import type { VehicleManager } from './vehicle/VehicleManager'
import type { VideoManager } from './video/VideoManager'
import type { LinkManager } from './links/LinkManager'
import { savePlanFile, loadPlanFile } from '../core/mission/PlanFileIO'
import type { MissionItem } from '@shared/ipc/MissionTypes'
import { MavlinkInspector } from '../runtime/mavlink/MavlinkInspector'
import { createMavInspectorCommandHandlers } from '../core/mavlink/MavInspectorCommandHandlers'
import type { MavlinkForwarder } from './forwarding/MavlinkForwarder'
import type { SettingsManager } from './settings/SettingsManager'
import type { RadarProxy } from './radar/RadarProxy'
import type {
  TargetTrackingManager,
  TrackingEngagementChangedPayload,
  TrackingEngagementLostPayload
} from './tracking/TargetTrackingManager'
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
import { rcCalibrationModule } from '@shared/ipc/modules/rcCalibration'
import { firmwareModule } from '@shared/ipc/modules/firmware'
import { cameraModule, type CameraImageCapturedPayload } from '@shared/ipc/modules/camera'
import { actuatorModule } from '@shared/ipc/modules/actuator'
import { linksModule } from '@shared/ipc/modules/links'
import { vehicleModule } from '@shared/ipc/modules/vehicle'
import { missionModule } from '@shared/ipc/modules/mission'
import { parametersModule } from '@shared/ipc/modules/parameters'
import type { VideoStreamState } from '@shared/ipc/VideoTypes'
import { VehicleTelemetryPublisher } from '../runtime/vehicle/VehicleTelemetryPublisher'
import { createVehicleCommandHandlers } from '../core/vehicle/VehicleCommandHandlers'
import { createSettingsCommandHandlers } from '../core/settings/SettingsCommandHandlers'
import { createVideoCommandHandlers } from '../core/video/VideoCommandHandlers'
import { createLinksCommandHandlers } from '../core/links/LinksCommandHandlers'
import {
  createForwardingCommandHandlers,
  createRadarCommandHandlers
} from '../core/operations/OperationCommandHandlers'
import { createCameraCommandHandlers } from '../core/camera/CameraCommandHandlers'
import {
  createCalibrationCommandHandlers,
  createRcCalibrationCommandHandlers
} from '../core/calibration/CalibrationCommandHandlers'
import { createFirmwareCommandHandlers } from '../core/firmware/FirmwareCommandHandlers'
import {
  createActuatorCommandHandlers,
  createMavConsoleCommandHandlers
} from '../core/vehicle/VehicleToolsCommandHandlers'
import type {
  CalibrationState,
  MagCalProgress,
  MagCalReport,
  RcCalibrationState,
  FirmwareUpgradeState
} from '@shared/ipc/SetupTypes'
import type { CameraState } from '@shared/ipc/CameraTypes'
import type {
  InspectorSnapshotPayload,
  InspectorFieldsPayload
} from '@shared/ipc/MavInspectorTypes'
import type { Parameter, ParameterLoadState } from '@shared/ipc/ParameterTypes'
import { createParameterCommandHandlers } from '../core/parameters/ParameterCommandHandlers'
import { createMissionCommandHandlers } from '../core/mission/MissionCommandHandlers'
import { createKmlCommandHandlers } from '../core/maps/KmlCommandHandlers'

export function startIpcBridge(
  vehicleManager: VehicleManager,
  videoManager?: VideoManager,
  linkManager?: LinkManager,
  forwarder?: MavlinkForwarder,
  settingsManager?: SettingsManager,
  radarManager?: RadarProxy,
  trackingManager?: TargetTrackingManager
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

  // Captured by rcCalibrationModule event wire so per-vehicle rcCalibration
  // manager events can fan out through the module's emit (registered below).
  let emitRcCalibrationStateChanged: (p: {
    vehicleId: number
    state: RcCalibrationState
  }) => void = () => {}

  // Captured by firmwareModule event wire so per-vehicle firmwareManager
  // events can fan out through the module's emit (registered below).
  let emitFirmwareUpgradeStateChanged: (p: {
    vehicleId: number
    state: FirmwareUpgradeState
  }) => void = () => {}

  // Captured by cameraModule event wires so per-vehicle cameraManager
  // events can fan out through the module's emit (registered below).
  let emitCameraStateChanged: (p: { vehicleId: number; state: CameraState }) => void = () => {}
  let emitCameraImageCaptured: (p: CameraImageCapturedPayload) => void = () => {}

  // Captured by linksModule event wire so linkManager state changes can fan
  // out through the module's emit (registered below).
  let emitLinksStateChanged: (
    states: import('@shared/ipc/LinkState').LinkState[]
  ) => void = () => {}

  // Captured by vehicleModule event wires so vehicle lifecycle/telemetry
  // events can fan out through the module's emit (registered below).
  let emitVehicleAdded: (p: { vehicleId: number }) => void = () => {}
  let emitVehicleRemoved: (p: { vehicleId: number }) => void = () => {}
  let emitVehicleDelta: (
    p: import('@shared/ipc/VehicleState').VehicleDeltaPayload
  ) => void = () => {}
  let emitVehicleStatusText: (p: {
    vehicleId: number
    severity: number
    text: string
  }) => void = () => {}
  let emitVehicleTrackingChanged: (p: TrackingEngagementChangedPayload) => void = () => {}
  let emitVehicleTrackingLost: (p: TrackingEngagementLostPayload) => void = () => {}

  // Captured by missionModule event wires so per-vehicle missionManager events
  // can fan out through the module's emit (registered below).
  let emitMissionProgress: (p: {
    vehicleId: number
    current: number
    total: number
  }) => void = () => {}
  let emitMissionComplete: (p: { vehicleId: number; items: MissionItem[] }) => void = () => {}
  let emitMissionCurrentChanged: (p: { vehicleId: number; seq: number }) => void = () => {}

  // Captured by parametersModule event wires so per-vehicle parameterManager events
  // can fan out through the module's emit (registered below).
  let emitParameterChanged: (p: { vehicleId: number; parameter: Parameter }) => void = () => {}
  let emitParametersReady: (p: { vehicleId: number }) => void = () => {}
  let emitParametersProgress: (p: {
    vehicleId: number
    loadState: ParameterLoadState
  }) => void = () => {}

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

  const vehicleListenerDisposers = new Map<number, () => void>()

  const attachVehicleListeners = (sysid: number): void => {
    if (vehicleListenerDisposers.has(sysid)) return
    const vehicle = vehicleManager.getVehicle(sysid)
    if (!vehicle) return

    const disposersForVehicle: Array<() => void> = []
    const addListener = (
      target: Pick<EventEmitter, 'on' | 'removeListener'>,
      event: string,
      listener: Parameters<EventEmitter['on']>[1]
    ): void => {
      target.on(event, listener)
      disposersForVehicle.push(() => target.removeListener(event, listener))
    }

    addListener(vehicle.missionManager, 'progress', (p: { current: number; total: number }) => {
      emitMissionProgress({ vehicleId: sysid, ...p })
    })
    addListener(vehicle.missionManager, 'loadComplete', (items: MissionItem[]) => {
      emitMissionComplete({ vehicleId: sysid, items })
    })
    addListener(vehicle.missionManager, 'currentChanged', (seq: number) => {
      emitMissionCurrentChanged({ vehicleId: sysid, seq })
    })

    addListener(vehicle.parameterManager, 'parameterReceived', (param: Parameter) => {
      emitParameterChanged({ vehicleId: sysid, parameter: param })
    })
    addListener(vehicle.parameterManager, 'parametersReady', () => {
      emitParametersReady({ vehicleId: sysid })
    })
    addListener(vehicle.parameterManager, 'progress', (loadState: ParameterLoadState) => {
      emitParametersProgress({ vehicleId: sysid, loadState })
    })

    addListener(vehicle, 'statusText', (payload: { severity: number; text: string }) => {
      emitVehicleStatusText({ vehicleId: sysid, ...payload })
    })

    addListener(vehicle.calibrationManager, 'stateChanged', (state: CalibrationState) => {
      emitCalibrationStateChanged({ vehicleId: sysid, state })
    })
    addListener(vehicle.calibrationManager, 'magProgress', (progress: MagCalProgress) => {
      emitCalibrationMagProgress({ vehicleId: sysid, ...progress })
    })
    addListener(vehicle.calibrationManager, 'magReport', (report: MagCalReport) => {
      emitCalibrationMagReport({ vehicleId: sysid, ...report })
    })

    addListener(vehicle.rcCalibrationManager, 'stateChanged', (state: RcCalibrationState) => {
      emitRcCalibrationStateChanged({ vehicleId: sysid, state })
    })

    addListener(vehicle.firmwareManager, 'stateChanged', (state: FirmwareUpgradeState) => {
      emitFirmwareUpgradeStateChanged({ vehicleId: sysid, state })
    })

    addListener(vehicle.cameraManager, 'stateChanged', (state: CameraState) => {
      emitCameraStateChanged({ vehicleId: sysid, state })
    })
    addListener(
      vehicle.cameraManager,
      'imageCaptured',
      (data: Omit<CameraImageCapturedPayload, 'vehicleId'>) => {
        emitCameraImageCaptured({ vehicleId: sysid, ...data })
      }
    )

    addListener(vehicle, 'consoleData', (payload: { text: string }) => {
      emitMavConsoleData?.({ vehicleId: sysid, ...payload })
    })

    vehicleListenerDisposers.set(sysid, () => {
      for (const dispose of disposersForVehicle) dispose()
    })
  }

  const detachVehicleListeners = (sysid: number): void => {
    vehicleListenerDisposers.get(sysid)?.()
    vehicleListenerDisposers.delete(sysid)
  }

  // Forward vehicle lifecycle events to all renderer windows
  const onVehicleAdded = (sysid: number): void => {
    emitVehicleAdded({ vehicleId: sysid })
    attachVehicleListeners(sysid)
  }
  vehicleManager.on('vehicleAdded', onVehicleAdded)
  disposers.push(() => vehicleManager.removeListener('vehicleAdded', onVehicleAdded))

  const onVehicleRemoved = (sysid: number): void => {
    emitVehicleRemoved({ vehicleId: sysid })
    detachVehicleListeners(sysid)
  }
  vehicleManager.on('vehicleRemoved', onVehicleRemoved)
  disposers.push(() => vehicleManager.removeListener('vehicleRemoved', onVehicleRemoved))

  // Forward link state changes to all renderer windows via linksModule's captured emit
  if (linkManager) {
    const lm = linkManager
    const onLinkStateChanged = (): void => {
      emitLinksStateChanged(lm.getAllStates())
    }
    lm.on('linkStateChanged', onLinkStateChanged)
    disposers.push(() => lm.removeListener('linkStateChanged', onLinkStateChanged))
  }

  // Video IPC module (commands + stateChanged event)
  if (videoManager) {
    const vm = videoManager
    disposers.push(
      registerIpcModule(videoModule, {
        commands: createVideoCommandHandlers(vm),
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
        commands: createForwardingCommandHandlers(fw),
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
        commands: createRadarCommandHandlers(rm),
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
      commands: createKmlCommandHandlers({
        pickImportFile: async () => {
          const result = await dialog.showOpenDialog({
            filters: [{ name: 'KML Files', extensions: ['kml'] }],
            properties: ['openFile']
          })
          if (result.canceled || result.filePaths.length === 0) return null
          return result.filePaths[0]!
        }
      }),
      events: {}
    })
  )

  // MAVLink Console IPC module — commands target a vehicle; the `data` event
  // is emitted from per-vehicle `consoleData` listeners attached in
  // onVehicleAdded via the captured emit callback.
  disposers.push(
    registerIpcModule(mavConsoleModule, {
      commands: createMavConsoleCommandHandlers(vehicleManager),
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
      commands: createMavInspectorCommandHandlers(inspector),
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
      commands: createCalibrationCommandHandlers(vehicleManager),
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

  // RC Calibration IPC module — commands target a vehicle; stateChanged is
  // emitted from per-vehicle rcCalibrationManager listeners via captured emit.
  disposers.push(
    registerIpcModule(rcCalibrationModule, {
      commands: createRcCalibrationCommandHandlers(vehicleManager),
      events: {
        stateChanged: (emit) => {
          emitRcCalibrationStateChanged = emit
          return () => {
            emitRcCalibrationStateChanged = () => {}
          }
        }
      }
    })
  )

  // Firmware IPC module — commands target a vehicle; upgradeStateChanged is
  // emitted from per-vehicle firmwareManager listeners via captured emit.
  disposers.push(
    registerIpcModule(firmwareModule, {
      commands: createFirmwareCommandHandlers(vehicleManager),
      events: {
        upgradeStateChanged: (emit) => {
          emitFirmwareUpgradeStateChanged = emit
          return () => {
            emitFirmwareUpgradeStateChanged = () => {}
          }
        }
      }
    })
  )

  // Camera IPC module — commands target a vehicle; events fan out from
  // per-vehicle cameraManager listeners via captured emits.
  disposers.push(
    registerIpcModule(cameraModule, {
      commands: createCameraCommandHandlers(vehicleManager),
      events: {
        stateChanged: (emit) => {
          emitCameraStateChanged = emit
          return () => {
            emitCameraStateChanged = () => {}
          }
        },
        imageCaptured: (emit) => {
          emitCameraImageCaptured = emit
          return () => {
            emitCameraImageCaptured = () => {}
          }
        }
      }
    })
  )

  // Actuator testing IPC module — commands target a vehicle; no events.
  // Uses MAV_CMD_ACTUATOR_TEST (310). Matches QGC implementation:
  //   p1 = output value (-1.0..1.0 for servos, 0.0..1.0 for motors, NaN = stop)
  //   p2 = timeout in seconds (0 = stop immediately)
  //   p5 = 1000 + actuator function
  // Must be refreshed every ~100ms or PX4 auto-stops the output.
  disposers.push(
    registerIpcModule(actuatorModule, {
      commands: createActuatorCommandHandlers(vehicleManager),
      events: {}
    })
  )

  // Links IPC module — commands manage link lifecycle; stateChanged fans out
  // linkManager state changes via captured emit (wired above).
  disposers.push(
    registerIpcModule(linksModule, {
      commands: createLinksCommandHandlers(linkManager ?? null),
      events: {
        stateChanged: (emit) => {
          emitLinksStateChanged = emit
          return () => {
            emitLinksStateChanged = () => {}
          }
        }
      }
    })
  )

  // Delta tick: iterate all vehicles, broadcast to all windows
  const telemetryPublisher = new VehicleTelemetryPublisher(vehicleManager, {
    shouldPublish: () => BrowserWindow.getAllWindows().length > 0
  })
  telemetryPublisher.on('delta', (payload) => emitVehicleDelta(payload))

  // Vehicle command + telemetry IPC module.
  // Commands target a vehicle via sysid; events (added/removed/delta/statusText)
  // are fanned out through the captured emits wired in above.
  disposers.push(
    registerIpcModule(vehicleModule, {
      commands: createVehicleCommandHandlers(vehicleManager, trackingManager ?? null),
      events: {
        added: (emit) => {
          emitVehicleAdded = emit
          return () => {
            emitVehicleAdded = () => {}
          }
        },
        removed: (emit) => {
          emitVehicleRemoved = emit
          return () => {
            emitVehicleRemoved = () => {}
          }
        },
        delta: (emit) => {
          emitVehicleDelta = emit
          return () => {
            emitVehicleDelta = () => {}
          }
        },
        statusText: (emit) => {
          emitVehicleStatusText = emit
          return () => {
            emitVehicleStatusText = () => {}
          }
        },
        trackingChanged: (emit) => {
          emitVehicleTrackingChanged = emit
          return () => {
            emitVehicleTrackingChanged = () => {}
          }
        },
        trackingLost: (emit) => {
          emitVehicleTrackingLost = emit
          return () => {
            emitVehicleTrackingLost = () => {}
          }
        }
      }
    })
  )

  // Wire tracking manager events to the captured emits. Must be after the
  // vehicleModule registration so emits are bound (registerIpcModule invokes
  // the event factories synchronously).
  if (trackingManager) {
    const tm = trackingManager
    const onTrackingChanged = (p: TrackingEngagementChangedPayload): void => {
      emitVehicleTrackingChanged(p)
    }
    const onTrackingLost = (p: TrackingEngagementLostPayload): void => {
      emitVehicleTrackingLost(p)
    }
    tm.on('engagementChanged', onTrackingChanged)
    tm.on('engagementLost', onTrackingLost)
    disposers.push(() => {
      tm.removeListener('engagementChanged', onTrackingChanged)
      tm.removeListener('engagementLost', onTrackingLost)
    })
  }

  // Mission IPC module — commands target a vehicle's missionManager; events
  // are fanned out through the captured emits wired in onVehicleAdded above.
  disposers.push(
    registerIpcModule(missionModule, {
      commands: createMissionCommandHandlers(vehicleManager, {
        savePlan: async (planData) => {
          const result = await dialog.showSaveDialog({
            filters: [{ name: 'Plan', extensions: ['plan'] }]
          })
          if (result.canceled || !result.filePath) return { cancelled: true as const }
          await savePlanFile(result.filePath, planData)
          return { filePath: result.filePath }
        },
        openPlan: async () => {
          const result = await dialog.showOpenDialog({
            filters: [{ name: 'Plan', extensions: ['plan'] }],
            properties: ['openFile']
          })
          if (result.canceled || result.filePaths.length === 0) return { cancelled: true as const }
          return loadPlanFile(result.filePaths[0]!)
        }
      }),
      events: {
        progress: (emit) => {
          emitMissionProgress = emit
          return () => {
            emitMissionProgress = () => {}
          }
        },
        complete: (emit) => {
          emitMissionComplete = emit
          return () => {
            emitMissionComplete = () => {}
          }
        },
        currentChanged: (emit) => {
          emitMissionCurrentChanged = emit
          return () => {
            emitMissionCurrentChanged = () => {}
          }
        }
      }
    })
  )

  disposers.push(
    registerIpcModule(parametersModule, {
      commands: createParameterCommandHandlers(vehicleManager),
      events: {
        changed: (emit) => {
          emitParameterChanged = emit
          return () => {
            emitParameterChanged = () => {}
          }
        },
        ready: (emit) => {
          emitParametersReady = emit
          return () => {
            emitParametersReady = () => {}
          }
        },
        progress: (emit) => {
          emitParametersProgress = emit
          return () => {
            emitParametersProgress = () => {}
          }
        }
      }
    })
  )

  // All IPC commands are now registered via registerIpcModule() above.

  // Settings IPC module (getAll/set + changed event)
  if (settingsManager) {
    const sm = settingsManager
    disposers.push(
      registerIpcModule(settingsModule, {
        commands: createSettingsCommandHandlers(sm),
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
    telemetryPublisher.dispose()
    for (const dispose of vehicleListenerDisposers.values()) dispose()
    vehicleListenerDisposers.clear()
    for (const dispose of disposers) dispose()
  }
}
