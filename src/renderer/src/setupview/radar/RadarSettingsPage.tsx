import { useCallback } from 'react'
import { useSettingsStore } from '../../store/settingsStore'
import styles from './RadarSettingsPage.module.css'

export function RadarSettingsPage(): React.JSX.Element {
  const settings = useSettingsStore((s) => s.settings)
  const setSetting = useSettingsStore((s) => s.setSetting)

  const handleToggle = useCallback(
    (
      key:
        | 'radarSimulationEnabled'
        | 'trackingAutoStopOnLost'
        | 'trackingAutoStopOnModeChange'
        | 'trackingAutoStopOnDisarm'
    ) => {
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
        <div className={styles.row}>
          <span className={styles.label}>Track stale timeout (s)</span>
          <input
            type="number"
            className={styles.numberInput}
            min={1}
            max={120}
            step={1}
            value={Math.round(settings.radarTrackStaleMs / 1000)}
            onChange={(e) =>
              setSetting(
                'radarTrackStaleMs',
                Math.max(1000, Math.min(120000, Number(e.target.value) * 1000))
              )
            }
          />
        </div>
        <div className={styles.hint}>
          Tracks not updated within this window are pruned from the radar.
        </div>
      </div>

      {/* Target tracking */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Target Tracking</div>
        <div className={styles.row}>
          <span className={styles.label}>Altitude mode</span>
          <select
            className={styles.selectInput}
            value={settings.trackingAltitudeMode}
            onChange={(e) =>
              setSetting(
                'trackingAltitudeMode',
                e.target.value as 'hold-engagement' | 'match-track' | 'follow-vehicle'
              )
            }
          >
            <option value="hold-engagement">Hold engagement alt</option>
            <option value="match-track">Match track alt</option>
            <option value="follow-vehicle">Follow vehicle alt</option>
          </select>
        </div>
        <div className={styles.hint}>
          Controls the altitude sent to the vehicle during tracking. Hold = captured at engage;
          match = track's reported altitude; follow = vehicle's live altitude.
        </div>

        <div className={styles.row} style={{ marginTop: 14 }}>
          <span className={styles.label}>Auto-disengage when track lost</span>
          <button
            className={`${styles.toggle} ${settings.trackingAutoStopOnLost ? styles.toggleOn : ''}`}
            onClick={() => handleToggle('trackingAutoStopOnLost')}
          />
        </div>
        <div className={styles.row}>
          <span className={styles.label}>Auto-disengage on flight mode change</span>
          <button
            className={`${styles.toggle} ${settings.trackingAutoStopOnModeChange ? styles.toggleOn : ''}`}
            onClick={() => handleToggle('trackingAutoStopOnModeChange')}
          />
        </div>
        <div className={styles.row}>
          <span className={styles.label}>Auto-disengage on disarm</span>
          <button
            className={`${styles.toggle} ${settings.trackingAutoStopOnDisarm ? styles.toggleOn : ''}`}
            onClick={() => handleToggle('trackingAutoStopOnDisarm')}
          />
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

            <div className={styles.row} style={{ marginTop: 14 }}>
              <span className={styles.label}>Target speed min (m/s)</span>
              <input
                type="number"
                className={styles.numberInput}
                min={0}
                max={200}
                step={1}
                value={settings.radarSimulationMinSpeedMs}
                onChange={(e) => {
                  const v = Math.max(0, Math.min(200, Number(e.target.value)))
                  setSetting('radarSimulationMinSpeedMs', v)
                  if (settings.radarSimulationMaxSpeedMs < v) {
                    setSetting('radarSimulationMaxSpeedMs', v)
                  }
                }}
              />
            </div>
            <div className={styles.row}>
              <span className={styles.label}>Target speed max (m/s)</span>
              <input
                type="number"
                className={styles.numberInput}
                min={0}
                max={200}
                step={1}
                value={settings.radarSimulationMaxSpeedMs}
                onChange={(e) => {
                  const v = Math.max(
                    settings.radarSimulationMinSpeedMs,
                    Math.min(200, Number(e.target.value))
                  )
                  setSetting('radarSimulationMaxSpeedMs', v)
                }}
              />
            </div>
            <div className={styles.hint}>
              Each simulated track is assigned a random speed in this range.
            </div>
          </>
        )}
      </div>
    </div>
  )
}
