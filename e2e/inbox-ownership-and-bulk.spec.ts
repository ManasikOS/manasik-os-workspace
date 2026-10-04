import { expect, test, type Page } from "@playwright/test";

import { parseInboxLr2BrowserEnvironment } from "./inbox-lr2-config";
import { createFixtureAdminClient, deleteTestConversation, fixtureAgencyId } from "./support/fixture-admin";
import { inboxAddress, parseViewTotal, requireOwnerFixture, signInToInboxAt } from "./support/inbox-session";

/**
 * TASK-030 groups O (ownership and lifecycle) and B (bulk actions). These CHANGE DATA, so they run only against the non-production
 * environment, after the fixtures were reset with `scripts/e2e/seed-inbox-lr2-fixtures.ts --execute`, and one at a time. Reset again
 * before re-running: closing and marking as spam are not undone here.
 *
 * Fixture contract (a test that finds otherwise fails with a message, it never passes quietly):
 *  - Staff A1 may assign, release, close and mark as spam in Agency A; A-readonly may do none of that.
 *  - INBOX_E2E_A2_NAME is how Staff A2 appears in the owner picker.
 *  - The All view starts with at least three plain conversations (no booking, no open review) and the Spam view starts empty.
 *
 * The fixture variables are read inside the tests that need them, so a missing one fails that test with a clear message instead of
 * stopping every spec from loading.
 *
 * Covered: O1, O2, O3, O5 (including that a read-only user is offered no bulk selection), B1, B2, B3, B4. Not covered: O4 (handoff needs a
 * confirmed booking fixture), and the 50-conversation limit, which is covered by unit tests because it needs 51 conversations.
 */
const environment = parseInboxLr2BrowserEnvironment();
const staffA1 = environment.agencyA.staffA1;

test.describe.configure({ mode: "serial" });

/** Opens the actions menu and waits until its items are on screen, so a later "is this item there?" check is not a race. */
async function openActionsMenu(page: Page) {
  await page.getByLabel("Conversation actions").click();
  await expect(page.getByRole("menuitem").first()).toBeVisible();
}

async function viewTotal(page: Page, view: string): Promise<number> {
  await page.goto(inboxAddress({ view }));
  const list = page.getByLabel("Conversation list");
  await expect(list).toBeVisible();
  await expect(list.locator("header p").first()).toHaveText(/conversation|Showing/);
  return parseViewTotal(await list.locator("header p").first().innerText());
}

/** Switches the list into selection mode and ticks the first `count` rows. */
/** `skipRowsNamed` leaves out rows whose text matches, so a test can avoid a conversation its colleague already owns (handing it over would change nothing). */
async function selectFirstRows(page: Page, count: number, skipRowsNamed?: RegExp) {
  const list = page.getByLabel("Conversation list");
  await list.getByRole("button", { name: "Select conversations" }).click();
  const bar = page.getByRole("region", { name: "Bulk actions" });
  await expect(bar.getByText("Choose conversations")).toBeVisible();
  const rows = list.getByRole("checkbox");
  expect(await rows.count(), "the view needs enough conversations for this test; reset the fixtures").toBeGreaterThanOrEqual(count);
  const total = await rows.count();
  let picked = 0;
  for (let index = 0; index < total && picked < count; index += 1) {
    if (skipRowsNamed && skipRowsNamed.test((await rows.nth(index).innerText()).replace(/\s+/g, " "))) continue;
    await rows.nth(index).click();
    picked += 1;
  }
  expect(picked, "the view needs enough eligible conversations for this test; reset the fixtures").toBe(count);
  await expect(bar.getByText(`${count} selected`)).toBeVisible();
  return bar;
}

