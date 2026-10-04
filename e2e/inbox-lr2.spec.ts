import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { parseInboxLr2BrowserEnvironment, type InboxLr2StaffCredentials } from "./inbox-lr2-config";

const inboxLr2BrowserEnvironment = parseInboxLr2BrowserEnvironment();

function inboxConversationUrl(conversationId: string): string { return "/inbox?conversation=" + encodeURIComponent(conversationId); }

async function signInToInbox(browser: Browser, staff: InboxLr2StaffCredentials, conversationId: string): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("Work email").fill(staff.email);
  await page.getByPlaceholder("Enter your password").fill(staff.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/(dashboard|inbox)/);
  await page.goto(inboxConversationUrl(conversationId));
  await expect(page.getByLabel("Conversation list")).toBeVisible();
  return { context, page };
}

test.describe("LR2 Inbox browser acceptance", () => {
  test("staff can take control, retain a draft, send, and add an internal note", async ({ browser }) => {
    const session = await signInToInbox(browser, inboxLr2BrowserEnvironment.agencyA.staffA1, inboxLr2BrowserEnvironment.agencyA.takeControlConversationId);
    try {
      await session.page.getByLabel("Conversation actions").click();
      await session.page.getByRole("menuitem", { name: "Take control" }).click();
      await expect(session.page.getByRole("group", { name: "Who owns this conversation" })).toContainText("Assistant paused");
      const draft = "LR2 draft " + Date.now();
      const composer = session.page.getByPlaceholder("Reply to the customer…");
      // The draft is saved a moment after typing stops; leaving before the save has finished would lose it, so wait for the save itself.
      const draftSaved = session.page.waitForResponse((response) => response.request().method() === "POST" && (response.request().postData() ?? "").includes(draft));
      await composer.fill(draft);
      await draftSaved;
      await session.page.goto(inboxConversationUrl(inboxLr2BrowserEnvironment.agencyA.openConversationId));
      await session.page.goto(inboxConversationUrl(inboxLr2BrowserEnvironment.agencyA.takeControlConversationId));
      await expect(composer).toHaveValue(draft);
      const message = "LR2 browser send " + Date.now();
      await composer.fill(message);
      await session.page.getByRole("button", { name: "Send", exact: true }).click();
      await expect(session.page.getByText(message, { exact: true })).toBeVisible();
      await expect(session.page.getByText("Sending…", { exact: true })).toHaveCount(0);
      await session.page.getByRole("tab", { name: "Internal note" }).click();
      const note = "LR2 internal note " + Date.now();
      await session.page.getByPlaceholder("Write an internal note…").fill(note);
      await session.page.getByRole("button", { name: "Add note" }).click();
      await expect(session.page.getByText(note, { exact: true })).toBeVisible();
    } finally { await session.context.close(); }
  });

  test("channel-window, permission, and coworker ownership feedback is understandable", async ({ browser }) => {
    const closed = await signInToInbox(browser, inboxLr2BrowserEnvironment.agencyA.staffA1, inboxLr2BrowserEnvironment.agencyA.closedWindowConversationId);
    const readonly = await signInToInbox(browser, inboxLr2BrowserEnvironment.agencyA.staffReadonly, inboxLr2BrowserEnvironment.agencyA.openConversationId);
    const coworker = await signInToInbox(browser, inboxLr2BrowserEnvironment.agencyA.staffA1, inboxLr2BrowserEnvironment.agencyA.coworkerConversationId);
    try {
      await expect(closed.page.getByText("Reply window closed", { exact: true })).toBeVisible();
      await expect(closed.page.getByPlaceholder("Reply to the customer…")).toHaveCount(0);
      await expect(readonly.page.getByPlaceholder("Reply to the customer…")).toHaveCount(0);
      await expect(coworker.page.getByRole("note")).toContainText(/owns this chat|check with them/i);
    } finally { await Promise.all([closed.context.close(), readonly.context.close(), coworker.context.close()]); }
  });

  test("two staff sessions converge after reconnect without cross-agency disclosure", async ({ browser }) => {
    const first = await signInToInbox(browser, inboxLr2BrowserEnvironment.agencyA.staffA1, inboxLr2BrowserEnvironment.agencyA.openConversationId);
    const second = await signInToInbox(browser, inboxLr2BrowserEnvironment.agencyA.staffA2, inboxLr2BrowserEnvironment.agencyA.openConversationId);
    const agencyB = await signInToInbox(browser, inboxLr2BrowserEnvironment.agencyB.staffB1, inboxLr2BrowserEnvironment.agencyB.conversationId);
    try {
      await second.context.setOffline(true);
      const message = "LR2 realtime recovery " + Date.now();
      await first.page.getByPlaceholder("Reply to the customer…").fill(message);
      await first.page.getByRole("button", { name: "Send", exact: true }).click();
      await expect(first.page.getByText(message, { exact: true })).toBeVisible();
      await second.context.setOffline(false);
      await expect(second.page.getByText(message, { exact: true })).toBeVisible();
      expect(await agencyB.page.locator("body").innerText()).not.toContain(message);
    } finally { await Promise.all([first.context.close(), second.context.close(), agencyB.context.close()]); }
  });

  test("keyboard traversal retains visible focus and exposed Inbox labels", async ({ browser }) => {
    const session = await signInToInbox(browser, inboxLr2BrowserEnvironment.agencyA.staffA1, inboxLr2BrowserEnvironment.agencyA.openConversationId);
    try {
      for (let index = 0; index < 12; index += 1) { await session.page.keyboard.press("Tab"); await expect(session.page.locator(":focus")).toBeVisible(); }
      await expect(session.page.getByLabel("Conversation list")).toBeVisible();
      await expect(session.page.getByRole("group", { name: "Who owns this conversation" })).toBeVisible();
    } finally { await session.context.close(); }
  });
});
