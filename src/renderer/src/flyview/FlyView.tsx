import { useState, useEffect, useCallback, useRef } from 'react'
import { AttitudeIndicator } from '../components/AttitudeIndicator'
import { Compass } from '../components/Compass'
import { MapView } from '../components/MapView'
import { VideoView } from '../components/VideoView'
import { VideoControls } from '../components/VideoControls'
import { InstrumentPanel } from './InstrumentPanel'
import { GpsStatus } from './GpsStatus'
import { BatteryStatus } from './BatteryStatus'
import { FlightModeButton } from './FlightModeButton'
import { ArmedIndicator } from './ArmedIndicator'
import { PreFlightChecklist } from './PreFlightChecklist'
import { GuidedActions } from './GuidedActions'
import { LinkQuality } from './LinkQuality'
import { StatusTextOverlay } from './StatusTextOverlay'
import { VehicleSelector } from './VehicleSelector'
import { PerfOverlay } from '../perf/PerfOverlay'
import { useTelemetry } from '../hooks/useVehicle'
import { useCommand } from '../hooks/useCommand'
import styles from './FlyView.module.css'

type MainView = 'map' | 'video'

export function FlyView(): React.JSX.Element {
  const core = useTelemetry('core')
  const armed = core?.armed ?? false
  const { arm } = useCommand()
  const [mainView, setMainView] = useState<MainView>('map')
  const [poppedOut, setPoppedOut] = useState<'video' | 'map' | null>(null)
  const [pipMinimized, setPipMinimized] = useState(false)
  const [pipPos, setPipPos] = useState<{ x: number; y: number } | null>(null)
  const [pipSize, setPipSize] = useState<{ w: number; h: number }>({ w: 240, h: 180 })
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(
    null
  )
  const resizeRef = useRef<{ startX: number; startY: number; origW: number; origH: number } | null>(
    null
  )
  const pipRef = useRef<HTMLDivElement>(null)
  const mapAreaRef = useRef<HTMLDivElement>(null)
  const videoIsMain = mainView === 'video'

  useEffect(() => {
    const unsub = window.bridge?.onPopoutClosed(({ view }) => {
      if (view === poppedOut) setPoppedOut(null)
    })
    return unsub
  }, [poppedOut])

  const handlePopout = useCallback((view: 'video' | 'map') => {
    window.bridge?.popoutOpen(view)
    setPoppedOut(view)
  }, [])

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    const target = e.target as HTMLElement
    // Don't start drag when clicking buttons inside the toolbar
    if (target.closest('button')) return
    if (!target.closest(`.${styles.pipToolbar}`)) return
    e.preventDefault()
    const pip = pipRef.current
    if (!pip) return
    const rect = pip.getBoundingClientRect()
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: rect.left,
      origY: rect.top
    }
    pip.setPointerCapture(e.pointerId)
  }, [])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current || !mapAreaRef.current) return
    const bounds = mapAreaRef.current.getBoundingClientRect()
    const newX = dragRef.current.origX + (e.clientX - dragRef.current.startX) - bounds.left
    const newY = dragRef.current.origY + (e.clientY - dragRef.current.startY) - bounds.top
    setPipPos({ x: newX, y: newY })
  }, [])

  const onPointerUp = useCallback(() => {
    dragRef.current = null
    resizeRef.current = null
  }, [])

  const onResizePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      e.stopPropagation()
      resizeRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        origW: pipSize.w,
        origH: pipSize.h
      }
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    },
    [pipSize]
  )

  const onResizePointerMove = useCallback((e: React.PointerEvent) => {
    if (!resizeRef.current) return
    const dx = e.clientX - resizeRef.current.startX
    const dy = e.clientY - resizeRef.current.startY
    const newW = Math.max(160, Math.min(600, resizeRef.current.origW + dx))
    const newH = Math.max(120, Math.min(450, resizeRef.current.origH + dy))
    setPipSize({ w: newW, h: newH })
  }, [])

  const showVideo = poppedOut !== 'video'
  const showMap = poppedOut !== 'map'
  const showPip = showVideo && showMap

  const pipView = videoIsMain ? 'map' : 'video'

  const pipStyle: React.CSSProperties = {
    width: pipSize.w,
    ...(pipPos ? { left: pipPos.x, top: pipPos.y, bottom: 'auto', right: 'auto' } : {})
  }

  // Render video and map elements. Each is rendered once and placed
  // either as the main layer or inside the pip body.
  const videoEl = <VideoView />
  const mapEl = <MapView />

  const mainEl = videoIsMain ? videoEl : mapEl
  const pipEl = videoIsMain ? mapEl : videoEl

  return (
    <div className={styles.root}>
      <div className={styles.mapArea} ref={mapAreaRef}>
        {/* Main view — always full size */}
        {(showVideo || showMap) && <div className={styles.mainLayer}>{mainEl}</div>}

        {/* PiP — draggable container with toolbar + content */}
        {showPip && (
          <div
            ref={pipRef}
            className={styles.pipContainer}
            style={pipStyle}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            data-testid="pip-container"
          >
            <div className={styles.pipToolbar}>
              <span className={styles.pipDragHandle}>&#x2630;</span>
              <span className={styles.pipTitle}>{pipView === 'video' ? 'Video' : 'Map'}</span>
              <div className={styles.pipActions}>
                <button
                  className={styles.pipActionBtn}
                  onClick={() => setPipMinimized((v) => !v)}
                  title={pipMinimized ? 'Restore' : 'Minimize'}
                  data-testid="pip-minimize"
                  dangerouslySetInnerHTML={{ __html: pipMinimized ? '&#x25A1;' : '&#x2013;' }}
                />
                <button
                  className={styles.pipActionBtn}
                  onClick={() => handlePopout(pipView)}
                  title="Open in separate window"
                  data-testid="pip-popout"
                >
                  &#x2197;
                </button>
              </div>
            </div>
            {!pipMinimized && (
              <div
                className={styles.pipBody}
                style={{ height: pipSize.h }}
                onClick={() => setMainView(videoIsMain ? 'map' : 'video')}
                title="Click to switch"
                data-testid="pip-body"
              >
                {pipEl}
                <div
                  className={styles.resizeHandle}
                  onPointerDown={onResizePointerDown}
                  onPointerMove={onResizePointerMove}
                  onPointerUp={onPointerUp}
                  data-testid="pip-resize"
                />
              </div>
            )}
          </div>
        )}

        {/* Toggle buttons */}
        {showPip && (
          <div className={styles.viewToggle}>
            <button
              className={`${styles.toggleBtn} ${mainView === 'map' ? styles.toggleActive : ''}`}
              onClick={() => setMainView('map')}
            >
              Map
            </button>
            <button
              className={`${styles.toggleBtn} ${mainView === 'video' ? styles.toggleActive : ''}`}
              onClick={() => setMainView('video')}
            >
              Video
            </button>
          </div>
        )}

        {/* Pop-out button when only one view remains */}
        {!showPip && poppedOut && (
          <button
            className={styles.popoutBtnMain}
            onClick={() => handlePopout(poppedOut === 'video' ? 'map' : 'video')}
            title="Open in separate window"
          >
            &#x2197;
          </button>
        )}

        <VideoControls />
        <StatusTextOverlay />
      </div>

      <div className={styles.sidebar}>
        <VehicleSelector />
        <FlightModeButton />
        <ArmedIndicator />
        {!armed && <PreFlightChecklist onComplete={() => arm()} />}

        <div className="section-label">ATTITUDE</div>
        <AttitudeIndicator />

        <div className="section-label">COMPASS</div>
        <Compass />

        <div className="section-label">INSTRUMENTS</div>
        <InstrumentPanel />

        <div className="section-label">GPS</div>
        <GpsStatus />

        <div className="section-label">BATTERY</div>
        <BatteryStatus />

        <div className="section-label">RADIO</div>
        <LinkQuality />

        <div className={styles.guidedActionsArea}>
          <GuidedActions />
        </div>
      </div>

      <PerfOverlay />
    </div>
  )
}
