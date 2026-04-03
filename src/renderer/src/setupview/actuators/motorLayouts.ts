/**
 * Motor position in the diagram (relative coordinates 0-100).
 * spin: true = CW, false = CCW
 */
export interface MotorDef {
  x: number
  y: number
  label: string
  cw: boolean
}

/**
 * ArduCopter motor layouts.
 * Motor numbering and spin directions follow ArduPilot documentation:
 * https://ardupilot.org/copter/docs/connect-escs-and-motors.html
 *
 * Coordinate system: x=right, y=down. Center at (50,50). Front is top.
 */

// Quad X (FRAME_CLASS=1, FRAME_TYPE=1) — most common
export const QUAD_X: MotorDef[] = [
  { x: 75, y: 25, label: '1', cw: false }, // front-right, CCW
  { x: 25, y: 75, label: '2', cw: false }, // rear-left, CCW
  { x: 25, y: 25, label: '3', cw: true }, // front-left, CW
  { x: 75, y: 75, label: '4', cw: true } // rear-right, CW
]

// Quad Plus (FRAME_CLASS=1, FRAME_TYPE=0)
export const QUAD_PLUS: MotorDef[] = [
  { x: 50, y: 20, label: '1', cw: false }, // front, CCW
  { x: 50, y: 80, label: '2', cw: false }, // rear, CCW
  { x: 20, y: 50, label: '3', cw: true }, // left, CW
  { x: 80, y: 50, label: '4', cw: true } // right, CW
]

// Hexa X (FRAME_CLASS=2, FRAME_TYPE=1)
export const HEXA_X: MotorDef[] = [
  { x: 75, y: 20, label: '1', cw: false },
  { x: 75, y: 80, label: '2', cw: true },
  { x: 25, y: 20, label: '3', cw: true },
  { x: 25, y: 80, label: '4', cw: false },
  { x: 90, y: 50, label: '5', cw: true },
  { x: 10, y: 50, label: '6', cw: false }
]

// Hexa Plus (FRAME_CLASS=2, FRAME_TYPE=0)
export const HEXA_PLUS: MotorDef[] = [
  { x: 50, y: 15, label: '1', cw: false },
  { x: 50, y: 85, label: '2', cw: true },
  { x: 82, y: 32, label: '3', cw: true },
  { x: 18, y: 68, label: '4', cw: false },
  { x: 82, y: 68, label: '5', cw: false },
  { x: 18, y: 32, label: '6', cw: true }
]

// Octa X (FRAME_CLASS=3, FRAME_TYPE=1)
export const OCTA_X: MotorDef[] = [
  { x: 68, y: 18, label: '1', cw: false },
  { x: 68, y: 82, label: '2', cw: false },
  { x: 32, y: 18, label: '3', cw: true },
  { x: 32, y: 82, label: '4', cw: true },
  { x: 85, y: 35, label: '5', cw: true },
  { x: 15, y: 65, label: '6', cw: false },
  { x: 85, y: 65, label: '7', cw: false },
  { x: 15, y: 35, label: '8', cw: true }
]

// Y6 (FRAME_CLASS=5) — coaxial on 3 arms
export const Y6: MotorDef[] = [
  { x: 75, y: 25, label: '1', cw: false },
  { x: 25, y: 25, label: '2', cw: true },
  { x: 50, y: 80, label: '3', cw: false },
  { x: 75, y: 25, label: '4', cw: true }, // coax under 1
  { x: 25, y: 25, label: '5', cw: false }, // coax under 2
  { x: 50, y: 80, label: '6', cw: true } // coax under 3
]

// Tri (FRAME_CLASS=7)
export const TRI: MotorDef[] = [
  { x: 75, y: 25, label: '1', cw: false },
  { x: 25, y: 25, label: '2', cw: true },
  { x: 50, y: 80, label: '4', cw: false } // motor 4 in ArduPilot (3 is yaw servo)
]

