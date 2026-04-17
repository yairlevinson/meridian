/**
 * All ipcRenderer.on() event names — main→renderer push events.
 */
export enum IpcEvents {
  /** Vehicle state delta (30Hz throttled) */
  VehicleDelta = 'vehicle:delta',

  /** Vehicle added/removed */
  VehicleAdded = 'vehicle:added',
  VehicleRemoved = 'vehicle:removed',

  /** Link state change */
  LinkStateChanged = 'link:stateChanged',

  /** Parameter load progress */
  ParametersProgress = 'parameters:progress',
  ParametersReady = 'parameters:ready',
  ParameterChanged = 'parameter:changed',

  /** Mission protocol events */
  MissionProgress = 'mission:progress',
  MissionComplete = 'mission:complete',
  MissionError = 'mission:error',
  MissionCurrentChanged = 'mission:currentChanged',

  /** MAV command result */
  CommandResult = 'command:result',

  /** STATUSTEXT messages */
  StatusText = 'statustext',

  /** FTP progress */
  FtpProgress = 'ftp:progress',

  /** Log streaming */
  LogData = 'log:data',
  LogProgress = 'log:progress',

  // Video: now owned by videoModule (src/shared-types/ipc/modules/video.ts)

  // Popout: now owned by popoutModule (src/shared-types/ipc/modules/popout.ts)

  // Calibration: now owned by calibrationModule (src/shared-types/ipc/modules/calibration.ts)

  /** RC calibration state changed */
  RcCalibrationStateChanged = 'rcCalibration:stateChanged',

  /** Firmware upgrade state changed */
  FirmwareUpgradeStateChanged = 'firmware:stateChanged',

  /** Camera state changed */
  CameraStateChanged = 'camera:stateChanged',
  /** Image captured event */
  CameraImageCaptured = 'camera:imageCaptured'

  // MAVLink Inspector: now owned by mavInspectorModule
  //   (src/shared-types/ipc/modules/mavInspector.ts)
}
