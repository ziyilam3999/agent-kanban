import { defineConfig, devices } from "@playwright/test";

// Playwright drives the RUNNING dev board for the #1295 Live-Swimlanes DOM
// acceptance checks. Jest owns `__tests__/**/*.test.ts` (node env); Playwright owns
// `e2e/**/*.e2e.spec.ts` — the two never collide on testMatch.
//
// Base URL: PW_BASE_URL (default :3939). When PW_WEB_SERVER=1 Playwright boots its
// own `next dev` (CI); locally we reuse an already-running server.
const PORT = process.env.PW_PORT || "3939";
const BASE_URL = process.env.PW_BASE_URL || `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "e2e",
  testMatch: /.*\.e2e\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "off",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  ...(process.env.PW_WEB_SERVER === "1"
    ? {
        webServer: {
          command: `BOARD_BLOB_URL= next dev -p ${PORT}`,
          url: BASE_URL,
          timeout: 120_000,
          reuseExistingServer: true,
        },
      }
    : {}),
});
