/**
 * PX4 airframe definitions.
 * Sourced from QGroundControl's AirframeFactMetaData.xml + PX4 firmware metadata.
 * Each airframe has a SYS_AUTOSTART ID that configures the mixer and defaults.
 */

export interface Airframe {
  id: number
  name: string
}

export interface AirframeGroup {
  name: string
  image: string // SVG filename without extension
  airframes: Airframe[]
}

/** All PX4 airframe groups with their SYS_AUTOSTART IDs */
export const PX4_AIRFRAME_GROUPS: AirframeGroup[] = [
  {
    name: 'Quadrotor x',
    image: 'QuadRotorX',
    airframes: [
      { id: 4001, name: 'Generic Quadcopter' },
      { id: 4014, name: 'S500 Generic' },
      { id: 4015, name: 'Holybro S500' },
      { id: 4016, name: 'PX4 Vision Dev Kit v1' },
      { id: 4017, name: 'NXP HoverGames' },
      { id: 4019, name: 'Holybro X500 V2' },
      { id: 4020, name: 'PX4 Vision Dev Kit v1.5' },
      { id: 4050, name: 'Generic 250 Racer' },
      { id: 4052, name: 'HolyBro QAV250' },
      { id: 4053, name: 'Holybro Kopis 2' },
      { id: 4061, name: 'ATL Mantis EDU' },
      { id: 4071, name: 'UVify IFO' },
      { id: 4500, name: 'COEX Clover 4' },
      { id: 4601, name: 'Droneblocks DEXI 5' },
      { id: 4901, name: 'Crazyflie 2.1' }
    ]
  },
  {
    name: 'Quadrotor +',
    image: 'QuadRotorPlus',
    airframes: [{ id: 5001, name: 'Generic Quad + geometry' }]
  },
  {
    name: 'Quadrotor H',
    image: 'QuadRotorH',
    airframes: [{ id: 4041, name: 'BetaFPV Beta75X 2S Brushless Whoop' }]
  },
  {
    name: 'Hexarotor x',
    image: 'HexaRotorX',
    airframes: [
      { id: 6001, name: 'Generic Hexarotor x geometry' },
      { id: 6002, name: 'UVify Draco-R' }
    ]
  },
  {
    name: 'Hexarotor +',
    image: 'HexaRotorPlus',
    airframes: [{ id: 7001, name: 'Generic Hexarotor + geometry' }]
  },
  {
    name: 'Hexarotor Coaxial',
    image: 'Y6B',
    airframes: [{ id: 11001, name: 'Generic Hexarotor coaxial geometry' }]
  },
  {
    name: 'Octorotor x',
    image: 'OctoRotorX',
    airframes: [{ id: 8001, name: 'Generic Octocopter X geometry' }]
  },
  {
    name: 'Octorotor +',
    image: 'OctoRotorPlus',
    airframes: [{ id: 9001, name: 'Generic Octocopter + geometry' }]
  },
  {
    name: 'Octorotor Coaxial',
    image: 'OctoRotorXCoaxial',
    airframes: [{ id: 12001, name: 'Generic 10" Octo coaxial geometry' }]
  },
  {
    name: 'Tricopter Y+',
    image: 'Y6A',
    airframes: [{ id: 14001, name: 'Generic Multirotor with tilt' }]
  },
  {
    name: 'Helicopter',
    image: 'Helicopter',
    airframes: [{ id: 16001, name: 'Generic Helicopter (Tail ESC)' }]
  },
  {
    name: 'Standard Plane',
    image: 'Plane',
    airframes: [{ id: 2100, name: 'Generic Standard Plane' }]
  },
  {
    name: 'Flying Wing',
    image: 'FlyingWing',
    airframes: [{ id: 3000, name: 'Generic Flying Wing' }]
  },
  {
    name: 'Plane A-Tail',
    image: 'PlaneATail',
    airframes: [{ id: 2106, name: 'Applied Aeronautics Albatross' }]
  },
  {
    name: 'Standard VTOL',
    image: 'VTOLPlane',
    airframes: [{ id: 13000, name: 'Generic Standard VTOL' }]
  },
  {
    name: 'VTOL Tiltrotor',
    image: 'VTOLTiltRotor',
    airframes: [
      { id: 13030, name: 'Generic Quadplane VTOL Tiltrotor' },
      { id: 13100, name: 'Generic Tiltrotor VTOL' }
    ]
  },
  {
    name: 'VTOL Tailsitter',
    image: 'VTOLDuoRotorTailSitter',
    airframes: [{ id: 13200, name: 'Generic VTOL Tailsitter' }]
  },
  {
    name: 'Rover',
    image: 'Rover',
    airframes: [
      { id: 50000, name: 'Generic Rover Differential' },
      { id: 50001, name: 'Aion Robotics R1 UGV' },
      { id: 51000, name: 'Generic Rover Ackermann' },
      { id: 51001, name: 'Axial SCX10 2 Trail Honcho' },
      { id: 51002, name: 'NXP B3RB Rover Ackermann' },
      { id: 52000, name: 'Generic Rover Mecanum' }
    ]
  },
  {
    name: 'Airship',
    image: 'Airship',
    airframes: [{ id: 2507, name: 'Cloudship' }]
  },
  {
    name: 'Autogyro',
    image: 'Autogyro',
    airframes: [
      { id: 17002, name: 'ThunderFly Auto-G2' },
      { id: 17003, name: 'ThunderFly TF-G2' }
    ]
  },
  {
    name: 'Simulation',
    image: 'AirframeSimulation',
    airframes: [
      { id: 1001, name: 'HIL Quadcopter X' },
      { id: 1100, name: 'SIH Quadcopter X (legacy)' },
      { id: 1101, name: 'SIH Plane AERT (legacy)' },
      { id: 1102, name: 'SIH Tailsitter Duo (legacy)' },
      { id: 1103, name: 'SIH Standard VTOL QuadPlane (legacy)' },
      { id: 1104, name: 'SIH Rover Ackermann (legacy)' },
      { id: 10040, name: 'SIH Quadcopter X' },
      { id: 10041, name: 'SIH Plane AERT' },
      { id: 10042, name: 'SIH Tailsitter Duo' },
      { id: 10043, name: 'SIH Standard VTOL QuadPlane' },
      { id: 10044, name: 'SIH Rover Ackermann' }
    ]
  },
  {
    name: 'Underwater Robot',
    image: 'Vectored6DofUUV',
    airframes: [
      { id: 60000, name: 'Generic Underwater Robot' },
      { id: 60001, name: 'HippoCampus UUV' },
      { id: 60002, name: 'BlueROV2 Heavy Configuration' }
    ]
  }
]