/** Map ArduPilot (frameClass, frameType) → motor layout */
export function getMotorLayout(frameClass: number, frameType: number): MotorDef[] | null {
  switch (frameClass) {
    case 1: // Quad
      return frameType === 0 ? QUAD_PLUS : QUAD_X
    case 2: // Hexa
      return frameType === 0 ? HEXA_PLUS : HEXA_X
    case 3: // Octa
      return OCTA_X
    case 5: // Y6
      return Y6
    case 7: // Tri
      return TRI
    default:
      return null
  }
}

/**
 * PX4 motor layouts.
 * Motor numbering follows PX4 airframe reference:
 * https://docs.px4.io/main/en/airframes/airframe_reference.html
 *
 * PX4 Quad X motor order differs from ArduPilot:
 *   PX4:       1=FR CCW, 2=RL CCW, 3=FL CW, 4=RR CW
 *   ArduPilot: 1=FR CCW, 2=RL CCW, 3=FL CW, 4=RR CW  (same positions, but spin may differ by FW version)
 */
export const PX4_QUAD_X: MotorDef[] = [
  { x: 75, y: 25, label: '1', cw: true }, // front-right, CW
  { x: 25, y: 75, label: '2', cw: false }, // rear-left, CCW
  { x: 25, y: 25, label: '3', cw: false }, // front-left, CCW
  { x: 75, y: 75, label: '4', cw: true } // rear-right, CW
]

export const PX4_QUAD_PLUS: MotorDef[] = [
  { x: 50, y: 20, label: '1', cw: false }, // front, CCW
  { x: 80, y: 50, label: '2', cw: false }, // right, CCW
  { x: 50, y: 80, label: '3', cw: true }, // rear, CW
  { x: 20, y: 50, label: '4', cw: true } // left, CW
]

export const PX4_HEXA_X: MotorDef[] = [
  { x: 75, y: 20, label: '1', cw: false },
  { x: 75, y: 80, label: '2', cw: false },
  { x: 50, y: 15, label: '3', cw: true },
  { x: 25, y: 80, label: '4', cw: true },
  { x: 25, y: 20, label: '5', cw: true },
  { x: 50, y: 85, label: '6', cw: false }
]

export const PX4_HEXA_PLUS: MotorDef[] = [
  { x: 50, y: 15, label: '1', cw: false },
  { x: 82, y: 32, label: '2', cw: false },
  { x: 82, y: 68, label: '3', cw: true },
  { x: 50, y: 85, label: '4', cw: true },
  { x: 18, y: 68, label: '5', cw: true },
  { x: 18, y: 32, label: '6', cw: false }
]

/**
 * Map PX4 SYS_AUTOSTART airframe ID to motor layout and display name.
 * IDs follow PX4 airframe numbering: 4xxx=Quad, 6xxx=Hexa, 8xxx=Octa, etc.
 */
export function getPx4MotorLayout(autostart: number): { layout: MotorDef[]; name: string } | null {
  // 4xxx = Quadrotor
  if (autostart >= 4000 && autostart < 5000) {
    // 4010, 4011 = Plus; rest = X
    if (autostart === 4010 || autostart === 4011) {
      return { layout: PX4_QUAD_PLUS, name: 'Quad +' }
    }
    return { layout: PX4_QUAD_X, name: 'Quad X' }
  }
  // 6xxx = Hexarotor
  if (autostart >= 6000 && autostart < 7000) {
    if (autostart === 6002) {
      return { layout: PX4_HEXA_PLUS, name: 'Hexa +' }
    }
    return { layout: PX4_HEXA_X, name: 'Hexa X' }
  }
  // No specific PX4 layouts for octa/Y6/tri yet — return null
  return null
}

export const FRAME_CLASS_NAMES: Record<number, string> = {
  0: 'Undefined',
  1: 'Quad',
  2: 'Hexa',
  3: 'Octa',
  4: 'OctaQuad',
  5: 'Y6',
  6: 'Heli',
  7: 'Tri',
  8: 'SingleCopter',
  9: 'CoaxCopter',
  10: 'BiCopter',
  11: 'Heli_Dual',
  12: 'DodecaHexa',
  13: 'HeliQuad'
}

export const FRAME_TYPE_NAMES: Record<number, string> = {
  0: 'Plus (+)',
  1: 'X',
  2: 'V',
  3: 'H',
  4: 'V-Tail',
  5: 'A-Tail'
}
