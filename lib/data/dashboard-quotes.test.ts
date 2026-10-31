import { describe, expect, it } from "vitest";

import { buildQuotePipeline, QUOTE_PIPELINE_ROW_LIMIT } from "./dashboard-quotes";
import type { QuoteDashboardFacts } from "./leads-repository";

const NOW = "2026-10-13T09:00:00.000Z";
const DAY = 24 * 60 * 60 * 1000;
const inDays = (d: number) => new Date(Date.parse(NOW) + d * DAY).toISOString();

let seq = 0;

function quote(overrides: Partial<QuoteDashboardFacts> = {}): QuoteDashboardFacts {
  seq += 1;
  return {
    id: `q${seq}`,
    reference: `Q-${seq}`,
    status: "SENT",
    valid_until: inDays(10),
    sent_at: inDays(-1),
    created_at: inDays(-2),
    ...overrides,
  } as QuoteDashboardFacts;
}

describe("buildQuotePipeline", () => {
  it("counts each stage of the pipeline", () => {
    const data = buildQuotePipeline(
      [
        quote({ status: "DRAFT" }),
        quote({ status: "DRAFT" }),
        quote({ status: "PENDING_APPROVAL" }),
        quote({ status: "SENT" }),
        quote({ status: "VIEWED" }),
        quote({ status: "ACCEPTED" }),
        quote({ status: "DECLINED" }),
      ],
      NOW,
    );
    expect(data.counts).toEqual({ drafts: 2, awaitingApproval: 1, awaitingReply: 2, expiringSoon: 0, accepted: 1 });
    expect(data.open).toBe(5);
    expect(data.total).toBe(7);
  });

  it("uses the Quotes page's own accept rate: accepted over every quote", () => {
    const data = buildQuotePipeline(
      [quote({ status: "ACCEPTED" }), quote({ status: "SENT" }), quote({ status: "DECLINED" }), quote({ status: "EXPIRED" })],
      NOW,
    );
    expect(data.acceptRatePercent).toBe(25);
  });

  it("has no accept rate when there are no quotes, rather than 0%", () => {
    expect(buildQuotePipeline([], NOW).acceptRatePercent).toBeNull();
  });

  it("lists quotes about to lapse, soonest first, with the days left", () => {
    const data = buildQuotePipeline(
      [
        quote({ reference: "Q-LATER", status: "SENT", valid_until: inDays(2) }),
        quote({ reference: "Q-SOON", status: "VIEWED", valid_until: inDays(0.5) }),
        quote({ reference: "Q-FAR", status: "SENT", valid_until: inDays(9) }),
        quote({ reference: "Q-DRAFT", status: "DRAFT", valid_until: inDays(1) }),
      ],
      NOW,
    );
    expect(data.counts.expiringSoon).toBe(2);
    expect(data.expiring.map((q) => q.reference)).toEqual(["Q-SOON", "Q-LATER"]);
    expect(data.expiring[0].daysLeft).toBe(1);
  });

  it("does not list a quote that has already lapsed as expiring", () => {
    const data = buildQuotePipeline([quote({ status: "SENT", valid_until: inDays(-1) })], NOW);
    expect(data.counts.expiringSoon).toBe(0);
    expect(data.expiring).toEqual([]);
  });

  it("limits the list but still reports how many are expiring", () => {
    const many = Array.from({ length: QUOTE_PIPELINE_ROW_LIMIT + 3 }, (_, i) =>
      quote({ status: "SENT", valid_until: inDays(0.1 + i * 0.1) }),
    );
    const data = buildQuotePipeline(many, NOW);
    expect(data.expiring).toHaveLength(QUOTE_PIPELINE_ROW_LIMIT);
    expect(data.counts.expiringSoon).toBe(QUOTE_PIPELINE_ROW_LIMIT + 3);
  });

  it("carries no customer or price data", () => {
    const data = buildQuotePipeline(
      [{ ...quote({ status: "SENT", valid_until: inDays(1) }), total_lkr: 987654, full_name: "A. Customer" } as QuoteDashboardFacts],
      NOW,
    );
    const serialised = JSON.stringify(data);
    expect(serialised).not.toContain("987654");
    expect(serialised).not.toContain("A. Customer");
  });
});
