import { command, defineIpcModule } from '../ipcModule'

export const actuatorModule = defineIpcModule({
  name: 'actuator',
  commands: {
    motorTest: command<
      [vehicleId: number, motorInstance: number, throttlePercent: number, timeoutSeconds: number],
      void
    >(),
    servoTest: command<[vehicleId: number, servoInstance: number, pwmValue: number], void>()
  },
  events: {}
})

export type ActuatorModule = typeof actuatorModule
