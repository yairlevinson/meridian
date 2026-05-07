# Meridian Client/Server Migration Plan

This document describes a staged migration from the current Electron-only architecture to a client/server architecture where multiple app-like web clients can connect to one Meridian server near the vehicles.

The goal is to preserve Meridian's current cockpit feel while moving MAVLink, video ingest, mission state, and device access into a shared server process.

---

## 1. Target Architecture

```text
MAVLink vehicles / cameras / radar / serial devices
              |
              v
Meridian Server
  - MAVLink links: UDP, TCP, serial, replay
  - VehicleManager / Vehicle instances
  - mission, parameters, camera, FTP, calibration, firmware
  - video ingest, recording, stream fanout
  - settings, permissions, sessions
  - HTTP + WebSocket API
              |
              v
Meridian Clients
  - React + Zustand + MapLibre
  - app-like PWA/browser client
  - optional Electron/Tauri desktop shell
  - one or more clients connected at once
```

The server is the single authority over vehicles and video sources. Clients never talk to MAVLink vehicles directly. They issue commands to the server and subscribe to server-published state.

The existing Electron app can remain as an optional desktop wrapper, but Electron should stop being the architectural boundary. In the target design, Electron is just one possible client shell.

### Current Implementation Status

The `client-server-architecture` branch now has the first working browser/server spine in place:

- Server HTTP + `/realtime` WebSocket RPC exists and can serve the built renderer.
- Browser bridge generation maps the existing module specs onto the WebSocket RPC transport.
- Browser bridge reconnects event subscriptions after transport reconnect.
- Server CLI can start the MAVLink runtime and serve the browser preview.
- Synthetic vehicle browser/server smoke coverage verifies renderer load, bridge availability, link state, vehicle add, telemetry deltas, and tile URL behavior.
- Server tile proxy replaces `tile://` in browser mode.
- Browser clients route video playback through the server `/video/live` endpoint.
- Radar has a server preview implementation.
- Link state tracks associated vehicle IDs.
- Browser popouts are handled locally with browser windows.
- Browser plan save/open uses browser download/file-picker APIs.
- Browser KML import uses browser file-picker APIs and shared KML parsing.
- Browser firmware upload sends file bytes over RPC instead of a client-local path.
- Runtime-managed video recordings are written under `userData/recordings` with sanitized client-provided names.

Intentional compatibility surfaces still remain:

- Electron keeps native dialogs and desktop shell behavior in the Electron adapter.
- Server-local path APIs such as KML `importFromPath`, firmware `uploadFile`, log replay paths, and low-level recording paths remain available for tests, server-side workflows, and desktop compatibility.
- `src/main/ipcBridge.ts` still contains Electron adapter logic; it is no longer the desired architectural boundary, but it remains useful until Electron is fully converted to a shell around the server/client path.

---

## 2. Design Principles

### Keep The Client Feeling Like An App

The browser client should not feel like a website. It should open directly into the operational UI, remember local layout, reconnect automatically, and support full-screen field use.

Required app qualities:

- Launch directly into Fly, Plan, or the last selected workspace.
- Preserve the current full-screen map/video cockpit layout.
- Show an in-app disconnected/reconnecting state instead of browser-style failure pages.
- Persist local UI preferences per client: selected view, map provider, grid lines, panel layout, video PiP state, theme, and similar UI-only settings.
- Support installable PWA behavior: icon, app window, manifest, service worker shell caching.
- Keep popout-style map/video windows, implemented as browser windows where possible.
- Keep tablet/laptop ergonomics: large enough flight controls, keyboard shortcuts where useful, and predictable focus behavior.

### Keep The Server Authoritative

The server owns:

- Vehicle discovery and identity.
- MAVLink stream requests and heartbeat broadcasting.
- Command retry/ack behavior.
- Mission uploads/downloads.
- Parameter state.
- Calibration and firmware workflows.
- Video ingest and recording.
- Shared operational state.

