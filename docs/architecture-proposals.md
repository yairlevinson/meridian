# Meridian Architecture Proposals

Five high-level architecture changes, ordered by impact. Code samples are illustrative — meant to show shape, not be drop-in.

---

## 1. IPC bridge / preload decomposition

**Problem.** [`src/main/ipcBridge.ts`](../src/main/ipcBridge.ts) is 909 lines: wires every manager's events (lines 125–188), holds PX4/ArduPilot mode tables inline (lines 32–80), and registers ~70 channels in one `handlers` array. The preload ([`src/preload/index.ts`](../src/preload/index.ts)) duplicates that shape by hand in a 35+ method `Bridge` interface. Adding a feature touches three files (channel enum, main handler, preload method) in lockstep.

**Sketch.** Introduce per-feature "IPC modules" that own their channel registrations and event forwarding:

```ts
// src/shared-types/ipc/defineModule.ts
export function defineIpcModule<T extends Record<string, (...a: any) => any>>(
  name: string,
  spec: { commands: T; events: string[] }
) {
  return spec
} // carries type info only

// src/main/vehicle/ipc.ts
export const vehicleIpc = defineIpcModule('vehicle', {
  commands: {
    arm: (id: number) => Promise<void>,
    disarm: (id: number) => Promise<void>,
    setFlightMode: (req: FlightModeRequest) => Promise<MavResult>
    // ...
  },
  events: ['delta', 'added', 'removed', 'statusText']
})
```

Each module exports `register(ipcMain, deps)` that handles its own channels and forwards its own events. A single `bootstrapIpc()` imports every module and wires the shared tick loop. The preload's `Bridge` type is **derived** from module specs — `type Bridge = InferBridge<typeof allModules>` — so `preload/index.ts` becomes a ~30-line generic dispatcher rather than 638 hand-written methods.

**Tradeoff.** The module pattern adds some type machinery up front. Worth it because every new IPC method stops editing `channels.ts` + `events.ts` + `ipcBridge.ts` + `preload/index.ts` as four coordinated edits.

---

## 2. Autopilot dialect layer

**Problem.** Autopilot divergence leaks across the codebase:

- [`src/main/ipcBridge.ts`](../src/main/ipcBridge.ts) lines 32–80 — mode name → number tables, inline
- [`src/main/vehicleState.ts`](../src/main/vehicleState.ts) lines 27–86 — mode number → display name, duplicated
- [`src/main/vehicle/commandSemantics.ts`](../src/main/vehicle/commandSemantics.ts) — 506 lines of `if (autopilot === 'px4')` branches
- [`src/main/ipcBridge.ts`](../src/main/ipcBridge.ts) line 306 — autopilot detection by sniffing for `RC_MAP_FLTMODE` parameter (fragile)

**Sketch.** One interface, two implementations, one detection point:

```ts
// src/main/vehicle/dialect/VehicleDialect.ts
export interface VehicleDialect {
  readonly name: 'px4' | 'ardupilot'

  // Mode mapping
  modeNameToCustomMode(name: string): number | undefined
  customModeToName(customMode: number, vehicleType: number): string

  // Command plans (replaces commandSemantics.ts branches)
  planTakeoff(p: TakeoffParams): ActionStep[]
  planGoto(p: GotoParams): ActionStep[]
  planSetMode(modeName: string): ActionStep[]
  planChangeAltitude(p: ChangeAltitudeParams): ActionStep[]
  // ...

  // Protocol hints
  usesSetModeMessage: boolean      // PX4 yes, ArduPilot uses DO_SET_MODE command
  supportsForceArm: boolean
  paramNamespace: 'px4' | 'ardupilot'
}

// Two implementations:
// src/main/vehicle/dialect/Px4Dialect.ts
// src/main/vehicle/dialect/ArduPilotDialect.ts

// Detection: once, when we first see a HEARTBEAT
// src/main/vehicle/Vehicle.ts
private dialect: VehicleDialect | null = null
onHeartbeat(msg: Heartbeat) {
  if (!this.dialect) {
    this.dialect = msg.autopilot === MAV_AUTOPILOT_PX4
      ? new Px4Dialect()
      : new ArduPilotDialect()
  }
}
```

All callers then ask `vehicle.dialect.planGoto({...})` instead of passing `autopilot: AutopilotType` around. The `customModeToName` tables live in one place per dialect, not three.

**Tradeoff.** Doesn't reduce total LOC much, but it relocates the branching so each dialect file can be read top-to-bottom. Makes adding a third autopilot (INAV, Betaflight) a matter of writing a third file.

---

## 3. Vehicle coordinator refactor

**Problem.** [`src/main/vehicle/Vehicle.ts`](../src/main/vehicle/Vehicle.ts) instantiates 11 managers in its constructor and repeats identical plumbing for each:

```ts
this.parameterManager.setLink(link)
this.parameterManager.setTarget(sysid, 1)
this.calibrationManager.setLink(link)
this.calibrationManager.setTarget(sysid)
this.cameraManager.setLink(link)
// ... ×11
```

Every manager independently re-derives `(link, sysid, compid)`. Unit-testing a single manager requires constructing the whole `Vehicle`.

**Sketch.** A `VehicleContext` value-object passed to managers; managers react to context changes via a subscription:

