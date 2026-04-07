import { useCallback } from 'react'
import { useRadarStore } from '../../store/radarStore'
import { useSettingsStore } from '../../store/settingsStore'
import styles from './RadarPanel.module.css'

export function RadarPanel(): React.JSX.Element | null {
  const enabled = useRadarStore((s) => s.state?.enabled ?? false)
  const simulationActive = useRadarStore((s) => s.state?.simulationActive ?? false)
  const friendlyCount = useRadarStore((s) => {
    const tracks = s.state?.tracks
    if (!tracks) return 0
    let n = 0
    for (const t of tracks) if (t.affiliation === 'friendly') n++
    return n
  })
  const hostileCount = useRadarStore((s) => {
    const tracks = s.state?.tracks
    if (!tracks) return 0
    let n = 0
    for (const t of tracks) if (t.affiliation !== 'friendly') n++
    return n
  })
  const scopeView = useRadarStore((s) => s.scopeView)
  const setScopeView = useRadarStore((s) => s.setScopeView)
  const radiusMeters = useSettingsStore((s) => s.settings.radarRadiusMeters)
  const setSetting = useSettingsStore((s) => s.setSetting)

  const toggleRadar = useCallback(() => {
    if (enabled) {
      window.bridge?.radarDisable()
    } else {
      window.bridge?.radarEnable()
    }
  }, [enabled])

  const handleRadiusChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSetting('radarRadiusMeters', Number(e.target.value))
    },
    [setSetting]
  )

  const radiusLabel =
    radiusMeters >= 1000 ? `${(radiusMeters / 1000).toFixed(1)}km` : `${radiusMeters}m`

  return (
    <div className={styles.panel}>
      {/* Power toggle */}
      <button
        className={`${styles.powerBtn} ${enabled ? styles.powerOn : ''}`}
        onClick={toggleRadar}
        title={enabled ? 'Disable Radar' : 'Enable Radar'}
      >
        <span className={styles.powerDot} />
        RADAR
      </button>

      {enabled && (
        <div className={styles.inner}>
          {/* View toggle */}
          <div className={styles.viewToggle}>
            <button
              className={`${styles.viewBtn} ${scopeView === 'radar' ? styles.viewActive : ''}`}
              onClick={() => setScopeView('radar')}
            >
              Radar
            </button>
            <button
              className={`${styles.viewBtn} ${scopeView === 'map' ? styles.viewActive : ''}`}
              onClick={() => setScopeView('map')}
            >
              Map
            </button>
          </div>

          {/* Radius slider */}
          <div className={styles.sliderGroup}>
            <label className={styles.sliderLabel}>{radiusLabel}</label>
            <input
              type="range"
              min={1000}
              max={20000}
              step={500}
              value={radiusMeters}
              onChange={handleRadiusChange}
              className={styles.slider}
            />
          </div>

          {/* Track counts */}
          <div className={styles.counts}>
            <span className={styles.friendlyCount}>{friendlyCount}F</span>
            <span className={styles.hostileCount}>{hostileCount}H</span>
          </div>

          {/* Sim indicator */}
          {simulationActive && (
            <div className={styles.simBadge}>
              <span className={styles.simDot} />
              SIM
            </div>
          )}
        </div>
      )}
    </div>
  )
}
