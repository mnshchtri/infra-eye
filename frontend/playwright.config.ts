import { defineConfig, devices } from '@playwright/test'

// E2E tests drive the real UI against a running backend (default seeded admin).
// Start the stack first (`make infra && make backend`); the Vite dev server is
// launched here unless one is already listening.
const BASE_URL = process.env.E2E_BASE_URL || 'http://127.0.0.1:5173'

export default defineConfig({
  testDir: './e2e',
  // Generous: the dev server compiles on demand and CI/laptops can be heavily loaded.
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false, // tests share one backend/database
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, storageState: 'e2e/.auth/admin.json' },
      dependencies: ['setup'],
      testIgnore: /login\.spec\.ts/,
    },
    // Login tests must start unauthenticated.
    { name: 'login', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } }, testMatch: /login\.spec\.ts/ },
  ],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1',
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
