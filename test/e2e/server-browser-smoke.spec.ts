import { expect, test, type Page } from '@playwright/test'
import { execSync, spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import dgram from 'dgram'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { SyntheticVehicle } from './helpers/SyntheticVehicle'

let built = false

async function freeUdpPort(): Promise<number> {
  const socket = dgram.createSocket('udp4')
  return new Promise((resolve, reject) => {
    socket.once('error', reject)
    socket.bind(0, '127.0.0.1', () => {
      const address = socket.address()
      const port = typeof address === 'object' ? address.port : 0
      socket.close(() => resolve(port))
    })
  })
}

async function ensureBuilt(): Promise<void> {
  if (built) return
  execSync('npm run build', {
    cwd: path.resolve(__dirname, '../..'),
    stdio: 'pipe'
  })
  built = true
}

async function startServerProcess(udpPort: number): Promise<{
  url: string
  userDataDir: string
  process: ChildProcessWithoutNullStreams
}> {
  await ensureBuilt()
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'meridian-web-e2e-'))
  const proc = spawn('node', ['out/main/server.js'], {
    cwd: path.resolve(__dirname, '../..'),
    env: {
      ...process.env,
      GC_UDP_PORT: String(udpPort),
      MERIDIAN_SERVER_PORT: '0',
      MERIDIAN_SERVER_HOST: '127.0.0.1',
      MERIDIAN_USER_DATA_DIR: userDataDir
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })

  const url = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Timed out waiting for server URL'))
    }, 15_000)

    const onData = (buf: Buffer): void => {
      const text = buf.toString()
      const match = text.match(/Meridian server listening on (http:\/\/[^\s]+)/)
      if (!match) return
      clearTimeout(timeout)
      resolve(match[1]!)
    }

    proc.stdout.on('data', onData)
    proc.stderr.on('data', (buf) => {
      process.stderr.write(`[server:e2e] ${buf.toString()}`)
    })
    proc.once('exit', (code) => {
      clearTimeout(timeout)
      reject(new Error(`Server exited before startup: ${code}`))
    })
  })

  return { url, userDataDir, process: proc }
}

async function stopServer(server: {
  process: ChildProcessWithoutNullStreams
  userDataDir: string
}): Promise<void> {
  if (!server.process.killed) {
    server.process.kill('SIGTERM')
    await new Promise<void>((resolve) => {
      server.process.once('exit', () => resolve())
      setTimeout(resolve, 2500)
    })
  }
  await rm(server.userDataDir, { recursive: true, force: true })
}

async function waitForBridge(page: Page): Promise<void> {
  await page.waitForFunction(() => Boolean((window as unknown as { bridge?: unknown }).bridge))
}

async function waitForServerConnected(page: Page): Promise<void> {
  await expect(page.getByTestId('server-status')).toHaveText('connected', { timeout: 10_000 })
}

function collectConsoleWarnings(page: Page): string[] {
  const consoleMessages: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      consoleMessages.push(message.text())
    }
  })
  return consoleMessages
}

function waitForVehicleAdded(page: Page): Promise<unknown> {
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        const off = (window as any).bridge.onVehicleAdded((payload: unknown) => {
          off()
          resolve(payload)
        })
      })
  )
}

function waitForVehicleDelta(page: Page): Promise<unknown> {
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        const off = (window as any).bridge.onVehicleDelta((payload: unknown) => {
          off()
          resolve(payload)
        })
      })
  )
}

test.describe('browser/server smoke', () => {
  test('loads the browser client and receives synthetic vehicle telemetry', async ({ page }) => {
    const udpPort = await freeUdpPort()
    const server = await startServerProcess(udpPort)
    const vehicle = new SyntheticVehicle(udpPort)
    const consoleMessages = collectConsoleWarnings(page)

    try {
      await page.goto(server.url, { waitUntil: 'domcontentloaded' })
      await waitForBridge(page)

      const settings = await page.evaluate(async () => {
        const bridge = (window as any).bridge
        return bridge.settingsGetAll()
      })
      expect(settings.mapProvider).toBeTruthy()
      await waitForServerConnected(page)

      const links = await page.evaluate(async () => {
        const bridge = (window as any).bridge
        return bridge.linksGetAll()
      })
      expect(links).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            status: 'connected'
          })
        ])
      )

      const vehicleAdded = waitForVehicleAdded(page)
      const vehicleDelta = waitForVehicleDelta(page)

      await page.waitForTimeout(250)
      vehicle.startStreaming({ lat: 42.3898, lon: -71.1476, alt: 14 })

      await expect(vehicleAdded).resolves.toEqual({ vehicleId: 1 })
      await expect(vehicleDelta).resolves.toMatchObject({ vehicleId: 1 })

      await expect(async () => {
        const currentLinks = await page.evaluate(async () => {
          const bridge = (window as any).bridge
          return bridge.linksGetAll()
        })
        expect(currentLinks).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              vehicleIds: expect.arrayContaining([1])
            })
          ])
        )
      }).toPass({ timeout: 10_000 })

      expect(consoleMessages.filter((message) => message.includes('tile://'))).toEqual([])
    } finally {
      vehicle.stop()
      await stopServer(server)
    }
  })

  test('publishes telemetry to two browser clients from one server runtime', async ({
    context
  }) => {
    const udpPort = await freeUdpPort()
    const server = await startServerProcess(udpPort)
    const vehicle = new SyntheticVehicle(udpPort)
    const pageA = await context.newPage()
    const pageB = await context.newPage()
    const consoleMessagesA = collectConsoleWarnings(pageA)
    const consoleMessagesB = collectConsoleWarnings(pageB)

    try {
      await Promise.all([
        pageA.goto(server.url, { waitUntil: 'domcontentloaded' }),
        pageB.goto(server.url, { waitUntil: 'domcontentloaded' })
      ])
      await Promise.all([waitForBridge(pageA), waitForBridge(pageB)])
      await Promise.all([
        pageA.evaluate(async () => (window as any).bridge.settingsGetAll()),
        pageB.evaluate(async () => (window as any).bridge.settingsGetAll())
      ])
      await Promise.all([waitForServerConnected(pageA), waitForServerConnected(pageB)])

      const addedA = waitForVehicleAdded(pageA)
      const addedB = waitForVehicleAdded(pageB)
      const deltaA = waitForVehicleDelta(pageA)
      const deltaB = waitForVehicleDelta(pageB)

      await pageA.waitForTimeout(250)
      vehicle.startStreaming({ lat: 42.3898, lon: -71.1476, alt: 14 })

      await expect(addedA).resolves.toEqual({ vehicleId: 1 })
      await expect(addedB).resolves.toEqual({ vehicleId: 1 })
      await expect(deltaA).resolves.toMatchObject({ vehicleId: 1 })
      await expect(deltaB).resolves.toMatchObject({ vehicleId: 1 })

      for (const page of [pageA, pageB]) {
        await expect(async () => {
          const currentLinks = await page.evaluate(async () => {
            const bridge = (window as any).bridge
            return bridge.linksGetAll()
          })
          expect(currentLinks).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                vehicleIds: expect.arrayContaining([1])
              })
            ])
          )
        }).toPass({ timeout: 10_000 })
      }

      expect(consoleMessagesA.filter((message) => message.includes('tile://'))).toEqual([])
      expect(consoleMessagesB.filter((message) => message.includes('tile://'))).toEqual([])
    } finally {
      vehicle.stop()
      await pageA.close().catch(() => {})
      await pageB.close().catch(() => {})
      await stopServer(server)
    }
  })
})
