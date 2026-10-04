import { describe, expect, it } from "vitest";

import type { QueueCode } from "@/lib/inbox/intelligence/contracts";

import { parseWorkingHours } from "./business-hours";
import { CHANNEL_WINDOW_BUFFER_MINUTES, NEARING_DEADLINE_MINUTES, computeSlaDueAt, isAwaitingReply, slaBand, type SlaInput } from "./due-at";
import { DEFAULT_SLA_POLICIES, MAX_SLA_MINUTES, mergeSlaPolicies, slaPolicyInputSchema } from "./policies";

const TZ = "Asia/Colombo";
const colombo = (text: string) => new Date(`${text}+05:30`);
const show = (date: Date | null) => (date ? date.toLocaleString("sv-SE", { timeZone: TZ }).replace(" ", "T") : null);

// Mon–Fri 09:00–17:00, Saturday 09:00–13:00, Sunday closed.
const calendar = parseWorkingHours({
  weekly: { mon: ["09:00-17:00"], tue: ["09:00-17:00"], wed: ["09:00-17:00"], thu: ["09:00-17:00"], fri: ["09:00-17:00"], sat: ["09:00-13:00"], sun: [] },
});
const policies = new Map(DEFAULT_SLA_POLICIES.map((policy) => [policy.queueCode, policy]));

const MONDAY_10AM = colombo("2026-09-21T10:00:00");

function due(queues: QueueCode[], overrides: Partial<SlaInput> = {}, enteredAt: Date = MONDAY_10AM) {
  return computeSlaDueAt({
    memberships: queues.map((queueCode) => ({ queueCode, enteredAt })),
    policies,
    lastInboundAt: MONDAY_10AM,
    lastOutboundAt: null,
    serviceWindowExpiresAt: null,
    calendar,
    timezone: TZ,
    ...overrides,
  });
}

/** Customer wrote Monday 10:00 and is unanswered → first-reply deadline; answered → only the resolution deadline. */
const answered = { lastOutboundAt: colombo("2026-09-21T10:01:00") };

describe("one fixture per row of R2's table (calendar: Mon–Fri 09–17, Sat 09–13)", () => {
  // queue, first reply due, resolution due — every value worked out by hand from the calendar above.
  const rows: Array<[QueueCode, string, string | null]> = [
    ["ESCALATIONS", "2026-09-21T10:15:00", "2026-09-22T10:00:00"], // 15 min · 24 h · 24/7
    ["COMPLAINTS", "2026-09-21T10:15:00", "2026-09-22T10:00:00"], // 15 min · 24 h · 24/7
    ["BOOKING_READY", "2026-09-21T10:15:00", "2026-09-21T14:00:00"], // 15 min · 4 h
    ["PAYMENT_DISCUSSIONS", "2026-09-21T10:30:00", "2026-09-21T14:00:00"], // 30 min · 4 h
    ["NEW_ENQUIRIES", "2026-09-21T10:30:00", "2026-09-22T10:00:00"], // 30 min · 8 h (7 h Monday + 1 h Tuesday)
    ["NEEDS_REPLY", "2026-09-21T11:00:00", null], // 60 min · no resolution target
    ["DEPARTURE_CHANGES", "2026-09-21T12:00:00", "2026-09-24T10:00:00"], // 2 h · 24 open hours
    ["GROUP_CHANGES", "2026-09-21T12:00:00", "2026-09-24T10:00:00"],
    ["QUALIFIED", "2026-09-21T12:00:00", "2026-09-28T14:00:00"], // 2 h · 48 open hours (across a Saturday half day)
    ["QUOTE_SENT", "2026-09-21T12:00:00", "2026-09-28T14:00:00"],
    ["DOCUMENTS", "2026-09-21T14:00:00", "2026-09-24T10:00:00"], // 4 h · 3 business days
    ["VISA_ISSUES", "2026-09-21T14:00:00", "2026-09-24T10:00:00"],
  ];

  it("covers every policy the defaults define", () => {
    expect(rows.map(([queue]) => queue).sort()).toEqual(DEFAULT_SLA_POLICIES.map((policy) => policy.queueCode).sort());
  });

  it.each(rows)("%s: first reply %s, resolution %s", (queue, firstReply, resolution) => {
    const unanswered = due([queue]);
    expect(unanswered.basis).toBe("FIRST_REPLY");
    expect(show(unanswered.dueAt)).toBe(firstReply);

    const afterReply = due([queue], answered);
    expect(show(afterReply.dueAt)).toBe(resolution);
    expect(afterReply.basis).toBe(resolution === null ? "NONE" : "RESOLUTION");
  });

  it("opens an intervention on breach for exactly the four queues R2 names", () => {
    expect(DEFAULT_SLA_POLICIES.filter((policy) => policy.opensInterventionOnBreach).map((policy) => policy.queueCode).sort()).toEqual([
      "BOOKING_READY",
      "COMPLAINTS",
      "ESCALATIONS",
      "PAYMENT_DISCUSSIONS",
    ]);
  });
});

