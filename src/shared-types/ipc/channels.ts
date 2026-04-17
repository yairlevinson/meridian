/**
 * All ipcMain.handle() channel names.
 * Both main and renderer reference this single enum.
 */
export enum IpcChannels {
  // Vehicle commands: now owned by vehicleModule (src/shared-types/ipc/modules/vehicle.ts)

  // Links + serial ports: now owned by linksModule (src/shared-types/ipc/modules/links.ts)

  // Mission
  MissionLoad = 'mission:load',
  MissionWrite = 'mission:write',
  MissionRemoveAll = 'mission:removeAll',
  MissionGetItems = 'mission:getItems',

  // GeoFence
  GeoFenceLoad = 'geofence:load',
  GeoFenceWrite = 'geofence:write',
  GeoFenceRemoveAll = 'geofence:removeAll',

  // Rally
  RallyLoad = 'rally:load',
  RallyWrite = 'rally:write',
  RallyRemoveAll = 'rally:removeAll',

  // Parameters
  ParametersRefresh = 'parameters:refresh',
  ParametersSet = 'parameters:set',
  ParametersGet = 'parameters:get',
  ParametersGetAll = 'parameters:getAll',

  // FTP
  FtpDownload = 'ftp:download',
  FtpUpload = 'ftp:upload',
  FtpListDirectory = 'ftp:listDirectory',

  // Log management
  LogList = 'log:list',
  LogDownload = 'log:download',
  LogUpload = 'log:upload',

  // Map tiles
  MapFetchTile = 'map:fetchTile',

  // Settings: now owned by settingsModule (src/shared-types/ipc/modules/settings.ts)
  SettingsGet = 'settings:get',

  // Mission file I/O
  MissionSavePlan = 'mission:savePlan',
  MissionOpenPlan = 'mission:openPlan'

  // Video: now owned by videoModule (src/shared-types/ipc/modules/video.ts)

  // Popout: now owned by popoutModule (src/shared-types/ipc/modules/popout.ts)

  // Calibration: now owned by calibrationModule (src/shared-types/ipc/modules/calibration.ts)
  // RC Calibration: now owned by rcCalibrationModule (src/shared-types/ipc/modules/rcCalibration.ts)
  // Firmware: now owned by firmwareModule (src/shared-types/ipc/modules/firmware.ts)
  // Camera: now owned by cameraModule (src/shared-types/ipc/modules/camera.ts)
  // Actuator testing: now owned by actuatorModule (src/shared-types/ipc/modules/actuator.ts)
  // MAVLink Inspector: now owned by mavInspectorModule
  //   (src/shared-types/ipc/modules/mavInspector.ts)
}
