import type { LinkInterface } from '../main/links/LinkInterface'
import { dialectForName } from '../core/vehicle/dialect'
import type { VehicleContext, VehicleSubsystem } from '../main/vehicle/VehicleContext'

/**
 * Build a VehicleContext and bind a VehicleSubsystem to it for tests.
 * Defaults: sysid=1, compid=1, ArduPilot dialect. Override via opts.
 */
export function bindForTest(
  subsystem: VehicleSubsystem,
  link: LinkInterface,
  opts: { sysid?: number; compid?: number; dialect?: 'px4' | 'ardupilot' } = {}
): VehicleContext {
  const ctx: VehicleContext = {
    sysid: opts.sysid ?? 1,
    compid: opts.compid ?? 1,
    link,
    dialect: dialectForName(opts.dialect ?? 'ardupilot')
  }
  subsystem.bind(ctx)
  return ctx
}
