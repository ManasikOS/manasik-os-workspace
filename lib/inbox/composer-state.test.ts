import { describe, expect, it } from "vitest";

import { channelDisplayName, channelSupportsSubjectAndCcBcc, composerStateFor, type ComposerStateInput } from "./composer-state";

const NOW = new Date("2026-09-19T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs).toISOString();

const base: ComposerStateInput = { conversationState: "HUMAN_ACTIVE", canSendMessage: true, channel: "MESSENGER", serviceWindowExpiresAt: at(3 * HOUR), now: NOW };
const state = (over: Partial<ComposerStateInput> = {}) => composerStateFor({ ...base, ...over });

describe("composerStateFor", () => {
  it("lets staff reply inside the window on every channel", () => {
    for (const channel of ["WHATSAPP", "MESSENGER", "INSTAGRAM", "GMAIL"]) expect(state({ channel })).toMatchObject({ canReply: true });
  });

  it("blocks a closed conversation first, whatever the channel or window", () => {
    expect(state({ conversationState: "CLOSED" })).toMatchObject({ canReply: false, reason: "CLOSED", notice: "This conversation is closed." });
    expect(state({ conversationState: "CLOSED", canSendMessage: false })).toMatchObject({ reason: "CLOSED" });
  });

  it("blocks a person who may not send, with the same wording as before", () => {
    expect(state({ canSendMessage: false })).toMatchObject({ canReply: false, reason: "NO_PERMISSION", notice: "You don't have permission to reply here." });
  });

  describe("Messenger and Instagram — the customer writes first", () => {
    for (const channel of ["MESSENGER", "INSTAGRAM"]) {
      it(`${channel}: cannot reply before the customer has ever written, and says so in the channel's name`, () => {
        const result = state({ channel, serviceWindowExpiresAt: null });
        expect(result).toMatchObject({ canReply: false, reason: "CUSTOMER_MUST_MESSAGE_FIRST" });
        expect((result as { notice: string }).notice).toContain(channelDisplayName(channel));
        expect((result as { notice: string }).notice).toContain("after the customer has messaged you");
      });

      it(`${channel}: closes the reply window once the customer's last message is over 24 hours old`, () => {
        const result = state({ channel, serviceWindowExpiresAt: at(-1) });
        expect(result).toMatchObject({ canReply: false, reason: "WINDOW_CLOSED" });
        expect((result as { notice: string }).notice).toContain("24 hours");
        expect((result as { notice: string }).notice).toContain("no way to reopen");
      });
    }

    it("is still open at the exact moment of expiry — the server closes a window only once its expiry is in the past", () => {
      expect(state({ serviceWindowExpiresAt: at(0) })).toMatchObject({ canReply: true });
      expect(state({ serviceWindowExpiresAt: at(-1) })).toMatchObject({ canReply: false });
    });
  });

  describe("WhatsApp approved-template path", () => {
    it("blocks free text before the customer writes and exposes the approved-template policy", () => {
      expect(state({ channel: "WHATSAPP", serviceWindowExpiresAt: null })).toMatchObject({ canReply: false, policy: { action: "APPROVED_TEMPLATE" } });
    });

    it("blocks free text after the window closes and exposes the approved-template policy", () => {
      expect(state({ channel: "WHATSAPP", serviceWindowExpiresAt: at(-5 * HOUR) })).toMatchObject({ canReply: false, reason: "WINDOW_CLOSED", policy: { action: "APPROVED_TEMPLATE" } });
    });
  });

  it("does not block Email on a rule that is not Meta's", () => {
    expect(state({ channel: "GMAIL", serviceWindowExpiresAt: null })).toMatchObject({ canReply: true });
  });
});

describe("channelSupportsSubjectAndCcBcc", () => {
  it("is true only for email", () => {
    expect(channelSupportsSubjectAndCcBcc("GMAIL")).toBe(true);
    for (const channel of ["WHATSAPP", "MESSENGER", "INSTAGRAM", "SMS", "OTHER"]) expect(channelSupportsSubjectAndCcBcc(channel)).toBe(false);
  });
});

describe("channelDisplayName", () => {
  it("names the channels people read, and shows an unknown one as stored", () => {
    expect(channelDisplayName("WHATSAPP")).toBe("WhatsApp");
    expect(channelDisplayName("MESSENGER")).toBe("Messenger");
    expect(channelDisplayName("INSTAGRAM")).toBe("Instagram");
    expect(channelDisplayName("GMAIL")).toBe("Email");
    expect(channelDisplayName("SMS")).toBe("SMS");
  });
});
