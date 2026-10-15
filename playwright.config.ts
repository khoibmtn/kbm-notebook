import { defineConfig, devices } from "@playwright/test";
import fs from "node:fs";

const PORT = Number(process.env.E2E_PORT ?? 3200);
const baseURL = `http://localhost:${PORT}`;

// Chromium cài sẵn trong môi trường (không chạy `playwright install`). Có thể ghi đè bằng PW_CHROMIUM_PATH.
const candidates = [
  process.env.PW_CHROMIUM_PATH,
  "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
].filter((p): p is string => Boolean(p));
const executablePath = candidates.find((p) => fs.existsSync(p));

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  reporter: [["list"]],
  outputDir: "test-results",
  use: {
    baseURL,
    locale: "vi-VN",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: { executablePath, args: ["--no-sandbox"] },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm dev",
    url: `${baseURL}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      PORT: String(PORT),
      BETTER_AUTH_URL: baseURL,
      NEXT_PUBLIC_APP_URL: baseURL,
      AI_PROVIDER: "mock",
      // Bridge giả của e2e chạy ở localhost
      CONNECTORS_ALLOW_PRIVATE_HOSTS: "true",
    },
  },
});
