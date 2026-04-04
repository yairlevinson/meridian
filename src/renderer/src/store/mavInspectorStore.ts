import { create } from 'zustand'
import type {
  InspectorMessageSummary,
  InspectorFieldValue
} from '../../../shared-types/ipc/MavInspectorTypes'

interface MavInspectorStore {
  isOpen: boolean
  messages: InspectorMessageSummary[]
  selectedKey: string | null
  selectedFields: InspectorFieldValue[]
  filterSysid: number | null
  filterCompid: number | null

  open: () => void
  close: () => void
  selectMessage: (sysid: number, compid: number, msgid: number) => void
  deselectMessage: () => void
  setFilterSysid: (sysid: number | null) => void
  setFilterCompid: (compid: number | null) => void
}

export const useMavInspectorStore = create<MavInspectorStore>((set) => {
  let unsubSnapshot: (() => void) | null = null
  let unsubFields: (() => void) | null = null

  return {
    isOpen: false,
    messages: [],
    selectedKey: null,
    selectedFields: [],
    filterSysid: null,
    filterCompid: null,

    open: () => {
      window.bridge?.mavInspectorEnable()
      set({ isOpen: true })

      unsubSnapshot?.()
      unsubFields?.()

      unsubSnapshot =
        window.bridge?.onMavInspectorSnapshot((payload) => {
          if (useMavInspectorStore.getState().isOpen) {
            useMavInspectorStore.setState({ messages: payload.messages })
          }
        }) ?? null

      unsubFields =
        window.bridge?.onMavInspectorFields((payload) => {
          const store = useMavInspectorStore.getState()
          const key = `${payload.sysid}:${payload.compid}:${payload.msgid}`
          if (store.isOpen && store.selectedKey === key) {
            useMavInspectorStore.setState({ selectedFields: payload.fields })
          }
        }) ?? null
    },

    close: () => {
      unsubSnapshot?.()
      unsubFields?.()
      unsubSnapshot = null
      unsubFields = null

      window.bridge?.mavInspectorDisable()
      set({ isOpen: false, messages: [], selectedKey: null, selectedFields: [] })
    },

    selectMessage: (sysid, compid, msgid) => {
      window.bridge?.mavInspectorSelect(sysid, compid, msgid)
      set({ selectedKey: `${sysid}:${compid}:${msgid}`, selectedFields: [] })
    },

    deselectMessage: () => {
      window.bridge?.mavInspectorDeselect()
      set({ selectedKey: null, selectedFields: [] })
    },

    setFilterSysid: (sysid) => set({ filterSysid: sysid }),
    setFilterCompid: (compid) => set({ filterCompid: compid })
  }
})
