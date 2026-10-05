import { describe, expect, it } from "vitest";

import {
  DEFAULT_INBOX_RATE_LIMITS,
  dayWindowStart,
  hourWindowStart,
  INBOX_RATE_LIMITED_ACTIONS,
  rateLimitRefusalMessage,
  resolveInboxRateLimits,
} from "./policy";

/** SEC-6 (docs/progress/2026-10-05-inbox-security-and-bug-audit.md): the limits, their windows and the words a person sees. */

describe("the defaults", () => {
  it("cover every limited action, and new chats are held tighter than anything inside an existing chat", () => {
    expect(Object.keys(DEFAULT_INBOX_RATE_LIMITS).sort()).toEqual([...INBOX_RATE_LIMITED_ACTIONS].sort());
    const newChats = DEFAULT_INBOX_RATE_LIMITS.START_WHATSAPP_CHAT;
    // Agencies start fewer than 30 new chats a day, so the daily cap leaves room for double that and no more.
    expect(newChats.perAgencyDaily).toBe(60);
    expect(newChats.perAgencyDaily).toBeLessThan(DEFAULT_INBOX_RATE_LIMITS.SEND_TEMPLATE.perAgencyDaily);
    expect(newChats.perUserHourly).toBeLessThan(DEFAULT_INBOX_RATE_LIMITS.SEND_TEMPLATE.perUserHourly);
  });

  it("refuses when the counter is unavailable for anything that costs money or WhatsApp standing, and allows the AI helpers", () => {
    for (const action of ["START_WHATSAPP_CHAT", "START_EMAIL_CONVERSATION", "SEND_TEMPLATE"] as const) expect(DEFAULT_INBOX_RATE_LIMITS[action].whenUnavailable, action).toBe("REFUSE");
    for (const action of ["SUGGEST_REPLY", "TRANSLATE", "PREPARE_OFFER"] as const) expect(DEFAULT_INBOX_RATE_LIMITS[action].whenUnavailable, action).toBe("ALLOW");
  });
});

describe("resolveInboxRateLimits", () => {
  it("uses the defaults when the agency has no override", () => {
    expect(resolveInboxRateLimits("START_WHATSAPP_CHAT", null)).toEqual({ perUserHourly: 15, perAgencyDaily: 60 });
    expect(resolveInboxRateLimits("START_WHATSAPP_CHAT", undefined)).toEqual({ perUserHourly: 15, perAgencyDaily: 60 });
  });

  it("applies an override per column, and a null column keeps the default", () => {
    expect(resolveInboxRateLimits("START_WHATSAPP_CHAT", { per_user_hourly: null, per_agency_daily: 200 })).toEqual({ perUserHourly: 15, perAgencyDaily: 200 });
    expect(resolveInboxRateLimits("START_WHATSAPP_CHAT", { per_user_hourly: 40, per_agency_daily: null })).toEqual({ perUserHourly: 40, perAgencyDaily: 60 });
  });

  it("treats 0 as a real limit that blocks the action, not as 'no override'", () => {
    expect(resolveInboxRateLimits("TRANSLATE", { per_user_hourly: 0, per_agency_daily: 0 })).toEqual({ perUserHourly: 0, perAgencyDaily: 0 });
  });

  it("does not let one action's override touch another", () => {
    expect(resolveInboxRateLimits("SEND_TEMPLATE", null)).toEqual({ perUserHourly: 60, perAgencyDaily: 400 });
  });
});

describe("windows follow Sri Lanka time (UTC+5:30)", () => {
  it("starts the day at local midnight, which is 18:30 UTC the evening before", () => {
    expect(dayWindowStart(new Date("2026-10-05T10:00:00.000Z")).toISOString()).toBe("2026-10-04T18:30:00.000Z");
    // 18:29 UTC is still 23:59 in Colombo, 18:31 UTC is already the next day.
    expect(dayWindowStart(new Date("2026-10-05T18:29:00.000Z")).toISOString()).toBe("2026-10-04T18:30:00.000Z");
    expect(dayWindowStart(new Date("2026-10-05T18:31:00.000Z")).toISOString()).toBe("2026-10-05T18:30:00.000Z");
  });

  it("starts the hour on the local hour", () => {
    expect(hourWindowStart(new Date("2026-10-05T10:20:00.000Z")).toISOString()).toBe("2026-10-05T09:30:00.000Z");
    expect(hourWindowStart(new Date("2026-10-05T09:30:00.000Z")).toISOString()).toBe("2026-10-05T09:30:00.000Z");
  });

  it("gives every moment inside one window the same start, so they share one counter", () => {
    expect(dayWindowStart(new Date("2026-10-05T01:00:00.000Z")).getTime()).toBe(dayWindowStart(new Date("2026-10-05T17:00:00.000Z")).getTime());
  });
});

describe("rateLimitRefusalMessage", () => {
  const now = new Date("2026-10-05T10:20:00.000Z"); // 3:50 pm in Colombo

  it("tells a person who hit their hourly limit how many, and when they can go on", () => {
    expect(rateLimitRefusalMessage({ action: "START_WHATSAPP_CHAT", blockedBy: "USER", limit: 15, now })).toBe(
      "You have reached the limit of 15 new WhatsApp chats per hour. You can try again after 4:00 pm.",
    );
  });

  it("tells staff the agency's day is used up, when it starts again, and who can change it", () => {
    const message = rateLimitRefusalMessage({ action: "START_WHATSAPP_CHAT", blockedBy: "AGENCY", limit: 60, now });
    expect(message).toContain("Your agency has reached today's limit of 60 new WhatsApp chats");
    expect(message).toContain("midnight (Sri Lanka time)");
    expect(message).toContain("platform team");
  });

  it("says plainly when an action has been switched off for the agency", () => {
    expect(rateLimitRefusalMessage({ action: "TRANSLATE", blockedBy: "AGENCY", limit: 0, now })).toBe("Translations are switched off for your agency. If that is not expected, ask the platform team.");
  });
});
