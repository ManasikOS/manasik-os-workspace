import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  OPEN_QUICK_CHAT_EVENT,
  isQuickChatAvailable,
  openQuickChat,
  setQuickChatAvailable,
  type OpenQuickChatDetail,
} from "./open-quick-chat-event";

const detail: OpenQuickChatDetail = { channel: "WHATSAPP", to: "94771234567", contactName: "Amina", draft: "Hello" };

// The suite runs in the node environment (see vitest.config.mts), so the browser's `window` is a bare event target here.
beforeEach(() => {
  vi.stubGlobal("window", new EventTarget());
});

afterEach(() => {
  setQuickChatAvailable(false);
  vi.unstubAllGlobals();
});

describe("openQuickChat", () => {
  it("declines, and announces nothing, while the popup is unavailable", () => {
    const listener = vi.fn();
    window.addEventListener(OPEN_QUICK_CHAT_EVENT, listener);
    expect(openQuickChat(detail)).toBe(false);
    expect(listener).not.toHaveBeenCalled();
    window.removeEventListener(OPEN_QUICK_CHAT_EVENT, listener);
  });

  it("announces the request with its detail once the popup is available", () => {
    setQuickChatAvailable(true);
    expect(isQuickChatAvailable()).toBe(true);
    const listener = vi.fn((event: Event) => (event as CustomEvent<OpenQuickChatDetail>).detail);
    window.addEventListener(OPEN_QUICK_CHAT_EVENT, listener);
    expect(openQuickChat(detail)).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.results[0]?.value).toEqual(detail);
    window.removeEventListener(OPEN_QUICK_CHAT_EVENT, listener);
  });
});
