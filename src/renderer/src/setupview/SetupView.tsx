import { useSetupStore } from '../store/setupStore'
import { SetupSidebar } from './SetupSidebar'
import { SummaryPage } from './summary/SummaryPage'
import { ParameterEditorPage } from './parameters/ParameterEditorPage'
import { SensorCalibrationPage } from './sensors/SensorCalibrationPage'
import { RadioCalibrationPage } from './radio/RadioCalibrationPage'
import { FlightModesPage } from './flightmodes/FlightModesPage'
import { PowerPage } from './power/PowerPage'
import { SafetyPage } from './safety/SafetyPage'
import { AirframePage } from './airframe/AirframePage'
import { TuningPage } from './tuning/TuningPage'
import { ActuatorsPage } from './actuators/ActuatorsPage'
import { FirmwarePage } from './firmware/FirmwarePage'
import { VideoSettingsPage } from './video/VideoSettingsPage'
import { MavConsoleView } from './console/MavConsoleView'
import { MavInspectorView } from './inspector/MavInspectorView'
import styles from './SetupView.module.css'

function PageContent(): React.JSX.Element {
  const activePage = useSetupStore((s) => s.activePage)

  switch (activePage) {
    case 'summary':
      return <SummaryPage />
    case 'firmware':
      return <FirmwarePage />
    case 'parameters':
      return <ParameterEditorPage />
    case 'sensors':
      return <SensorCalibrationPage />
    case 'radio':
      return <RadioCalibrationPage />
    case 'flightModes':
      return <FlightModesPage />
    case 'power':
      return <PowerPage />
    case 'safety':
      return <SafetyPage />
    case 'airframe':
      return <AirframePage />
    case 'tuning':
      return <TuningPage />
    case 'actuators':
      return <ActuatorsPage />
    case 'video':
      return <VideoSettingsPage />
    case 'mavConsole':
      return <MavConsoleView />
    case 'mavInspector':
      return <MavInspectorView />
  }
}

export function SetupView(): React.JSX.Element {
  const activePage = useSetupStore((s) => s.activePage)
  const setActivePage = useSetupStore((s) => s.setActivePage)

  return (
    <div className={styles.root}>
      <SetupSidebar activePage={activePage} onSelect={setActivePage} />
      <div className={styles.content}>
        <PageContent />
      </div>
    </div>
  )
}
