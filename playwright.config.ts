import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".\\tests\\e2e",
  testMatch: "**/*.e2e.ts",
  outputDir: ".\\scriptsIgnored\\timing-test-results",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:5198",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run test:e2e:server",
    url: "http://127.0.0.1:5198",
    reuseExistingServer: false,
    timeout: 30_000,
    stdout: "pipe",
  },
});
