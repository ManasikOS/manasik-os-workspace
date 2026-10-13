import { defineConfig, devices } from "@playwright/test";

import { parseDashboardE2eEnvironment } from "./e2e/dashboard-roles-config";

/**
 * Dashboard role-matrix run (docs/runbooks/dashboard-roles-e2e.md).
 *
 * Its own config, not an addition to `playwright.config.ts`: that one is an
 * explicit Inbox LR2 allowlist whose base URL comes from the Inbox's own
 * environment, so a Dashboard spec must neither depend on those variables nor
 * be picked up by `npm run test:e2e`.
 *
 * Parsing the environment here refuses a production target before a browser
 * is ever launched.
 */
const environment = parseDashboardE2eEnvironment();

const browserChannel = process.env.PLAYWRIGHT_BROWSER_CHANNEL?.trim();
const slowFactor = Math.max(1, Number(process.env.PLAYWRIGHT_SLOW_FACTOR) || 1);

export default defineConfig({
  testDir: "./e2e",
  testMatch: ["dashboard-roles.spec.ts"],
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report/dashboard-roles" }]],
  outputDir: "test-results/dashboard-roles",
  timeout: 60_000 * slowFactor,
  expect: { timeout: 15_000 * slowFactor },
  use: {
    baseURL: environment.baseUrl,
    ...devices["Desktop Chrome"],
    ...(browserChannel ? { channel: browserChannel } : {}),
    serviceWorkers: "block",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
