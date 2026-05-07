import { ipcMain, dialog, BrowserWindow } from 'electron'
import type { VehicleManager } from './vehicle/VehicleManager'
import type { VideoManager } from './video/VideoManager'
import type { LinkManager } from './links/LinkManager'
import { SerialPort } from 'serialport'
import { VideoSourceType } from '@shared/ipc/VideoTypes'
import { CameraMode } from '@shared/ipc/CameraTypes'
import { savePlanFile, loadPlanFile } from './mission/PlanFileIO'
import { parseKmlFile } from './kml/KmlParser'
import type { MissionItem } from '@shared/ipc/MissionTypes'
import { MavlinkInspector } from './mavlink/MavlinkInspector'
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
import { VehicleTelemetryPublisher } from './vehicle/VehicleTelemetryPublisher'
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
import type { AppSettings } from '@shared/ipc/AppSettings'
import type { Parameter, ParameterLoadState } from '@shared/ipc/ParameterTypes'

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

  // Forward vehicle lifecycle events to all renderer windows
  const onVehicleAdded = (sysid: number): void => {
    emitVehicleAdded({ vehicleId: sysid })
    const vehicle = vehicleManager.getVehicle(sysid)
    if (vehicle) {
      vehicle.missionManager.on('progress', (p: { current: number; total: number }) => {
        emitMissionProgress({ vehicleId: sysid, ...p })
      })
      vehicle.missionManager.on('loadComplete', (items: MissionItem[]) => {
        emitMissionComplete({ vehicleId: sysid, items })
      })
      vehicle.missionManager.on('currentChanged', (seq: number) => {
        emitMissionCurrentChanged({ vehicleId: sysid, seq })
      })

      // Forward parameter events via parametersModule's captured emits
      vehicle.parameterManager.on('parameterReceived', (param) => {
        emitParameterChanged({ vehicleId: sysid, parameter: param })
      })
      vehicle.parameterManager.on('parametersReady', () => {
        emitParametersReady({ vehicleId: sysid })
      })
      vehicle.parameterManager.on('progress', (loadState) => {
        emitParametersProgress({ vehicleId: sysid, loadState })
      })

      // Forward STATUSTEXT
      vehicle.on('statusText', (payload: { severity: number; text: string }) => {
        emitVehicleStatusText({ vehicleId: sysid, ...payload })
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

      // Forward RC calibration events via rcCalibrationModule's captured emit
      vehicle.rcCalibrationManager.on('stateChanged', (state) => {
        emitRcCalibrationStateChanged({ vehicleId: sysid, state })
      })

      // Forward firmware upgrade events via firmwareModule's captured emit
      vehicle.firmwareManager.on('stateChanged', (state) => {
        emitFirmwareUpgradeStateChanged({ vehicleId: sysid, state })
      })

      // Forward camera events via cameraModule's captured emits
      vehicle.cameraManager.on('stateChanged', (state) => {
        emitCameraStateChanged({ vehicleId: sysid, state })
      })
      vehicle.cameraManager.on('imageCaptured', (data) => {
        emitCameraImageCaptured({ vehicleId: sysid, ...data })
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
    emitVehicleRemoved({ vehicleId: sysid })
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
        commands: {
          start: (sourceType, uri) => {
            vm.start(sourceType as VideoSourceType, uri)
          },
          stop: () => {
            vm.stop()
          },
          startRecording: (fileName) => {
            return { filePath: vm.startRecording(fileName) }
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

  // RC Calibration IPC module — commands target a vehicle; stateChanged is
  // emitted from per-vehicle rcCalibrationManager listeners via captured emit.
  disposers.push(
    registerIpcModule(rcCalibrationModule, {
      commands: {
        start: async (vehicleId) => {
          vehicleManager.getVehicle(vehicleId)?.rcCalibrationManager.start()
        },
        nextStep: async (vehicleId) => {
          vehicleManager.getVehicle(vehicleId)?.rcCalibrationManager.nextStep()
        },
        cancel: async (vehicleId) => {
          vehicleManager.getVehicle(vehicleId)?.rcCalibrationManager.cancel()
        },
        save: async (vehicleId) => {
          await vehicleManager.getVehicle(vehicleId)?.rcCalibrationManager.save()
        }
      },
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
      commands: {
        uploadFile: async (vehicleId, filePath) => {
          const vehicle = vehicleManager.getVehicle(vehicleId)
          if (!vehicle) throw new Error('No vehicle')
          await vehicle.firmwareManager.uploadFile(filePath)
        },
        uploadData: async (vehicleId, fileName, dataBase64) => {
          const vehicle = vehicleManager.getVehicle(vehicleId)
          if (!vehicle) throw new Error('No vehicle')
          await vehicle.firmwareManager.uploadData(fileName, Buffer.from(dataBase64, 'base64'))
        },
        cancel: async (vehicleId) => {
          vehicleManager.getVehicle(vehicleId)?.firmwareManager.cancel()
        },
        reboot: async (vehicleId) => {
          const vehicle = vehicleManager.getVehicle(vehicleId)
          if (!vehicle) throw new Error('No vehicle')
          await vehicle.firmwareManager.reboot()
        },
        getBoardInfo: async (vehicleId) => {
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
      commands: {
        requestInfo: async (vehicleId) => {
          vehicleManager.getVehicle(vehicleId)?.cameraManager.handleCameraHeartbeat()
        },
        takePhoto: async (vehicleId) => {
          vehicleManager.getVehicle(vehicleId)?.cameraManager.takePhoto()
        },
        stopCapture: async (vehicleId) => {
          vehicleManager.getVehicle(vehicleId)?.cameraManager.stopCapture()
        },
        startRecording: async (vehicleId) => {
          vehicleManager.getVehicle(vehicleId)?.cameraManager.startRecording()
        },
        stopRecording: async (vehicleId) => {
          vehicleManager.getVehicle(vehicleId)?.cameraManager.stopRecording()
        },
        setMode: async (vehicleId, mode) => {
          vehicleManager.getVehicle(vehicleId)?.cameraManager.setMode(mode as CameraMode)
        },
        formatStorage: async (vehicleId, storageId) => {
          vehicleManager.getVehicle(vehicleId)?.cameraManager.formatStorage(storageId)
        },
        getState: async (vehicleId) =>
          vehicleManager.getVehicle(vehicleId)?.cameraManager.state ?? null
      },
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
      commands: {
        motorTest: async (vehicleId, motorInstance, throttlePercent, _timeoutSeconds) => {
          const vehicle = vehicleManager.getVehicle(vehicleId)
          if (!vehicle) return
          const throttleFraction = throttlePercent > 0 ? throttlePercent / 100 : NaN
          const timeout = throttlePercent > 0 ? 1 : 0
          const actuatorFunction = vehicle.actuatorMetadata.motorFunction(motorInstance)
          await vehicle.commandQueue.sendCommand(310, vehicleId, 1, {
            p1: throttleFraction,
            p2: timeout,
            p5: actuatorFunction
          })
        },
        servoTest: async (vehicleId, servoInstance, pwmValue) => {
          const vehicle = vehicleManager.getVehicle(vehicleId)
          if (!vehicle) return
          const normalized = (pwmValue - 1500) / 500
          const timeout = 1
          const actuatorFunction = vehicle.actuatorMetadata.servoFunction(servoInstance)
          await vehicle.commandQueue.sendCommand(310, vehicleId, 1, {
            p1: normalized,
            p2: timeout,
            p5: actuatorFunction
          })
        }
      },
      events: {}
    })
  )

  // Links IPC module — commands manage link lifecycle; stateChanged fans out
  // linkManager state changes via captured emit (wired above).
  disposers.push(
    registerIpcModule(linksModule, {
      commands: {
        create: async (config) => {
          if (!linkManager) throw new Error('LinkManager not available')
          const link = await linkManager.createLink(config)
          return { id: link.id, status: link.status }
        },
        disconnect: async (id) => {
          linkManager?.disconnectLink(id)
        },
        getAll: async () => linkManager?.getAllStates() ?? [],
        listSerialPorts: async () => {
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
      commands: {
        arm: async (vehicleId) => {
          await vehicleManager.getVehicle(vehicleId)?.arm()
        },
        forceArm: async (vehicleId) => {
          await vehicleManager.getVehicle(vehicleId)?.forceArm()
        },
        disarm: async (vehicleId) => {
          await vehicleManager.getVehicle(vehicleId)?.disarm()
        },
        sendMavCommand: async (req) => {
          await vehicleManager
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
        setFlightMode: async (vehicleId, modeName) =>
          vehicleManager.getVehicle(vehicleId)?.setFlightModeByName(modeName),
        guidedTakeoff: async (vehicleId, altitude) =>
          vehicleManager.getVehicle(vehicleId)?.guidedTakeoff(altitude),
        guidedRTL: async (vehicleId) => {
          await vehicleManager.getVehicle(vehicleId)?.guidedRTL()
        },
        guidedLand: async (vehicleId) => {
          await vehicleManager.getVehicle(vehicleId)?.guidedLand()
        },
        guidedGoto: async (vehicleId, lat, lon, alt) => {
          await vehicleManager.getVehicle(vehicleId)?.guidedGoto(lat, lon, alt)
        },
        guidedPause: async (vehicleId) => {
          await vehicleManager.getVehicle(vehicleId)?.guidedPause()
        },
        missionStart: async (vehicleId) => {
          await vehicleManager.getVehicle(vehicleId)?.missionStart()
        },
        emergencyStop: async (vehicleId) => {
          await vehicleManager.getVehicle(vehicleId)?.emergencyStop()
        },
        guidedChangeAltitude: async (vehicleId, altitudeRel) =>
          vehicleManager.getVehicle(vehicleId)?.guidedChangeAltitude(altitudeRel),
        guidedChangeHeading: async (vehicleId, headingDeg) =>
          vehicleManager.getVehicle(vehicleId)?.guidedChangeHeading(headingDeg),
        guidedChangeSpeed: async (vehicleId, speed, speedType) =>
          vehicleManager.getVehicle(vehicleId)?.guidedChangeSpeed(speed, speedType),
        guidedOrbit: async (vehicleId, lat, lon, radius, altitudeRel) =>
          vehicleManager.getVehicle(vehicleId)?.guidedOrbit(lat, lon, radius, altitudeRel),
        landingGearDeploy: async (vehicleId) =>
          vehicleManager.getVehicle(vehicleId)?.landingGearDeploy(),
        landingGearRetract: async (vehicleId) =>
          vehicleManager.getVehicle(vehicleId)?.landingGearRetract(),
        trackingEngage: async (vehicleId, trackId) => {
          if (!trackingManager) return { ok: false, error: 'Tracking manager not available' }
          return trackingManager.engage(vehicleId, trackId)
        },
        trackingDisengage: async (vehicleId) => {
          trackingManager?.disengage(vehicleId)
        },
        trackingGetEngagement: async (vehicleId) =>
          trackingManager?.getEngagement(vehicleId) ?? null
      },
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
      commands: {
        load: async (vehicleId) => {
          const vehicle = vehicleManager.getVehicle(vehicleId)
          if (!vehicle) return { items: [], error: 'No vehicle' }
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
        },
        write: async (vehicleId, items) => {
          const vehicle = vehicleManager.getVehicle(vehicleId)
          if (!vehicle) return { error: 'No vehicle' }
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
            mm.writeToVehicle(items)
          })
        },
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
      },
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
      commands: {
        getAll: (vehicleId) => {
          const vehicle = vehicleManager.getVehicle(vehicleId)
          if (!vehicle) return []
          return vehicle.parameterManager.getAllParameters()
        },
        set: (vehicleId, name, value) => {
          const vehicle = vehicleManager.getVehicle(vehicleId)
          if (!vehicle) return
          vehicle.parameterManager.setParameter(name, value)
        },
        refresh: (vehicleId) => {
          const vehicle = vehicleManager.getVehicle(vehicleId)
          if (!vehicle) return
          vehicle.parameterManager.requestAllParameters()
        }
      },
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
    telemetryPublisher.dispose()
    for (const dispose of disposers) dispose()
  }
}
