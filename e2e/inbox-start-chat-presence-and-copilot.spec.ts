import { expect, test } from "@playwright/test";

import { inboxLr2FixtureTemplate } from "../scripts/e2e/inbox-lr2-fixtures-config";
import { parseInboxLr2BrowserEnvironment } from "./inbox-lr2-config";
import { createFixtureAdminClient, deleteTestConversation, fixtureAgencyId } from "./support/fixture-admin";
import { inboxAddress, signInToInboxAt } from "./support/inbox-session";

/**
 * TASK-030 composing groups C5 (start a new WhatsApp chat), C8 (two staff typing in one conversation) and C9 (Copilot unavailable).
 * They run against the two fixture agencies only. Agency A is a TEST agency answered by the provider simulator, so the template message
 * of C5 reaches nobody; the number used is in the range regulators reserve for fiction (+44 7700 900xxx).
 *
 * Not covered here: C4 (translation calls an AI provider and needs a reachable model and a fixture agency with the translation surface
 * on), C6 (e-mail compose needs a configured test mailbox on the fixture agency). Both are listed in docs/progress/2026-10-03-browser-run-s6.md
 * with what they need.
 */
const environment = parseInboxLr2BrowserEnvironment();
const staffA1 = environment.agencyA.staffA1;
const staffA2 = environment.agencyA.staffA2;

/** A fictional number nothing else uses; the test removes the conversation it creates. */
const NEW_CHAT_NUMBER = "447700900777";

test.describe("TASK-030 C: starting a chat", () => {
  test("C5: a new WhatsApp chat is started with an approved template, and the same number is matched, not duplicated", async ({ browser }) => {
    const admin = createFixtureAdminClient();
    const agencyId = await fixtureAgencyId(admin, "agencyA");
    const countFor = async () => {
      const found = await admin.from("conversations").select("id").eq("agency_id", agencyId).eq("channel", "WHATSAPP").like("contact_phone", `%${NEW_CHAT_NUMBER}`);
      if (found.error) throw new Error(found.error.message);
      return found.data.map((row) => row.id as string);
    };
    expect(await countFor(), "the test number is already on file; remove the leftover conversation first").toEqual([]);

    const session = await signInToInboxAt(browser, staffA1, inboxAddress({ view: "all" }));
    try {
      const { page } = session;
      async function startChat() {
        await page.getByRole("button", { name: "Start a new conversation" }).click();
        await page.getByRole("menuitem", { name: "WhatsApp chat" }).click();
        const dialog = page.getByRole("dialog", { name: "Start a WhatsApp chat" });
        await expect(dialog).toBeVisible();
        await dialog.getByLabel("WhatsApp number").fill(`+${NEW_CHAT_NUMBER}`);
        await dialog.getByRole("combobox", { name: "Approved template" }).click();
        await page.getByRole("option", { name: new RegExp(inboxLr2FixtureTemplate.name) }).click();
        // The chosen template shows by its name, never by its internal id.
        await expect(dialog.getByRole("combobox", { name: "Approved template" })).toContainText(inboxLr2FixtureTemplate.name);
        await dialog.getByLabel("Template value 1").fill("Customer");
        await dialog.getByLabel("Template value 2").fill("umrah");
        await dialog.getByRole("button", { name: "Send and open chat" }).click();
        await expect(dialog).toBeHidden();
        await expect(page).toHaveURL(/conversation=/);
        return new URL(page.url()).searchParams.get("conversation");
      }

      const first = await startChat();
      expect(first).toBeTruthy();
      expect(await countFor()).toEqual([first]);

      const second = await startChat();
      expect(second, "the same number opens the conversation already on file").toBe(first);
      expect(await countFor(), "no second conversation was created for the same number").toEqual([first]);
    } finally {
      await session.context.close();
      for (const id of await countFor()) await deleteTestConversation(admin, id);
    }
  });
});

test.describe("TASK-030 C: two people in one conversation", () => {
  test("C8: while one staff member is writing a reply, the other is told, and can still decide for themselves", async ({ browser }) => {
    const address = inboxAddress({ conversationId: environment.agencyA.openConversationId });
    const admin = createFixtureAdminClient();
    const writer = await signInToInboxAt(browser, staffA1, address);
    const reader = await signInToInboxAt(browser, staffA2, address);
    try {
      const writerBox = writer.page.getByPlaceholder("Reply to the customer…");
      await expect(writerBox).toBeVisible();
      await expect(reader.page.getByPlaceholder("Reply to the customer…")).toBeVisible();
      await expect(reader.page.getByText(/is writing a reply/)).toHaveCount(0);

      await writerBox.click();
      await writerBox.fill("LR2 presence check");
      await expect(reader.page.getByText("LR2 Staff A1 is writing a reply. Please coordinate before sending.")).toBeVisible();
      // A warning only: the second person's own box is still there and still theirs to use.
      await expect(reader.page.getByPlaceholder("Reply to the customer…")).toBeEnabled();
      // The writer is not warned about themselves.
      await expect(writer.page.getByText(/is writing a reply/)).toHaveCount(0);
    } finally {
      await writer.context.close();
      await reader.context.close();
      // Leave nothing behind: the draft the writer typed and the claim on the box.
      await admin.from("conversation_drafts").delete().eq("conversation_id", environment.agencyA.openConversationId);
      await admin.from("conversations").update({ composing_by: null, composing_at: null }).eq("id", environment.agencyA.openConversationId);
    }
  });
});

test.describe("TASK-030 C: Copilot unavailable", () => {
  test("C9: when Copilot cannot prepare a reply, no draft is offered, the box stays empty and nothing is sent", async ({ browser }) => {
    const admin = createFixtureAdminClient();
    const countOutbound = async () => {
      const found = await admin.from("conversation_messages").select("id", { count: "exact", head: true }).eq("conversation_id", environment.agencyA.openConversationId).eq("direction", "OUTBOUND");
      if (found.error) throw new Error(found.error.message);
      return found.count ?? 0;
    };
    const before = await countOutbound();

    const session = await signInToInboxAt(browser, staffA1, inboxAddress({ conversationId: environment.agencyA.openConversationId }));
    try {
      const { page } = session;
      await expect(page.getByPlaceholder("Reply to the customer…")).toBeVisible();
      const card = page.locator('[aria-labelledby="recommended-next-action-heading"]');
      await expect(card).toBeVisible();
      const draftButtons = card.getByRole("button", { name: "Draft with Copilot" });
      await expect(draftButtons).toHaveCount(1);
      await expect(draftButtons).toBeDisabled();
      // The card says why, in words.
      await expect(card.getByText(/cannot use Copilot/)).toBeVisible();
      await expect(page.getByPlaceholder("Reply to the customer…")).toHaveValue("");
      expect(await countOutbound()).toBe(before);

      test.info().annotations.push({
        type: "finding",
        description:
          "The card blames the person's role ('Your role cannot use Copilot') although the same text appears for an Admin whose conversation simply has no lead linked yet: the customer context loads with Copilot off until a lead is linked. The reason shown is not the real one.",
      });
    } finally {
      await session.context.close();
    }
  });
});