describe("THE CHANNEL WINDOW OUTRANKS EVERY TARGET — this test must never be deleted", () => {
  it("due = least(queue target, window − 2 h): a window closing sooner than the target wins, and says so", () => {
    // Complaint due 10:15 (24/7). The WhatsApp window closes at 11:30, so the last safe moment is 09:30 — earlier than the target.
    const result = due(["COMPLAINTS"], { serviceWindowExpiresAt: colombo("2026-09-21T11:30:00") });
    expect(result.basis).toBe("CHANNEL_WINDOW");
    expect(show(result.dueAt)).toBe("2026-09-21T09:30:00");
    expect(result.queueCode).toBeNull();
  });

  it("uses a two-hour buffer exactly", () => {
    expect(CHANNEL_WINDOW_BUFFER_MINUTES).toBe(120);
    // NEEDS_REPLY is due 11:00; a window closing 12:30 has its last safe moment at 10:30, which is sooner.
    const closes = colombo("2026-09-21T12:30:00");
    expect(due(["NEEDS_REPLY"], { serviceWindowExpiresAt: closes }).dueAt?.getTime()).toBe(closes.getTime() - 120 * 60_000);
  });

  it("beats a business-hours target that would run past the window: Friday-evening arrival, window closes Saturday 06:00", () => {
    // NEEDS_REPLY at Fri 18:30 is due Sat 10:00 (60 open minutes after Saturday opens); the window closes Sat 06:00.
    const result = due(["NEEDS_REPLY"], { lastInboundAt: colombo("2026-09-18T18:30:00"), serviceWindowExpiresAt: colombo("2026-09-19T06:00:00") });
    expect(result.basis).toBe("CHANNEL_WINDOW");
    expect(show(result.dueAt)).toBe("2026-09-19T04:00:00");
  });

  it("does not shorten a target that is already sooner than the window", () => {
    const result = due(["COMPLAINTS"], { serviceWindowExpiresAt: colombo("2026-09-22T10:00:00") });
    expect(result.basis).toBe("FIRST_REPLY");
    expect(show(result.dueAt)).toBe("2026-09-21T10:15:00");
  });

  it("applies even to a queue with no reply target of its own, while the customer is waiting", () => {
    const result = due([], { serviceWindowExpiresAt: colombo("2026-09-21T14:00:00") });
    expect(result.basis).toBe("CHANNEL_WINDOW");
    expect(show(result.dueAt)).toBe("2026-09-21T12:00:00");
  });

  it("an already-passed window deadline is a breach now", () => {
    const result = due(["NEEDS_REPLY"], { serviceWindowExpiresAt: colombo("2026-09-21T11:00:00") });
    expect(slaBand(result.dueAt, colombo("2026-09-21T10:30:00"))).toBe("BREACHED");
  });

  it("is irrelevant once we have replied: there is nothing left to answer inside the window", () => {
    const result = due(["NEEDS_REPLY"], { ...answered, serviceWindowExpiresAt: colombo("2026-09-21T10:30:00") });
    expect(result.basis).toBe("NONE");
    expect(result.dueAt).toBeNull();
  });

  it("does nothing on a channel with no window", () => {
    expect(due(["NEEDS_REPLY"], { serviceWindowExpiresAt: null }).basis).toBe("FIRST_REPLY");
  });
});

