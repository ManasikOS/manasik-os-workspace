import { describe, expect, it } from "vitest";

import { canUseQuickChat, quickChatSendMode } from "./access";

describe("quick chat access", () => {
  it.each(["ADMIN", "MARKETING", "OPERATIONS"] as const)("%s sends through the Inbox's own actions", (role) => {
    expect(quickChatSendMode(role)).toBe("INBOX");
    expect(canUseQuickChat(role)).toBe(true);
  });

  it.each(["FINANCE", "VISA"] as const)("%s sends one kind of message from a record, not from the Inbox", (role) => {
    expect(quickChatSendMode(role)).toBe("RECORD");
    expect(canUseQuickChat(role)).toBe(true);
  });

  it.each(["CEO", "GUIDE"] as const)("%s cannot use the popup", (role) => {
    expect(quickChatSendMode(role)).toBeNull();
    expect(canUseQuickChat(role)).toBe(false);
  });
});
