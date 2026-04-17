/**
 * IPC module framework: declare an IPC surface once, derive both the
 * main-side handler table and the preload-side `Bridge` methods from it.
 *
 * Naming convention (matches existing channel/event names):
 *   channel for command `cmd` in module `mod` = `${mod}:${cmd}`
 *   event   for event   `ev`  in module `mod` = `${mod}:${ev}`
 *   bridge method for command = `${mod}${Capitalize<cmd>}`
 *   bridge method for event   = `on${Capitalize<mod>}${Capitalize<ev>}`
 */

// ── Phantom helpers for typed placeholders in a module spec ──────────

/** Phantom command signature — never called at runtime; carries type info only. */
export function command<TArgs extends unknown[], TResult>(): (...args: TArgs) => Promise<TResult> {
  return (() => {
    throw new Error('command() placeholder should never be invoked')
  }) as (...args: TArgs) => Promise<TResult>
}

/** Phantom event payload marker — carries the payload type. */
export interface EventMarker<TPayload> {
  readonly __event: true
  readonly __payload?: TPayload
}
export function event<TPayload>(): EventMarker<TPayload> {
  return { __event: true } as EventMarker<TPayload>
}

// ── Module spec ───────────────────────────────────────────────────────

export type CommandMap = Record<string, (...args: never[]) => Promise<unknown>>
export type EventMap = Record<string, EventMarker<unknown>>

export interface IpcModuleSpec<
  Name extends string = string,
  C extends CommandMap = CommandMap,
  E extends EventMap = EventMap
> {
  name: Name
  commands: C
  events: E
}

export function defineIpcModule<Name extends string, C extends CommandMap, E extends EventMap>(
  spec: IpcModuleSpec<Name, C, E>
): IpcModuleSpec<Name, C, E> {
  return spec
}

// ── Bridge type derivation ───────────────────────────────────────────

type UnionToIntersection<U> = (U extends unknown ? (x: U) => void : never) extends (
  x: infer I
) => void
  ? I
  : never

type Cap<S extends string> = Capitalize<S>

type PayloadOf<M> = M extends EventMarker<infer P> ? P : never

/** Bridge methods generated from a module's commands. */
export type ModuleCommandBridge<M extends IpcModuleSpec> = {
  [K in keyof M['commands'] & string as `${M['name']}${Cap<K>}`]: M['commands'][K]
}

/** Bridge methods generated from a module's events. */
export type ModuleEventBridge<M extends IpcModuleSpec> = {
  [K in keyof M['events'] & string as `on${Cap<M['name']>}${Cap<K>}`]: (
    cb: (payload: PayloadOf<M['events'][K]>) => void
  ) => () => void
}

/** All Bridge methods contributed by a single module. */
export type ModuleBridge<M extends IpcModuleSpec> = ModuleCommandBridge<M> & ModuleEventBridge<M>

/** Combined Bridge type from a tuple of modules. */
export type BridgeOf<Modules extends readonly IpcModuleSpec[]> = UnionToIntersection<
  ModuleBridge<Modules[number]>
>

// ── Wire helpers (used by main & preload) ────────────────────────────

export function commandChannel(moduleName: string, commandKey: string): string {
  return `${moduleName}:${commandKey}`
}

export function eventChannel(moduleName: string, eventKey: string): string {
  return `${moduleName}:${eventKey}`
}

export function commandBridgeKey(moduleName: string, commandKey: string): string {
  return `${moduleName}${capitalize(commandKey)}`
}

export function eventBridgeKey(moduleName: string, eventKey: string): string {
  return `on${capitalize(moduleName)}${capitalize(eventKey)}`
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1)
}
