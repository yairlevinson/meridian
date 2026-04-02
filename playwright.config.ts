import { defineConfig } from '@playwright/test'

const useSitl = process.env.GC_E2E_SITL === '1'

export default defineConfig({
  testDir: './test/e2e',
  timeout: useSitl ? 180_000 : 30_000,
  retries: useSitl ? 0 : 1, // No retries for SITL — vehicle state is non-resettable
  workers: 1, // Electron tests must run serially — one app at a time
  reporter: 'list',
  use: {
    trace: 'on-first-retry'
  },
  globalSetup: useSitl ? './test/e2e/fixtures/sitl.setup.ts' : undefined,
  globalTeardown: useSitl ? './test/e2e/fixtures/sitl.teardown.ts' : undefined
})
