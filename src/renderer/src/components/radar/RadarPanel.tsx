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
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M12 12 L12 2" />
          <path d="M12 12 A5 5 0 0 1 16.33 9.5" />
          <path d="M12 12 A9 9 0 0 1 19.8 7.2" />
        </svg>
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
