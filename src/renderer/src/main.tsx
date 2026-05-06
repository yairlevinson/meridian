import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { installBrowserRpcBridge } from './transport/installBrowserBridge'

async function bootstrap(): Promise<void> {
  if (!window.bridge) {
    installBrowserRpcBridge({
      serverUrl: import.meta.env.VITE_MERIDIAN_SERVER_URL || window.location.origin
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
