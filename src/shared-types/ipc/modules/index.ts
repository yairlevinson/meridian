import type { IpcModuleSpec } from '../ipcModule'
import { actuatorModule } from './actuator'
import { calibrationModule } from './calibration'
import { cameraModule } from './camera'
import { firmwareModule } from './firmware'
import { forwardingModule } from './forwarding'
import { kmlModule } from './kml'
import { linksModule } from './links'
import { mavConsoleModule } from './mavConsole'
import { mavInspectorModule } from './mavInspector'
import { missionModule } from './mission'
import { parametersModule } from './parameters'
import { popoutModule } from './popout'
import { radarModule } from './radar'
import { rcCalibrationModule } from './rcCalibration'
import { settingsModule } from './settings'
import { vehicleModule } from './vehicle'
import { videoModule } from './video'

export const allIpcModules = [
  radarModule,
  forwardingModule,
  settingsModule,
  kmlModule,
  mavConsoleModule,
  mavInspectorModule,
  popoutModule,
  videoModule,
  calibrationModule,
  rcCalibrationModule,
  firmwareModule,
  cameraModule,
  actuatorModule,
  linksModule,
  vehicleModule,
  missionModule,
  parametersModule
] as const satisfies readonly IpcModuleSpec[]

export type AllIpcModule = (typeof allIpcModules)[number]
