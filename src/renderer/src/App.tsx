import { useState } from 'react'
import { FlyView } from './flyview/FlyView'
import { PlanView } from './planview/PlanView'
import { PopoutView } from './flyview/PopoutView'
import styles from './App.module.css'

type ViewMode = 'fly' | 'plan'

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
        FLY
      </button>
      <button
        className={`${styles.tab} ${view === 'plan' ? styles.tabActive : ''}`}
        onClick={() => setView('plan')}
      >
        PLAN
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
      {view === 'fly' ? <FlyView /> : <PlanView />}
    </div>
  )
}

export default App
