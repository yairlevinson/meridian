import { useEffect, useRef, useState } from 'react'
import { useVehicleStore } from '../store/vehicleStore'
import { useTelemetry, useConnected } from '../hooks/useVehicle'
import styles from './PerfOverlay.module.css'

export function PerfOverlay(): React.JSX.Element {
  const [fps, setFps] = useState(0)
  const [longTasks, setLongTasks] = useState(0)
  const frameCountRef = useRef(0)
  const lastSecRef = useRef(0)
  useEffect(() => {
    if (lastSecRef.current === 0) lastSecRef.current = Date.now()
  }, [])

  const ipcLatency = useVehicleStore((s) => s.ipcLatency)
  const connected = useConnected()
  const attitude = useTelemetry('attitude')
  const gps = useTelemetry('gps')
  const core = useTelemetry('core')

  useEffect(() => {
    let running = true
    const tick = (): void => {
      if (!running) return
      frameCountRef.current++
      const now = Date.now()
      if (now - lastSecRef.current >= 1000) {
        setFps(frameCountRef.current)
        frameCountRef.current = 0
        lastSecRef.current = now
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
    return () => {
      running = false
    }
  }, [])

  useEffect(() => {
    if (!('PerformanceObserver' in window)) return
    const observer = new PerformanceObserver((list) => {
      setLongTasks((n) => n + list.getEntries().length)
    })
    try {
      observer.observe({ type: 'longtask', buffered: true })
    } catch {
      // longtask may not be supported in all Electron versions
    }
    return () => observer.disconnect()
  }, [])

  const RAD_TO_DEG = 180 / Math.PI

  const modeName = core?.flightModeName || (core ? `M${core.flightMode}` : '')

  return (
    <div className={styles.root}>
      <span
        className={connected ? styles.connected : styles.disconnected}
        data-testid="conn-status"
      >
        {connected ? 'CONNECTED' : 'WAITING'}
      </span>
      <span className={styles.sep}>FPS {fps}</span>
      <span className={styles.sep}>IPC {ipcLatency}ms</span>
      {attitude && (
        <span className={styles.sep}>
          Roll: {(attitude.roll * RAD_TO_DEG).toFixed(1)} Pitch:{' '}
          {(attitude.pitch * RAD_TO_DEG).toFixed(1)} Yaw: {(attitude.yaw * RAD_TO_DEG).toFixed(1)}
        </span>
      )}
      {gps && (
        <span className={styles.sep}>
          Lat: {gps.lat.toFixed(5)} Lon: {gps.lon.toFixed(5)} Alt: {gps.alt.toFixed(0)}m
        </span>
      )}
      {core && (
        <span className={styles.sep}>
          {core.armed ? 'ARMED' : 'DISARMED'} {modeName}
        </span>
      )}
      {longTasks > 0 && <span className={styles.warnBad}>LT:{longTasks}</span>}
    </div>
  )
}
