import { describe, expect, it } from "vitest";

import { isQuickChatEnabled } from "./flag";

describe("isQuickChatEnabled", () => {
  it("is off by default", () => {
    expect(isQuickChatEnabled({})).toBe(false);
    expect(isQuickChatEnabled({ QUICK_CHAT_ENABLED: "" })).toBe(false);
  });

  it.each(["1", "true", "TRUE", " yes ", "on"])("turns on for %j", (value) => {
    expect(isQuickChatEnabled({ QUICK_CHAT_ENABLED: value })).toBe(true);
  });

  it.each(["0", "false", "off", "no", "enabled"])("stays off for %j", (value) => {
    expect(isQuickChatEnabled({ QUICK_CHAT_ENABLED: value })).toBe(false);
  });
});
