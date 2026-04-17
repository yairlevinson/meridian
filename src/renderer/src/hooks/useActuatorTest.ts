import { useCallback } from 'react'
import { useVehicleStore } from '../store/vehicleStore'

/** Hook: motor and servo test commands via bridge */
export function useActuatorTest(vehicleIdOverride?: number): {
  motorTest: (
    motorInstance: number,
    throttlePercent: number,
    timeoutSeconds: number
  ) => Promise<void> | undefined
  servoTest: (servoInstance: number, pwmValue: number) => Promise<void> | undefined
  stopAllMotors: (motorCount: number) => void
} {
  const activeId = useVehicleStore((s) => s.activeVehicleId)
  const vid = vehicleIdOverride ?? activeId ?? 1

  const motorTest = useCallback(
    (motorInstance: number, throttlePercent: number, timeoutSeconds: number) => {
      return window.bridge?.actuatorMotorTest(vid, motorInstance, throttlePercent, timeoutSeconds)
    },
    [vid]
  )

  const servoTest = useCallback(
    (servoInstance: number, pwmValue: number) => {
      return window.bridge?.actuatorServoTest(vid, servoInstance, pwmValue)
    },
    [vid]
  )

  const stopAllMotors = useCallback(
    (motorCount: number) => {
      for (let i = 1; i <= motorCount; i++) {
        window.bridge?.actuatorMotorTest(vid, i, 0, 0)
      }
    },
    [vid]
  )

  return { motorTest, servoTest, stopAllMotors }
}
