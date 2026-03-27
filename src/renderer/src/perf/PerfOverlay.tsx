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
  const mergeCount = useVehicleStore((s) => s.mergeCount)
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

  return (
    <div className={styles.root}>
      <div className={connected ? styles.connected : styles.disconnected}>
        {connected ? '● CONNECTED' : '○ WAITING…'}
      </div>
      <div>FPS: {fps}</div>
      <div>IPC latency: {ipcLatency}ms</div>
      <div>Store merges:{mergeCount}</div>
      <div className={longTasks > 0 ? styles.warnBad : styles.warnOk}>Long tasks: {longTasks}</div>
      {attitude && (
        <>
          <div className={styles.section}>Roll: {(attitude.roll * RAD_TO_DEG).toFixed(1)}°</div>
          <div>Pitch: {(attitude.pitch * RAD_TO_DEG).toFixed(1)}°</div>
          <div>Yaw: {(attitude.yaw * RAD_TO_DEG).toFixed(1)}°</div>
        </>
      )}
      {gps && (
        <>
          <div className={styles.section}>Lat: {gps.lat.toFixed(6)}</div>
          <div>Lon: {gps.lon.toFixed(6)}</div>
          <div>Alt: {gps.alt.toFixed(1)}m</div>
        </>
      )}
      {core && (
        <div className={styles.section}>
          {core.armed ? 'ARMED' : 'DISARMED'} | mode:{core.flightMode}
        </div>
      )}
    </div>
  )
}
