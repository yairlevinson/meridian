import { contextBridge, ipcRenderer } from 'electron'
import type { VehicleDeltaPayload } from '../shared-types/ipc/VehicleState'
import { IpcChannels } from '../shared-types/ipc/channels'
import { IpcEvents } from '../shared-types/ipc/events'
import type { MavCommandRequest } from '../shared-types/ipc/MavCommandRequest'
import type { LinkConfig, LinkState, SerialPortInfo } from '../shared-types/ipc/LinkState'
import type { Parameter, ParameterLoadState } from '../shared-types/ipc/ParameterTypes'
import type { RcCalibrationState, FirmwareUpgradeState } from '../shared-types/ipc/SetupTypes'
import type { CameraState } from '../shared-types/ipc/CameraTypes'
import { radarModule } from '../shared-types/ipc/modules/radar'
import { forwardingModule } from '../shared-types/ipc/modules/forwarding'
import { settingsModule } from '../shared-types/ipc/modules/settings'
import { kmlModule } from '../shared-types/ipc/modules/kml'
import { mavConsoleModule } from '../shared-types/ipc/modules/mavConsole'
import { mavInspectorModule } from '../shared-types/ipc/modules/mavInspector'
import { popoutModule } from '../shared-types/ipc/modules/popout'
import { videoModule } from '../shared-types/ipc/modules/video'
import { calibrationModule } from '../shared-types/ipc/modules/calibration'
import type { ModuleBridge } from '../shared-types/ipc/ipcModule'
import { bindIpcModule } from './moduleBridge'