/**
 * ArduCopter frame class + type definitions.
 * Maps FRAME_CLASS to image and label. FRAME_TYPE refines the geometry.
 */
export interface ArduFrameClass {
  value: number
  name: string
  image: string
}

export const ARDU_FRAME_CLASSES: ArduFrameClass[] = [
  { value: 1, name: 'Quad', image: 'QuadRotorX' },
  { value: 2, name: 'Hexa', image: 'HexaRotorX' },
  { value: 3, name: 'Octa', image: 'OctoRotorX' },
  { value: 4, name: 'OctaQuad', image: 'OctoRotorXCoaxial' },
  { value: 5, name: 'Y6', image: 'Y6B' },
  { value: 6, name: 'Heli', image: 'Helicopter' },
  { value: 7, name: 'Tri', image: 'Y6A' },
  { value: 10, name: 'Single/Coax', image: 'HelicopterCoaxial' },
  { value: 11, name: 'Coax', image: 'HelicopterCoaxial' },
  { value: 13, name: 'HeliQuad', image: 'QuadRotorX' },
  { value: 14, name: 'DodecaHexa', image: 'HexaRotorX' },
  { value: 15, name: 'HeliDual', image: 'Helicopter' }
]

export const ARDU_FRAME_TYPES: Array<{ value: number; name: string }> = [
  { value: 0, name: 'Plus (+)' },
  { value: 1, name: 'X' },
  { value: 2, name: 'V' },
  { value: 3, name: 'H' },
  { value: 4, name: 'V-Tail' },
  { value: 5, name: 'A-Tail' },
  { value: 10, name: 'Y6B' },
  { value: 11, name: 'Y6F' },
  { value: 12, name: 'BetaFlightX' },
  { value: 13, name: 'DJIX' },
  { value: 14, name: 'ClockwiseX' },
  { value: 18, name: 'BetaFlightXReversed' }
]

/** Find the PX4 airframe group that contains a given SYS_AUTOSTART ID */
export function findGroupByAutostartId(id: number): AirframeGroup | undefined {
  return PX4_AIRFRAME_GROUPS.find((g) => g.airframes.some((a) => a.id === id))
}
