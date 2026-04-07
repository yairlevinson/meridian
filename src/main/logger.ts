import * as fs from 'fs'
import * as path from 'path'

function getLogPath(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { app } = require('electron')
    return path.join(app?.getPath('home') ?? '/tmp', 'meridian-app.log')
  } catch {
    return path.join('/tmp', 'meridian-app.log')
  }
}

const LOG_FILE = getLogPath()

let fd: number | null = null

function open(): void {
  try {
    fd = fs.openSync(LOG_FILE, 'w')
    write('INFO', 'logger', `App log started ${new Date().toISOString()}`)
  } catch {
    fd = null
  }
}

function write(level: string, tag: string, message: string): void {
  if (fd === null) return
  try {
    fs.writeSync(fd, `${new Date().toISOString()} ${level} [${tag}] ${message}\n`)
  } catch {
    // ignore write errors
  }
}

function close(): void {
  if (fd !== null) {
    fs.closeSync(fd)
    fd = null
  }
}

export interface Logger {
  log(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
}

function format(args: unknown[]): string {
  return args
    .map((a) => (typeof a === 'string' ? a : a instanceof Error ? a.message : String(a)))
    .join(' ')
}

export function createLogger(tag: string): Logger {
  if (fd === null) open()

  return {
    log(...args: unknown[]): void {
      const msg = format(args)
      console.log(`[${tag}] ${msg}`)
      write('INFO', tag, msg)
    },
    warn(...args: unknown[]): void {
      const msg = format(args)
      console.warn(`[${tag}] ${msg}`)
      write('WARN', tag, msg)
    },
    error(...args: unknown[]): void {
      const msg = format(args)
      console.error(`[${tag}] ${msg}`)
      write('ERROR', tag, msg)
    }
  }
}

export function closeLogger(): void {
  close()
}
