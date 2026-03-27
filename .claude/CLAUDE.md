# Meridian

A ground control station (GCS) for MAVLink-based autonomous vehicles (ArduPilot/PX4), built with Electron + React + TypeScript.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Renderer (React + Zustand + MapLibre)              │
│  - FlyView (live telemetry, map, instruments)       │
│  - PlanView (mission planning, waypoint editor)     │
│  - VideoView (video stream display)                 │
└─────────────────┬───────────────────────────────────┘
                  │ ipcRenderer.invoke / on
                  │ (contextBridge exposed as window.bridge)
┌─────────────────┴───────────────────────────────────┐
│  Main Process (Node.js)                             │
│  - LinkManager / UdpLink / TcpLink (network I/O)   │
│  - VehicleManager (multi-vehicle registry)          │
│  - MavlinkProtocol (channel pool + parsing)         │
│  - ipcBridge (delta-encoded state push @ 30Hz)      │
│  - VideoManager (ffmpeg + WebSocket streaming)      │
└─────────────────┬───────────────────────────────────┘
                  │ MAVLink UDP/TCP
                  ▼
        ArduPilot / PX4 Autopilot
```

## Source Layout

```
src/
├── main/                   # Electron main process
│   ├── index.ts            # App entry, window creation, link setup
│   ├── ipcBridge.ts        # IPC handler registry, delta telemetry push
│   ├── vehicle/            # VehicleManager, Vehicle, MavCommandQueue
│   ├── links/              # LinkManager, UdpLink, TcpLink, LinkInterface
│   ├── mavlink/            # MavlinkProtocol, MavlinkChannel, signing, constants
│   ├── mission/            # MissionManager, PlanManager, GeoFence, Rally, PlanFileIO
│   ├── video/              # VideoManager, FfmpegProcess, VideoWebSocketServer
│   ├── gimbal/             # GimbalController (quaternion math, MAVLink commands)
│   ├── adsb/               # ADS-B traffic tracking
│   ├── parameters/         # Vehicle parameter download/set protocol
│   ├── ftp/                # MAVLink FTP implementation
│   ├── terrain/            # Custom tile:// protocol handler
│   └── settings/           # App settings management
├── renderer/src/           # React UI
│   ├── App.tsx             # View switcher (Fly/Plan)
│   ├── flyview/            # FlyView, InstrumentPanel, MapView, VideoView, guided actions
│   ├── planview/           # PlanView, WaypointEditor, MissionSidebar, MissionToolbar
│   ├── components/         # Shared UI (AttitudeIndicator, Compass, TelemetryRow)
│   ├── store/              # Zustand stores (vehicle, mission, settings, parameter, link, video)
│   ├── hooks/              # useVehicle, useMission, useCommand, useVideoStream
│   ├── map/providers/      # Tile provider registry & URL resolution
│   └── perf/               # Performance overlay (FPS, IPC latency)
├── shared-types/ipc/       # Shared type definitions (channels, events, VehicleState, etc.)
└── preload/index.ts        # contextBridge → window.bridge (35+ IPC methods)
```

## Key Concepts

### Delta-Encoded IPC
Vehicle state is split into 15 groups (core, attitude, GPS, battery, RC, etc.), each with a `seq` counter. The main process pushes only groups whose `seq` changed to the renderer at 30Hz, reducing IPC bandwidth by ~80-90%.

### MAVLink Channel Pool
Pool of 16 channels (matching C++ QGroundControl). Each link allocates one channel. Per-sysid/compid sequence tracking enables packet loss detection.

### Multi-Vehicle
VehicleManager auto-discovers vehicles on HEARTBEAT (autopilot compid=1). Each vehicle independently manages state, commands, and missions. Popout windows for map/video support multi-vehicle viewing.

### Command Queue
MavCommandQueue sends COMMAND_LONG, waits for COMMAND_ACK with timeout-based retry (1.5s default, 3 retries). Handles IN_PROGRESS responses gracefully.

### CORS Bypass for Map Tiles
Custom `tile://` protocol in main process. Renderer requests `tile://tiles/{provider}/{z}/{x}/{y}`, main resolves the real HTTPS URL, fetches, and caches (500-tile LRU).

### Video Streaming
ffmpeg subprocess remuxes input to fMP4 → WebSocket server broadcasts to renderer(s). Auto-restart on transient failures (max 5 retries).

## Commands

```bash
npm run dev              # Electron dev mode with hot-reload
npm run build            # Typecheck + electron-vite build
npm run build:mac        # macOS .dmg
npm run build:win        # Windows .exe/.msi
npm run build:linux      # Linux AppImage/deb
npm run typecheck        # TypeScript validation (node + web configs)
npm run lint             # ESLint with cache
npm run format           # Prettier formatting
npm test                 # Vitest unit tests
npm run test:watch       # Vitest watch mode
npm run test:e2e         # Playwright E2E tests
npm run dev:sitl         # Dev with SITL via scripts/dev-sitl.sh
```

## Environment Variables

- `GC_UDP_PORT` — UDP listen port (default: 14550)
- `GC_TCP_LINKS` — Comma-separated TCP SITL targets (e.g., `127.0.0.1:5760,127.0.0.1:5761`)

## Tech Stack

- **Electron** (39.x) — Desktop shell
- **React** (19.x) + **Zustand** (5.x) — UI and state management
- **MapLibre GL** (5.x) — Map rendering
- **node-mavlink** + **mavlink-mappings** — MAVLink protocol
- **electron-vite** + **Vite** — Build tooling
- **Vitest** — Unit tests
- **Playwright** — E2E tests
- **ws** — WebSocket (video streaming)
- **ffmpeg-static** — Bundled ffmpeg for video transcoding

## Utilities

- `bridge.py` — Python TCP↔UDP bridge for connecting ArduPilot SITL (TCP 5760) to Meridian (UDP 14550). Bidirectional, threaded.

## Conventions

- Shared types live in `src/shared-types/` — no type duplication across process boundaries
- IPC channels and events are defined as string enums for type safety
- Preload interface (`Bridge`) is fully typed
- Socket errors (EPIPE, ECONNRESET) are caught at the app level
- MAVLink decode errors skip the message rather than crash
- Link abstraction (`LinkInterface`) allows adding serial/WebSocket transports
