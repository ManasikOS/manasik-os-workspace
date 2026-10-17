import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OPEN_QUICK_CHAT_EVENT, setQuickChatAvailable, type OpenQuickChatDetail } from "./open-quick-chat-event";
import { sendViaWhatsApp } from "./send-via-whatsapp";

const request = {
  channel: "WHATSAPP" as const,
  to: "94771234567",
  contactName: "Amina",
  draft: "Assalamu Alaikum",
  fallbackUrl: "https://wa.me/94771234567?text=Assalamu%20Alaikum",
};

let opened: Array<[string, string, string]>;
let target: EventTarget;

beforeEach(() => {
  opened = [];
  target = new EventTarget();
  vi.stubGlobal("window", Object.assign(target, { open: (...args: [string, string, string]) => opened.push(args) }));
});

afterEach(() => {
  setQuickChatAvailable(false);
  vi.unstubAllGlobals();
});

describe("sendViaWhatsApp", () => {
  it("opens the wa.me link, and says so, when the popup is not available", () => {
    expect(sendViaWhatsApp(request)).toBe("LINK");
    expect(opened).toEqual([[request.fallbackUrl, "_blank", "noopener,noreferrer"]]);
  });

  it("hands the person and the draft to the popup, and opens no link, when it is available", () => {
    setQuickChatAvailable(true);
    const heard: OpenQuickChatDetail[] = [];
    target.addEventListener(OPEN_QUICK_CHAT_EVENT, (event) => heard.push((event as CustomEvent<OpenQuickChatDetail>).detail));
    const onOpened = vi.fn();

    expect(sendViaWhatsApp({ ...request, onOpened })).toBe("POPUP");

    expect(opened).toEqual([]);
    expect(onOpened).toHaveBeenCalledTimes(1);
    expect(heard).toEqual([{ channel: "WHATSAPP", to: "94771234567", contactName: "Amina", draft: "Assalamu Alaikum" }]);
  });

  it("does not call onOpened when it falls back to the link", () => {
    const onOpened = vi.fn();
    sendViaWhatsApp({ ...request, onOpened });
    expect(onOpened).not.toHaveBeenCalled();
  });
});