Clients own:

- Rendering.
- Local UI layout/preferences.
- User interaction intent.
- Optimistic UI only where it does not imply vehicle state.

### Migrate By Compatibility Adapters

The current renderer is already built around `window.bridge`. The migration should avoid rewriting every component at once.

Introduce a browser-side bridge implementation with the same method shape:

```text
current Electron:
  React -> window.bridge.vehicleArm(...) -> ipcRenderer.invoke(...)

target browser:
  React -> bridge.vehicleArm(...) -> HTTP/WebSocket command transport
```

Once the browser bridge is stable, components and stores can continue using the same generated bridge surface while the transport changes underneath.

---

## 3. Transport Strategy

Use separate transports for control/state and video.

### Control Commands

Use HTTP or WebSocket request/reply. Start with HTTP for simple command semantics unless a single WebSocket command bus is simpler to implement with the existing module specs.

Examples:

```text
POST /api/rpc/vehicle/arm
POST /api/rpc/mission/write
POST /api/rpc/settings/set
```

or:

```text
WS /realtime
  { id, type: "command", module, command, args }
  { id, type: "reply", ok, result?, error? }
```

Recommendation: use one WebSocket `/realtime` connection for command/reply plus server events. It gives one connection lifecycle to manage and maps well to the current IPC module system.

### Realtime Events

Use WebSocket for:

- Vehicle added/removed.
- Telemetry deltas.
- STATUSTEXT.
- Mission progress/current item.
- Parameter progress/changes.
- Link state.
- Camera state.
- Video stream state.
- Radar and tracking updates.

Start with JSON envelopes and payloads. Keep the envelope stable so payload encoding can change later.

```ts
type ClientMessage =
  | { id: string; type: 'command'; module: string; command: string; args: unknown[] }
  | { type: 'subscribe'; topics: string[] }
  | { type: 'unsubscribe'; topics: string[] }

type ServerMessage =
  | { id: string; type: 'reply'; ok: true; result: unknown }
  | { id: string; type: 'reply'; ok: false; error: string }
  | { type: 'event'; topic: string; payload: unknown }
```

### Binary Encoding

Do not start by making all control/state messages binary.

Recommended order:

1. JSON for command/reply/event envelopes.
2. JSON telemetry deltas while validating the architecture.
3. MessagePack for realtime messages if profiling shows JSON overhead matters.
4. Binary always for video and file/log transfer.

MessagePack is the preferred binary upgrade path because it preserves the current TypeScript object shapes and is browser/Node friendly.

---

## 4. Video Streaming For Multiple Clients

The server should ingest each video source once, then fan out encoded stream data to all interested clients.

```text
camera / stream source
          |
          v
Meridian Server VideoManager
  - ffmpeg remux pipeline
  - raw H.264/AV1 receive pipeline
  - recording
  - stream metadata/state
  - client fanout
          |
          +--> Client A
          +--> Client B
          +--> Client C
```

### Initial Implementation

Keep the current WebSocket video approach, but expose it as a server endpoint instead of an Electron-local detail.

Suggested endpoints:

```text
GET /api/video/streams
POST /api/video/:streamId/start
POST /api/video/:streamId/stop
POST /api/video/:streamId/record/start
POST /api/video/:streamId/record/stop
WS /video/:streamId/live
```

The current video logic maps cleanly:

- `VideoManager` becomes server-owned.
- `FfmpegProcess` remains responsible for remuxing RTSP/TCP-MPEGTS/fallback sources to fragmented MP4.
- `VideoReceiver` remains responsible for raw UDP/TCP receive.
- `VideoWebSocketServer` should evolve from "one local WS server" into "one or more video stream broadcasters".
- The renderer keeps `useVideoStream` for fMP4/MSE and `useWebCodecsStream` for raw H.264/AV1.

### Late Joining Clients

For fragmented MP4:

