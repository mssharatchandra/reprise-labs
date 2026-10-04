import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/browser',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: 'http://127.0.0.1:4174',
    headless: true,
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npx tsx server/index.ts',
    url: 'http://127.0.0.1:4174/healthz',
    reuseExistingServer: false,
    env: {
      PORT: '4174',
      DATABASE_PATH: `.local/e2e-${Date.now()}.db`,
      BOLNA_API_KEY: '',
      BOLNA_AGENT_ID: '',
      DEMO_PHONE_NUMBER: '',
      APP_BASE_URL: 'http://localhost:4174',
    },
    timeout: 30000,
  },
});
