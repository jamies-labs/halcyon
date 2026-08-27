import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: "http://localhost:4173", hasTouch: true },
  webServer: {
    command: 'npm run preview:e2e',
    port: 4173,
    reuseExistingServer: !process.env.CI,
  },
});
