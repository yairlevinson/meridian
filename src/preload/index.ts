import { contextBridge, ipcRenderer } from 'electron'
import type { VehicleDeltaPayload } from '../shared-types/ipc/VehicleState'
import { IpcChannels } from '../shared-types/ipc/channels'
import { IpcEvents } from '../shared-types/ipc/events'
import type { MavCommandRequest } from '../shared-types/ipc/MavCommandRequest'
import type { VideoStreamState } from '../shared-types/ipc/VideoTypes'
import type { LinkConfig, LinkState, SerialPortInfo } from '../shared-types/ipc/LinkState'
import type { Parameter, ParameterLoadState } from '../shared-types/ipc/ParameterTypes'
import type {
  CalibrationSensor,
  CalibrationState,
  MagCalProgress,
  RcCalibrationState,
  FlightModeConfig,
  FirmwareUpgradeState
} from '../shared-types/ipc/SetupTypes'
import type { CameraState } from '../shared-types/ipc/CameraTypes'
import type { ForwardingState } from '../shared-types/ipc/ForwardingTypes'
import type { AppSettings } from '../shared-types/ipc/AppSettings'

export interface Bridge {
  onVehicleDelta: (cb: (payload: VehicleDeltaPayload) => void) => () => void
  onVehicleAdded: (cb: (payload: { vehicleId: number }) => void) => () => void
  onVehicleRemoved: (cb: (payload: { vehicleId: number }) => void) => () => void
  arm: (vehicleId: number) => Promise<void>
  disarm: (vehicleId: number) => Promise<void>
  sendMavCommand: (req: MavCommandRequest) => Promise<void>
  setFlightMode: (vehicleId: number, modeName: string) => Promise<void>
  guidedTakeoff: (vehicleId: number, altitude: number) => Promise<void>
  guidedRTL: (vehicleId: number) => Promise<void>
  guidedLand: (vehicleId: number) => Promise<void>
  guidedGoto: (vehicleId: number, lat: number, lon: number, alt: number) => Promise<void>
  guidedPause: (vehicleId: number) => Promise<void>
  emergencyStop: (vehicleId: number) => Promise<void>
  onStatusText: (
    cb: (payload: { vehicleId: number; severity: number; text: string }) => void
  ) => () => void
  onCommandResult: (
    cb: (payload: { vehicleId: number; command: number; result: number }) => void
  ) => () => void
  getParameters: (vehicleId: number) => Promise<unknown>
  setParameter: (vehicleId: number, name: string, value: number) => Promise<void>
  refreshParameters: (vehicleId: number) => Promise<void>
  missionLoad: (vehicleId: number) => Promise<unknown>
  missionWrite: (vehicleId: number, items: unknown[]) => Promise<void>
  savePlan: (planData: unknown) => Promise<{ filePath: string } | { cancelled: true }>
  openPlan: () => Promise<unknown>
  onMissionProgress: (
    cb: (payload: { vehicleId: number; current: number; total: number }) => void
  ) => () => void
  onMissionComplete: (
    cb: (payload: { vehicleId: number; items: import('../shared-types/ipc/MissionTypes').MissionItem[] }) => void
  ) => () => void
  onMissionCurrentChanged: (cb: (payload: { vehicleId: number; seq: number }) => void) => () => void

  // Video streaming
  videoStart: (sourceType: string, uri: string) => Promise<void>
  videoStop: () => Promise<void>
  videoStartRecording: (filePath: string) => Promise<void>
  videoStopRecording: () => Promise<void>
  videoGetState: () => Promise<VideoStreamState>
  onVideoStateChanged: (cb: (state: VideoStreamState) => void) => () => void

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

  // Calibration
  calibrationStart: (vehicleId: number, sensor: CalibrationSensor) => Promise<void>
  calibrationCancel: (vehicleId: number) => Promise<void>
  onCalibrationStateChanged: (
    cb: (payload: { vehicleId: number; state: CalibrationState }) => void
  ) => () => void
  onCalibrationMagProgress: (
    cb: (payload: { vehicleId: number } & MagCalProgress) => void
  ) => () => void

  // RC Calibration
  rcCalibrationStart: (vehicleId: number) => Promise<void>
  rcCalibrationNextStep: (vehicleId: number) => Promise<void>
  rcCalibrationCancel: (vehicleId: number) => Promise<void>
  rcCalibrationSave: (vehicleId: number) => Promise<void>
  onRcCalibrationStateChanged: (
    cb: (payload: { vehicleId: number; state: RcCalibrationState }) => void
  ) => () => void

