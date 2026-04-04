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

  /** Video stream state changed */
  VideoStateChanged = 'video:stateChanged',

  /** A popout window was closed */
  PopoutClosed = 'popout:closed',

  /** Sensor calibration state changed */
  CalibrationStateChanged = 'calibration:stateChanged',
  /** Compass calibration progress */
  CalibrationMagProgress = 'calibration:magProgress',
  /** Compass calibration report */
  CalibrationMagReport = 'calibration:magReport',

  /** RC calibration state changed */
  RcCalibrationStateChanged = 'rcCalibration:stateChanged',

  /** Firmware upgrade state changed */
  FirmwareUpgradeStateChanged = 'firmware:stateChanged',

  /** Camera state changed */
  CameraStateChanged = 'camera:stateChanged',
  /** Image captured event */
  CameraImageCaptured = 'camera:imageCaptured',

  /** MAVLink console data received from autopilot shell */
  MavConsoleData = 'mavconsole:data',

  /** MAVLink Inspector: 1 Hz message list snapshot */
  MavInspectorSnapshot = 'mavInspector:snapshot',
  /** MAVLink Inspector: 5 Hz field values for selected message */
  MavInspectorFields = 'mavInspector:fields'
}
