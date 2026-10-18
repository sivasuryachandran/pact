import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests-e2e',
  timeout: 30_000,
  fullyParallel: false,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'retain-on-failure', viewport: { width: 1440, height: 900 }, ...devices['Desktop Chrome'] },
  webServer: { command: 'npm run dev -- --host 127.0.0.1', cwd: new URL('.', import.meta.url).pathname, url: 'http://127.0.0.1:4173', reuseExistingServer: true, timeout: 30_000 },
});
