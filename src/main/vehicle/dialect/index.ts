import { Px4Dialect } from './Px4Dialect'
import { ArduPilotDialect } from './ArduPilotDialect'
import type { AutopilotName, VehicleDialect } from './VehicleDialect'

// MAV_AUTOPILOT_PX4 = 12. Anything else → treat as ArduPilot-flavoured.
const MAV_AUTOPILOT_PX4 = 12

const PX4_DIALECT = new Px4Dialect()
const ARDUPILOT_DIALECT = new ArduPilotDialect()

/** Pick the dialect for a HEARTBEAT's `autopilot` field. */
export function dialectForAutopilot(autopilot: number): VehicleDialect {
  return autopilot === MAV_AUTOPILOT_PX4 ? PX4_DIALECT : ARDUPILOT_DIALECT
}

/** Pick the dialect by name (for tests / explicit selection). */
export function dialectForName(name: AutopilotName): VehicleDialect {
  return name === 'px4' ? PX4_DIALECT : ARDUPILOT_DIALECT
}

export { Px4Dialect, ArduPilotDialect }
export * from './VehicleDialect'