export interface Bridge
  extends
    ModuleBridge<typeof radarModule>,
    ModuleBridge<typeof forwardingModule>,
    ModuleBridge<typeof settingsModule>,
    ModuleBridge<typeof kmlModule>,
    ModuleBridge<typeof mavConsoleModule>,
    ModuleBridge<typeof mavInspectorModule>,
    ModuleBridge<typeof popoutModule>,
    ModuleBridge<typeof videoModule>,
    ModuleBridge<typeof calibrationModule> {
  onVehicleDelta: (cb: (payload: VehicleDeltaPayload) => void) => () => void
  onVehicleAdded: (cb: (payload: { vehicleId: number }) => void) => () => void
  onVehicleRemoved: (cb: (payload: { vehicleId: number }) => void) => () => void
  arm: (vehicleId: number) => Promise<void>
  forceArm: (vehicleId: number) => Promise<void>
  disarm: (vehicleId: number) => Promise<void>
  sendMavCommand: (req: MavCommandRequest) => Promise<void>
  setFlightMode: (vehicleId: number, modeName: string) => Promise<number | undefined>
  guidedTakeoff: (vehicleId: number, altitude: number) => Promise<number | undefined>
  guidedRTL: (vehicleId: number) => Promise<void>
  guidedLand: (vehicleId: number) => Promise<void>
  guidedGoto: (vehicleId: number, lat: number, lon: number, alt: number) => Promise<void>
  guidedPause: (vehicleId: number) => Promise<void>
  missionStart: (vehicleId: number) => Promise<void>
  emergencyStop: (vehicleId: number) => Promise<void>
  guidedChangeAltitude: (vehicleId: number, altitudeRel: number) => Promise<number | undefined>
  guidedChangeHeading: (vehicleId: number, headingDeg: number) => Promise<number | undefined>
  guidedChangeSpeed: (
    vehicleId: number,
    speed: number,
    speedType: 0 | 1
  ) => Promise<number | undefined>
  guidedOrbit: (
    vehicleId: number,
    lat: number,
    lon: number,
    radius: number,
    altitudeRel: number
  ) => Promise<number | undefined>
  landingGearDeploy: (vehicleId: number) => Promise<number | undefined>
  landingGearRetract: (vehicleId: number) => Promise<number | undefined>
  onStatusText: (
    cb: (payload: { vehicleId: number; severity: number; text: string }) => void
  ) => () => void
  onCommandResult: (
    cb: (payload: { vehicleId: number; command: number; result: number }) => void
  ) => () => void
  getParameters: (vehicleId: number) => Promise<unknown>
  setParameter: (vehicleId: number, name: string, value: number) => Promise<void>
  refreshParameters: (vehicleId: number) => Promise<void>
  missionLoad: (vehicleId: number) => Promise<{
    items: import('../shared-types/ipc/MissionTypes').MissionItem[]
    error?: string
  }>
  missionWrite: (
    vehicleId: number,
    items: import('../shared-types/ipc/MissionTypes').MissionItem[]
  ) => Promise<{ success: true } | { error: string }>
  savePlan: (planData: unknown) => Promise<{ filePath: string } | { cancelled: true }>
  openPlan: () => Promise<unknown>
  onMissionProgress: (
    cb: (payload: { vehicleId: number; current: number; total: number }) => void
  ) => () => void
  onMissionComplete: (
    cb: (payload: {
      vehicleId: number
      items: import('../shared-types/ipc/MissionTypes').MissionItem[]
    }) => void
  ) => () => void
  onMissionCurrentChanged: (cb: (payload: { vehicleId: number; seq: number }) => void) => () => void

  // Video: generated from videoModule (videoStart, videoStop, videoStartRecording,
  //   videoStopRecording, videoGetState, onVideoStateChanged)

  // Links
  serialListPorts: () => Promise<SerialPortInfo[]>
  linksCreate: (config: LinkConfig) => Promise<{ id: string; status: string }>
  linksDisconnect: (id: string) => Promise<void>
  linksGetAll: () => Promise<LinkState[]>
  onLinkStateChanged: (cb: (states: LinkState[]) => void) => () => void

  // Parameters (events)
  onParameterChanged: (
    cb: (payload: { vehicleId: number; parameter: Parameter }) => void
  ) => () => void
  onParametersReady: (cb: (payload: { vehicleId: number }) => void) => () => void
  onParametersProgress: (
    cb: (payload: { vehicleId: number; loadState: ParameterLoadState }) => void
  ) => () => void

  // Calibration: generated from calibrationModule (calibrationStart, calibrationCancel,
  //   calibrationGetState, onCalibrationStateChanged, onCalibrationMagProgress,
  //   onCalibrationMagReport)

  // RC Calibration
  rcCalibrationStart: (vehicleId: number) => Promise<void>
  rcCalibrationNextStep: (vehicleId: number) => Promise<void>
  rcCalibrationCancel: (vehicleId: number) => Promise<void>
  rcCalibrationSave: (vehicleId: number) => Promise<void>
  onRcCalibrationStateChanged: (
    cb: (payload: { vehicleId: number; state: RcCalibrationState }) => void
  ) => () => void

  // Firmware
  firmwareUploadFile: (vehicleId: number, filePath: string) => Promise<void>
  firmwareCancel: (vehicleId: number) => Promise<void>
  firmwareReboot: (vehicleId: number) => Promise<void>
  firmwareGetBoardInfo: (vehicleId: number) => Promise<unknown>
  onFirmwareUpgradeStateChanged: (
    cb: (payload: { vehicleId: number; state: FirmwareUpgradeState }) => void
  ) => () => void

  // Camera
  cameraRequestInfo: (vehicleId: number) => Promise<void>
  cameraTakePhoto: (vehicleId: number) => Promise<void>
  cameraStopCapture: (vehicleId: number) => Promise<void>
  cameraStartRecording: (vehicleId: number) => Promise<void>
  cameraStopRecording: (vehicleId: number) => Promise<void>
  cameraSetMode: (vehicleId: number, mode: number) => Promise<void>
  cameraFormatStorage: (vehicleId: number, storageId?: number) => Promise<void>
  cameraGetState: (vehicleId: number) => Promise<CameraState | null>
  onCameraStateChanged: (
    cb: (payload: { vehicleId: number; state: CameraState }) => void
  ) => () => void
  onCameraImageCaptured: (
    cb: (payload: {
      vehicleId: number
      lat: number
      lon: number
      alt: number
      imageIndex: number
      captureResult: number
    }) => void
  ) => () => void

  // Actuator testing
  motorTest: (
    vehicleId: number,
    motorInstance: number,
    throttlePercent: number,
    timeoutSeconds: number
  ) => Promise<void>
  servoTest: (vehicleId: number, servoInstance: number, pwmValue: number) => Promise<void>

  // Popout: generated from popoutModule (popoutOpen, popoutClose, onPopoutClosed)

  // MAVLink Inspector: generated from mavInspectorModule (mavInspectorEnable,
  //   mavInspectorDisable, mavInspectorSelect, mavInspectorDeselect,
  //   onMavInspectorSnapshot, onMavInspectorFields)

  // Radar: generated from radarModule (radarEnable, radarDisable, radarGetState,
  //   radarSetSimPosition, onRadarStateChanged)

  // Settings: generated from settingsModule (settingsGetAll, settingsSet, onSettingsChanged)

  // Renderer → main process logging (written to ~/meridian-app.log)
  log: (level: 'info' | 'warn' | 'error' | 'debug', tag: string, message: string) => void
}

