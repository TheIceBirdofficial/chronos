import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  timeout: 60_000,
  use: {
    headless: true,
    launchOptions: {
      args: ['--disable-gpu', '--disable-software-rasterizer'],
    },
    cpuThrottleRate: 2,
    viewport: { width: 1280, height: 720 },
    // Keep memory low
  },
  workers: 1,
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});