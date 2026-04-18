export interface Logger {
  log(...args: unknown[]): void
  debug(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
}

export function createLogger(tag: string): Logger {
  return {
    log: (...a) => console.log(`[${tag}]`, ...a),
    debug: (...a) => console.debug(`[${tag}]`, ...a),
    warn: (...a) => console.warn(`[${tag}]`, ...a),
    error: (...a) => console.error(`[${tag}]`, ...a)
  }
}