- Cache the init segment.
- Send it immediately to new clients.
- Then send live fragments.

For raw H.264:

- Prefer sending keyframe-aware segments when possible.
- If keyframe detection is not available initially, document that late clients may show video only after the decoder recovers naturally.

For AV1 RTP:

- Continue packing access units with keyframe flag and timestamp.
- Renderer should wait for a key access unit before decoding.

### Scaling Notes

Avoid per-client transcoding. Server CPU should not grow much with client count if streams are copied/remuxed once.

Server outbound network grows linearly:

```text
6 Mbps stream x 1 client  = 6 Mbps outbound
6 Mbps stream x 5 clients = 30 Mbps outbound
6 Mbps stream x 10 clients = 60 Mbps outbound
```

This is acceptable for nearby LAN clients. Revisit WebRTC/SFU only after the server/client split works.

### Later WebRTC Option

WebRTC can be introduced per stream behind the same client abstraction if lower latency, browser-native jitter handling, or broader network traversal becomes important.

The client should ask for stream transport metadata rather than hard-code "WebSocket forever":

```ts
type VideoTransport =
  | { kind: 'websocket'; url: string; codec: string; container: 'fmp4' | 'raw-h264' | 'av1-chunks' }
  | { kind: 'webrtc'; offerUrl: string; streamId: string }
```

---

## 5. Map Tiles And Map State

Maps should remain client-rendered. The browser client should continue using MapLibre for pan/zoom, mission editing, markers, and overlays. The server replaces Electron's current `tile://` protocol handler with an HTTP tile proxy/cache.

Current Electron model:

```text
MapLibre -> tile://tiles/:provider/:z/:x/:y -> Electron main -> HTTPS tile provider
```

Target client/server model:

```text
MapLibre -> /api/tiles/:provider/:z/:x/:y -> Meridian server -> HTTPS tile provider
```

### Client Responsibilities

- Render MapLibre map instances.
- Draw vehicle markers from telemetry deltas.
- Draw mission paths, waypoint markers, planned home, geofence, rally points, radar tracks, and overlays.
- Handle mission editing gestures such as click-to-add and drag-to-move.
- Persist local viewport and display preferences where useful.
- Choose map provider per client, subject to server-advertised availability.

### Server Responsibilities

- Own the map provider registry.
- Keep provider API keys and URL templates out of browser code when needed.
- Proxy tile requests to upstream providers.
- Cache tiles centrally so multiple nearby clients benefit from the same cache.
- Enforce provider availability and attribution metadata.
- Optionally serve offline tile packs for field use.

Suggested endpoints:

```text
GET /api/map/providers
GET /api/tiles/:provider/:z/:x/:y
GET /api/map/packs
GET /api/map/packs/:packId/tiles/:z/:x/:y
```

### Provider Preference

Available providers are server-defined. The selected provider should be per-client by default, not global. One client may want satellite imagery while another uses topo or street tiles.

The server should still validate provider IDs and return provider metadata:

```ts
interface MapProviderInfo {
  id: string
  name: string
  attribution: string
  tileSize: number
  maxZoom?: number
  offline?: boolean
}
```

### Offline Field Use

Offline tile support does not need to be part of the first server slice, but the API should leave space for it. A later implementation can add server-managed map packs backed by MBTiles or a filesystem tile pyramid.

The client should not care whether a tile came from an upstream provider, cache, or offline pack. It should only receive a MapLibre-compatible tile URL.

---

## 6. Package And Directory Direction

The current repo does not need to become a monorepo on day one, but the code should move toward clear boundaries.

Target shape:

```text
src/
  server/
    main.ts
    http/
    realtime/
    video/
    maps/
    auth/

  core/
    vehicle/
    links/
    mavlink/
    mission/
    parameters/
    camera/
    calibration/
    firmware/
    ftp/
    settings/
    maps/

  client/
    App.tsx
    transport/
    store/
    flyview/
    planview/
    setupview/

  shared-types/
    rpc/
    ipc/
    vehicle-state/
```

