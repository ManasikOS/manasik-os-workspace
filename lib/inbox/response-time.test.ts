import { describe, expect, it } from "vitest";

import { buildResponseTimeStats, type ResponseActor, type ResponseMessage } from "@/lib/inbox/response-time";

const NOW = new Date("2026-10-01T12:00:00Z");
const at = (minutes: number) => new Date(Date.parse("2026-10-01T09:00:00Z") + minutes * 60_000).toISOString();

function msg(conversationId: string, actorKind: ResponseActor, minutes: number, channel = "MESSENGER"): ResponseMessage {
  return { conversationId, channel, actorKind, createdAt: at(minutes) };
}

const MINUTE = 60_000;

describe("buildResponseTimeStats", () => {
  it("measures a staff reply from the customer's message", () => {
    const stats = buildResponseTimeStats([msg("c1", "CUSTOMER", 0), msg("c1", "STAFF", 10)], 15, NOW);
    expect(stats.groups).toEqual([{ channel: "MESSENGER", responder: "STAFF", answered: 1, medianMs: 10 * MINUTE, slowestTenthMs: 10 * MINUTE, withinTargetPercent: 100 }]);
    expect(stats.waitingNow).toEqual([]);
  });

  it("measures from the FIRST of several unanswered customer messages", () => {
    const stats = buildResponseTimeStats([msg("c1", "CUSTOMER", 0), msg("c1", "CUSTOMER", 5), msg("c1", "CUSTOMER", 12), msg("c1", "STAFF", 20)], 15, NOW);
    expect(stats.groups[0].medianMs).toBe(20 * MINUTE);
    expect(stats.groups[0].withinTargetPercent).toBe(0);
    expect(stats.groups[0].answered).toBe(1);
  });

  it("keeps assistant and staff replies separate, and a reply by the assistant ends the run", () => {
    const stats = buildResponseTimeStats([msg("c1", "CUSTOMER", 0), msg("c1", "AI", 1), msg("c1", "STAFF", 30), msg("c1", "CUSTOMER", 40), msg("c1", "STAFF", 45)], 15, NOW);
    const ai = stats.groups.find((g) => g.responder === "AI");
    const staff = stats.groups.find((g) => g.responder === "STAFF");
    expect(ai).toMatchObject({ answered: 1, medianMs: MINUTE });
    // The staff message at minute 30 answers nobody (the assistant already replied); only the run starting at 40 counts.
    expect(staff).toMatchObject({ answered: 1, medianMs: 5 * MINUTE });
  });

  it("puts a customer with no reply yet in 'waiting now', not in the medians", () => {
    const stats = buildResponseTimeStats([msg("c1", "CUSTOMER", 0), msg("c2", "CUSTOMER", 0, "WHATSAPP"), msg("c2", "STAFF", 4, "WHATSAPP")], 15, NOW);
    expect(stats.waitingNow).toEqual([{ channel: "MESSENGER", count: 1 }]);
    expect(stats.groups).toHaveLength(1);
    expect(stats.groups[0].channel).toBe("WHATSAPP");
  });

  it("ignores system notes", () => {
    const stats = buildResponseTimeStats([msg("c1", "CUSTOMER", 0), msg("c1", "SYSTEM", 2), msg("c1", "STAFF", 8)], 15, NOW);
    expect(stats.groups[0].medianMs).toBe(8 * MINUTE);
  });

  it("does not need messages to arrive in order", () => {
    const stats = buildResponseTimeStats([msg("c1", "STAFF", 8), msg("c1", "CUSTOMER", 0)], 15, NOW);
    expect(stats.groups[0].medianMs).toBe(8 * MINUTE);
  });

  it("computes median, slowest tenth and share within target over many answers", () => {
    const messages: ResponseMessage[] = [];
    for (let i = 1; i <= 10; i += 1) {
      messages.push(msg(`c${i}`, "CUSTOMER", 0), msg(`c${i}`, "STAFF", i * 3)); // waits 3, 6, … 30 minutes
    }
    const group = buildResponseTimeStats(messages, 15, NOW).groups[0];
    expect(group.answered).toBe(10);
    expect(group.medianMs).toBe(15 * MINUTE); // nearest rank: 5th of 10
    expect(group.slowestTenthMs).toBe(27 * MINUTE); // nearest rank: 9th of 10
    expect(group.withinTargetPercent).toBe(50); // 3, 6, 9, 12, 15 are within 15 minutes
  });

  it("returns empty results for no messages", () => {
    expect(buildResponseTimeStats([], 15, NOW)).toEqual({ targetMinutes: 15, groups: [], waitingNow: [] });
  });

  it("counts one waiting customer per conversation", () => {
    const stats = buildResponseTimeStats([msg("c1", "CUSTOMER", 0), msg("c1", "CUSTOMER", 3), msg("c2", "CUSTOMER", 1)], 15, NOW);
    expect(stats.waitingNow).toEqual([{ channel: "MESSENGER", count: 2 }]);
  });
});
