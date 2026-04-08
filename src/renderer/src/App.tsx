import { useState, useEffect, useRef } from 'react'
import { FlyView } from './flyview/FlyView'
import { PlanView } from './planview/PlanView'
import { SetupView } from './setupview/SetupView'
import { PopoutView } from './flyview/PopoutView'
import styles from './App.module.css'

type ViewMode = 'fly' | 'plan' | 'setup'

/**
 * Keeps children mounted but hidden via CSS when inactive.
 * Dispatches a resize event when re-activated so MapLibre recalculates its viewport.
 */
function HiddenWhenInactive({
  active,
  children
}: {
  active: boolean
  children: React.ReactNode
}): React.JSX.Element {
  const wasActive = useRef(active)

  useEffect(() => {
    if (active && !wasActive.current) {
      // MapLibre needs a resize after the container becomes visible again
      window.dispatchEvent(new Event('resize'))
    }
    wasActive.current = active
  }, [active])

  return <div style={{ display: active ? 'contents' : 'none' }}>{children}</div>
}

// Check if this window is a popout
const popoutView = new URLSearchParams(window.location.search).get('popout')

function ViewSwitcher({
  view,
  setView
}: {
  view: ViewMode
  setView: (v: ViewMode) => void
}): React.JSX.Element {
  return (
    <div className={styles.topbar}>
      <button
        className={`${styles.tab} ${view === 'fly' ? styles.tabActive : ''}`}
        onClick={() => setView('fly')}
      >
        <span aria-hidden="true">&#x2708;</span> FLY
      </button>
      <button
        className={`${styles.tab} ${view === 'plan' ? styles.tabActive : ''}`}
        onClick={() => setView('plan')}
      >
        <span aria-hidden="true">&#x2637;</span> PLAN
      </button>
      <button
        className={`${styles.tab} ${view === 'setup' ? styles.tabActive : ''}`}
        onClick={() => setView('setup')}
      >
        <span aria-hidden="true">&#x2699;</span> SETUP
      </button>
    </div>
  )
}

function App(): React.JSX.Element {
  const [view, setView] = useState<ViewMode>('fly')

  // Popout windows render only the requested component
  if (popoutView === 'video' || popoutView === 'map') {
    return <PopoutView view={popoutView} />
  }

  return (
    <div className={styles.root}>
      <ViewSwitcher view={view} setView={setView} />
      <HiddenWhenInactive active={view === 'fly'}>
        <FlyView />
      </HiddenWhenInactive>
      {view === 'plan' && <PlanView />}
      {view === 'setup' && <SetupView />}
    </div>
  )
}

export default App