test.describe("TASK-030 O: ownership and lifecycle", () => {
  test("O1: giving a conversation to a colleague updates it for both of them without a reload, and it can be taken back", async ({ browser }) => {
    const { colleagueName } = requireOwnerFixture();
    const address = inboxAddress({ conversationId: environment.agencyA.takeControlConversationId });
    const first = await signInToInboxAt(browser, staffA1, address);
    const second = await signInToInboxAt(browser, environment.agencyA.staffA2, address);
    try {
      const owner = first.page.getByRole("combobox", { name: "Conversation owner" });
      await owner.click();
      await first.page.getByRole("option", { name: colleagueName }).click();
      await expect(first.page.getByText("Owner changed", { exact: true })).toBeVisible();
      await expect(owner).toContainText(colleagueName);
      await expect(second.page.getByRole("combobox", { name: "Conversation owner" })).toContainText(colleagueName);

      await owner.click();
      await first.page.getByRole("option", { name: "Unassigned" }).click();
      await expect(first.page.getByText("Owner removed", { exact: true })).toBeVisible();
      await expect(second.page.getByRole("combobox", { name: "Conversation owner" })).toContainText("Unassigned");
    } finally {
      await Promise.all([first.context.close(), second.context.close()]);
    }
  });

  test("O2: hand the conversation back to the assistant, then take control again", async ({ browser }) => {
    const session = await signInToInboxAt(browser, staffA1, inboxAddress({ conversationId: environment.agencyA.takeControlConversationId }));
    try {
      const { page } = session;
      // Start from a person handling it, whichever state the fixture was left in.
      await openActionsMenu(page);
      if (await page.getByRole("menuitem", { name: "Take control" }).isVisible()) {
        await page.getByRole("menuitem", { name: "Take control" }).click();
        await expect(page.getByText("You are now handling this chat")).toBeVisible();
        await openActionsMenu(page);
      }
      await page.getByRole("menuitem", { name: "Hand back to AI" }).click();
      await expect(page.getByText("Handed back to Copilot")).toBeVisible();
      await expect(page.getByText("Copilot can reply to the customer again.")).toBeVisible();

      await openActionsMenu(page);
      await expect(page.getByRole("menuitem", { name: "Hand back to AI" })).toHaveCount(0);
      await page.getByRole("menuitem", { name: "Take control" }).click();
      await expect(page.getByText("You are now handling this chat")).toBeVisible();
      await expect(page.getByRole("group", { name: "Who owns this conversation" })).toBeVisible();
    } finally {
      await session.context.close();
    }
  });

  test("O3: closing a conversation moves it from the open views to Closed, once", async ({ browser }) => {
    const session = await signInToInboxAt(browser, staffA1, inboxAddress({ view: "all" }));
    try {
      const { page } = session;
      const openBefore = await viewTotal(page, "all");
      const closedBefore = await viewTotal(page, "closed");

      await page.goto(inboxAddress({ view: "all", conversationId: environment.agencyA.closedWindowConversationId }));
      await openActionsMenu(page);
      await page.getByRole("menuitem", { name: "Close conversation" }).click();
      // Closing asks first; nothing changes until it is confirmed.
      await page.getByRole("dialog", { name: "Close this conversation?" }).getByRole("button", { name: "Close conversation" }).click();
      await expect(page.getByText("Conversation closed", { exact: true })).toBeVisible();

      expect(await viewTotal(page, "all")).toBe(openBefore - 1);
      expect(await viewTotal(page, "closed")).toBe(closedBefore + 1);
    } finally {
      await session.context.close();
    }
  });

  test("O5: a read-only user is offered no owner change, no actions menu and no bulk selection, and nothing changes", async ({ browser }) => {
    const session = await signInToInboxAt(browser, environment.agencyA.staffReadonly, inboxAddress({ view: "all", conversationId: environment.agencyA.takeControlConversationId }));
    try {
      const { page } = session;
      await expect(page.getByLabel("Conversation actions")).toHaveCount(0);
      const owner = page.getByRole("combobox", { name: "Conversation owner" });
      if ((await owner.count()) > 0) await expect(owner).toBeDisabled();
      await expect(page.getByLabel("Conversation list").getByRole("button", { name: "Select conversations" })).toHaveCount(0);
    } finally {
      await session.context.close();
    }
  });
});

