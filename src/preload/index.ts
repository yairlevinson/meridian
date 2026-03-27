import { contextBridge, ipcRenderer } from 'electron'
import type { VehicleDeltaPayload } from '../shared-types/ipc/VehicleState'
import { IpcChannels } from '../shared-types/ipc/channels'
import { IpcEvents } from '../shared-types/ipc/events'
import type { MavCommandRequest } from '../shared-types/ipc/MavCommandRequest'
import type { VideoStreamState } from '../shared-types/ipc/VideoTypes'

export interface QgcBridge {
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
  onMissionCurrentChanged: (cb: (payload: { vehicleId: number; seq: number }) => void) => () => void

  // Video streaming
  videoStart: (sourceType: string, uri: string) => Promise<void>
  videoStop: () => Promise<void>
  videoStartRecording: (filePath: string) => Promise<void>
  videoStopRecording: () => Promise<void>
  videoGetState: () => Promise<VideoStreamState>
  onVideoStateChanged: (cb: (state: VideoStreamState) => void) => () => void

  // Popout windows
  popoutOpen: (view: 'video' | 'map') => Promise<void>
  popoutClose: (view: 'video' | 'map') => Promise<void>
  onPopoutClosed: (cb: (payload: { view: string }) => void) => () => void
}

const bridge: QgcBridge = {
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
  }
}

contextBridge.exposeInMainWorld('qgcBridge', bridge)
