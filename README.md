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
- **TCP mode**: Connect to multiple SITL instances simultaneously via `QGC_TCP_LINKS`
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
2. **Outbound commands**: React component calls `window.qgcBridge.methodName()` → IPC to main process → serialized to MAVLink v2 → sent via the vehicle's command link (UDP/TCP)
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
QGC_UDP_PORT=14551 npm run dev
```

#### Option 2: TCP (SITL)

Connect directly to one or more ArduPilot/PX4 SITL instances:

```bash
# Single SITL
QGC_TCP_LINKS=127.0.0.1:5760 npm run dev

# Multiple SITLs
QGC_TCP_LINKS=127.0.0.1:5760,127.0.0.1:5761,127.0.0.1:5762 npm run dev
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
| `QGC_UDP_PORT` | `14550` | UDP port to listen for MAVLink |
| `QGC_TCP_LINKS` | _(empty)_ | Comma-separated `host:port` pairs for TCP SITL connections |

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
npx playwright test

# Run E2E tests against a real SITL
USE_SITL=1 npx playwright test
```

E2E tests verify:
- Connection state transitions (WAITING → CONNECTED)
- Attitude and GPS telemetry display
- Arm/disarm state rendering
- Continuous streaming performance
- FPS and IPC latency benchmarks
- Visual regression screenshots

### SITL Testing

For full integration testing with ArduPilot SITL:

```bash
# Start ArduPilot SITL
sim_vehicle.py -v ArduCopter --no-mavproxy

# In another terminal, connect Meridian via TCP
QGC_TCP_LINKS=127.0.0.1:5760 npm run dev
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

## License

ISC
