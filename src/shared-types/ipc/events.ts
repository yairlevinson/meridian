/**
 * All ipcRenderer.on() event names — main→renderer push events.
 */
export enum IpcEvents {
  // Vehicle delta/added/removed/statusText: now owned by vehicleModule
  //   (src/shared-types/ipc/modules/vehicle.ts)

  // Link state change: now owned by linksModule (src/shared-types/ipc/modules/links.ts)

  // Parameter events: now owned by parametersModule
  //   (src/shared-types/ipc/modules/parameters.ts)

  // Mission protocol events: now owned by missionModule
  //   (src/shared-types/ipc/modules/mission.ts)

  /** FTP progress */
  FtpProgress = 'ftp:progress',

  /** Log streaming */
  LogData = 'log:data',
  LogProgress = 'log:progress'

  // Video: now owned by videoModule (src/shared-types/ipc/modules/video.ts)

  // Popout: now owned by popoutModule (src/shared-types/ipc/modules/popout.ts)

  // Calibration: now owned by calibrationModule (src/shared-types/ipc/modules/calibration.ts)

  // RC Calibration: now owned by rcCalibrationModule (src/shared-types/ipc/modules/rcCalibration.ts)
  // Firmware: now owned by firmwareModule (src/shared-types/ipc/modules/firmware.ts)
  // Camera: now owned by cameraModule (src/shared-types/ipc/modules/camera.ts)
  // MAVLink Inspector: now owned by mavInspectorModule
  //   (src/shared-types/ipc/modules/mavInspector.ts)
}