Recommended staged mapping from current files:

| Current area                              | Target                                                          |
| ----------------------------------------- | --------------------------------------------------------------- |
| `src/main/vehicle/*`                      | `src/core/vehicle/*`                                            |
| `src/main/links/*`                        | `src/core/links/*`                                              |
| `src/main/mavlink/*`                      | `src/core/mavlink/*`                                            |
| `src/main/mission/*`                      | `src/core/mission/*`                                            |
| `src/main/video/*`                        | split between `src/core/video/*` and `src/server/video/*`       |
| `src/main/index.ts` tile protocol handler | `src/server/maps/*` tile proxy/cache                            |
| `src/shared-types/ipc/tileProviders.ts`   | `src/core/maps/*` or `src/shared-types/map/*` provider metadata |
| `src/main/ipcBridge.ts`                   | replaced by `src/server/realtime/*` and small Electron adapter  |
| `src/preload/*`                           | compatibility layer only for Electron shell                     |
| `src/renderer/src/*`                      | `src/client/*` over time                                        |
| `src/shared-types/ipc/modules/*`          | evolve into transport-neutral RPC module specs                  |

---

## 7. Security And Multi-Client Control

Even on a local network, multi-client ground control needs explicit authority rules.

### Authentication

Initial local-network option:

- Server starts with a generated pairing token shown in logs or local console.
- Browser clients authenticate once and receive a session cookie or token.
- Allow a development mode with auth disabled only on `127.0.0.1`.

Later options:

- User accounts.
- TLS.
- Role-based permissions.
- Audit log for vehicle-affecting commands.

### Roles

Introduce roles before exposing dangerous commands to multiple clients:

```text
observer: view telemetry/video/map only
planner: edit/save mission plans
operator: send guided/arm/disarm/mission commands
admin: settings, links, calibration, firmware, forwarding
```

### Command Ownership

Some operations should be guarded:

- Arm/disarm.
- Guided movement.
- Mission upload/start/pause.
- Calibration.
- Firmware upgrade.
- Link changes.

Use an operation lock model:

```ts
interface OperationLock {
  resource: 'vehicle-control' | 'mission-edit' | 'setup' | 'firmware'
  vehicleId?: number
  holderClientId: string
  expiresAt: number
}
```

Start simple: one active operator per vehicle. Other clients can observe and request control.

### Mission Editing

Do not start with fully collaborative mission editing.

Phase 1 behavior:

- Mission edits are local to the client until uploaded/saved.
- Server broadcasts mission load/upload results.
- If two clients upload, the later upload wins but all clients are notified.

Later behavior:

- Server-side mission draft sessions.
- Explicit lock or branch/merge behavior.

---

## 8. Migration Phases

### Phase 0: Baseline And Guardrails

Goal: document current behavior and prevent regressions before extraction.

Tasks:

- Keep current Electron app working.
- Add or identify tests for `ipcModule`, telemetry deltas, vehicle commands, mission protocol, settings, and video stream state.
- Add a small architecture note in `README.md` pointing to this plan.
- Decide the first server port and configuration names.

Exit criteria:

- `npm test` passes.
- `npm run typecheck` passes.
- Current Electron dev flow still works.

### Phase 1: Transport-Neutral Bridge Contracts

Goal: make the existing module specs usable outside Electron.

Tasks:

- Rename or alias `shared-types/ipc/modules` conceptually as transport-neutral modules.
- Keep existing Electron IPC generation intact.
- Add a generic module registry export, for example `allModules`.
- Define generic command/event envelope types.
- Add tests that generated bridge method names remain stable.

Exit criteria:

- Electron `window.bridge` API is unchanged.
- Module specs can be consumed without importing Electron.

### Phase 2: Server Runtime Skeleton

Goal: create a server process that can host APIs without yet owning all GCS logic.

Tasks:

