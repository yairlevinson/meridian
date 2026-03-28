/**
 * All ipcMain.handle() channel names.
 * Both main and renderer reference this single enum.
 */
export enum IpcChannels {
  // Vehicle commands
  VehicleArm = 'vehicle:arm',
  VehicleDisarm = 'vehicle:disarm',
  VehicleSendMavCommand = 'vehicle:sendMavCommand',
  VehicleSetFlightMode = 'vehicle:setFlightMode',
  VehicleGuidedTakeoff = 'vehicle:guidedModeTakeoff',
  VehicleGuidedRTL = 'vehicle:guidedModeRTL',
  VehicleGuidedLand = 'vehicle:guidedModeLand',
  VehicleGuidedGoto = 'vehicle:guidedModeGotoLocation',
  VehicleGuidedPause = 'vehicle:guidedModePause',
  VehicleEmergencyStop = 'vehicle:emergencyStop',

  // Links
  LinksCreate = 'links:createConnectedLink',
  LinksDisconnect = 'links:disconnect',
  LinksRemoveConfig = 'links:removeConfiguration',
  LinksGetAll = 'links:getAll',

  // Serial ports
  SerialListPorts = 'serial:listPorts',

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

  // Signing
  SigningAddKey = 'signing:addKey',
  SigningRemoveKey = 'signing:removeKey',
  SigningEnable = 'signing:enable',

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

  // Settings
  SettingsGet = 'settings:get',
  SettingsSet = 'settings:set',
  SettingsGetAll = 'settings:getAll',

  // Mission file I/O
  MissionSavePlan = 'mission:savePlan',
  MissionOpenPlan = 'mission:openPlan',

  // Video streaming
  VideoStart = 'video:start',
  VideoStop = 'video:stop',
  VideoStartRecording = 'video:startRecording',
  VideoStopRecording = 'video:stopRecording',
  VideoGetState = 'video:getState',

  // Popout windows
  PopoutOpen = 'popout:open',
  PopoutClose = 'popout:close',

  // Calibration
  CalibrationStart = 'calibration:start',
  CalibrationCancel = 'calibration:cancel',
  CalibrationGetState = 'calibration:getState',

  // RC Calibration
  RcCalibrationStart = 'rcCalibration:start',
  RcCalibrationNextStep = 'rcCalibration:nextStep',
  RcCalibrationCancel = 'rcCalibration:cancel',
  RcCalibrationSave = 'rcCalibration:save',

  // Flight Modes
  FlightModesGet = 'flightModes:get',
  FlightModesSet = 'flightModes:set',

  // Firmware
  FirmwareUploadFile = 'firmware:uploadFile',
  FirmwareCancel = 'firmware:cancel',
  FirmwareReboot = 'firmware:reboot',
  FirmwareGetBoardInfo = 'firmware:getBoardInfo',

  // Camera
  CameraRequestInfo = 'camera:requestInfo',
  CameraTakePhoto = 'camera:takePhoto',
  CameraStopCapture = 'camera:stopCapture',
  CameraStartRecording = 'camera:startRecording',
  CameraStopRecording = 'camera:stopRecording',
  CameraSetMode = 'camera:setMode',
  CameraFormatStorage = 'camera:formatStorage',
  CameraGetState = 'camera:getState'
}
