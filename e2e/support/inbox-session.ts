import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

import type { InboxLr2StaffCredentials } from "../inbox-lr2-config";

export { PHONE_VIEWPORT, inboxAddress, parseViewTotal, pngLikeBuffer, requireOwnerFixture, requireSearchFixtures, requireTemplateFixture } from "./inbox-test-inputs";

export type InboxBrowserSession = { context: BrowserContext; page: Page };

/**
 * Signs in through the real login form (never a mocked session) and opens the Inbox at `path`. Each call is its own browser context, so
 * two staff, or two agencies, can be signed in side by side. The caller closes the context.
 */
export async function signInToInboxAt(
  browser: Browser,
  staff: InboxLr2StaffCredentials,
  path: string,
  options: { viewport?: { width: number; height: number } } = {},
): Promise<InboxBrowserSession> {
  const context = await browser.newContext({ serviceWorkers: "block", ...(options.viewport ? { viewport: options.viewport } : {}) });
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("Work email").fill(staff.email);
  await page.getByPlaceholder("Enter your password").fill(staff.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/(dashboard|inbox)/);
  await page.goto(path);
  await expect(page.getByLabel("Conversation list")).toBeVisible();
  return { context, page };
}
