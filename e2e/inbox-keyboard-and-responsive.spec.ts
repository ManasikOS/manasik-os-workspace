import { expect, test, type Page } from "@playwright/test";

import { parseInboxLr2BrowserEnvironment } from "./inbox-lr2-config";
import { PHONE_VIEWPORT, inboxAddress, signInToInboxAt } from "./support/inbox-session";

/**
 * TASK-030 groups K (keyboard shortcuts) and M (phone and small screens). Read-only: these tests move around and focus controls; none of
 * them sends, assigns or changes a conversation.
 *
 * Covered: K1 (j, k, /, r, n do what the help overlay says, and nothing while typing), K2 (? opens the overlay, Escape closes it), M1
 * (phone: list first, thread on open, Back returns), M2 (no horizontal page scroll at five widths). Not covered yet: K3 and K4 (a denied
 * or unavailable shortcut explaining why, and the g-d, q, e, b shortcuts) because their wording and per-role availability have to be read
 * from a running build first; M3 is a manual step on real phones.
 */
const environment = parseInboxLr2BrowserEnvironment();
const staffA1 = environment.agencyA.staffA1;

async function clearFocus(page: Page): Promise<void> {
  await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined));
}

function conversationIdInAddress(page: Page): string | null {
  return new URL(page.url()).searchParams.get("conversation");
}

test.describe("TASK-030 K: keyboard shortcuts", () => {
  test("K1: j and k move between conversations, and / focuses the search box", async ({ browser }) => {
    const session = await signInToInboxAt(browser, staffA1, inboxAddress({ view: "all" }));
    try {
      await clearFocus(session.page);
      await session.page.keyboard.press("j");
      await expect.poll(() => conversationIdInAddress(session.page)).not.toBeNull();
      const first = conversationIdInAddress(session.page);

      await session.page.keyboard.press("j");
      await expect.poll(() => conversationIdInAddress(session.page)).not.toBe(first);
      const second = conversationIdInAddress(session.page);
      expect(second).not.toBeNull();

      await session.page.keyboard.press("k");
      await expect.poll(() => conversationIdInAddress(session.page)).toBe(first);

      await clearFocus(session.page);
      await session.page.keyboard.press("/");
      await expect(session.page.getByPlaceholder("Search conversations")).toBeFocused();
    } finally {
      await session.context.close();
    }
  });

  test("K1: while typing in the search box, shortcut letters are text and move nothing", async ({ browser }) => {
    const session = await signInToInboxAt(browser, staffA1, inboxAddress({ view: "all", conversationId: environment.agencyA.openConversationId }));
    try {
      const before = conversationIdInAddress(session.page);
      const search = session.page.getByPlaceholder("Search conversations");
      await search.click();
      await session.page.keyboard.type("jkrn?");
      await expect(search).toHaveValue("jkrn?");
      expect(conversationIdInAddress(session.page)).toBe(before);
      await expect(session.page.getByRole("dialog", { name: "Keyboard shortcuts" })).toHaveCount(0);
    } finally {
      await session.context.close();
    }
  });

  test("K1: r moves the cursor to the reply box and n to the internal note box", async ({ browser }) => {
    const session = await signInToInboxAt(browser, staffA1, inboxAddress({ conversationId: environment.agencyA.openConversationId }));
    try {
      // The shortcuts attach once the screen has hydrated; the reply box being there means they have.
      await expect(session.page.getByPlaceholder("Reply to the customer…")).toBeVisible();
      await clearFocus(session.page);
      await session.page.keyboard.press("r");
      await expect(session.page.getByPlaceholder("Reply to the customer…")).toBeFocused();

      await clearFocus(session.page);
      await session.page.keyboard.press("n");
      await expect(session.page.getByPlaceholder("Write an internal note…")).toBeFocused();
    } finally {
      await session.context.close();
    }
  });

  test("K2: ? opens the shortcut help, listing what each key does, and Escape closes it", async ({ browser }) => {
    const session = await signInToInboxAt(browser, staffA1, inboxAddress({ conversationId: environment.agencyA.openConversationId }));
    try {
      await clearFocus(session.page);
      await session.page.keyboard.press("?");
      const help = session.page.getByRole("dialog", { name: "Keyboard shortcuts" });
      await expect(help).toBeVisible();
      for (const label of ["Next conversation", "Previous conversation", "Search conversations", "Reply to customer", "Add internal note"]) {
        await expect(help.getByText(label, { exact: true })).toBeVisible();
      }
      await session.page.keyboard.press("Escape");
      await expect(help).toBeHidden();
    } finally {
      await session.context.close();
    }
  });
});

test.describe("TASK-030 M: phone and small screens", () => {
  test("M1: on a phone the list shows first, opening a chat shows the thread, and both All chats and browser Back return to the list", async ({ browser }) => {
    const session = await signInToInboxAt(browser, staffA1, inboxAddress({ view: "all" }), { viewport: PHONE_VIEWPORT });
    try {
      const { page } = session;
      const list = page.getByLabel("Conversation list");
      const allChats = page.getByRole("button", { name: "All chats" });
      await expect(list).toBeVisible();
      await expect(allChats).toBeHidden();

      // Rows are plain buttons inside the list; they carry the `group` class and no stable name, since the name is the customer's.
      await list.locator("button.group").first().click();
      await expect(page).toHaveURL(/conversation=/);
      await expect(allChats).toBeVisible();
      await expect(list).toBeHidden();

      await allChats.click();
      await expect(list).toBeVisible();
      await expect(allChats).toBeHidden();

      await list.locator("button.group").first().click();
      await expect(allChats).toBeVisible();
      await page.goBack();
      await expect(list).toBeVisible();
      await expect(allChats).toBeHidden();
    } finally {
      await session.context.close();
    }
  });

  for (const width of [320, 375, 768, 1024, 1440]) {
    test(`M2: at ${width} px wide there is no horizontal page scroll, for the list and for an open chat`, async ({ browser }) => {
      const session = await signInToInboxAt(browser, staffA1, inboxAddress({ view: "all" }), { viewport: { width, height: 900 } });
      try {
        for (const address of [inboxAddress({ view: "all" }), inboxAddress({ conversationId: environment.agencyA.openConversationId })]) {
          await session.page.goto(address);
          await expect(session.page.getByLabel("Conversation list")).toBeAttached();
          const overflow = await session.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
          expect(overflow, `horizontal overflow at ${width} px on ${address}`).toBeLessThanOrEqual(0);
        }
      } finally {
        await session.context.close();
      }
    });
  }
});
