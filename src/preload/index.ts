import { contextBridge, ipcRenderer } from 'electron'
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
import { parametersModule } from '../shared-types/ipc/modules/parameters'
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
    ModuleBridge<typeof missionModule>,
    ModuleBridge<typeof parametersModule> {
  // Renderer → main process logging (written to ~/meridian-app.log)
  log: (level: 'info' | 'warn' | 'error' | 'debug', tag: string, message: string) => void
}

const bridge: Bridge = {
  // Renderer → main process logging
  log: (level, tag, message) => {
    ipcRenderer.send('renderer:log', { level, tag, message })
  },

  ...bindIpcModule(radarModule),
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
  ...bindIpcModule(missionModule),
  ...bindIpcModule(parametersModule)
}

contextBridge.exposeInMainWorld('bridge', bridge)
