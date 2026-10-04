import { expect, test } from "@playwright/test";

import { emptyViewCopy } from "../lib/inbox/empty-view-copy";
import { QUEUE_CATALOGUE } from "../lib/inbox/queues";
import { INBOX_VIEWS, VIEW_QUEUE } from "../lib/inbox/views";
import { parseInboxLr2BrowserEnvironment } from "./inbox-lr2-config";
import { inboxAddress, requireSearchFixtures, signInToInboxAt } from "./support/inbox-session";

/**
 * TASK-030 groups V (queues and views) and S (search). Read-only: nothing here sends, assigns or changes a conversation.
 *
 * Covered: V1 (every view opens and is labelled, with a plain empty state when it is empty), V2 (the address and browser Back follow the
 * view), V4 (another agency's conversation, opened by address, is not shown), S1 and S3 (search finds this agency's text and never the
 * other agency's). Not covered here: the rail count against the list for the open view (V1's count clause) needs the rail's badge to
 * expose a stable name, and S2 (saved views) changes data, so it lives with the data-changing groups.
 */
const environment = parseInboxLr2BrowserEnvironment();
const staffA1 = environment.agencyA.staffA1;

test.describe("TASK-030 V: queues and views", () => {
  test("V1: every view opens, carries its own title, and shows either conversations or its own plain empty state", async ({ browser }) => {
    // One page load per view: the whole walk takes longer than a single-screen test.
    test.setTimeout(60_000 + INBOX_VIEWS.length * 15_000);
    const session = await signInToInboxAt(browser, staffA1, inboxAddress());
    try {
      for (const view of INBOX_VIEWS) {
        await test.step(`view ${view}`, async () => {
          await session.page.goto(inboxAddress({ view }));
          const list = session.page.getByLabel("Conversation list");
          await expect(list).toBeVisible();
          await expect(list.getByRole("heading", { level: 2 })).toHaveText(QUEUE_CATALOGUE[VIEW_QUEUE[view]].label);
          // The rail marks exactly the open view.
          await expect(session.page.getByRole("navigation", { name: "Inbox views" }).locator('[aria-current="true"]').first()).toBeVisible();
          const countLine = await list.locator("header p").first().innerText();
          expect(countLine, `count line for ${view}`).toMatch(/^(\d+ conversations?|Showing \d+ of \d+)$/);
          const empty = emptyViewCopy(view);
          if (countLine.startsWith("0 ")) await expect(session.page.getByText(empty.title, { exact: true })).toBeVisible();
          else await expect(session.page.getByText(empty.title, { exact: true })).toHaveCount(0);
        });
      }
    } finally {
      await session.context.close();
    }
  });

  test("V2: choosing a view changes the address, and the browser Back button returns to the previous view", async ({ browser }) => {
    const session = await signInToInboxAt(browser, staffA1, inboxAddress({ view: "all" }));
    try {
      const rail = session.page.getByRole("navigation", { name: "Inbox views" });
      await rail.getByRole("button", { name: /^Closed/ }).click();
      await expect(session.page).toHaveURL(/view=closed/);
      await expect(session.page.getByLabel("Conversation list").getByRole("heading", { level: 2 })).toHaveText(QUEUE_CATALOGUE[VIEW_QUEUE.closed].label);
      await session.page.goBack();
      await expect(session.page.getByLabel("Conversation list").getByRole("heading", { level: 2 })).toHaveText(QUEUE_CATALOGUE[VIEW_QUEUE.all].label);
    } finally {
      await session.context.close();
    }
  });

  test("V4: another agency's conversation, opened by its address, is not shown", async ({ browser }) => {
    const session = await signInToInboxAt(browser, staffA1, inboxAddress({ conversationId: environment.agencyB.conversationId }));
    try {
      // The Inbox falls back to this agency's own first conversation: nothing of the other agency's is shown, in the thread or the list.
      await expect(session.page.getByText("LR2 Agency B Only")).toHaveCount(0);
      await expect(session.page.getByText("Agency B private message")).toHaveCount(0);
      await expect(session.page.getByLabel("Conversation list").getByText("LR2 Open Window")).toBeVisible();
    } finally {
      await session.context.close();
    }
  });
});

test.describe("TASK-030 S: search", () => {
  test("S1: search finds this agency's text, says plainly when nothing matches, and clearing restores the list", async ({ browser }) => {
    const { agencyATerm } = requireSearchFixtures();
    const session = await signInToInboxAt(browser, staffA1, inboxAddress({ view: "all" }));
    try {
      const search = session.page.getByPlaceholder("Search conversations");
      await search.fill(agencyATerm);
      await expect(session.page.getByLabel("Conversation list").getByText(/Matches from all conversations/)).toBeVisible();
      await expect(session.page.getByLabel("Conversation list").getByText(agencyATerm, { exact: false }).first()).toBeVisible();

      const noMatch = `no-such-text-${Date.now()}`;
      await search.fill(noMatch);
      await expect(session.page.getByText(`No conversations match “${noMatch}”.`)).toBeVisible();
      await expect(session.page.getByLabel("Conversation list").getByText(agencyATerm, { exact: false })).toHaveCount(0);

      await search.fill("");
      await expect(session.page.getByLabel("Conversation list").getByText(/Matches from all conversations/)).toHaveCount(0);
    } finally {
      await session.context.close();
    }
  });

  test("S3: search never reveals the other agency's conversation, and the other agency sees only its own", async ({ browser }) => {
    const { agencyATerm, agencyBTerm } = requireSearchFixtures();
    const agencyA = await signInToInboxAt(browser, staffA1, inboxAddress({ view: "all" }));
    const agencyB = await signInToInboxAt(browser, environment.agencyB.staffB1, inboxAddress({ view: "all" }));
    try {
      // The only place the other agency's term may appear is the plain "No conversations match" message that echoes what was typed.
      for (const [session, term] of [
        [agencyA, agencyBTerm],
        [agencyB, agencyATerm],
      ] as const) {
        await session.page.getByPlaceholder("Search conversations").fill(term);
        const noMatchMessage = `No conversations match “${term}”.`;
        await expect(session.page.getByText(noMatchMessage)).toBeVisible();
        const bodyWithoutEcho = (await session.page.locator("body").innerText()).replaceAll(noMatchMessage, "");
        expect(bodyWithoutEcho, "the other agency's text must not appear anywhere on the page").not.toContain(term);
      }
    } finally {
      await Promise.all([agencyA.context.close(), agencyB.context.close()]);
    }
  });
});