```ts
// src/main/vehicle/VehicleContext.ts
export interface VehicleContext {
  sysid: number
  compid: number
  link: LinkInterface
  dialect: VehicleDialect
  log: Logger
}

export abstract class VehicleSubsystem {
  protected ctx!: VehicleContext
  bind(ctx: VehicleContext) {
    this.ctx = ctx
    this.onBind()
  }
  protected onBind() {} // hook for per-subsystem wiring
}

// Vehicle becomes a thin coordinator:
class Vehicle {
  readonly subsystems: {
    mission: MissionManager
    params: ParameterManager
    calibration: CalibrationManager
    // ...
  }

  private rebind(link: LinkInterface) {
    const ctx = { sysid: this.sysid, compid: 1, link, dialect: this.dialect!, log }
    for (const s of Object.values(this.subsystems)) s.bind(ctx)
  }
}
```

Each subsystem reads `this.ctx.link` / `this.ctx.sysid` directly. `Vehicle.ts` drops from 749 lines to something closer to 200, and managers become independently constructable (`new ParameterManager().bind(fakeCtx)`) — a real testability win.

**Tradeoff.** Subsystems now have a shared base class / conventional `bind()`. Mildly more framework-y than the current composition, but replaces ~30 lines of repeated plumbing.

---

## 4. Delta-state generalization

**Problem.** [`src/main/vehicleState.ts`](../src/main/vehicleState.ts) is 869 lines of the same pattern repeated 15 times: a group interface with a `seq` counter, a `defaultGroup()` factory, a `setGroup()` mutator that bumps seq, and a `getGroupDelta()` accessor. Lines 88–120 show how mechanical it is.

**Sketch.** A generic `DeltaGroup<T>` that handles the sequencing once:

```ts
// src/main/state/DeltaGroup.ts
export class DeltaGroup<T extends object> {
  private state: T & { seq: number }
  private dirty = false

  constructor(initial: T) {
    this.state = { ...initial, seq: 0 }
  }

  update(patch: Partial<T>): void {
    let changed = false
    for (const k in patch) {
      if (!Object.is(this.state[k], patch[k])) {
        ;(this.state as any)[k] = patch[k]
        changed = true
      }
    }
    if (changed) {
      this.state.seq++
      this.dirty = true
    }
  }

  snapshot(): Readonly<T & { seq: number }> {
    return this.state
  }
  takeDelta(): (T & { seq: number }) | null {
    if (!this.dirty) return null
    this.dirty = false
    return { ...this.state }
  }
}

// VehicleState shrinks to a registry:
export class VehicleState {
  readonly core = new DeltaGroup<CoreGroup>(defaultCore())
  readonly attitude = new DeltaGroup<AttitudeGroup>(defaultAttitude())
  readonly gps = new DeltaGroup<GpsGroup>(defaultGps())
  // ...

  getDelta(): VehicleDelta {
    const out: VehicleDelta = {}
    const c = this.core.takeDelta()
    if (c) out.core = c
    const a = this.attitude.takeDelta()
    if (a) out.attitude = a
    // ...
    return out
  }
}
```

Callers then do `vehicle.state.attitude.update({ roll, pitch, yaw })` instead of `vehicle.state.setAttitude(...)`. The `defaultX()` factories can mostly stay (they're the group schemas). The mutation-with-seq logic — the bulk of the 869 lines — disappears.

**Tradeoff.** Slightly more indirection at call sites (`state.gps.update(...)` vs `state.setGps(...)`). But removes ~500 lines of boilerplate and makes it impossible to forget to bump `seq`.

---

## 5. Utility-process isolation

**Problem.** Main process juggles UI event loop, network I/O for every link, MAVLink parsing, long-running protocol state machines (mission download, parameter download, FTP, firmware upload), and video ffmpeg supervision. A hang or leak in any of these affects IPC latency for the renderer. The 30 Hz delta tick (in [`src/main/ipcBridge.ts`](../src/main/ipcBridge.ts) around line 236) lives alongside FTP retry loops.

**Sketch.** Move the MAVLink stack into a utility process:

```
┌──────────────┐      ┌──────────────────────┐      ┌───────────┐
│  Renderer(s) │─IPC─▶│  Main (thin)         │      │  MAVLink  │
│              │◀─────│  - window mgmt       │─MP──▶│  Utility  │
└──────────────┘      │  - settings          │◀─MP──│  Process  │
                      │  - video supervision │      │           │
                      │  - IPC fan-out       │      │  (links,  │
                      └──────────────────────┘      │   vehicle,│
                                                    │   mission,│
                                                    │   ftp)    │
                                                    └─────┬─────┘
                                                          │ UDP/TCP
                                                          ▼
                                                    ArduPilot / PX4
```

- Main spawns the utility via `utilityProcess.fork()`, communicates via `MessagePort`.
- Utility owns `LinkManager`, `VehicleManager`, all protocol managers. Emits delta-state batches over the port at 30 Hz.
- Main just fans those out to `BrowserWindow`s — it's a dumb router.
- Video (ffmpeg + WebSocket) stays in main because it owns a local WS server; moving it is a separate decision.

**Tradeoff.** Big payoff: main stays responsive; utility can crash and restart without taking down the window; easier to reason about shutdown. But non-trivial migration — every manager's current `import { ipcMain }` pattern has to move to MessagePort, and the preload bridge becomes a double-hop. Do this **after** #1 (module decomposition), because module boundaries make the split mostly mechanical.

---

## Suggested order

1 → 2 → 3 → 4 → 5. Each earlier one makes the next cheaper:

- Module decomposition (#1) gives you clean module boundaries to relocate dialect code into (#2).
- Dialects (#2) make `VehicleContext` (#3) stable — contexts can carry a `dialect` reference.
- Coordinator refactor (#3) makes it obvious where `DeltaGroup<T>` (#4) plugs in.
- All four together make the utility-process split (#5) a package-move, not a rewrite.