- Add `src/server/main.ts`.
- Add HTTP server and WebSocket `/realtime`.
- Add static serving for the future web client in production mode.
- Add health endpoint:

```text
GET /api/health
```

- Add placeholder map provider endpoint if it is cheap to do:

```text
GET /api/map/providers
```

- Add development script:

```text
npm run dev:server
```

Exit criteria:

- Server starts independently of Electron.
- A test or script can connect to `/api/health`.
- No MAVLink behavior has moved yet.

### Phase 3: Realtime RPC Layer

Goal: implement command/reply/events over WebSocket using the existing module specs.

Tasks:

- Implement server-side `registerRpcModule(module, impl)`.
- Implement browser-side `bindRpcModule(module, transport)`.
- Support request IDs, timeouts, structured errors, and reconnect.
- Support event subscription and replay of initial state where needed.
- Add tests for command success, command error, event fanout, disconnect cleanup.

Exit criteria:

- A browser/client test can call a fake module command and receive fake module events.
- The generated browser bridge has the same method names as the Electron bridge.

### Phase 4: Extract Core GCS Bootstrap

Goal: make the current main-process GCS stack startable from Electron or server.

Tasks:

- Extract the MAVLink/video/settings/radar bootstrap from `src/main/index.ts` into a reusable service factory.
- Avoid importing `BrowserWindow`, `ipcMain`, `dialog`, or Electron-only APIs in the core service.
- Define server-facing service dependencies:

```ts
interface MeridianRuntime {
  vehicleManager: VehicleManager
  linkManager: LinkManager
  videoManager: VideoManager
  settingsManager: SettingsManager
  forwarder: MavlinkForwarder
  radarManager: RadarProxy
  trackingManager: TargetTrackingManager
  dispose(): void
}
```

- Keep Electron main using this runtime.

Exit criteria:

- Electron still works.
- Server can instantiate the runtime without creating a `BrowserWindow`.
- Tests for vehicle/link behavior still pass.

### Phase 5: Move Command/Event Modules To Server

Goal: expose real GCS behavior over `/realtime`.

Tasks:

- Register vehicle, mission, parameters, links, settings, video, camera, calibration, firmware, forwarding, radar, and inspector modules in the server.
- Move the 30 Hz telemetry delta tick into a transport-neutral publisher.
- Preserve the Electron IPC adapter by connecting it to the same module implementations or runtime publishers.
- Add initial-state commands for stores that need them after reconnect.
- Move tile provider metadata toward a server-readable registry.

Exit criteria:

- A non-Electron client can observe vehicle added/delta events.
- A non-Electron client can issue at least one harmless command, such as `settingsGet` or `linksGetState`.
- Electron continues to use either IPC or the new local server path.

### Phase 6: Browser Client Transport Adapter

Goal: run the React client in a normal browser.

Tasks:

- Add `src/renderer/src/transport` or `src/client/transport`. **Done for the current renderer path.**
- Provide `createBrowserBridge({ url })`. **Done as `createBrowserRpcBridge` plus browser install helper.**
- Set `window.bridge` or an equivalent injected bridge before stores subscribe. **Done for browser preview mode.**
- Replace Electron-only assumptions in renderer code.
- Replace `dialog`-dependent flows with browser-compatible file APIs or server-side file APIs:
  - Plan save/open. **Done.**
  - KML import. **Done.**
  - Recording file path selection. **Done by making runtime recording paths server-owned.**
  - Firmware file selection. **Done with browser file-byte upload.**
  - MAVLink log download.
- Replace `tile://` map tile URLs with server HTTP tile URLs. **Done for browser mode.**
- Keep MapLibre rendering and map overlays client-side.
- Add server connection UI state.

Exit criteria:

- `npm run dev:web` opens the client in a browser. **Partially covered by server preview/static serving.**
- Browser client connects to server and receives realtime state. **Done in smoke coverage.**
- Browser client can use core Fly view with telemetry. **Done in smoke coverage with synthetic vehicle.**

