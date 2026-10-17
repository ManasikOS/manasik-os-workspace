import { expect, test, type Browser } from "@playwright/test";

import { DASHBOARD_E2E_ROLES, parseDashboardE2eEnvironment, type DashboardE2eCredentials } from "./dashboard-roles-config";
import {
  BLOCK_DISTINCTIVE_TEXT,
  forbiddenBlocksFor,
  mustBePresentBlocksFor,
} from "./support/dashboard-expectations";

/**
 * Dashboard role matrix (docs/modules/dashboard-role-blocks-spec.md section
 * 8, task T16). One real sign-in per built-in role against a staging or
 * disposable project, then:
 *
 *  - every block the role's preset and capabilities allow is on the page,
 *  - every block they do not is absent from the DOM *and* its distinctive
 *    text is absent from the served document (so not in the RSC payload),
 *  - no block rendered its error card (the seeded agency is healthy).
 *
 * Needs the accounts and variables in docs/runbooks/dashboard-roles-e2e.md.
 * Not part of `npm run test:e2e` (the Inbox config's allowlist): run it with
 * `npm run test:e2e:dashboard`.
 */
const environment = parseDashboardE2eEnvironment();

async function signInToDashboard(browser: Browser, staff: DashboardE2eCredentials) {
  const context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("Work email").fill(staff.email);
  await page.getByPlaceholder("Enter your password").fill(staff.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/(dashboard|inbox)/);
  return { context, page };
}

for (const role of DASHBOARD_E2E_ROLES) {
  test.describe(`Dashboard as ${role}`, () => {
    test("shows exactly the blocks its role is entitled to", async ({ browser }) => {
      const { context, page } = await signInToDashboard(browser, environment.staff[role]);
      try {
        const response = await page.goto("/dashboard");
        expect(response?.ok()).toBe(true);
        await expect(page.getByRole("heading", { name: "Dashboard" }).first()).toBeVisible();

        for (const id of mustBePresentBlocksFor(role)) {
          await expect(page.locator(`[data-dashboard-block="${id}"]`), `block ${id} should be present`).toHaveCount(1);
        }

        const document = (await response?.text()) ?? "";
        for (const id of forbiddenBlocksFor(role)) {
          await expect(page.locator(`[data-dashboard-block="${id}"]`), `block ${id} must be absent`).toHaveCount(0);
          const text = BLOCK_DISTINCTIVE_TEXT[id];
          if (text) expect(document, `"${text}" must not be in the served document`).not.toContain(text);
        }

        // A healthy seeded agency: nothing should have fallen back to its error card.
        await expect(page.locator('[data-dashboard-block] [role="alert"]')).toHaveCount(0);
      } finally {
        await context.close();
      }
    });
  });
}

test.describe("Dashboard - role boundaries that must never move", () => {
  test("a GUIDE's page carries no money, sales, team or approvals block", async ({ browser }) => {
    const { context, page } = await signInToDashboard(browser, environment.staff.GUIDE);
    try {
      await page.goto("/dashboard");
      for (const id of ["collections", "revenue-trend", "supplier-payables", "pipeline", "team-performance", "quotes-pending", "approvals"]) {
        await expect(page.locator(`[data-dashboard-block="${id}"]`)).toHaveCount(0);
      }
    } finally {
      await context.close();
    }
  });

  test("OPERATIONS never gets supplier payments, however its preset changes", async ({ browser }) => {
    const { context, page } = await signInToDashboard(browser, environment.staff.OPERATIONS);
    try {
      await page.goto("/dashboard");
      await expect(page.locator('[data-dashboard-block="supplier-payables"]')).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});