describe("the clock pauses while parked on the customer, and never manufactures a breach", () => {
  it("WAITING_CUSTOMER with nothing unanswered has no deadline, and stays unbreached however long it sits", () => {
    const parked = due(["WAITING_CUSTOMER"], { lastOutboundAt: colombo("2026-09-21T10:05:00") });
    expect(parked).toEqual({ dueAt: null, basis: "PAUSED", queueCode: null });
    expect(slaBand(parked.dueAt, colombo("2026-12-31T10:00:00"))).toBe("NONE");
  });

  it("a conversation in NEEDS_REPLY's sibling WAITING_CUSTOMER plus RESOLVED is paused too", () => {
    expect(due(["RESOLVED"]).basis).toBe("PAUSED");
    expect(due(["RESOLVED", "COMPLAINTS"]).dueAt).toBeNull();
  });

  it("resuming on the customer's next message restarts the clock from THAT message, never back-dated", () => {
    // Parked since Monday; the customer writes again Thursday 14:00. The deadline is Thursday 15:00, not Monday's.
    const resumed = due(["NEEDS_REPLY"], { lastInboundAt: colombo("2026-09-24T14:00:00"), lastOutboundAt: colombo("2026-09-21T10:05:00") });
    expect(show(resumed.dueAt)).toBe("2026-09-24T15:00:00");
    expect(slaBand(resumed.dueAt, colombo("2026-09-24T14:30:00"))).not.toBe("BREACHED");
  });

  it("a queue's resolution clock does not run while parked on the customer or the team", () => {
    expect(due(["COMPLAINTS", "WAITING_CUSTOMER"], { ...answered }).dueAt).toBeNull();
    const withTeam = due(["COMPLAINTS", "WAITING_TEAM"], answered);
    expect(withTeam.dueAt).toBeNull();
  });

  it("but an unanswered customer in WAITING_TEAM is still on the first-reply clock: opening a breach intervention must not erase the breach", () => {
    const result = due(["COMPLAINTS", "WAITING_TEAM"]);
    expect(result.basis).toBe("FIRST_REPLY");
    expect(show(result.dueAt)).toBe("2026-09-21T10:15:00");
  });
});

describe("clocks: 24/7 versus business hours", () => {
  it("a 24/7 queue breaches overnight; a business-hours queue does not", () => {
    const night = colombo("2026-09-21T23:00:00");
    const complaint = due(["COMPLAINTS"], { lastInboundAt: night });
    const needsReply = due(["NEEDS_REPLY"], { lastInboundAt: night });
    expect(show(complaint.dueAt)).toBe("2026-09-21T23:15:00");
    expect(show(needsReply.dueAt)).toBe("2026-09-22T10:00:00");

    const breachCheck = colombo("2026-09-22T02:00:00");
    expect(slaBand(complaint.dueAt, breachCheck)).toBe("BREACHED");
    expect(slaBand(needsReply.dueAt, breachCheck)).toBe("NONE");
    expect(slaBand(needsReply.dueAt, colombo("2026-09-22T09:59:00"))).toBe("NEARING");
    expect(slaBand(needsReply.dueAt, colombo("2026-09-22T10:00:00"))).toBe("BREACHED");
  });

  it("an out-of-hours NEW_ENQUIRIES arrival is due 30 minutes after opening", () => {
    expect(show(due(["NEW_ENQUIRIES"], { lastInboundAt: colombo("2026-09-21T22:00:00") }).dueAt)).toBe("2026-09-22T09:30:00");
    expect(show(due(["NEW_ENQUIRIES"], { lastInboundAt: colombo("2026-09-20T15:00:00") }).dueAt)).toBe("2026-09-21T09:30:00"); // Sunday
  });

  it("with no calendar saved, business-hours queues run around the clock", () => {
    const arrival = colombo("2026-09-21T22:00:00");
    const result = due(["NEW_ENQUIRIES"], { calendar: null, lastInboundAt: arrival }, arrival);
    expect(show(result.dueAt)).toBe("2026-09-21T22:30:00");
  });
});

