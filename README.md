# Meridian

A modern ground control station for MAVLink-based autonomous vehicles, built with Electron, React, and TypeScript. Meridian is a from-scratch reimagining of [QGroundControl](https://github.com/mavlink/qgroundcontrol) using web technologies for faster iteration, easier extensibility, and a modern development experience.

## Features

### Live Telemetry
- Real-time attitude (roll, pitch, yaw), GPS position, altitude, and velocity display
- Delta-encoded IPC for efficient main→renderer telemetry streaming
- Support for multiple simultaneous vehicles with independent telemetry streams

### Interactive Map (Fly View)
- MapLibre GL-powered map with live vehicle position tracking
- Multiple tile providers: Google Satellite, Google Hybrid, Bing Aerial, Esri World Imagery, OpenStreetMap, Statkart Topo, and Mapbox Satellite
- Custom `tile://` protocol proxy bypasses CORS restrictions with an LRU cache (500 tiles)
- Prominent vehicle indicators with color-coded active/inactive states

### Mission Planning (Plan View)
- Interactive waypoint editing with drag-and-drop on the map
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

### Additional Systems
- Gimbal control with quaternion-to-Euler conversion
- GeoFence and Rally Point management
- MAVLink FTP for file transfer to/from the vehicle
- MAVLink 2 message signing support

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

| Variable | Default | Description |
|----------|---------|-------------|
| `GC_UDP_PORT` | `14550` | UDP port to listen for MAVLink |
| `GC_TCP_LINKS` | _(empty)_ | Comma-separated `host:port` pairs for TCP SITL connections |

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
- GeoFence and Rally Point protocols
- Tile provider URL resolution
- Zustand store logic

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
│   │   ├── ipcBridge.ts         # IPC handlers between main ↔ renderer
│   │   ├── udpLink.ts           # UDP socket wrapper
│   │   ├── mavlinkPipeline.ts   # MAVLink stream parsing pipeline
│   │   ├── mavlink/
│   │   │   ├── MavlinkProtocol.ts
│   │   │   └── constants.ts
│   │   ├── vehicle/
│   │   │   ├── VehicleManager.ts    # Multi-vehicle registry
│   │   │   ├── Vehicle.ts           # Per-vehicle state & message handling
│   │   │   ├── PlanManager.ts       # Mission/fence/rally protocol
│   │   │   ├── GimbalController.ts  # Gimbal angle tracking & commands
│   │   │   └── AdsbVehicleManager.ts
│   │   ├── links/
│   │   │   ├── LinkManager.ts       # Multi-link management
│   │   │   └── TcpLink.ts          # TCP socket wrapper
│   │   └── ftp/
│   │       └── MavlinkFtp.ts       # MAVLink FTP implementation
│   ├── renderer/                # React renderer process
│   │   └── src/
│   │       ├── App.tsx
│   │       ├── components/
│   │       │   └── MapView.tsx      # MapLibre fly view with provider switching
│   │       ├── planview/            # Mission planning UI
│   │       ├── hooks/
│   │       │   ├── useMission.ts
│   │       │   └── useMissionMapLayers.ts
│   │       ├── store/
│   │       │   ├── vehicleStore.ts
│   │       │   ├── missionStore.ts
│   │       │   └── settingsStore.ts
│   │       └── map/providers/
│   │           └── ProviderRegistry.ts
│   ├── preload/                 # Electron preload (contextBridge)
│   │   └── index.ts
│   └── shared-types/            # Types shared between main & renderer
│       └── ipc/
│           ├── tileProviders.ts     # Tile provider definitions & URL resolution
│           ├── MissionTypes.ts
│           ├── LinkState.ts
│           └── geo.ts
├── test/
│   ├── *.test.ts                # Unit tests (Vitest)
│   └── e2e/
│       ├── app.spec.ts          # Playwright E2E tests
│       └── fixtures/
├── bridge.py                    # TCP↔UDP MAVLink bridge for SITL
├── electron.vite.config.ts
├── electron-builder.yml
├── tsconfig.json
└── package.json
```

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Desktop shell | Electron |
| UI framework | React 18 + TypeScript |
| State management | Zustand |
| Map rendering | MapLibre GL JS |
| MAVLink parsing | node-mavlink + mavlink-mappings |
| Build tooling | electron-vite (Vite-based) |
| Unit testing | Vitest |
| E2E testing | Playwright |
| Packaging | electron-builder |

## Feature Parity with QGroundControl

Meridian aims to cover the core functionality of [QGroundControl](https://github.com/mavlink/qgroundcontrol). The table below tracks what is implemented and what remains.

### Communication & Links

| Feature | Status | Notes |
|---------|--------|-------|
| UDP Link | ✅ | Configurable port, auto-discovery |
| TCP Link | ✅ | Multi-SITL support |
| Serial Link | ✅ | Full serialport with baud rate, flow control, DTR |
| MAVLink Signing | ✅ | Key management, per-channel signing |
| Log Replay Link | ✅ | `.mavlink` binary replay with speed control |
| Multi-Link Failover | ✅ | Heartbeat-based automatic failover |
| Bluetooth Link | ❌ | |
| ADS-B TCP Receiver Link | ❌ | |

### Vehicle Setup & Configuration

| Feature | Status | Notes |
|---------|--------|-------|
| Setup View | ✅ | 10-page setup with sidebar navigation |
| Airframe Selection | ✅ | 11 frame classes, 18+ frame types |
| Sensor Calibration | ✅ | Accel, compass, gyro, level horizon, baro, ESC (8 types) |
| Radio/RC Calibration | ✅ | 16-channel stick detection, min/max/trim, reversal |
| Flight Mode Assignment | ✅ | All 4 ArduPilot vehicle types |
| Power/Battery Config | ✅ | Monitor type, capacity, pins, multipliers |
| Safety/Failsafe Config | ✅ | Throttle, battery, GCS failsafe, geofence, arming checks |
| PID Tuning | ✅ | 8 groups, 40+ params (rate, position, velocity) |
| Firmware Upgrade | ✅ | MAVLink FTP upload, reboot, board info |
| Parameter Editor | ✅ | Search, edit, refresh, progress tracking |
| Motor Testing | ❌ | Individual motor test commands |
| Gimbal/Mount Setup UI | ❌ | |

### Mission Planning

| Feature | Status | Notes |
|---------|--------|-------|
| Waypoints | ✅ | NAV_WAYPOINT, Takeoff, Land, RTL, Loiter variants |
| GeoFence | ✅ | Polygon and circle inclusion/exclusion |
| Rally Points | ✅ | Load, write, clear |
| Plan File I/O | ✅ | `.plan` format (QGC-compatible) |
| Mission Stats | ✅ | Distance, ETA, waypoint count |
| Survey/Grid Scan | ❌ | Automated camera survey patterns |
| Structure Scan | ❌ | Vertical structure scanning |
| Corridor Scan | ❌ | Linear corridor inspection |
| Spline Waypoints | ❌ | Curved flight paths |
| Landing Patterns | ❌ | Fixed-wing/VTOL approach patterns |
| Camera Trigger Commands | ❌ | In-mission photo/video control |
| ROI Commands | ❌ | Region of interest in missions |
| DO_JUMP / Flow Control | ❌ | Mission loops and conditionals |
| Speed/Delay Commands | ❌ | In-mission speed changes, waits |
| Servo/Relay Commands | ❌ | Hardware actuator control |
| KML/KMZ Export | ❌ | |

### Flight Control

| Feature | Status | Notes |
|---------|--------|-------|
| Arm / Disarm | ✅ | |
| Takeoff | ✅ | Configurable altitude |
| Land | ✅ | |
| RTL | ✅ | |
| Go-To Location | ✅ | Click-on-map reposition |
| Pause / Resume | ✅ | |
| Emergency Stop | ✅ | Hold-to-confirm safety UX |
| Pre-Flight Checklist | ✅ | 6 automated + 4 manual checks |
| Change Altitude | ❌ | In-flight altitude adjustment |
| Change Heading | ❌ | |
| Change Speed | ❌ | |
| Orbit | ❌ | Circle around point |
| Follow Me | ❌ | GPS-based follow mode |
| Landing Gear Control | ❌ | |

### Joystick & RC

| Feature | Status | Notes |
|---------|--------|-------|
| Gamepad/Joystick Input | ✅ | Deadband, expo curves, 30 Hz output |
| Axis Mapping | ✅ | Roll, pitch, yaw, throttle |
| RC Channel Monitor | ✅ | Live channel bars during calibration |
| Virtual On-Screen Joystick | ❌ | |
| Button-to-Action Mapping | ❌ | |

### Video & Camera

| Feature | Status | Notes |
|---------|--------|-------|
| Video Streaming | ✅ | UDP H.264/H.265, RTSP, TCP MPEG-TS via ffmpeg |
| Video Recording | ✅ | MKV, MOV, MP4 formats |
| MAVLink Camera Protocol | ❌ | Photo capture, camera settings, zoom |
| Multiple Simultaneous Streams | ❌ | |

### Analysis & Logging

| Feature | Status | Notes |
|---------|--------|-------|
| MAVLink Log Recording | ✅ | ULog format with sequence tracking |
| Log Replay | ✅ | Binary `.mavlink` replay |
| MAVLink Inspector | ❌ | Real-time message viewer |
| MAVLink Console | ❌ | Serial console over MAVLink |
| Log Download Browser | ❌ | |
| GeoTagging | ❌ | Image geotagging from logs |
| Vibration Analysis | ❌ | |

### GPS & Positioning

| Feature | Status | Notes |
|---------|--------|-------|
| Primary GPS | ✅ | Fix type, satellites, HDOP/VDOP |
| RTK GPS | ❌ | Differential GPS support |
| NTRIP Client | ❌ | |

### Map & Terrain

| Feature | Status | Notes |
|---------|--------|-------|
| Multiple Map Providers | ✅ | 7 providers (Google, Bing, Esri, Mapbox, OSM, Statkart) |
| CORS-Bypass Tile Proxy | ✅ | Custom `tile://` protocol with LRU cache |
| Terrain Elevation Queries | ✅ | TERRAIN_REPORT handling |
| Offline Map Bulk Download | ❌ | Only 500-tile LRU cache |
| 3D Visualization | ❌ | |
| Terrain Profile Along Path | ❌ | |

### Safety & Compliance

| Feature | Status | Notes |
|---------|--------|-------|
| Pre-Flight Checklist | ✅ | GPS, battery, sensors, comms, RC + manual checks |
| Failsafe Configuration | ✅ | Throttle, battery, GCS, geofence |
| Arming Check Config | ✅ | ARMING_CHECK parameter |
| Remote ID / UTM | ❌ | |
| Object Avoidance Display | ❌ | Proximity sensor visualization |

### Other

| Feature | Status | Notes |
|---------|--------|-------|
| Multi-Vehicle Support | ✅ | Auto-discovery, independent state |
| ADS-B Traffic Display | ✅ | ICAO, callsign, position, altitude |
| Gimbal Control | ✅ | Pitch/yaw commands, attitude feedback |
| MAVLink FTP | ✅ | Upload, download, directory listing |
| Popout Windows | ✅ | Multi-monitor video/map |
| Multi-Language / i18n | ❌ | English only |
| Android / iOS | ❌ | Desktop only (macOS, Windows, Linux) |
| Plugin / Branding System | ❌ | |
| Audio Alerts | ❌ | |

## License

ISC