### Phase 7: Video Fanout

Goal: support multiple browser clients watching the same server-ingested stream.

Tasks:

- Turn `VideoWebSocketServer` into a stream broadcaster that can serve stable endpoints such as `/video/:streamId/live`. **Done for the single current live stream endpoint.**
- Preserve fMP4 init segment replay for late clients. **Existing behavior preserved.**
- Preserve raw AV1 chunk protocol. **Existing behavior preserved.**
- Add stream metadata to `VideoStreamState`. **Partially done with browser websocket URL decoration; multi-stream metadata remains.**
- Let each client independently choose whether to subscribe/display video. **Done at the client display level for the shared live endpoint.**
- Ensure recording is server-side and not tied to any one viewer. **Done for runtime-managed recordings.**
- Add tests for late fMP4 client receiving init segment first.

Exit criteria:

- Two browser clients can watch one stream without starting two ingest pipelines.
- Starting/stopping stream from one authorized client updates all clients.
- Recording continues even if the viewing client disconnects.

### Phase 8: App-Like PWA Shell

Goal: make the browser client feel like a native app.

Tasks:

- Add web manifest, icons, app name, display mode, theme color.
- Add service worker for static shell caching.
- Add installability checks.
- Add reconnect/backoff UI.
- Persist local client preferences separately from server operational settings.
- Persist map viewport/provider locally unless a future team workflow needs shared map state.
- Support full-screen and standalone modes.
- Rework popout windows for browser/PWA constraints.

Exit criteria:

- Client is installable as a PWA.
- Refresh/reconnect does not lose local UI layout.
- Loss of server connection is visible and recoverable.

### Phase 9: Multi-Client Authority

Goal: make multiple clients safe, not just possible.

Tasks:

- Add sessions and client IDs.
- Add roles and permission checks.
- Add operation locks for vehicle control/setup/mission upload.
- Add audit events for vehicle-affecting commands.
- Add UI indication for who has control.
- Add timeout/release behavior for stale locks.

Exit criteria:

- Observer clients cannot send dangerous commands.
- Only the active operator can control a vehicle.
- Other clients receive visible state about control ownership.

### Phase 10: Optional Desktop Wrapper

Goal: keep a desktop app distribution without making Electron the core runtime.

Options:

1. Electron launches/embeds the browser client and optionally starts a local server.
2. Electron only connects to an already-running server.
3. Tauri wrapper for a smaller desktop package.

Recommended first wrapper:

- Electron starts local server in development/local mode.
- Electron BrowserWindow loads `http://127.0.0.1:<serverPort>`.
- Remote server URL can be configured.

Exit criteria:

- Desktop build still feels like Meridian.
- Browser client and desktop wrapper share the same app code.

---

## 9. Reconnect And State Resync

Clients must assume the realtime socket can disconnect.

On reconnect:

1. Re-authenticate or resume session.
2. Re-subscribe to topics.
3. Request full snapshots for stateful stores:
   - vehicles
   - links
   - settings
   - parameters for active vehicle
   - mission state
   - video streams
   - map provider availability
   - radar/tracking
4. Resume deltas after snapshot.

Telemetry deltas need a generation or sequence guard so clients can detect missed state:

```ts
interface VehicleDeltaPayload {
  vehicleId: number
  generation: number
  deltaSeq: number
  delta: VehicleDelta
  sentAt: number
}
```

If a client sees a gap, it requests a full snapshot.

---

## 10. Testing Strategy

The current test suite has three useful shapes that should be preserved during the migration:

- Core protocol and manager unit tests, mostly in `test/*.test.ts`, using `MockLink`, `MockVehicle`, and tlog replay.
- Renderer/store/component tests, some of which mock `window.bridge` directly.
- Playwright E2E tests that currently launch Electron and connect either to `SyntheticVehicle` over UDP or to SITL.

