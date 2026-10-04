import { defineConfig, devices } from "@playwright/test";
import { parseInboxLr2BrowserEnvironment } from "./e2e/inbox-lr2-config";

const inboxLr2BrowserEnvironment = parseInboxLr2BrowserEnvironment();

// Set PLAYWRIGHT_BROWSER_CHANNEL=chrome (or msedge) to use a browser already installed on this machine instead of Playwright's own
// download, which some networks block. Unset, nothing changes (CI uses Playwright's Chromium).
const browserChannel = process.env.PLAYWRIGHT_BROWSER_CHANNEL?.trim();

// PLAYWRIGHT_SLOW_FACTOR=3 triples every timeout for a slow machine (a local Docker database makes each server action take 1 to 2 seconds). Unset, nothing changes.
const slowFactor = Math.max(1, Number(process.env.PLAYWRIGHT_SLOW_FACTOR) || 1);

// https://playwright.dev/docs/test-configuration
// https://playwright.dev/docs/auth
export default defineConfig({
  testDir: "./e2e",
  testMatch: [
    "inbox-lr2.spec.ts",
    "inbox-views-and-search.spec.ts",
    "inbox-keyboard-and-responsive.spec.ts",
    "inbox-accessibility.spec.ts",
    "inbox-ownership-and-bulk.spec.ts",
    "inbox-composer.spec.ts",
    "inbox-start-chat-presence-and-copilot.spec.ts",
    "inbox-shortcuts-denied-and-unavailable.spec.ts",
    "inbox-customer-context.spec.ts",
    "inbox-two-agency-isolation.spec.ts",
  ],
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  outputDir: "test-results/inbox-lr2",
  timeout: 60_000 * slowFactor,
  expect: { timeout: 15_000 * slowFactor },
  use: { baseURL: inboxLr2BrowserEnvironment.baseUrl, ...devices["Desktop Chrome"], ...(browserChannel ? { channel: browserChannel } : {}), serviceWorkers: "block", trace: "retain-on-failure", screenshot: "only-on-failure", video: "retain-on-failure" },
});
