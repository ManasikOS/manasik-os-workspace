import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { parseInboxLr2BrowserEnvironment } from "./inbox-lr2-config";
import { PHONE_VIEWPORT, inboxAddress, signInToInboxAt } from "./support/inbox-session";

/**
 * TASK-030 group A+ (accessibility additions to LR2's A1 to A5). Read-only.
 *
 * Covered: A6 (an automated axe scan of the Inbox in each state below, failing on any serious or critical finding) and A9 (focus returns
 * to the control that opened a dialog). Not automatable and left to a person: A7 (a screen-reader pass with NVDA or VoiceOver) and the
 * contrast judgement in A8 beyond what axe measures. A scan is evidence, not a guarantee: axe finds roughly a third of accessibility
 * problems, so a clean scan never replaces A7.
 */
const environment = parseInboxLr2BrowserEnvironment();
const staffA1 = environment.agencyA.staffA1;

const BLOCKING_IMPACTS = new Set(["serious", "critical"]);

async function blockingViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  return results.violations
    .filter((violation) => violation.impact && BLOCKING_IMPACTS.has(violation.impact))
    .map((violation) => ({
      rule: violation.id,
      impact: violation.impact,
      help: violation.help,
      // Selectors only: node HTML could contain customer text, which must not reach a report.
      targets: violation.nodes.slice(0, 5).map((node) => node.target.join(" ")),
    }));
}

test.describe("TASK-030 A+: accessibility", () => {
  test("A6: no serious or critical accessibility finding in the list, an open chat, the help dialog, or the phone layout", async ({ browser }) => {
    const desktop = await signInToInboxAt(browser, staffA1, inboxAddress({ view: "all" }));
    const phone = await signInToInboxAt(browser, staffA1, inboxAddress({ view: "all" }), { viewport: PHONE_VIEWPORT });
    try {
      expect(await blockingViolations(desktop.page), "the conversation list").toEqual([]);

      await desktop.page.goto(inboxAddress({ conversationId: environment.agencyA.openConversationId }));
      await expect(desktop.page.getByRole("group", { name: "Who owns this conversation" })).toBeVisible();
      expect(await blockingViolations(desktop.page), "an open chat").toEqual([]);

      await desktop.page.getByRole("button", { name: "Keyboard shortcuts" }).click();
      await expect(desktop.page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
      expect(await blockingViolations(desktop.page), "the keyboard shortcuts dialog").toEqual([]);

      expect(await blockingViolations(phone.page), "the phone list").toEqual([]);
      await phone.page.goto(inboxAddress({ conversationId: environment.agencyA.openConversationId }));
      await expect(phone.page.getByRole("button", { name: "All chats" })).toBeVisible();
      expect(await blockingViolations(phone.page), "the phone chat").toEqual([]);
    } finally {
      await Promise.all([desktop.context.close(), phone.context.close()]);
    }
  });

  test("A9: closing the keyboard shortcuts dialog returns focus to the control that opened it", async ({ browser }) => {
    const session = await signInToInboxAt(browser, staffA1, inboxAddress({ view: "all" }));
    try {
      const trigger = session.page.getByRole("button", { name: "Keyboard shortcuts" });
      await trigger.click();
      const dialog = session.page.getByRole("dialog", { name: "Keyboard shortcuts" });
      await expect(dialog).toBeVisible();
      await session.page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(trigger).toBeFocused();
    } finally {
      await session.context.close();
    }
  });
});
