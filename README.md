# Meridian

A modern ground control station for MAVLink-based autonomous vehicles, built with Electron, React, and TypeScript. Meridian is a from-scratch reimagining of [QGroundControl](https://github.com/mavlink/qgroundcontrol) using web technologies for faster iteration, easier extensibility, and a modern development experience.

## Features

### Live Telemetry

- Real-time attitude (roll, pitch, yaw), GPS position, altitude, and velocity display
- Distance-to-home instrument with automatic m/km unit switching
- Delta-encoded IPC for efficient main→renderer telemetry streaming
- Support for multiple simultaneous vehicles with independent telemetry streams

### Interactive Map (Fly View)

- MapLibre GL-powered map with live vehicle position tracking
- Home position marker ("H") displayed when the vehicle reports a valid home location
- Multiple tile providers: Google Satellite, Google Hybrid, Bing Aerial, Esri World Imagery, OpenStreetMap, Statkart Topo, and Mapbox Satellite
- Custom `tile://` protocol proxy bypasses CORS restrictions with an LRU cache (500 tiles)
- Prominent vehicle indicators with color-coded active/inactive states

### Mission Planning (Plan View)

- Interactive waypoint editing with drag-and-drop on the map
- Home position displayed as waypoint 0 in the mission sidebar
- Full MAVLink mission protocol: upload, download, and clear missions
- Save/load `.plan` files (QGroundControl-compatible format)
- Visual mission path overlay with numbered waypoint markers

### Vehicle Management

- Automatic vehicle discovery from MAVLink heartbeats
- Multi-vehicle support with independent state tracking
- Arm/disarm commands via MAVLink COMMAND_LONG
- ADS-B traffic vehicle tracking and display

### Connectivity

- **UDP mode**: Listen on a configurable port (default 14550) for MAVLink packets
- **TCP mode**: Connect to multiple SITL instances simultaneously via `GC_TCP_LINKS`
- Automatic data stream requests for both ArduPilot and PX4 autopilots
- GCS heartbeat broadcasting for PX4 compatibility

### Camera Control

- MAVLink Camera Protocol v2 (CAMERA_INFORMATION, CAMERA_SETTINGS, CAMERA_CAPTURE_STATUS)
- Photo capture (single shot and interval/timelapse)
- Video recording start/stop with recording time tracking
- Camera mode switching (photo/video)
- Storage information and format commands
- Auto-discovery from camera component heartbeats with retry logic
- Adaptive capture status polling (QGC-compatible intervals)

### Additional Systems

- MAVLink Inspector with real-time message viewer and field drill-down
- MAVLink Console (serial terminal over MAVLink)
- MAVLink forwarding with configurable UDP targets
- GeoFence and Rally Point management
- MAVLink FTP for file transfer to/from the vehicle

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Renderer (React + Zustand + MapLibre)          │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────┐│
│  │vehicleStore│ │missionStore│ │settingsStore    ││
│  └─────┬────┘ └─────┬────┘ └──────────────────┘│
│        │            │                            │
│        └────────────┼── contextBridge (preload) ─┤
│                     │                            │
├─────────────────────┼────────────────────────────┤
│  Main Process       │                            │
│  ┌──────────────────┴───────────────────┐        │
│  │ IPC Bridge (ipcBridge.ts)            │        │
│  │  - delta-encoded telemetry push      │        │
│  │  - command request/response          │        │
│  └──────────────────┬───────────────────┘        │
│  ┌──────────────────┴───────────────────┐        │
│  │ VehicleManager → Vehicle instances   │        │
│  │  - PlanManager (missions/fence/rally)│        │
│  │  - GimbalController                  │        │
│  │  - AdsbVehicleManager                │        │
│  └──────────────────┬───────────────────┘        │
│  ┌──────────────────┴───────────────────┐        │
│  │ LinkManager / UdpLink / TcpLink      │        │
│  │  - MAVLink v2 parse & serialize      │        │
│  └──────────────────────────────────────┘        │
└─────────────────────────────────────────────────┘
         │
         ▼
   MAVLink Vehicle (ArduPilot / PX4 SITL or real hardware)
```

### Data Flow

1. **Inbound telemetry**: MAVLink packets arrive via UDP or TCP → parsed by `node-mavlink` → routed through `VehicleManager` → state updates pushed to renderer via delta-encoded IPC → Zustand stores update → React re-renders
2. **Outbound commands**: React component calls `window.bridge.methodName()` → IPC to main process → serialized to MAVLink v2 → sent via the vehicle's command link (UDP/TCP)
3. **Map tiles**: MapLibre requests `tile://tiles/{provider}/{z}/{x}/{y}` → Electron's custom protocol handler resolves the real HTTPS URL → fetches via `net.fetch` → caches in LRU → returns to renderer

## Getting Started

### Prerequisites

- **Node.js** >= 18
- **npm** >= 9

### Install

```bash
npm install
```

### Development

```bash
npm run dev
```

This starts the Electron app in development mode with hot-reload for the renderer process.

### Connect to a Vehicle

#### Option 1: UDP (default)

Meridian listens on UDP port 14550 by default. Point your vehicle or SITL to send MAVLink to `127.0.0.1:14550`.

```bash
# Override the UDP port
GC_UDP_PORT=14551 npm run dev
```

#### Option 2: TCP (SITL)

Connect directly to one or more ArduPilot/PX4 SITL instances:

```bash
# Single SITL
GC_TCP_LINKS=127.0.0.1:5760 npm run dev

# Multiple SITLs
GC_TCP_LINKS=127.0.0.1:5760,127.0.0.1:5761,127.0.0.1:5762 npm run dev
```

#### Option 3: TCP via Bridge

For setups where SITL exposes TCP and you need UDP translation:

```bash
# Terminal 1: Start SITL (ArduPilot example)
sim_vehicle.py -v ArduCopter --no-mavproxy

# Terminal 2: Start the bridge
python3 bridge.py

# Terminal 3: Start Meridian (uses UDP 14550 by default)
npm run dev
```

### Environment Variables

| Variable       | Default   | Description                                                |
| -------------- | --------- | ---------------------------------------------------------- |
| `GC_UDP_PORT`  | `14550`   | UDP port to listen for MAVLink                             |
| `GC_TCP_LINKS` | _(empty)_ | Comma-separated `host:port` pairs for TCP SITL connections |

## Code Walkthrough

Interactive [CodeTour](https://marketplace.visualstudio.com/items?itemName=vsls-live-share.codetour) walkthroughs are included in `.tours/` to help new developers understand the full-stack data flow. Install the CodeTour VS Code extension, then open the CodeTour panel to start.

| Tour                           | Steps | What you'll learn                                                      |
| ------------------------------ | ----- | ---------------------------------------------------------------------- |
| 1/3: From Radio Waves to State | 14    | MAVLink decode pipeline, VehicleState grouping, delta-encoded IPC push |
| 2/3: From State to Pixels      | 13    | Preload bridge, Zustand stores, React hooks, component rendering       |
| 3/3: From Click to Autopilot   | 12    | Command dispatch, MavCommandQueue with retry, COMMAND_ACK round-trip   |

The tours are designed for experienced developers with little or no React experience. React concepts (components, hooks, props, Zustand) are explained inline as they appear.

## Testing

### Unit Tests

```bash
# Run all unit tests
npm test

# Run with coverage
npm run test -- --coverage

# Run a specific test file
npm test -- test/gimbalController.test.ts
```

Unit tests cover:

- Vehicle state management and telemetry parsing
- Mission protocol (upload/download/error handling/retries)
- MAVLink FTP (chunked transfers, retries, path validation)
- TCP/UDP link lifecycle and error handling
- ADS-B vehicle tracking and unit conversions
- Gimbal quaternion math and command sending
- MAVLink camera protocol (discovery, capture, recording, polling)
- GeoFence and Rally Point protocols
- Tile provider URL resolution
- Zustand store logic
- Tlog replay integration (see below)

### Integration Tests (Tlog Replay)

Integration tests feed real MAVLink captures (tlogs) through the production `MavlinkChannel` → `Vehicle` pipeline, verifying telemetry state without a live autopilot.

```bash
# Run tlog replay tests (uses synthetic data if real captures aren't available)
npm test -- test/tlogReplay.test.ts
```

Tests cover: heartbeat/vehicle detection, GPS position, armed/disarmed tracking, altitude changes, flight mode resolution, attitude, and GPS fix type.

#### Generating Real Captures from PX4 SITL

To replace the synthetic fallback with real PX4 telemetry:

```bash
# 1. Install Python dependencies
pip3 install mavsdk pymavlink

# 2. Start PX4 SITL (in the PX4-Autopilot directory)
make px4_sitl gz_x500

# 3. In another terminal, run all capture scenarios
python3 scripts/capture-tlog.py --scenario all

# 4. List available scenarios
python3 scripts/capture-tlog.py --list
```

This generates `.tlog` files in `test/fixtures/captures/` for 4 scenarios: `arm-takeoff-land`, `rtl`, `gps-startup`, and `mode-changes`. The capture script uses MAVSDK for vehicle control and pymavlink for raw MAVLink recording.

> **Note:** PX4 v1.17+ defaults `COM_ARMABLE=0` (safety mode). The capture script sets this automatically via MAVSDK params.

### End-to-End Tests

```bash
# Run E2E tests with synthetic vehicle (no SITL needed)
npm run test:e2e

# Run E2E tests against Docker SITL (starts container automatically)
npm run test:e2e:sitl

# Run E2E tests against an already-running SITL (e.g. PX4 Gazebo on UDP 14550)
npm run test:e2e:sitl:external
```

E2E tests verify:

- Connection state transitions (WAITING → CONNECTED)
- Attitude and GPS telemetry display
- Arm/disarm state rendering
- Continuous streaming performance
- FPS and IPC latency benchmarks
- Visual regression screenshots

> **Note:** If `ELECTRON_RUN_AS_NODE` is set in your shell (common when working with Electron tooling), E2E tests will fail because Electron runs as plain Node.js instead of a desktop app. The test fixtures delete this variable automatically, but if you see `Process failed to launch!` errors, check your environment.

### SITL Testing

#### ArduPilot SITL

```bash
# Start ArduPilot SITL
sim_vehicle.py -v ArduCopter --no-mavproxy

# In another terminal, connect Meridian via TCP
GC_TCP_LINKS=127.0.0.1:5760 npm run dev
```

#### PX4 SITL with Gazebo

```bash
# In the PX4-Autopilot directory, build and run PX4 SITL with Gazebo
make px4_sitl gz_x500

# In another terminal, start Meridian (PX4 broadcasts MAVLink on UDP 14550 by default)
npm run dev

# To run E2E tests against the running PX4 instance
npm run test:e2e:sitl:external
```

### PX4 SITL E2E Test Suite

A comprehensive Playwright test suite validates Meridian's major features against a real PX4 SITL + Gazebo simulation. Tests auto-launch PX4 via `GazeboLauncher` and run 10 spec files covering connection, telemetry, arm/disarm, guided flight, flight modes, missions, parameters, preflight checks, camera, and video.

#### Prerequisites

- **PX4-Autopilot** built for SITL: `make px4_sitl gz_x500_depth` (in the PX4-Autopilot directory)
- **Gazebo** (Harmonic) installed and working
- The `x500_depth` model is used for camera/video tests

#### Running

```bash
# Auto-launch PX4 + Gazebo and run all SITL tests
PX4_HOME=/path/to/PX4-Autopilot GC_E2E_SITL=1 GC_E2E_SITL_EXTERNAL=1 \
  npx playwright test sitl-

# Run a specific test file
PX4_HOME=/path/to/PX4-Autopilot GC_E2E_SITL=1 GC_E2E_SITL_EXTERNAL=1 \
  npx playwright test sitl-03

# Or use the npm script
PX4_HOME=/path/to/PX4-Autopilot npm run test:e2e:gazebo
```

#### Test Files

| File                    | Tests | What it validates                                                                       |
| ----------------------- | ----- | --------------------------------------------------------------------------------------- |
| `sitl-01-connection`    | 4     | Heartbeat, autopilot ID, mode decode, map marker                                        |
| `sitl-02-telemetry`     | 10    | Attitude, GPS, heading, battery, sensors, home position, FPS, IPC latency               |
| `sitl-03-arm-disarm`    | 6     | Arm via UI hold-button, arm via IPC, disarm via RTL                                     |
| `sitl-04-guided-flight` | 5     | Takeoff, goto, pause, RTL, land (serial chain)                                          |
| `sitl-05-flight-modes`  | 5     | Mode display, PX4 custom_mode decoding (mode switching skipped — no RC in SITL)         |
| `sitl-06-mission`       | 6     | Upload, download round-trip, arm + Auto:Mission, waypoints, RTL + land                  |
| `sitl-07-parameters`    | 4     | Auto-download, known params, set/read-back, param count                                 |
| `sitl-08-preflight`     | 5     | GPS check, battery, sensors, comms, checklist count                                     |
| `sitl-09-camera`        | 3     | Camera discovery, capabilities, photo capture (skipped if no camera)                    |
| `sitl-10-video`         | 5     | Video start/stop, stream state, `gz-video-stream.py` integration (skipped if no script) |

#### Architecture

- **GazeboLauncher** (`test/e2e/sitl/gazeboLauncher.ts`): Spawns PX4 from the pre-built binary, waits for EKF convergence ("home set" in PX4 stdout), cleans stale state files between runs.
- **Shared helpers** (`test/e2e/helpers/sitlHelpers.ts`): `waitConnected`, `waitGpsFix`, `waitArmReady`, `armVehicle`, `disarmVehicle`, etc. All use Playwright's `expect().toPass()` polling against the rendered UI.
- **Single PX4 process** shared across all test files. Each file gets a fresh Electron app but connects to the same PX4. Tests within a file use `test.describe.serial()`.

#### Known Limitations

- **PX4 SITL has no RC input**: Manual/Stabilized/AltCtl/PosCtl modes revert immediately. `DO_SET_MODE` returns ACCEPTED but PX4 doesn't actually change mode. Only `Auto:*` modes work reliably.
- **Arm non-determinism after flight cycles**: PX4 may need 15-90s of recovery time between flight cycles before accepting arm commands. `armVehicle()` retries up to 6 times with 15s gaps.
- **`emergencyStop` corrupts PX4 state**: Force disarm (param2=21196) can prevent subsequent arming. Tests use RTL-based disarm instead, with emergencyStop only as a last resort.
- **Cross-file arm flakiness**: After sitl-03's flight cycles, sitl-04 and sitl-06 may fail to arm. The retry logic handles this most of the time but not always.

## Build

```bash
# macOS
npm run build:mac

# Windows
npm run build:win

# Linux
npm run build:linux
```

Build artifacts are output to the `dist/` directory.

## Project Structure

```
meridian/
├── src/
│   ├── main/                    # Electron main process
│   │   ├── index.ts             # App entry, window creation, MAVLink setup
│   │   ├── ipcBridge.ts         # IPC handlers, delta-encoded telemetry push
│   │   ├── vehicleState.ts      # Vehicle state groups, MAVLink → telemetry
│   │   ├── mavlink/
│   │   │   ├── MavlinkProtocol.ts   # Channel pool + parse/serialize
│   │   │   └── constants.ts
│   │   ├── vehicle/
│   │   │   ├── VehicleManager.ts    # Multi-vehicle registry
│   │   │   └── Vehicle.ts          # Per-vehicle state & message handling
│   │   ├── links/
│   │   │   ├── LinkManager.ts       # Multi-link management, serial auto-connect
│   │   │   ├── UdpLink.ts          # UDP socket wrapper
│   │   │   └── TcpLink.ts          # TCP socket wrapper
│   │   ├── camera/
│   │   │   └── CameraManager.ts     # MAVLink camera protocol
│   │   ├── calibration/
│   │   │   ├── CalibrationManager.ts    # Sensor calibration state machine
│   │   │   └── RcCalibrationManager.ts  # RC calibration (PX4 + ArduPilot)
│   │   ├── mission/
│   │   │   └── PlanManager.ts       # Mission/fence/rally protocol
│   │   ├── parameters/
│   │   │   └── ParameterManager.ts  # Parameter download/set protocol
│   │   ├── ftp/
│   │   │   └── FTPManager.ts        # MAVLink FTP implementation
│   │   ├── forwarding/
│   │   │   └── MavlinkForwarder.ts  # UDP MAVLink forwarding
│   │   ├── video/
│   │   │   └── VideoManager.ts      # ffmpeg + WebSocket streaming
│   │   ├── settings/
│   │   │   └── SettingsManager.ts   # App settings persistence
│   │   └── terrain/                 # Custom tile:// protocol handler
│   ├── renderer/                # React renderer process
│   │   └── src/
│   │       ├── App.tsx
│   │       ├── flyview/             # FlyView, instruments, guided actions
│   │       ├── planview/            # Mission planning UI
│   │       ├── setupview/           # 15-page setup & configuration
│   │       │   ├── summary/         # Dashboard with card-based checklist
│   │       │   ├── sensors/         # Accel, compass, gyro calibration
│   │       │   ├── radio/           # RC calibration with channel bars
│   │       │   ├── flightmodes/     # Flight mode assignment
│   │       │   ├── power/           # Battery config with cell visualization
│   │       │   ├── safety/          # Failsafe config (PX4 + ArduPilot)
│   │       │   ├── airframe/        # Frame selection with SVG previews
│   │       │   ├── actuators/       # Motor test, spin direction, outputs
│   │       │   ├── tuning/          # PID tuning groups
│   │       │   ├── firmware/        # Firmware upgrade
│   │       │   ├── parameters/      # Parameter editor
│   │       │   ├── video/           # Video stream settings
│   │       │   ├── inspector/       # MAVLink message inspector
│   │       │   ├── console/         # MAVLink serial console
│   │       │   └── forwarding/      # MAVLink forwarding settings
│   │       ├── components/          # Shared UI (AttitudeIndicator, Compass, etc.)
│   │       ├── store/               # Zustand stores
│   │       ├── hooks/               # useVehicle, useMission, useCommand, etc.
│   │       └── map/providers/       # Tile provider registry
│   ├── preload/                 # Electron preload (contextBridge)
│   │   └── index.ts
│   └── shared-types/            # Types shared between main & renderer
│       └── ipc/
├── test/
│   ├── *.test.ts                # Unit tests (Vitest)
│   └── e2e/                     # Playwright E2E tests
├── .github/workflows/
│   └── build.yml                # CI: prettier, typecheck, tests, cross-platform builds
├── bridge.py                    # TCP↔UDP MAVLink bridge for SITL
├── electron.vite.config.ts
├── electron-builder.yml
├── tsconfig.json
└── package.json
```

## Technology Stack

| Layer            | Technology                      |
| ---------------- | ------------------------------- |
| Desktop shell    | Electron                        |
| UI framework     | React 19 + TypeScript           |
| State management | Zustand                         |
| Map rendering    | MapLibre GL JS                  |
| MAVLink parsing  | node-mavlink + mavlink-mappings |
| Build tooling    | electron-vite (Vite-based)      |
| Unit testing     | Vitest                          |
| E2E testing      | Playwright                      |
| Packaging        | electron-builder                |

## Feature Parity with QGroundControl

Meridian aims to cover the core functionality of [QGroundControl](https://github.com/mavlink/qgroundcontrol). The table below tracks what is implemented and what remains.

### Communication & Links

| Feature             | Status | Notes                                                    |
| ------------------- | ------ | -------------------------------------------------------- |
| UDP Link            | ✅     | Configurable port, auto-discovery                        |
| TCP Link            | ✅     | Multi-SITL support                                       |
| Serial Link         | ✅     | Auto-detect USB autopilots, baud rate, flow control, DTR |
| MAVLink Forwarding  | ✅     | UDP forwarding with configurable targets, settings UI    |
| Log Replay Link     | ✅     | `.mavlink` binary replay with speed control              |
| Multi-Link Failover | ✅     | Heartbeat-based automatic failover                       |
| Bluetooth Link      | ❌     |                                                          |

### Vehicle Setup & Configuration

| Feature                | Status | Notes                                                               |
| ---------------------- | ------ | ------------------------------------------------------------------- |
| Setup View             | ✅     | 15-page setup with sidebar navigation and summary dashboard         |
| Summary Dashboard      | ✅     | Card-based overview with clickable navigation to setup pages        |
| Airframe Selection     | ✅     | 11 frame classes, 18+ frame types                                   |
| Sensor Calibration     | ✅     | Accel, compass, gyro, level horizon, baro, ESC (8 types)            |
| Radio/RC Calibration   | ✅     | PX4 + ArduPilot, 16-channel stick detection, min/max/trim, reversal |
| Flight Mode Assignment | ✅     | PX4 + ArduPilot (all 4 vehicle types), switch indicators            |
| Power/Battery Config   | ✅     | PX4 + ArduPilot, voltage/current calibration, cell visualization    |
| Safety/Failsafe Config | ✅     | PX4 + ArduPilot, battery/RC/GCS/datalink failsafe, geofence, RTL    |
| PID Tuning             | ✅     | 8 groups, 40+ params (rate, position, velocity)                     |
| Firmware Upgrade       | ✅     | MAVLink FTP upload, reboot, board info                              |
| Parameter Editor       | ✅     | Search, edit, refresh, progress tracking                            |
| Motor/Servo Testing    | ✅     | Motor test sliders, servo test, motor identification wizard         |
| Motor Spin Direction   | ✅     | Visual CW/CCW diagram for Quad/Hexa/Octa/Y6/Tri frames              |
| Output Configuration   | ✅     | SERVOx function assignment, PWM min/max/trim, reversed              |
| Video Settings         | ✅     | Stream source config, recording format, settings UI                 |
| Gimbal/Mount Setup UI  | ❌     |                                                                     |

### Mission Planning

| Feature                 | Status | Notes                                             |
| ----------------------- | ------ | ------------------------------------------------- |
| Waypoints               | ✅     | NAV_WAYPOINT, Takeoff, Land, RTL, Loiter variants |
| GeoFence                | ✅     | Polygon and circle inclusion/exclusion            |
| Rally Points            | ✅     | Load, write, clear                                |
| Plan File I/O           | ✅     | `.plan` format (QGC-compatible)                   |
| Mission Stats           | ✅     | Distance, ETA, waypoint count                     |
| Survey/Grid Scan        | ❌     | Automated camera survey patterns                  |
| Structure Scan          | ❌     | Vertical structure scanning                       |
| Corridor Scan           | ❌     | Linear corridor inspection                        |
| Spline Waypoints        | ❌     | Curved flight paths                               |
| Landing Patterns        | ❌     | Fixed-wing/VTOL approach patterns                 |
| Camera Trigger Commands | ❌     | In-mission photo/video control                    |
| ROI Commands            | ❌     | Region of interest in missions                    |
| DO_JUMP / Flow Control  | ❌     | Mission loops and conditionals                    |
| Speed/Delay Commands    | ❌     | In-mission speed changes, waits                   |
| Servo/Relay Commands    | ❌     | Hardware actuator control                         |
| KML Import              | ✅     | Import KML polygons/lines/points as map overlays  |
| KML/KMZ Export          | ❌     |                                                   |

### Flight Control

| Feature              | Status | Notes                         |
| -------------------- | ------ | ----------------------------- |
| Arm / Disarm         | ✅     |                               |
| Takeoff              | ✅     | Configurable altitude         |
| Land                 | ✅     |                               |
| RTL                  | ✅     |                               |
| Go-To Location       | ✅     | Click-on-map reposition       |
| Pause / Resume       | ✅     |                               |
| Emergency Stop       | ✅     | Hold-to-confirm safety UX     |
| Pre-Flight Checklist | ✅     | 6 automated + 4 manual checks |
| Change Altitude      | ❌     | In-flight altitude adjustment |
| Change Heading       | ❌     |                               |
| Change Speed         | ❌     |                               |
| Orbit                | ❌     | Circle around point           |
| Follow Me            | ❌     | GPS-based follow mode         |
| Landing Gear Control | ❌     |                               |

### Joystick & RC

| Feature                    | Status | Notes                                |
| -------------------------- | ------ | ------------------------------------ |
| Gamepad/Joystick Input     | ✅     | Deadband, expo curves, 30 Hz output  |
| Axis Mapping               | ✅     | Roll, pitch, yaw, throttle           |
| RC Channel Monitor         | ✅     | Live channel bars during calibration |
| Virtual On-Screen Joystick | ❌     |                                      |
| Button-to-Action Mapping   | ❌     |                                      |

### Video & Camera

| Feature                       | Status | Notes                                                                                            |
| ----------------------------- | ------ | ------------------------------------------------------------------------------------------------ |
| Video Streaming               | ✅     | UDP H.264, AV1 RTP/UDP (WebCodecs) or TCP (ffmpeg), RTSP, TCP MPEG-TS; settings in Setup > Video |
| Video Recording               | ✅     | MKV, MOV, MP4 formats; compact Record overlay on fly view                                        |
| MAVLink Camera Protocol       | ✅     | Discovery, photo/video capture, mode switching, storage info                                     |
| Multiple Simultaneous Streams | ❌     |                                                                                                  |

### Analysis & Logging

| Feature               | Status | Notes                                          |
| --------------------- | ------ | ---------------------------------------------- |
| MAVLink Log Recording | ✅     | Traffic log with timestamps, sysid:compid      |
| Log Replay            | ✅     | Binary `.mavlink` replay                       |
| MAVLink Inspector     | ✅     | Real-time message viewer with field drill-down |
| MAVLink Console       | ✅     | Serial console over MAVLink (SERIAL_CONTROL)   |
| Log Download Browser  | ❌     |                                                |
| GeoTagging            | ❌     | Image geotagging from logs                     |
| Vibration Analysis    | ❌     |                                                |

### GPS & Positioning

| Feature      | Status | Notes                           |
| ------------ | ------ | ------------------------------- |
| Primary GPS  | ✅     | Fix type, satellites, HDOP/VDOP |
| RTK GPS      | ❌     | Differential GPS support        |
| NTRIP Client | ❌     |                                 |

### Map & Terrain

| Feature                    | Status | Notes                                                   |
| -------------------------- | ------ | ------------------------------------------------------- |
| Multiple Map Providers     | ✅     | 7 providers (Google, Bing, Esri, Mapbox, OSM, Statkart) |
| CORS-Bypass Tile Proxy     | ✅     | Custom `tile://` protocol with LRU cache                |
| Terrain Elevation Queries  | ✅     | TERRAIN_REPORT handling                                 |
| Offline Map Bulk Download  | ❌     | Only 500-tile LRU cache                                 |
| 3D Visualization           | ❌     |                                                         |
| Terrain Profile Along Path | ❌     |                                                         |

### Safety & Compliance

| Feature                  | Status | Notes                                                 |
| ------------------------ | ------ | ----------------------------------------------------- |
| Pre-Flight Checklist     | ✅     | GPS, battery, sensors, comms, RC + manual checks      |
| Failsafe Configuration   | ✅     | PX4 + ArduPilot, battery/RC/GCS/datalink/geofence/RTL |
| Arming Check Config      | ✅     | ARMING_CHECK parameter                                |
| Remote ID / UTM          | ❌     |                                                       |
| Object Avoidance Display | ❌     | Proximity sensor visualization                        |

### Other

| Feature                  | Status | Notes                                 |
| ------------------------ | ------ | ------------------------------------- |
| Multi-Vehicle Support    | ✅     | Auto-discovery, independent state     |
| ADS-B Traffic Display    | ✅     | ICAO, callsign, position, altitude    |
| Gimbal Control           | ✅     | Pitch/yaw commands, attitude feedback |
| MAVLink FTP              | ✅     | Upload, download, directory listing   |
| Popout Windows           | ✅     | Multi-monitor video/map               |
| Multi-Language / i18n    | ❌     | English only                          |
| Android / iOS            | ❌     | Desktop only (macOS, Windows, Linux)  |
| Plugin / Branding System | ❌     |                                       |
| Audio Alerts             | ❌     |                                       |

### Key Functional Gaps (vs QGroundControl)

The feature parity table above covers all individual items. The most significant gaps that affect day-to-day usability are:

1. **Survey/Scan mission types** — No automated camera survey, structure scan, or corridor scan patterns. Only basic waypoint missions are supported.
2. **RTK GPS / NTRIP** — No differential GPS support for precision operations.
3. **In-flight adjustments** — Cannot change altitude, heading, or speed mid-flight from the UI (only via guided actions like Go-To, RTL, Land).
4. **Orbit / Follow Me** — No circle-around-point or GPS-follow modes.
5. **Advanced mission commands** — No DO_JUMP, speed/delay, servo/relay, camera trigger, or ROI commands in the mission editor.
6. **Offline maps** — Only a 500-tile LRU cache; no bulk region download for field use.
7. **Mobile platforms** — Desktop only (macOS, Windows, Linux); no Android/iOS.
8. **Multiple video streams** — Only a single video stream at a time.
9. **Log analysis** — Can record logs but has no built-in download browser or vibration analysis.

## License

ISC