  // Flight Modes
  flightModesGet: (vehicleId: number) => Promise<FlightModeConfig>
  flightModesSet: (vehicleId: number, config: FlightModeConfig) => Promise<void>

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

  // Popout windows
  popoutOpen: (view: 'video' | 'map') => Promise<void>
  popoutClose: (view: 'video' | 'map') => Promise<void>
  onPopoutClosed: (cb: (payload: { view: string }) => void) => () => void

  // MAVLink Console
  mavConsoleWrite: (vehicleId: number, text: string) => Promise<void>
  onMavConsoleData: (cb: (payload: { vehicleId: number; text: string }) => void) => () => void

  // MAVLink Inspector
  mavInspectorEnable: () => Promise<void>
  mavInspectorDisable: () => Promise<void>
  mavInspectorSelect: (sysid: number, compid: number, msgid: number) => Promise<void>
  mavInspectorDeselect: () => Promise<void>
  onMavInspectorSnapshot: (
    cb: (payload: import('../shared-types/ipc/MavInspectorTypes').InspectorSnapshotPayload) => void
  ) => () => void
  onMavInspectorFields: (
    cb: (payload: import('../shared-types/ipc/MavInspectorTypes').InspectorFieldsPayload) => void
  ) => () => void

  // Settings
  settingsGetAll: () => Promise<AppSettings>
  settingsSet: (key: string, value: unknown) => Promise<void>
  onSettingsChanged: (cb: (payload: { key: string; value: unknown }) => void) => () => void

  // MAVLink Forwarding
  forwardingGetState: () => Promise<ForwardingState>
  forwardingAddTarget: (host: string, port: number) => Promise<string>
  forwardingRemoveTarget: (id: string) => Promise<void>
  forwardingSetEnabled: (enabled: boolean) => Promise<void>
  forwardingSetTargetEnabled: (id: string, enabled: boolean) => Promise<void>
  onForwardingStateChanged: (cb: (state: ForwardingState) => void) => () => void
}