The migration should refactor tests by boundary, not by deleting the Electron path. Electron tests remain as shell compatibility tests while new server/browser tests become the primary client/server coverage.

### Unit Tests

Keep and expand:

- Vehicle state deltas.
- Transport-neutral module contract validation.
- Electron bridge name generation.
- Browser RPC bridge name generation.
- RPC envelope handling.
- WebSocket request/reply timeout and error handling.
- Permission checks.
- Operation locks.
- Video init segment extraction.
- Tile provider URL resolution.
- Runtime factory dependency boundaries.

Refactor direction:

- Move existing `ipcContracts.test.ts` coverage toward transport-neutral module specs. It should verify command/event names once, then separately verify Electron IPC channel naming and browser RPC bridge naming.
- Keep `ipcBridge.test.ts` as an Electron adapter test only. The 30 Hz delta publishing behavior should move to a transport-neutral publisher test so it is not coupled to `BrowserWindow.getAllWindows()`.
- Add `rpcBridge.test.ts` for generated browser methods, request IDs, callback disposal, reconnect behavior, and command errors.
- Add `runtimeFactory.test.ts` to prove the core runtime can be constructed without importing Electron.
- Keep manager/protocol tests such as mission, parameters, FTP, camera, calibration, links, tlog replay, and dialect tests close to the core modules as they move from `src/main/*` to `src/core/*`.

### Integration Tests

Add:

- Server startup and health. **Done.**
- WebSocket connect/reconnect. **Done.**
- Fake module command/reply. **Done.**
- Fake telemetry event fanout to multiple clients.
- Runtime bootstrap without Electron. **Done for server runtime construction.**
- Video broadcaster with two clients.
- Tile proxy/cache behavior. **Done for proxy behavior; cache remains later.**
- Browser bridge against a real in-process server. **Done.**
- Snapshot-then-delta resync after reconnect.
- Authorization failures for observer clients.

Recommended server integration fixtures:

```text
test/integration/serverFixture.ts
  startTestServer()
  createRealtimeClient()
  createBrowserBridgeClient()
  stopTestServer()
```

The fixture should bind to port `0`, return the chosen URL, and clean up sockets/timers aggressively. Tests should not rely on a globally running Meridian server.

The existing `SyntheticVehicle` helper should be reused, but pointed at the server's MAVLink UDP port instead of an Electron-launched app. That keeps the high-value synthetic MAVLink coverage while removing the Electron dependency from most E2E tests.

### E2E Tests

Eventually run the same core scenarios against:

1. Electron local mode.
2. Browser client + local server.
3. Browser client + SITL server.

Core scenarios:

- Connection state.
- Telemetry display.
- Arm/disarm permission behavior.
- Mission planning/upload.
- Video stream display.
- Map tile loading through the server.
- Multi-client observer/operator behavior.

Refactor direction:

- Split the current `test/e2e/fixtures/vehicleFixture.ts` into a server/browser fixture and an Electron-shell fixture.
- Keep a small Electron E2E suite for desktop wrapper behavior: app launches, loads the client, popout windows work, and native shell paths still behave.
- Move most operational E2E coverage to browser + server:
  - Start Meridian server.
  - Start one or more browser pages.
  - Start `SyntheticVehicle` or SITL.
  - Exercise the same Fly/Plan/Setup workflows through the browser client.
- Add true multi-client E2E tests with two pages connected to one server:
  - Both receive vehicle telemetry.
  - Both can watch the same video stream.
  - Observer cannot arm/disarm.
  - Operator lock state appears on both clients.
  - Mission upload by one client updates the other client.

### Test Commands

The scripts should evolve from one Electron-oriented test command into explicit layers:

```text
npm test                    # unit tests
npm run test:integration    # server/realtime/video/map integration tests
npm run test:e2e:web        # browser client + local server + SyntheticVehicle
npm run test:e2e:web:sitl   # browser client + server + SITL
npm run test:e2e:electron   # desktop wrapper compatibility
```