describe("several queues at once", () => {
  it("the tightest deadline wins, and it names the queue that set it", () => {
    const result = due(["NEEDS_REPLY", "PAYMENT_DISCUSSIONS", "DOCUMENTS"]);
    expect(result.queueCode).toBe("PAYMENT_DISCUSSIONS");
    expect(show(result.dueAt)).toBe("2026-09-21T10:30:00");
  });

  it("a queue with no policy contributes nothing", () => {
    expect(due(["ALL", "WHATSAPP"]).basis).toBe("NONE");
  });

  it("resolution counts from when the conversation entered the queue, not from when it started", () => {
    const result = due(["BOOKING_READY"], answered, colombo("2026-09-21T15:00:00"));
    expect(show(result.dueAt)).toBe("2026-09-22T11:00:00"); // 2 h left on Monday + 2 h on Tuesday
  });
});

describe("isAwaitingReply and slaBand", () => {
  it("awaits when the customer wrote last, or wrote and was never answered", () => {
    expect(isAwaitingReply(MONDAY_10AM, null)).toBe(true);
    expect(isAwaitingReply(MONDAY_10AM, colombo("2026-09-21T09:00:00"))).toBe(true);
    expect(isAwaitingReply(MONDAY_10AM, colombo("2026-09-21T10:00:00"))).toBe(false);
    expect(isAwaitingReply(null, null)).toBe(false);
  });

  it("bands a deadline: none, nearing inside 30 minutes, breached at or after it", () => {
    expect(NEARING_DEADLINE_MINUTES).toBe(30);
    const deadline = colombo("2026-09-21T12:00:00");
    expect(slaBand(null, deadline)).toBe("NONE");
    expect(slaBand(deadline, colombo("2026-09-21T11:29:00"))).toBe("NONE");
    expect(slaBand(deadline, colombo("2026-09-21T11:30:01"))).toBe("NEARING");
    expect(slaBand(deadline, deadline)).toBe("BREACHED");
    expect(slaBand(deadline, colombo("2026-09-21T13:00:00"))).toBe("BREACHED");
  });
});

describe("policy rows", () => {
  it("overlay the defaults and ignore a row that does not parse", () => {
    const merged = mergeSlaPolicies([
      { queue_code: "COMPLAINTS", first_reply_minutes: 5, resolution_minutes: 600, clock: "ALWAYS", opens_intervention_on_breach: false },
      { queue_code: "DOCUMENTS", first_reply_minutes: -3, resolution_minutes: null, clock: "ALWAYS", opens_intervention_on_breach: true },
      { queue_code: "NOT_A_QUEUE", first_reply_minutes: 5, resolution_minutes: null, clock: "ALWAYS", opens_intervention_on_breach: false },
    ]);
    expect(merged.get("COMPLAINTS")).toMatchObject({ firstReplyMinutes: 5, resolutionMinutes: 600, opensInterventionOnBreach: false });
    expect(merged.get("DOCUMENTS")).toMatchObject({ firstReplyMinutes: 240 });
    expect(merged.size).toBe(DEFAULT_SLA_POLICIES.length);
  });

  it("the edit schema rejects a paused queue, a zero, an absurd number and an unknown clock", () => {
    const good = { queueCode: "COMPLAINTS", firstReplyMinutes: 15, resolutionMinutes: null, clock: "ALWAYS", opensInterventionOnBreach: true };
    expect(slaPolicyInputSchema.safeParse(good).success).toBe(true);
    expect(slaPolicyInputSchema.safeParse({ ...good, queueCode: "WAITING_CUSTOMER" }).success).toBe(false);
    expect(slaPolicyInputSchema.safeParse({ ...good, firstReplyMinutes: 0 }).success).toBe(false);
    expect(slaPolicyInputSchema.safeParse({ ...good, firstReplyMinutes: MAX_SLA_MINUTES + 1 }).success).toBe(false);
    expect(slaPolicyInputSchema.safeParse({ ...good, clock: "WEEKENDS" }).success).toBe(false);
  });
});
