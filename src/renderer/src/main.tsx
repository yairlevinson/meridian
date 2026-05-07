import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { installBrowserRpcBridge } from './transport/installBrowserBridge'

async function bootstrap(): Promise<void> {
  const isElectron = navigator.userAgent.includes('Electron')
  if (!window.bridge || !isElectron) {
    installBrowserRpcBridge({
      serverUrl: import.meta.env.VITE_MERIDIAN_SERVER_URL || window.location.origin,
      replaceExisting: !isElectron
    })
  }

  const { default: App } = await import('./App')

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
}

void bootstrap()