const bridge: Bridge = {
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
  emergencyStop: (vehicleId) => ipcRenderer.invoke(IpcChannels.VehicleEmergencyStop, vehicleId),
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
    const handler = (_event: Electron.IpcRendererEvent, payload: { vehicleId: number; items: unknown[] }): void =>
      cb(payload as { vehicleId: number; items: import('../shared-types/ipc/MissionTypes').MissionItem[] })
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

  // Video streaming
  videoStart: (sourceType, uri) => ipcRenderer.invoke(IpcChannels.VideoStart, { sourceType, uri }),
  videoStop: () => ipcRenderer.invoke(IpcChannels.VideoStop),
  videoStartRecording: (filePath) => ipcRenderer.invoke(IpcChannels.VideoStartRecording, filePath),
  videoStopRecording: () => ipcRenderer.invoke(IpcChannels.VideoStopRecording),
  videoGetState: () => ipcRenderer.invoke(IpcChannels.VideoGetState),
  onVideoStateChanged: (cb) => {
    const handler = (_event: Electron.IpcRendererEvent, state: VideoStreamState): void => cb(state)
    ipcRenderer.on(IpcEvents.VideoStateChanged, handler)
    return () => {
      ipcRenderer.removeListener(IpcEvents.VideoStateChanged, handler)
    }
  },

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

  // Calibration
  calibrationStart: (vehicleId, sensor) =>
    ipcRenderer.invoke(IpcChannels.CalibrationStart, { vehicleId, sensor }),
  calibrationCancel: (vehicleId) => ipcRenderer.invoke(IpcChannels.CalibrationCancel, vehicleId),
  onCalibrationStateChanged: (cb) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: { vehicleId: number; state: CalibrationState }
    ): void => cb(payload)
    ipcRenderer.on(IpcEvents.CalibrationStateChanged, handler)
    return () => {
      ipcRenderer.removeListener(IpcEvents.CalibrationStateChanged, handler)
    }
  },
  onCalibrationMagProgress: (cb) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: { vehicleId: number } & MagCalProgress
    ): void => cb(payload)
    ipcRenderer.on(IpcEvents.CalibrationMagProgress, handler)
    return () => {
      ipcRenderer.removeListener(IpcEvents.CalibrationMagProgress, handler)
    }
  },

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

  // Flight Modes
  flightModesGet: (vehicleId) => ipcRenderer.invoke(IpcChannels.FlightModesGet, vehicleId),
  flightModesSet: (vehicleId, config) =>
    ipcRenderer.invoke(IpcChannels.FlightModesSet, { vehicleId, config }),

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

  // Popout windows
  popoutOpen: (view) => ipcRenderer.invoke(IpcChannels.PopoutOpen, view),
  popoutClose: (view) => ipcRenderer.invoke(IpcChannels.PopoutClose, view),
  onPopoutClosed: (cb) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: { view: string }): void =>
      cb(payload)
    ipcRenderer.on(IpcEvents.PopoutClosed, handler)
    return () => {
      ipcRenderer.removeListener(IpcEvents.PopoutClosed, handler)
    }
  },

  // MAVLink Console
  mavConsoleWrite: (vehicleId, text) =>
    ipcRenderer.invoke(IpcChannels.MavConsoleWrite, { vehicleId, text }),
  onMavConsoleData: (cb) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: { vehicleId: number; text: string }
    ): void => cb(payload)
    ipcRenderer.on(IpcEvents.MavConsoleData, handler)
    return () => {
      ipcRenderer.removeListener(IpcEvents.MavConsoleData, handler)
    }
  },

  // MAVLink Inspector
  mavInspectorEnable: () => ipcRenderer.invoke(IpcChannels.MavInspectorEnable),
  mavInspectorDisable: () => ipcRenderer.invoke(IpcChannels.MavInspectorDisable),
  mavInspectorSelect: (sysid, compid, msgid) =>
    ipcRenderer.invoke(IpcChannels.MavInspectorSelect, { sysid, compid, msgid }),
  mavInspectorDeselect: () => ipcRenderer.invoke(IpcChannels.MavInspectorDeselect),
  onMavInspectorSnapshot: (cb) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown): void =>
      cb(payload as import('../shared-types/ipc/MavInspectorTypes').InspectorSnapshotPayload)
    ipcRenderer.on(IpcEvents.MavInspectorSnapshot, handler)
    return () => {
      ipcRenderer.removeListener(IpcEvents.MavInspectorSnapshot, handler)
    }
  },
  onMavInspectorFields: (cb) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown): void =>
      cb(payload as import('../shared-types/ipc/MavInspectorTypes').InspectorFieldsPayload)
    ipcRenderer.on(IpcEvents.MavInspectorFields, handler)
    return () => {
      ipcRenderer.removeListener(IpcEvents.MavInspectorFields, handler)
    }
  },

  // Settings
  settingsGetAll: () => ipcRenderer.invoke(IpcChannels.SettingsGetAll),
  settingsSet: (key, value) => ipcRenderer.invoke(IpcChannels.SettingsSet, { key, value }),
  onSettingsChanged: (cb) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: { key: string; value: unknown }
    ): void => cb(payload)
    ipcRenderer.on(IpcEvents.SettingsChanged, handler)
    return () => {
      ipcRenderer.removeListener(IpcEvents.SettingsChanged, handler)
    }
  },

  // MAVLink Forwarding
  forwardingGetState: () => ipcRenderer.invoke(IpcChannels.ForwardingGetState),
  forwardingAddTarget: (host, port) =>
    ipcRenderer.invoke(IpcChannels.ForwardingAddTarget, { host, port }),
  forwardingRemoveTarget: (id) => ipcRenderer.invoke(IpcChannels.ForwardingRemoveTarget, id),
  forwardingSetEnabled: (enabled) => ipcRenderer.invoke(IpcChannels.ForwardingSetEnabled, enabled),
  forwardingSetTargetEnabled: (id, enabled) =>
    ipcRenderer.invoke(IpcChannels.ForwardingSetTargetEnabled, { id, enabled }),
  onForwardingStateChanged: (cb) => {
    const handler = (_event: Electron.IpcRendererEvent, state: ForwardingState): void => cb(state)
    ipcRenderer.on(IpcEvents.ForwardingStateChanged, handler)
    return () => {
      ipcRenderer.removeListener(IpcEvents.ForwardingStateChanged, handler)
    }
  }
}

contextBridge.exposeInMainWorld('bridge', bridge)