const bridge: Bridge = {
  ...bindIpcModule(radarModule),
  onVehicleDelta: (cb) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: VehicleDeltaPayload): void =>
      cb(payload)
    ipcRenderer.on('vehicle:delta', handler)
    return () => {
      ipcRenderer.removeListener('vehicle:delta', handler)
    }
  },
  onVehicleAdded: (cb) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: { vehicleId: number }): void =>
      cb(payload)
    ipcRenderer.on('vehicle:added', handler)
    return () => {
      ipcRenderer.removeListener('vehicle:added', handler)
    }
  },
  onVehicleRemoved: (cb) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: { vehicleId: number }): void =>
      cb(payload)
    ipcRenderer.on('vehicle:removed', handler)
    return () => {
      ipcRenderer.removeListener('vehicle:removed', handler)
    }
  },
  arm: (vehicleId) => ipcRenderer.invoke(IpcChannels.VehicleArm, vehicleId),
  forceArm: (vehicleId) => ipcRenderer.invoke(IpcChannels.VehicleForceArm, vehicleId),
  disarm: (vehicleId) => ipcRenderer.invoke(IpcChannels.VehicleDisarm, vehicleId),
  sendMavCommand: (req) => ipcRenderer.invoke(IpcChannels.VehicleSendMavCommand, req),
  setFlightMode: (vehicleId, modeName) =>
    ipcRenderer.invoke(IpcChannels.VehicleSetFlightMode, { vehicleId, modeName }),
  guidedTakeoff: (vehicleId, altitude) =>
    ipcRenderer.invoke(IpcChannels.VehicleGuidedTakeoff, { vehicleId, altitude }),
  guidedRTL: (vehicleId) => ipcRenderer.invoke(IpcChannels.VehicleGuidedRTL, vehicleId),
  guidedLand: (vehicleId) => ipcRenderer.invoke(IpcChannels.VehicleGuidedLand, vehicleId),
  guidedGoto: (vehicleId, lat, lon, alt) =>
    ipcRenderer.invoke(IpcChannels.VehicleGuidedGoto, { vehicleId, lat, lon, alt }),
  guidedPause: (vehicleId) => ipcRenderer.invoke(IpcChannels.VehicleGuidedPause, vehicleId),
  missionStart: (vehicleId) => ipcRenderer.invoke(IpcChannels.VehicleMissionStart, vehicleId),
  emergencyStop: (vehicleId) => ipcRenderer.invoke(IpcChannels.VehicleEmergencyStop, vehicleId),
  guidedChangeAltitude: (vehicleId, altitudeRel) =>
    ipcRenderer.invoke(IpcChannels.VehicleGuidedChangeAltitude, { vehicleId, altitudeRel }),
  guidedChangeHeading: (vehicleId, headingDeg) =>
    ipcRenderer.invoke(IpcChannels.VehicleGuidedChangeHeading, { vehicleId, headingDeg }),
  guidedChangeSpeed: (vehicleId, speed, speedType) =>
    ipcRenderer.invoke(IpcChannels.VehicleGuidedChangeSpeed, { vehicleId, speed, speedType }),
  guidedOrbit: (vehicleId, lat, lon, radius, altitudeRel) =>
    ipcRenderer.invoke(IpcChannels.VehicleGuidedOrbit, {
      vehicleId,
      lat,
      lon,
      radius,
      altitudeRel
    }),
  landingGearDeploy: (vehicleId) =>
    ipcRenderer.invoke(IpcChannels.VehicleLandingGearDeploy, vehicleId),
  landingGearRetract: (vehicleId) =>
    ipcRenderer.invoke(IpcChannels.VehicleLandingGearRetract, vehicleId),
  onStatusText: (cb) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: { vehicleId: number; severity: number; text: string }
    ): void => cb(payload)
    ipcRenderer.on('statustext', handler)
    return () => {
      ipcRenderer.removeListener('statustext', handler)
    }
  },
  onCommandResult: (cb) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: { vehicleId: number; command: number; result: number }
    ): void => cb(payload)
    ipcRenderer.on('command:result', handler)
    return () => {
      ipcRenderer.removeListener('command:result', handler)
    }
  },
  getParameters: (vehicleId) => ipcRenderer.invoke(IpcChannels.ParametersGetAll, vehicleId),
  setParameter: (vehicleId, name, value) =>
    ipcRenderer.invoke(IpcChannels.ParametersSet, { vehicleId, componentId: 1, name, value }),
  refreshParameters: (vehicleId) => ipcRenderer.invoke(IpcChannels.ParametersRefresh, vehicleId),
  missionLoad: (vehicleId) => ipcRenderer.invoke(IpcChannels.MissionLoad, vehicleId),
  missionWrite: (vehicleId, items) =>
    ipcRenderer.invoke(IpcChannels.MissionWrite, { vehicleId, items }),
  savePlan: (planData) => ipcRenderer.invoke(IpcChannels.MissionSavePlan, planData),
  openPlan: () => ipcRenderer.invoke(IpcChannels.MissionOpenPlan),
  onMissionProgress: (cb) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: { vehicleId: number; current: number; total: number }
    ): void => cb(payload)
    ipcRenderer.on('mission:progress', handler)
    return () => {
      ipcRenderer.removeListener('mission:progress', handler)
    }
  },
  onMissionComplete: (cb) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: { vehicleId: number; items: unknown[] }
    ): void =>
      cb(
        payload as {
          vehicleId: number
          items: import('../shared-types/ipc/MissionTypes').MissionItem[]
        }
      )
    ipcRenderer.on(IpcEvents.MissionComplete, handler)
    return () => {
      ipcRenderer.removeListener(IpcEvents.MissionComplete, handler)
    }
  },
  onMissionCurrentChanged: (cb) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: { vehicleId: number; seq: number }
    ): void => cb(payload)
    ipcRenderer.on('mission:currentChanged', handler)
    return () => {
      ipcRenderer.removeListener('mission:currentChanged', handler)
    }
  },

  // Video methods are spread in from bindIpcModule(videoModule) below.

  // Links
  serialListPorts: () => ipcRenderer.invoke(IpcChannels.SerialListPorts),
  linksCreate: (config) => ipcRenderer.invoke(IpcChannels.LinksCreate, config),
  linksDisconnect: (id) => ipcRenderer.invoke(IpcChannels.LinksDisconnect, id),
  linksGetAll: () => ipcRenderer.invoke(IpcChannels.LinksGetAll),
  onLinkStateChanged: (cb) => {
    const handler = (_event: Electron.IpcRendererEvent, states: LinkState[]): void => cb(states)
    ipcRenderer.on(IpcEvents.LinkStateChanged, handler)
    return () => {
      ipcRenderer.removeListener(IpcEvents.LinkStateChanged, handler)
    }
  },

  // Parameters (events)
  onParameterChanged: (cb) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: { vehicleId: number; parameter: Parameter }
    ): void => cb(payload)
    ipcRenderer.on(IpcEvents.ParameterChanged, handler)
    return () => {
      ipcRenderer.removeListener(IpcEvents.ParameterChanged, handler)
    }
  },
  onParametersReady: (cb) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: { vehicleId: number }): void =>
      cb(payload)
    ipcRenderer.on(IpcEvents.ParametersReady, handler)
    return () => {
      ipcRenderer.removeListener(IpcEvents.ParametersReady, handler)
    }
  },
  onParametersProgress: (cb) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: { vehicleId: number; loadState: ParameterLoadState }
    ): void => cb(payload)
    ipcRenderer.on(IpcEvents.ParametersProgress, handler)
    return () => {
      ipcRenderer.removeListener(IpcEvents.ParametersProgress, handler)
    }
  },

  // Calibration methods are spread in from bindIpcModule(calibrationModule) below.

  // RC Calibration
  rcCalibrationStart: (vehicleId) => ipcRenderer.invoke(IpcChannels.RcCalibrationStart, vehicleId),
  rcCalibrationNextStep: (vehicleId) =>
    ipcRenderer.invoke(IpcChannels.RcCalibrationNextStep, vehicleId),
  rcCalibrationCancel: (vehicleId) =>
    ipcRenderer.invoke(IpcChannels.RcCalibrationCancel, vehicleId),
  rcCalibrationSave: (vehicleId) => ipcRenderer.invoke(IpcChannels.RcCalibrationSave, vehicleId),
  onRcCalibrationStateChanged: (cb) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: { vehicleId: number; state: RcCalibrationState }
    ): void => cb(payload)
    ipcRenderer.on(IpcEvents.RcCalibrationStateChanged, handler)
    return () => {
      ipcRenderer.removeListener(IpcEvents.RcCalibrationStateChanged, handler)
    }
  },

  // Firmware
  firmwareUploadFile: (vehicleId, filePath) =>
    ipcRenderer.invoke(IpcChannels.FirmwareUploadFile, { vehicleId, filePath }),
  firmwareCancel: (vehicleId) => ipcRenderer.invoke(IpcChannels.FirmwareCancel, vehicleId),
  firmwareReboot: (vehicleId) => ipcRenderer.invoke(IpcChannels.FirmwareReboot, vehicleId),
  firmwareGetBoardInfo: (vehicleId) =>
    ipcRenderer.invoke(IpcChannels.FirmwareGetBoardInfo, vehicleId),
  onFirmwareUpgradeStateChanged: (cb) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: { vehicleId: number; state: FirmwareUpgradeState }
    ): void => cb(payload)
    ipcRenderer.on(IpcEvents.FirmwareUpgradeStateChanged, handler)
    return () => {
      ipcRenderer.removeListener(IpcEvents.FirmwareUpgradeStateChanged, handler)
    }
  },

  // Camera
  cameraRequestInfo: (vehicleId) => ipcRenderer.invoke(IpcChannels.CameraRequestInfo, vehicleId),
  cameraTakePhoto: (vehicleId) => ipcRenderer.invoke(IpcChannels.CameraTakePhoto, vehicleId),
  cameraStopCapture: (vehicleId) => ipcRenderer.invoke(IpcChannels.CameraStopCapture, vehicleId),
  cameraStartRecording: (vehicleId) =>
    ipcRenderer.invoke(IpcChannels.CameraStartRecording, vehicleId),
  cameraStopRecording: (vehicleId) =>
    ipcRenderer.invoke(IpcChannels.CameraStopRecording, vehicleId),
  cameraSetMode: (vehicleId, mode) =>
    ipcRenderer.invoke(IpcChannels.CameraSetMode, { vehicleId, mode }),
  cameraFormatStorage: (vehicleId, storageId) =>
    ipcRenderer.invoke(IpcChannels.CameraFormatStorage, { vehicleId, storageId }),
  cameraGetState: (vehicleId) => ipcRenderer.invoke(IpcChannels.CameraGetState, vehicleId),
  onCameraStateChanged: (cb) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: { vehicleId: number; state: CameraState }
    ): void => cb(payload)
    ipcRenderer.on(IpcEvents.CameraStateChanged, handler)
    return () => {
      ipcRenderer.removeListener(IpcEvents.CameraStateChanged, handler)
    }
  },
  onCameraImageCaptured: (cb) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: {
        vehicleId: number
        lat: number
        lon: number
        alt: number
        imageIndex: number
        captureResult: number
      }
    ): void => cb(payload)
    ipcRenderer.on(IpcEvents.CameraImageCaptured, handler)
    return () => {
      ipcRenderer.removeListener(IpcEvents.CameraImageCaptured, handler)
    }
  },

  // Actuator testing
  motorTest: (vehicleId, motorInstance, throttlePercent, timeoutSeconds) =>
    ipcRenderer.invoke(IpcChannels.ActuatorMotorTest, {
      vehicleId,
      motorInstance,
      throttlePercent,
      timeoutSeconds
    }),
  servoTest: (vehicleId, servoInstance, pwmValue) =>
    ipcRenderer.invoke(IpcChannels.ActuatorServoTest, { vehicleId, servoInstance, pwmValue }),

  // Popout methods are spread in from bindIpcModule(popoutModule) below.

  // MAVLink Inspector methods are spread in from bindIpcModule(mavInspectorModule) below.

  // Radar methods are spread in from bindIpcModule(radarModule) below.

  // Settings methods are spread in from bindIpcModule(settingsModule) below.

  // Renderer → main process logging
  log: (level, tag, message) => {
    ipcRenderer.send('renderer:log', { level, tag, message })
  },

  ...bindIpcModule(forwardingModule),
  ...bindIpcModule(settingsModule),
  ...bindIpcModule(kmlModule),
  ...bindIpcModule(mavConsoleModule),
  ...bindIpcModule(mavInspectorModule),
  ...bindIpcModule(popoutModule),
  ...bindIpcModule(videoModule),
  ...bindIpcModule(calibrationModule)
}

contextBridge.exposeInMainWorld('bridge', bridge)
