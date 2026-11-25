import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120000,
  expect: { timeout: 10000 },
  workers: 1,
  use: { actionTimeout: 15000, baseURL: 'http://localhost:4173/', viewport: { width: 1280, height: 800 }, locale: 'ar' },
  webServer: { command: 'npm run build && npm run preview', url: 'http://localhost:4173/', reuseExistingServer: false, timeout: 180000 },
  projects: [
    { name: 'laptop', use: { browserName: 'chromium' } },
    { name: 'phone', use: { browserName: 'chromium', viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 } }
  ]
});
