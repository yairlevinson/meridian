import { create } from 'zustand'
import type { Parameter, ParameterLoadState } from '../../../shared-types/ipc/ParameterTypes'

interface ParameterStore {
  parameters: Map<string, Parameter>
  loadState: ParameterLoadState
  setParameters: (params: Parameter[]) => void
  updateParameter: (param: Parameter) => void
  setLoadState: (state: Partial<ParameterLoadState>) => void
}

const defaultLoadState: ParameterLoadState = {
  totalCount: 0,
  receivedCount: 0,
  loadProgress: 0,
  parametersReady: false,
  missingParameters: false,
  missingIndices: [],
  retryCount: 0,
  pendingWrites: 0
}

export const useParameterStore = create<ParameterStore>((set) => ({
  parameters: new Map(),
  loadState: { ...defaultLoadState },
  setParameters: (params) =>
    set({
      parameters: new Map(params.map((p) => [p.name, p]))
    }),
  updateParameter: (param) =>
    set((prev) => {
      const next = new Map(prev.parameters)
      next.set(param.name, param)
      return { parameters: next }
    }),
  setLoadState: (partial) =>
    set((prev) => ({
      loadState: { ...prev.loadState, ...partial }
    }))
}))

// Wire IPC listeners when bridge is available
setTimeout(() => {
  const bridge = window.bridge
  if (!bridge) return

  bridge.onParameterChanged?.((payload) => {
    useParameterStore.getState().updateParameter(payload.parameter)
  })

  bridge.onParametersReady?.(() => {
    useParameterStore.getState().setLoadState({ parametersReady: true })
  })

  bridge.onParametersProgress?.((payload) => {
    useParameterStore.getState().setLoadState(payload.loadState)
  })
}, 0)
