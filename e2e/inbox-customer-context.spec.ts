import { expect, test } from "@playwright/test";

import { parseInboxLr2BrowserEnvironment } from "./inbox-lr2-config";
import { createFixtureAdminClient } from "./support/fixture-admin";
import { inboxAddress, signInToInboxAt } from "./support/inbox-session";

/**
 * TASK-030 group X (customer context and conversion): X1 (the recommended next action) and X2 (linked record links). Read-only.
 *
 * Fixtures: the open conversation has no lead; the lead-linked conversation (INBOX_E2E_A_LEAD_LINKED_CONVERSATION_ID, from the seeder) has a
 * lead owned by Staff A1. There is no booking or departure group fixture yet, so the booking and departure-group links are checked only for
 * their absence. X3 (a conversion preview creates nothing until it is confirmed) needs a conversion-capable conversation with a customer
 * message the deterministic rules turn into a task or case; it is listed as not covered in docs/progress/2026-10-03-browser-run-s6.md.
 */
const environment = parseInboxLr2BrowserEnvironment();

function leadLinkedConversationId(): string {
  const id = process.env.INBOX_E2E_A_LEAD_LINKED_CONVERSATION_ID?.trim();
  if (!id) throw new Error("Missing INBOX_E2E_A_LEAD_LINKED_CONVERSATION_ID: run scripts/e2e/seed-inbox-lr2-fixtures.ts --execute and add the printed ids to the environment.");
  return id;
}

test.describe("TASK-030 X: customer context", () => {
  test("X1: the recommended next action is one action, only ever leads to an editable draft or a preview, and says why when it cannot run", async ({ browser }) => {
    const admin = createFixtureAdminClient();
    const countOutbound = async (conversationId: string) => {
      const found = await admin.from("conversation_messages").select("id", { count: "exact", head: true }).eq("conversation_id", conversationId).eq("direction", "OUTBOUND");
      if (found.error) throw new Error(found.error.message);
      return found.count ?? 0;
    };
    const outboundBefore = await countOutbound(environment.agencyA.openConversationId);

    const session = await signInToInboxAt(browser, environment.agencyA.staffA1, inboxAddress({ conversationId: environment.agencyA.openConversationId }));
    try {
      const { page } = session;
      await expect(page.getByPlaceholder("Reply to the customer…")).toBeVisible();
      const card = page.locator('[aria-labelledby="recommended-next-action-heading"]');
      await expect(card).toHaveCount(1);
      // One action, with its urgency, and the promise that nothing goes out by itself.
      await expect(card.getByRole("button")).toHaveCount(1);
      await expect(card.getByText(/urgency/i)).toBeVisible();
      await expect(card.getByText("Review is required before anything is sent or created.")).toBeVisible();
      // Unavailable, so it says what is missing instead of being a dead button.
      await expect(card.getByRole("button")).toBeDisabled();
      await expect(card.getByText(/cannot use Copilot|Link|lead|Copilot/).first()).toBeVisible();

      // Nothing was sent by looking at it.
      expect(await countOutbound(environment.agencyA.openConversationId)).toBe(outboundBefore);
      await expect(page.getByPlaceholder("Reply to the customer…")).toHaveValue("");
    } finally {
      await session.context.close();
    }
  });

  test("X2: a conversation with a lead links to it, one without shows no link, and no booking or group link is invented", async ({ browser }) => {
    const withLead = await signInToInboxAt(browser, environment.agencyA.staffA1, inboxAddress({ conversationId: leadLinkedConversationId() }));
    try {
      const { page } = withLead;
      const links = page.getByRole("navigation", { name: "Linked records" });
      await expect(links).toBeVisible();
      // A link rendered as a button-styled anchor: find it by its text and check where it goes.
      await expect(links.locator("a", { hasText: "Open lead" })).toHaveAttribute("href", /^\/leads\?open=[0-9a-f-]{36}$/);
      await expect(links.locator("a", { hasText: "Open booking" })).toHaveCount(0);
      await expect(links.locator("a", { hasText: "Open departure group" })).toHaveCount(0);
    } finally {
      await withLead.context.close();
    }

    const withoutLead = await signInToInboxAt(browser, environment.agencyA.staffA1, inboxAddress({ conversationId: environment.agencyA.openConversationId }));
    try {
      const { page } = withoutLead;
      await expect(page.getByPlaceholder("Reply to the customer…")).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Linked records" })).toHaveCount(0);
      await expect(page.getByText(/No lead is linked yet/)).toBeVisible();
    } finally {
      await withoutLead.context.close();
    }
  });
});
