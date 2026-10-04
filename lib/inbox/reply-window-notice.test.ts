import { describe, expect, it } from "vitest";

import type { ChannelPolicyState } from "@/lib/channels/policy-state";

import { formatTimeLeft, replyWindowNoticeFor } from "./reply-window-notice";

const NOW = new Date("2026-09-24T12:00:00.000Z");
const MIN = 60_000;
const at = (minutes: number) => new Date(NOW.getTime() + minutes * MIN).toISOString();

const policy = (action: ChannelPolicyState["action"], notice = "n"): ChannelPolicyState => ({
  action,
  templateRequired: action === "APPROVED_TEMPLATE",
  humanAgentTagEligible: action === "HUMAN_AGENT",
  projectedCharge: null,
  notice,
});

const notice = (over: Partial<Parameters<typeof replyWindowNoticeFor>[0]> & { action: ChannelPolicyState["action"] }) =>
  replyWindowNoticeFor({ channel: "WHATSAPP", policy: policy(over.action), serviceWindowExpiresAt: null, humanAgentWindowExpiresAt: null, now: NOW, ...over });

describe("formatTimeLeft", () => {
  it("formats hours and minutes, and never goes negative", () => {
    expect(formatTimeLeft(23 * 60 + 42)).toBe("23h 42m");
    expect(formatTimeLeft(65)).toBe("1h 05m");
    expect(formatTimeLeft(42.9)).toBe("42m");
    expect(formatTimeLeft(-5)).toBe("0m");
  });
});

describe("replyWindowNoticeFor", () => {
  it("counts down an open window", () => {
    expect(notice({ action: "FREE_FORM", serviceWindowExpiresAt: at(23 * 60 + 42) })).toMatchObject({ tone: "OPEN", detail: "Free-form reply allowed for 23h 42m." });
  });

  it("calls out a closing window at exactly two hours and below", () => {
    expect(notice({ action: "FREE_FORM", serviceWindowExpiresAt: at(121) }).tone).toBe("OPEN");
    expect(notice({ action: "FREE_FORM", serviceWindowExpiresAt: at(120) })).toMatchObject({ tone: "CLOSING", headline: "Reply window closes in 2h 00m" });
    expect(notice({ action: "FREE_FORM", serviceWindowExpiresAt: at(102) }).headline).toBe("Reply window closes in 1h 42m");
  });

  it("has nothing to count down on a channel without a window", () => {
    expect(notice({ action: "FREE_FORM" })).toMatchObject({ tone: "OPEN", headline: "Reply window open" });
  });

  it("never shows an email reply window, even if a legacy timestamp is present", () => {
    expect(notice({ action: "FREE_FORM", channel: "GMAIL", serviceWindowExpiresAt: at(90) })).toMatchObject({
      tone: "OPEN",
      headline: "Email messaging available",
      detail: "You can send an email at any time.",
    });
  });

  it("sends staff to an approved template once WhatsApp's window is closed", () => {
    expect(notice({ action: "APPROVED_TEMPLATE" })).toMatchObject({ tone: "CLOSED", needsTemplate: true, detail: expect.stringContaining("Meta charges may apply") });
  });

  it("says a human support reply must be written by staff, with its own deadline", () => {
    expect(notice({ action: "HUMAN_AGENT", humanAgentWindowExpiresAt: at(5 * 60) })).toMatchObject({ tone: "HUMAN_ONLY", headline: "Human support reply allowed for 5h 00m" });
  });

  it("passes the reason through when sending is blocked", () => {
    expect(replyWindowNoticeFor({ channel: "WHATSAPP", policy: policy("BLOCKED", "The window is closed."), serviceWindowExpiresAt: null, humanAgentWindowExpiresAt: null, now: NOW })).toMatchObject({ tone: "BLOCKED", detail: "The window is closed." });
  });
});
