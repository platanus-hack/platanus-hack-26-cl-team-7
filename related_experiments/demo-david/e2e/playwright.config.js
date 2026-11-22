import { defineConfig, devices } from '@playwright/test';

// By default the suite starts its own server on port 3111 (E2E_PORT to change it)
// with a fresh database. Set E2E_BASE_URL to run against an app that is already
// running instead, for example one started with "npm start".
const port = Number(process.env.E2E_PORT || 3111);
const externalBaseURL = process.env.E2E_BASE_URL;
const baseURL = externalBaseURL || `http://localhost:${port}`;

export default defineConfig({
  testDir: './tests',
  // One user and one database are shared, and one test changes the password,
  // so the tests run one at a time.
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    colorScheme: 'light',
    locale: 'en-US',
    viewport: { width: 1280, height: 900 },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } } }],
  webServer: externalBaseURL
    ? undefined
    : {
        command: 'node start-server.mjs',
        url: `${baseURL}/status`,
        reuseExistingServer: false,
        timeout: 60_000,
        stdout: 'pipe',
        stderr: 'pipe',
        env: { E2E_PORT: String(port) },
      },
});
