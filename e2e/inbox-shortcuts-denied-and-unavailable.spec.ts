import { expect, test, type Page } from "@playwright/test";

import { parseInboxLr2BrowserEnvironment } from "./inbox-lr2-config";
import { createFixtureAdminClient } from "./support/fixture-admin";
import { inboxAddress, signInToInboxAt } from "./support/inbox-session";

/**
 * TASK-030 groups K3 (a shortcut for a denied or unavailable action explains why instead of failing silently) and K4 (the open-a-record
 * shortcuts g-then-d, q, e and b open or start only what is there, and never send or confirm anything). K1 and K2 are in
 * inbox-keyboard-and-responsive.spec.ts.
 *
 * The open fixture conversation has no lead, booking or departure group linked, so every "open linked record" shortcut is unavailable
 * and must say so. The read-only user (a CEO) cannot reply or assign.
 */
const environment = parseInboxLr2BrowserEnvironment();

/** Only one message shows at a time, so each shortcut waits for the previous message to go before the next key is pressed. */
async function expectMessageThenWaitForItToClear(page: Page, text: string) {
  const message = page.getByText(text);
  await expect(message).toBeVisible();
  await expect(message).toBeHidden({ timeout: 30_000 });
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

async function readyForShortcuts(page: Page) {
  // The shortcuts attach once the screen has hydrated; the reply box being there means they have.
  await expect(page.getByPlaceholder("Reply to the customer…").or(page.getByLabel("Conversation list"))).toBeVisible();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

test.describe("TASK-030 K: shortcuts that cannot run explain why", () => {
  test("K3: a read-only user pressing r and a is told what their role cannot do, and nothing changes", async ({ browser }) => {
    const session = await signInToInboxAt(browser, environment.agencyA.staffReadonly, inboxAddress({ conversationId: environment.agencyA.openConversationId }));
    try {
      const { page } = session;
      await expect(page.getByLabel("Conversation list")).toBeVisible();
      await expect(page.locator("[data-inbox-conversation-open]")).toBeVisible();
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      const addressBefore = page.url();

      await page.keyboard.press("r");
      await expectMessageThenWaitForItToClear(page, "Your role cannot reply to customers.");
      await page.keyboard.press("a");
      await expectMessageThenWaitForItToClear(page, "Your role cannot assign owners.");

      expect(page.url()).toBe(addressBefore);
      await expect(page.getByPlaceholder("Reply to the customer…")).toHaveCount(0);
    } finally {
      await session.context.close();
    }
  });

  test("K4: e, b, g then d and q on a conversation with nothing linked say so, open nothing, and create nothing", async ({ browser }) => {
    const admin = createFixtureAdminClient();
    const countQuotes = async () => {
      const found = await admin.from("lead_quotes").select("id", { count: "exact", head: true });
      if (found.error) throw new Error(found.error.message);
      return found.count ?? 0;
    };
    const countOutbound = async () => {
      const found = await admin.from("conversation_messages").select("id", { count: "exact", head: true }).eq("conversation_id", environment.agencyA.openConversationId).eq("direction", "OUTBOUND");
      if (found.error) throw new Error(found.error.message);
      return found.count ?? 0;
    };
    const quotesBefore = await countQuotes();
    const outboundBefore = await countOutbound();

    const session = await signInToInboxAt(browser, environment.agencyA.staffA1, inboxAddress({ conversationId: environment.agencyA.openConversationId }));
    try {
      const { page, context } = session;
      await readyForShortcuts(page);
      await expect(page.locator("[data-inbox-conversation-open]")).toBeVisible();
      const addressBefore = page.url();

      await page.keyboard.press("e");
      await expectMessageThenWaitForItToClear(page, "This conversation has no linked lead.");

      await page.keyboard.press("b");
      await expectMessageThenWaitForItToClear(page, "This conversation has no linked booking.");

      await page.keyboard.press("g");
      await page.keyboard.press("d");
      await expectMessageThenWaitForItToClear(page, "This conversation has no linked departure group.");

      // q only focuses a control when a quote could be started; with no lead there is none, and either way nothing is created.
      await page.keyboard.press("q");

      expect(page.url(), "no shortcut navigated anywhere").toBe(addressBefore);
      expect(context.pages().length, "no shortcut opened a new tab").toBe(1);
      expect(await countQuotes(), "no shortcut created a quote").toBe(quotesBefore);
      expect(await countOutbound(), "no shortcut sent a message").toBe(outboundBefore);
    } finally {
      await session.context.close();
    }
  });
});
