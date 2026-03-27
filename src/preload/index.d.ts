import type { QgcBridge } from './index'

declare global {
  interface Window {
    qgcBridge: QgcBridge
  }
}
