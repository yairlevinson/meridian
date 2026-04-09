/**
 * Renderer logger — forwards to main process log file (~/meridian-app.log)
 * via bridge IPC, and also logs to the browser console.
 *
 * Usage:
 *   import { rlog } from '../lib/rlog'
 *   const log = rlog('MissionStore')
 *   log.debug('loaded', items.length, 'items')
 */

type LogLevel = 'info' | 'warn' | 'error' | 'debug'

function send(level: LogLevel, tag: string, args: unknown[]): void {
  const message = args
    .map((a) => (typeof a === 'string' ? a : a instanceof Error ? a.message : String(a)))
    .join(' ')

  // Console output
  const consoleFn =
    level === 'debug'
      ? console.debug
      : level === 'warn'
        ? console.warn
        : level === 'error'
          ? console.error
          : console.log
  consoleFn(`[${tag}] ${message}`)

  // Forward to main process log file
  window.bridge?.log(level, tag, message)
}

export interface RLogger {
  log(...args: unknown[]): void
  debug(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
}

export function rlog(tag: string): RLogger {
  return {
    log: (...args) => send('info', tag, args),
    debug: (...args) => send('debug', tag, args),
    warn: (...args) => send('warn', tag, args),
    error: (...args) => send('error', tag, args)
  }
}
