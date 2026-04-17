import { contextBridge, ipcRenderer } from 'electron'
import { IpcChannels } from '../shared-types/ipc/channels'
import { IpcEvents } from '../shared-types/ipc/events'
import type { Parameter, ParameterLoadState } from '../shared-types/ipc/ParameterTypes'
import { radarModule } from '../shared-types/ipc/modules/radar'
import { forwardingModule } from '../shared-types/ipc/modules/forwarding'
import { settingsModule } from '../shared-types/ipc/modules/settings'
import { kmlModule } from '../shared-types/ipc/modules/kml'
import { mavConsoleModule } from '../shared-types/ipc/modules/mavConsole'
import { mavInspectorModule } from '../shared-types/ipc/modules/mavInspector'
import { popoutModule } from '../shared-types/ipc/modules/popout'
import { videoModule } from '../shared-types/ipc/modules/video'
import { calibrationModule } from '../shared-types/ipc/modules/calibration'
import { rcCalibrationModule } from '../shared-types/ipc/modules/rcCalibration'
import { firmwareModule } from '../shared-types/ipc/modules/firmware'
import { cameraModule } from '../shared-types/ipc/modules/camera'
import { actuatorModule } from '../shared-types/ipc/modules/actuator'
import { linksModule } from '../shared-types/ipc/modules/links'
import { vehicleModule } from '../shared-types/ipc/modules/vehicle'
import { missionModule } from '../shared-types/ipc/modules/mission'
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
    ModuleBridge<typeof calibrationModule>,
    ModuleBridge<typeof rcCalibrationModule>,
    ModuleBridge<typeof firmwareModule>,
    ModuleBridge<typeof cameraModule>,
    ModuleBridge<typeof actuatorModule>,
    ModuleBridge<typeof linksModule>,
    ModuleBridge<typeof vehicleModule>,
    ModuleBridge<typeof missionModule> {
  // Vehicle: generated from vehicleModule (vehicleArm, vehicleDisarm, vehicleGuidedTakeoff,
  //   ..., onVehicleAdded, onVehicleRemoved, onVehicleDelta, onVehicleStatusText)
  // Mission: generated from missionModule (missionLoad, missionWrite, missionSavePlan,
  //   missionOpenPlan, onMissionProgress, onMissionComplete, onMissionCurrentChanged)
  getParameters: (vehicleId: number) => Promise<unknown>
  setParameter: (vehicleId: number, name: string, value: number) => Promise<void>
  refreshParameters: (vehicleId: number) => Promise<void>

  // Video: generated from videoModule (videoStart, videoStop, videoStartRecording,
  //   videoStopRecording, videoGetState, onVideoStateChanged)

  // Links: generated from linksModule (linksCreate, linksDisconnect, linksGetAll,
  //   linksListSerialPorts, onLinksStateChanged)

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

  // RC Calibration: generated from rcCalibrationModule (rcCalibrationStart,
  //   rcCalibrationNextStep, rcCalibrationCancel, rcCalibrationSave,
  //   onRcCalibrationStateChanged)

  // Firmware: generated from firmwareModule (firmwareUploadFile, firmwareCancel,
  //   firmwareReboot, firmwareGetBoardInfo, onFirmwareUpgradeStateChanged)

  // Camera: generated from cameraModule (cameraRequestInfo, cameraTakePhoto,
  //   cameraStopCapture, cameraStartRecording, cameraStopRecording, cameraSetMode,
  //   cameraFormatStorage, cameraGetState, onCameraStateChanged, onCameraImageCaptured)

  // Actuator testing: generated from actuatorModule (actuatorMotorTest, actuatorServoTest)

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
  // Vehicle methods are spread in from bindIpcModule(vehicleModule) below.
  getParameters: (vehicleId) => ipcRenderer.invoke(IpcChannels.ParametersGetAll, vehicleId),
  setParameter: (vehicleId, name, value) =>
    ipcRenderer.invoke(IpcChannels.ParametersSet, { vehicleId, componentId: 1, name, value }),
  refreshParameters: (vehicleId) => ipcRenderer.invoke(IpcChannels.ParametersRefresh, vehicleId),
  // Mission methods are spread in from bindIpcModule(missionModule) below.

  // Video methods are spread in from bindIpcModule(videoModule) below.

  // Links methods are spread in from bindIpcModule(linksModule) below.

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
  // RC Calibration methods are spread in from bindIpcModule(rcCalibrationModule) below.
  // Firmware methods are spread in from bindIpcModule(firmwareModule) below.
  // Camera methods are spread in from bindIpcModule(cameraModule) below.
  // Actuator testing methods are spread in from bindIpcModule(actuatorModule) below.

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
  ...bindIpcModule(calibrationModule),
  ...bindIpcModule(rcCalibrationModule),
  ...bindIpcModule(firmwareModule),
  ...bindIpcModule(cameraModule),
  ...bindIpcModule(actuatorModule),
  ...bindIpcModule(linksModule),
  ...bindIpcModule(vehicleModule),
  ...bindIpcModule(missionModule)
}

contextBridge.exposeInMainWorld('bridge', bridge)