test.describe("TASK-030 B: bulk actions", () => {
  test("B1: selecting shows the count, and stopping clears the selection and the bar", async ({ browser }) => {
    const session = await signInToInboxAt(browser, staffA1, inboxAddress({ view: "all" }));
    try {
      const { page } = session;
      const bar = await selectFirstRows(page, 2);
      await expect(page.getByLabel("Conversation list").getByRole("checkbox", { checked: true })).toHaveCount(2);
      await bar.getByRole("button", { name: "Cancel" }).click();
      await expect(page.getByRole("region", { name: "Bulk actions" })).toHaveCount(0);
      await expect(page.getByLabel("Conversation list").getByRole("button", { name: "Select conversations" })).toBeVisible();
    } finally {
      await session.context.close();
    }
  });

  test("B2: giving two selected conversations to a colleague changes exactly two", async ({ browser }) => {
    const { colleagueName } = requireOwnerFixture();
    const session = await signInToInboxAt(browser, staffA1, inboxAddress({ view: "all" }));
    try {
      const { page } = session;
      const bar = await selectFirstRows(page, 2, /LR2 Coworker Owned/);
      await bar.getByRole("combobox", { name: "Give the selected conversations to" }).click();
      await page.getByRole("option", { name: colleagueName }).click();
      await expect(page.getByText("Done", { exact: true })).toBeVisible();
      await expect(page.getByText(/^Changed the owner of 2 conversations\./)).toBeVisible();
    } finally {
      await session.context.close();
    }
  });

  test("B3: marking as spam asks first, cancelling changes nothing, confirming moves them to Spam, and Not spam restores them", async ({ browser }) => {
    const session = await signInToInboxAt(browser, staffA1, inboxAddress({ view: "all" }));
    try {
      const { page } = session;
      const spamBefore = await viewTotal(page, "spam");
      expect(spamBefore, "the Spam view must start empty so the restore step can select exactly what was marked; reset the fixtures").toBe(0);
      const openBefore = await viewTotal(page, "all");

      await page.goto(inboxAddress({ view: "all" }));
      let bar = await selectFirstRows(page, 2);
      await bar.getByRole("button", { name: "Mark as spam" }).click();
      const confirm = page.getByRole("dialog", { name: "Mark 2 conversations as spam?" });
      await expect(confirm).toBeVisible();

      // Cancelling changes nothing.
      await confirm.getByRole("button", { name: "Cancel" }).click();
      await expect(confirm).toBeHidden();
      expect(await viewTotal(page, "spam")).toBe(0);

      // Confirming does.
      await page.goto(inboxAddress({ view: "all" }));
      bar = await selectFirstRows(page, 2);
      await bar.getByRole("button", { name: "Mark as spam" }).click();
      await page.getByRole("dialog", { name: "Mark 2 conversations as spam?" }).getByRole("button", { name: "Mark as spam" }).click();
      await expect(page.getByText(/^Marked 2 conversations as spam\./)).toBeVisible();
      expect(await viewTotal(page, "spam")).toBe(2);
      expect(await viewTotal(page, "all")).toBe(openBefore - 2);

      // Restore them from the Spam view.
      await page.goto(inboxAddress({ view: "spam" }));
      bar = await selectFirstRows(page, 2);
      await bar.getByRole("button", { name: "Not spam" }).click();
      await page.getByRole("dialog", { name: "Restore 2 conversations from spam?" }).getByRole("button", { name: "Restore" }).click();
      await expect(page.getByText(/^Restored 2 conversations from spam\./)).toBeVisible();
      expect(await viewTotal(page, "spam")).toBe(0);
    } finally {
      await session.context.close();
    }
  });

  test("B4: if one selected conversation cannot be found when a spam change is made, none of them change, and the reason is given", async ({ browser }) => {
    // The rule (bulkUpdateConversationsAction): a spam change fails closed. Every selected id must be this agency's and still there, or nothing is
    // written. A conversation a screen cannot select from another agency, so one that vanishes between the selection and the click stands in for it.
    const admin = createFixtureAdminClient();
    const agencyId = await fixtureAgencyId(admin, "agencyA");
    const open = await admin.from("conversations").select("connection_id").eq("id", environment.agencyA.openConversationId).single();
    if (open.error) throw new Error(open.error.message);
    const scratch = await admin.from("conversations").insert({
      agency_id: agencyId, connection_id: open.data.connection_id, channel: "WHATSAPP", external_conversation_id: "447700900888", contact_name: "LR2 B4 Scratch",
      contact_phone: "+447700900888", state: "HUMAN_ACTIVE", handling_mode: "HUMAN_ACTIVE", ai_enabled: false, lifecycle_status: "OPEN", last_activity_at: new Date().toISOString(), unread_count: 0,
    }).select("id").single();
    if (scratch.error) throw new Error(`Could not create the scratch conversation: ${scratch.error.message}`);

    const session = await signInToInboxAt(browser, staffA1, inboxAddress({ view: "all" }));
    let scratchRemoved = false;
    try {
      const { page } = session;
      const list = page.getByLabel("Conversation list");
      await list.getByRole("button", { name: "Select conversations" }).click();
      const bar = page.getByRole("region", { name: "Bulk actions" });
      await list.getByRole("checkbox", { name: /LR2 B4 Scratch/ }).click();
      await list.getByRole("checkbox", { name: /LR2 Take Control/ }).click();
      await expect(bar.getByText("2 selected")).toBeVisible();

      await deleteTestConversation(admin, scratch.data.id as string);
      scratchRemoved = true;

      await bar.getByRole("button", { name: "Mark as spam" }).click();
      await page.getByRole("dialog", { name: "Mark 2 conversations as spam?" }).getByRole("button", { name: "Mark as spam" }).click();
      await expect(page.getByText("Could not change the conversations")).toBeVisible();
      await expect(page.getByText("Some of those conversations could not be found, so nothing was changed.")).toBeVisible();

      const other = await admin.from("conversations").select("lifecycle_status").eq("id", environment.agencyA.takeControlConversationId).single();
      expect(other.data?.lifecycle_status, "the other selected conversation was not marked as spam").toBe("OPEN");
    } finally {
      await session.context.close();
      if (!scratchRemoved) await deleteTestConversation(admin, scratch.data.id as string);
    }
  });
});
