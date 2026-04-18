import type { CoreGroup, ExtendedStateGroup } from './VehicleState'

const MAV_AUTOPILOT_ARDUPILOTMEGA = 3
const MAV_STATE_ACTIVE = 4
const MAV_STATE_CRITICAL = 5
const MAV_STATE_EMERGENCY = 6
const MAV_LANDED_STATE_IN_AIR = 2
const MAV_LANDED_STATE_TAKEOFF = 3
const MAV_LANDED_STATE_LANDING = 4

/**
 * Mirrors QGroundControl's `Vehicle::_flying`:
 * - ArduPilot doesn't reliably emit EXTENDED_SYS_STATE, so QGC infers flying
 *   from HEARTBEAT (armed && system_status ∈ ACTIVE/CRITICAL/EMERGENCY).
 * - Everything else (PX4, etc.) is driven by EXTENDED_SYS_STATE.landed_state.
 */
export function isVehicleFlying(
  core: Pick<CoreGroup, 'armed' | 'systemStatus' | 'autopilot'>,
  extendedState: Pick<ExtendedStateGroup, 'landedState'>
): boolean {
  if (core.autopilot === MAV_AUTOPILOT_ARDUPILOTMEGA) {
    return (
      core.armed &&
      (core.systemStatus === MAV_STATE_ACTIVE ||
        core.systemStatus === MAV_STATE_CRITICAL ||
        core.systemStatus === MAV_STATE_EMERGENCY)
    )
  }
  const ls = extendedState.landedState
  return (
    ls === MAV_LANDED_STATE_IN_AIR ||
    ls === MAV_LANDED_STATE_TAKEOFF ||
    ls === MAV_LANDED_STATE_LANDING
  )
}
