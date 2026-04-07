import { useCallback } from 'react'
import { useSettingsStore } from '../../store/settingsStore'
import styles from './RadarSettingsPage.module.css'

export function RadarSettingsPage(): React.JSX.Element {
  const settings = useSettingsStore((s) => s.settings)
  const setSetting = useSettingsStore((s) => s.setSetting)

  const handleToggle = useCallback(
    (key: 'radarSimulationEnabled') => {
      setSetting(key, !settings[key])
    },
    [settings, setSetting]
  )

  const radiusLabel =
    settings.radarRadiusMeters >= 1000
      ? `${(settings.radarRadiusMeters / 1000).toFixed(1)} km`
      : `${settings.radarRadiusMeters} m`

  return (
    <div className={styles.root}>
      <div className={styles.title}>Radar</div>

      {/* Radius */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Detection Range</div>
        <div className={styles.row}>
          <span className={styles.label}>Radius</span>
          <input
            type="range"
            className={styles.slider}
            min={1000}
            max={20000}
            step={500}
            value={settings.radarRadiusMeters}
            onChange={(e) => setSetting('radarRadiusMeters', Number(e.target.value))}
          />
          <span className={styles.sliderValue}>{radiusLabel}</span>
        </div>
      </div>

      {/* Simulation */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Simulation</div>

        <div className={styles.row}>
          <span className={styles.label}>Enable Simulation</span>
          <button
            className={`${styles.toggle} ${settings.radarSimulationEnabled ? styles.toggleOn : ''}`}
            onClick={() => handleToggle('radarSimulationEnabled')}
          />
        </div>
        <div className={styles.hint}>
          Generates simulated radar tracks for testing without a real AeroSentry device.
        </div>

        {settings.radarSimulationEnabled && (
          <>
            <div className={styles.row} style={{ marginTop: 14 }}>
              <span className={styles.label}>Friendly tracks</span>
              <input
                type="number"
                className={styles.numberInput}
                min={0}
                max={50}
                value={settings.radarSimulationFriendlyCount}
                onChange={(e) =>
                  setSetting(
                    'radarSimulationFriendlyCount',
                    Math.max(0, Math.min(50, Number(e.target.value)))
                  )
                }
              />
            </div>

            <div className={styles.row}>
              <span className={styles.label}>Hostile tracks</span>
              <input
                type="number"
                className={styles.numberInput}
                min={0}
                max={50}
                value={settings.radarSimulationHostileCount}
                onChange={(e) =>
                  setSetting(
                    'radarSimulationHostileCount',
                    Math.max(0, Math.min(50, Number(e.target.value)))
                  )
                }
              />
            </div>

            <div className={styles.row}>
              <span className={styles.label}>Center latitude</span>
              <input
                type="number"
                className={styles.coordInput}
                step={0.001}
                value={settings.radarSimulationLat}
                onChange={(e) => setSetting('radarSimulationLat', Number(e.target.value))}
              />
            </div>

            <div className={styles.row}>
              <span className={styles.label}>Center longitude</span>
              <input
                type="number"
                className={styles.coordInput}
                step={0.001}
                value={settings.radarSimulationLon}
                onChange={(e) => setSetting('radarSimulationLon', Number(e.target.value))}
              />
            </div>
            <div className={styles.hint}>
              Initial radar position. You can also drag the radar marker on the map overlay.
            </div>
          </>
        )}
      </div>
    </div>
  )
}