During migration, keep the current `npm run test:e2e` behavior until the browser/server fixture is stable. Then make browser/server the default E2E path and keep Electron as an explicit wrapper target.

### Test File Organization

Target layout:

```text
test/
  unit/
    core/
    client/
    shared/
    electron/
  integration/
    server/
    realtime/
    video/
    maps/
  e2e/
    web/
    electron/
    sitl/
    helpers/
```

This reorganization should be gradual. Move tests only when the code they cover moves, and avoid large test-only churn in the same PR as risky runtime changes.

---

## 11. Key Risks

### Electron API Leakage

Risk: core server code accidentally imports Electron-only modules.

Mitigation:

- Keep Electron adapters thin.
- Add lint or dependency-boundary checks later.
- Put file dialogs and BrowserWindow behavior behind client/shell interfaces.

### Multi-Client Command Conflicts

Risk: two clients send conflicting commands.

Mitigation:

- Add roles and operation locks before broad multi-client control.
- Make the server reject unauthorized or lock-conflicting commands.

### Video Browser Compatibility

Risk: codec/container support differs across Chrome/Safari/Firefox/tablets.

Mitigation:

- Start with Chromium-based support matching Electron.
- Expose stream codec metadata.
- Keep ffmpeg fMP4 fallback.
- Consider WebRTC later.

### State Drift After Reconnect

Risk: clients miss deltas and show stale state.

Mitigation:

- Full snapshot on reconnect.
- Delta sequence/generation tracking.
- Store-level reset/resync paths.

### Map Provider And Offline Tile Complexity

Risk: provider URL rules, API keys, attribution, cache behavior, and offline packs become tangled with client rendering.

Mitigation:

- Keep MapLibre rendering client-side.
- Keep provider registry and tile proxy server-side.
- Start with the existing provider list and HTTP proxy before adding offline packs.
- Treat offline tile packs as an implementation behind the same tile URL abstraction.

### Security On Local Networks

Risk: unauthenticated clients on the LAN can control vehicles.

Mitigation:

- Pairing token or local auth from the start.
- Development-only auth bypass bound to localhost.
- Permission checks on the server, not just hidden UI buttons.

---

## 12. Suggested First Implementation Slice

The first slice should prove the architecture without touching risky vehicle command behavior.

Recommended first PR:

1. Add `docs/client-server-migration-plan.md`.
2. Add transport-neutral `allModules` export.
3. Add generic RPC envelope types.
4. Add a tiny server skeleton with:
   - `GET /api/health`
   - `WS /realtime`
   - one fake diagnostic module or settings read-only command
5. Add tests for bridge method generation and fake RPC command/reply.

Recommended second PR:

1. Extract runtime bootstrap enough for the server to instantiate `SettingsManager` and `VideoManager`.
2. Expose read-only state over WebSocket.
3. Build browser bridge adapter.

Recommended third PR:

1. Move vehicle delta publishing into a transport-neutral publisher.
2. Connect a browser client to real telemetry.
3. Keep Electron working.

This order keeps the project shippable during the migration and gives us a working client/server spine before moving dangerous flight commands.

### Next Implementation Slices

The first client/server spine is now in place. Recommended next slices:

1. Add explicit browser connection UI state for disconnected/reconnecting/server unavailable.
2. Add multi-client authority roles and command locks before widening operator workflows.
3. Add a second-browser smoke/integration test proving both clients receive telemetry and shared state from one server runtime.
4. Move the remaining vehicle delta publisher logic out of Electron `BrowserWindow` checks and into a transport-neutral publisher used by both server and Electron adapter.
5. Decide what to do with server-local path APIs:
   - Keep `importFromPath`, `uploadFile`, and replay file paths as admin/server-local tools.
   - Hide them from normal browser UI.
   - Add HTTP download/list endpoints for server-owned artifacts such as video recordings and logs.
