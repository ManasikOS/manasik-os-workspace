import { expect, test, type Page } from "@playwright/test";

import { parseInboxLr2BrowserEnvironment } from "./inbox-lr2-config";
import { inboxAddress, pngLikeBuffer, requireTemplateFixture, signInToInboxAt } from "./support/inbox-session";

/**
 * TASK-030 group C (composing). These SEND REAL MESSAGES through the connected test channel, so they run only against the non-production
 * environment, to the Meta test number and nobody else, after the fixtures were reset. Each test uses a unique text so it can find
 * exactly its own message.
 *
 * Fixture contract: Staff A1 may reply in Agency A; the open-window conversation's contact is the provider test recipient; the
 * closed-window conversation is a WhatsApp chat whose 24-hour window has expired; INBOX_E2E_TEMPLATE_NAME names an approved template
 * for Agency A. Fixture variables are read inside the tests that need them, so a missing one fails that test with a clear message.
 *
 * Covered: C1 (attachments: sent once, and a wrong type and an oversize file refused in plain words), C2 (an approved template reopens
 * a closed window), C3 (create a saved reply, insert it, send it), C7 (a double click sends one message, also after a reload). Not
 * covered: C4 (translation, which calls an AI provider), C5 (new WhatsApp chat) and C6 (e-mail compose) because they need a test
 * recipient number and a test mailbox in the fixtures, C8 (presence needs two live typists and is checked in the LR2 coworker test),
 * and C9 (Copilot with AI off, which needs the AI flags set per run).
 */
const environment = parseInboxLr2BrowserEnvironment();
const staffA1 = environment.agencyA.staffA1;

const openConversation = inboxAddress({ conversationId: environment.agencyA.openConversationId });

function composerBox(page: Page) {
  return page.getByPlaceholder("Reply to the customer…");
}

function uniqueText(label: string): string {
  return `TASK-030 ${label} ${Date.now()}`;
}

test.describe.configure({ mode: "serial" });

test.describe("TASK-030 C: composing", () => {
  test("C1: an allowed attachment is staged, sent once with its caption, and a wrong type and an oversize file are refused in plain words", async ({ browser }) => {
    const session = await signInToInboxAt(browser, staffA1, openConversation);
    try {
      const { page } = session;
      const fileInput = page.locator('input[type="file"]');

      // A file type the server never sends.
      await fileInput.setInputFiles({ name: "not-allowed.exe", mimeType: "application/x-msdownload", buffer: Buffer.from("MZ") });
      await expect(page.getByText("This file type can't be sent. Use a JPG or PNG photo, a PDF, or a Word, Excel or PowerPoint file.")).toBeVisible();
      await page.getByRole("button", { name: "Remove not-allowed.exe" }).click();

      // A photo over the 5 MB limit.
      await fileInput.setInputFiles({ name: "too-large.png", mimeType: "image/png", buffer: pngLikeBuffer(6 * 1024 * 1024) });
      await expect(page.getByText("That file is too large. Photos can be up to 5 MB.")).toBeVisible();
      await page.getByRole("button", { name: "Remove too-large.png" }).click();

      // An allowed photo with a caption is sent exactly once.
      const caption = uniqueText("attachment caption");
      await fileInput.setInputFiles({ name: "acceptance.png", mimeType: "image/png", buffer: pngLikeBuffer(2048) });
      await expect(page.getByRole("button", { name: "Remove acceptance.png" })).toBeVisible();
      await composerBox(page).fill(caption);
      await page.getByRole("button", { name: "Send", exact: true }).click();
      await expect(page.getByText(caption, { exact: true })).toHaveCount(1);
      await expect(page.getByText("Sending…", { exact: true })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Remove acceptance.png" })).toHaveCount(0);

      await page.reload();
      await expect(page.getByText(caption, { exact: true })).toHaveCount(1);
    } finally {
      await session.context.close();
    }
  });

  test("C2: an approved template can be chosen, filled and sent into a conversation whose 24-hour window has closed", async ({ browser }) => {
    const { templateName } = requireTemplateFixture();
    const session = await signInToInboxAt(browser, staffA1, inboxAddress({ conversationId: environment.agencyA.closedWindowConversationId }));
    try {
      const { page } = session;
      await expect(page.getByText("Reply window closed", { exact: true })).toBeVisible();
      await expect(composerBox(page)).toHaveCount(0);

      await page.getByRole("button", { name: "Choose approved template" }).click();
      const sheet = page.getByRole("dialog", { name: "Approved WhatsApp templates" });
      await expect(sheet).toBeVisible();
      await sheet.getByRole("button", { name: new RegExp(templateName) }).click();

      // The send button stays off until every variable has a value.
      const send = sheet.getByRole("button", { name: "Send approved template" });
      const values = sheet.getByPlaceholder(/^Value for \{\{\d+\}\}$/);
      const variableCount = await values.count();
      if (variableCount > 0) await expect(send).toBeDisabled();
      for (let index = 0; index < variableCount; index += 1) await values.nth(index).fill(`Test ${index + 1}`);
      await expect(send).toBeEnabled();
      await expect(sheet.getByText("Preview", { exact: true })).toBeVisible();

      await send.click();
      await expect(sheet).toBeHidden();
      // A template does not reopen the window (only the customer's reply does), so the "Reply window closed" notice stays; what must not appear is a failure.
      await expect(page.getByText(/could not|failed|not permitted/i)).toHaveCount(0);
    } finally {
      await session.context.close();
    }
  });

  test("C3: a saved reply can be created, inserted into the draft and sent", async ({ browser }) => {
    const session = await signInToInboxAt(browser, staffA1, openConversation);
    try {
      const { page } = session;
      const title = uniqueText("saved reply title");
      const body = uniqueText("saved reply body");

      await page.getByLabel("Insert a saved reply").click();
      await page.getByRole("menuitem", { name: "Create reply" }).click();
      const dialog = page.getByRole("dialog", { name: "Create saved reply" });
      await expect(dialog).toBeVisible();
      await dialog.getByPlaceholder("e.g. Payment reminder").fill(title);
      await dialog.getByPlaceholder("What gets inserted into the draft…").fill(body);
      // Keep the test reply private so it does not appear in the whole agency's list.
      const privateSwitch = dialog.getByRole("switch");
      if ((await privateSwitch.getAttribute("aria-checked")) !== "true") await privateSwitch.click();
      await dialog.getByRole("button", { name: "Create" }).click();
      await expect(dialog).toBeHidden();

      await page.getByLabel("Insert a saved reply").click();
      await page.getByRole("menuitem", { name: new RegExp(title) }).click();
      await expect(composerBox(page)).toHaveValue(body);
      await page.getByRole("button", { name: "Send", exact: true }).click();
      await expect(page.getByText(body, { exact: true })).toHaveCount(1);
    } finally {
      await session.context.close();
    }
  });

  test("C7: pressing Send twice quickly sends one message, and it is still one after a reload", async ({ browser }) => {
    const session = await signInToInboxAt(browser, staffA1, openConversation);
    try {
      const { page } = session;
      const text = uniqueText("double send");
      await composerBox(page).fill(text);
      await page.getByRole("button", { name: "Send", exact: true }).dblclick();
      await expect(page.getByText(text, { exact: true })).toHaveCount(1);
      await expect(page.getByText("Sending…", { exact: true })).toHaveCount(0);

      await page.reload();
      await expect(page.getByText(text, { exact: true })).toHaveCount(1);
    } finally {
      await session.context.close();
    }
  });
});
