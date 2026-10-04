import { describe, expect, it } from "vitest";

import { STAFF_ROLES } from "@/lib/access/departure-groups-access";
import { INBOX_VIEWS, VIEW_QUEUE } from "@/lib/inbox/views";

import {
  INBOX_OUTCOME_METRICS,
  computeInboxOutcomes,
  getInboxOutcomeMetric,
  inboxOutcomeMetricsVisibleTo,
  percentileNearestRank,
  windowStartIso,
  type OutcomeSourceData,
} from "./inbox-outcomes";

const AGENCY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NOW = "2026-09-20T00:30:00.000Z";

const empty: OutcomeSourceData = {
  agencyId: AGENCY,
  nowIso: NOW,
  windowDays: 7,
  queueCounts: {},
  kpiDays: [],
  resolvedReviews: [],
  resolvedReviewsTruncated: false,
  openBlockingReviews: null,
};

const measurable = INBOX_OUTCOME_METRICS.filter((metric) => metric.status === "MEASURABLE");
const blocked = INBOX_OUTCOME_METRICS.filter((metric) => metric.status === "BLOCKED");

describe("the contract registry", () => {
  it("has unique keys and covers all four metric families", () => {
    const keys = INBOX_OUTCOME_METRICS.map((metric) => metric.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const family of ["OPERATIONAL", "COMMERCIAL", "SAFETY", "AI_QUALITY_COST"]) {
      expect(INBOX_OUTCOME_METRICS.some((metric) => metric.family === family && metric.status === "MEASURABLE")).toBe(true);
    }
  });

  it("makes every metric name its numerator, denominator, source tables, tenant scope, time basis and exclusions", () => {
    for (const metric of INBOX_OUTCOME_METRICS) {
      expect(metric.label.length).toBeGreaterThan(3);
      expect(metric.definition.length).toBeGreaterThan(20);
      expect(metric.numerator.length).toBeGreaterThan(5);
      expect(metric.denominator === null || metric.denominator.length > 5).toBe(true);
      expect(metric.sources.length).toBeGreaterThan(0);
      for (const source of metric.sources) {
        expect(source.table.length).toBeGreaterThan(2);
        expect(source.columns.length).toBeGreaterThan(0);
      }
      expect(metric.tenantScope).toBe("agency_id");
      expect(metric.timeBasis.length).toBeGreaterThan(10);
      expect(metric.exclusions.length).toBeGreaterThan(0);
    }
  });

  it("gives every measurable metric an exact drill-down onto its queue or reviewed event set", () => {
    for (const metric of measurable) {
      if (metric.drillDown.kind === "QUEUE") {
        expect(metric.drillDown.href).toMatch(/^\/inbox\?view=[a-z-]+$/);
        const view = new URL(metric.drillDown.href, "https://example.test").searchParams.get("view");
        expect(INBOX_VIEWS).toContain(view);
        expect(VIEW_QUEUE[view as (typeof INBOX_VIEWS)[number]]).toBe(metric.drillDown.queue);
      } else {
        expect(metric.drillDown.kind).toBe("EVENT_SET");
        if (metric.drillDown.kind === "EVENT_SET") {
          expect(metric.drillDown.source.length).toBeGreaterThan(2);
          expect(metric.drillDown.where.length).toBeGreaterThan(5);
        }
      }
    }
  });

  it("explains every blocked metric and names what blocks it, never inventing a number", () => {
    expect(blocked.length).toBeGreaterThan(5);
    for (const metric of blocked) {
      expect(metric.blockedBy && metric.blockedBy.length).toBeGreaterThan(15);
    }
    const blockedKeys = blocked.map((metric) => metric.key);
    expect(blockedKeys).toEqual(expect.arrayContaining(["FIRST_RESPONSE_TIME_P50_SECONDS", "ENQUIRY_TO_QUALIFIED_RATE", "NEVER_AUTONOMOUS_VIOLATIONS"]));
    const values = computeInboxOutcomes({ ...empty, queueCounts: { SLA_BREACHED: 3 } });
    for (const metric of blocked) expect(values[metric.key]).toMatchObject({ status: "BLOCKED", value: null });
  });

  it("never exposes message content, customer names or document fields", () => {
    const text = JSON.stringify(INBOX_OUTCOME_METRICS).toLowerCase();
    for (const forbidden of ["transcript_text", "\"content\"", "body", "full_name", "passport_number", "candidate_fields", "summary"]) {
      expect(text).not.toContain(forbidden);
    }
    expect(INBOX_OUTCOME_METRICS.every((metric) => metric.exposesContent === false)).toBe(true);
  });

  it("looks a metric up by key", () => {
    expect(getInboxOutcomeMetric("OVERDUE_CONVERSATIONS")?.family).toBe("OPERATIONAL");
    expect(getInboxOutcomeMetric("NOPE")).toBeNull();
  });
});

describe("queue count metrics", () => {
  it("report the queue's own count, so a drill-down opens exactly that many rows", () => {
    const values = computeInboxOutcomes({
      ...empty,
      queueCounts: { SLA_BREACHED: 4, NEARING_DEADLINE: 2, UNASSIGNED: 7, NEEDS_REPLY: 9, NEW_ENQUIRIES: 5, QUALIFIED: 3, QUOTE_SENT: 2, BOOKING_READY: 1, PAYMENT_DISCUSSIONS: 6, COMPLAINTS: 1, DOCUMENTS: 2, ESCALATIONS: 0 },
    });
    expect(values.OVERDUE_CONVERSATIONS).toMatchObject({ status: "OK", value: 4 });
    expect(values.UNASSIGNED_CONVERSATIONS).toMatchObject({ status: "OK", value: 7 });
    expect(values.AWAITING_REPLY_CONVERSATIONS).toMatchObject({ status: "OK", value: 9 });
    expect(values.QUOTE_SENT_CONVERSATIONS).toMatchObject({ status: "OK", value: 2 });
    // A real zero is a real answer, not "no data".
    expect(values.ESCALATED_CONVERSATIONS).toMatchObject({ status: "OK", value: 0 });
  });

  it("report no data, not zero, for a queue that was not loaded", () => {
    const values = computeInboxOutcomes({ ...empty, queueCounts: { UNASSIGNED: 1 } });
    expect(values.OVERDUE_CONVERSATIONS).toMatchObject({ status: "NO_DATA", value: null });
  });

  it("are stock counts as of now, and say so", () => {
    for (const metric of measurable.filter((entry) => entry.drillDown.kind === "QUEUE")) {
      expect(metric.valueBasis).toBe("NOW_SNAPSHOT");
      expect(metric.windowDays).toBeNull();
    }
  });
});

describe("AI cost and skip-rate metrics", () => {
  const day = (date: string, overrides = {}) => ({ day: date, gateEvaluated: 10, gateSkipped: 4, aiCostUsd: 0.5, conversationsEnriched: 5, ...overrides });

  it("divide the window's totals, not the average of daily ratios", () => {
    const values = computeInboxOutcomes({
      ...empty,
      kpiDays: [day("2026-09-19", { gateEvaluated: 10, gateSkipped: 5, aiCostUsd: 1, conversationsEnriched: 2 }), day("2026-09-20", { gateEvaluated: 90, gateSkipped: 9, aiCostUsd: 3, conversationsEnriched: 6 })],
    });
    expect(values.S0_SKIP_RATE).toMatchObject({ status: "OK", numerator: 14, denominator: 100, value: 0.14 });
    expect(values.AI_COST_PER_ENRICHED_CONVERSATION_USD).toMatchObject({ status: "OK", numerator: 4, denominator: 8, value: 0.5 });
  });

  it("return no data when the denominator is zero, never zero or NaN", () => {
    const values = computeInboxOutcomes({ ...empty, kpiDays: [day("2026-09-20", { gateEvaluated: 0, gateSkipped: 0, conversationsEnriched: 0, aiCostUsd: 0.2 })] });
    expect(values.S0_SKIP_RATE).toMatchObject({ status: "NO_DATA", value: null, denominator: 0 });
    expect(values.AI_COST_PER_ENRICHED_CONVERSATION_USD).toMatchObject({ status: "NO_DATA", value: null, denominator: 0 });
    expect(computeInboxOutcomes(empty).S0_SKIP_RATE).toMatchObject({ status: "NO_DATA", value: null });
  });

  it("use UTC days: the first day of the window is included and the day before is not", () => {
    // now 2026-09-20T00:30Z, 7 days => window starts 2026-09-14T00:00Z.
    const values = computeInboxOutcomes({ ...empty, kpiDays: [day("2026-09-13", { gateEvaluated: 1000, gateSkipped: 1000 }), day("2026-09-14", { gateEvaluated: 10, gateSkipped: 1 })] });
    expect(values.S0_SKIP_RATE).toMatchObject({ numerator: 1, denominator: 10 });
  });

  it("is a rate that stays between 0 and 1 even when skipped exceeds evaluated by a bad row", () => {
    const values = computeInboxOutcomes({ ...empty, kpiDays: [day("2026-09-20", { gateEvaluated: 2, gateSkipped: 5 })] });
    expect(values.S0_SKIP_RATE.value).toBeLessThanOrEqual(1);
  });
});

describe("review time metrics", () => {
  const review = (kind: string, minutes: number, resolvedAt = "2026-09-19T10:00:00.000Z") => ({
    kind,
    createdAt: new Date(new Date(resolvedAt).getTime() - minutes * 60_000).toISOString(),
    resolvedAt,
  });

  it("report median and p95 time to resolve a payment review", () => {
    const reviews = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((minutes) => review("PAYMENT_CLAIM", minutes));
    const values = computeInboxOutcomes({ ...empty, resolvedReviews: reviews });
    expect(values.FINANCE_REVIEW_TIME_P50_SECONDS).toMatchObject({ status: "OK", value: 50 * 60, denominator: 10 });
    expect(values.FINANCE_REVIEW_TIME_P95_SECONDS).toMatchObject({ status: "OK", value: 100 * 60 });
  });

  it("count only payment and bank-detail reviews resolved inside the window", () => {
    const values = computeInboxOutcomes({
      ...empty,
      resolvedReviews: [
        review("PAYMENT_CLAIM", 30),
        review("BANK_DETAIL_MISMATCH", 90),
        review("COMPLAINT", 5),
        review("PAYMENT_CLAIM", 999, "2026-09-13T23:59:59.000Z"),
        review("PAYMENT_CLAIM", 15, "2026-09-14T00:00:00.000Z"),
      ],
    });
    expect(values.FINANCE_REVIEW_TIME_P50_SECONDS).toMatchObject({ denominator: 3 });
  });

  it("ignore impossible durations instead of poisoning the median", () => {
    const values = computeInboxOutcomes({
      ...empty,
      resolvedReviews: [review("PAYMENT_CLAIM", 30), { kind: "PAYMENT_CLAIM", createdAt: "2026-09-19T11:00:00.000Z", resolvedAt: "2026-09-19T10:00:00.000Z" }, { kind: "PAYMENT_CLAIM", createdAt: "garbage", resolvedAt: "2026-09-19T10:00:00.000Z" }],
    });
    expect(values.FINANCE_REVIEW_TIME_P50_SECONDS).toMatchObject({ value: 1800, denominator: 1 });
  });

  it("return no data with no resolved reviews, and mark a truncated read as partial", () => {
    expect(computeInboxOutcomes(empty).FINANCE_REVIEW_TIME_P50_SECONDS).toMatchObject({ status: "NO_DATA", value: null });
    const partial = computeInboxOutcomes({ ...empty, resolvedReviews: [review("PAYMENT_CLAIM", 30)], resolvedReviewsTruncated: true });
    expect(partial.FINANCE_REVIEW_TIME_P50_SECONDS.partial).toBe(true);
    expect(computeInboxOutcomes({ ...empty, resolvedReviews: [review("PAYMENT_CLAIM", 30)] }).FINANCE_REVIEW_TIME_P50_SECONDS.partial).toBe(false);
  });

  it("report the open blocking-review count from the source", () => {
    expect(computeInboxOutcomes({ ...empty, openBlockingReviews: 3 }).OPEN_BLOCKING_REVIEWS).toMatchObject({ status: "OK", value: 3 });
    expect(computeInboxOutcomes(empty).OPEN_BLOCKING_REVIEWS).toMatchObject({ status: "NO_DATA", value: null });
  });
});

describe("windowStartIso and percentileNearestRank", () => {
  it("starts the window at UTC midnight of the first day", () => {
    expect(windowStartIso("2026-09-20T00:30:00.000Z", 7)).toBe("2026-09-14T00:00:00.000Z");
    expect(windowStartIso("2026-09-20T23:59:59.000Z", 1)).toBe("2026-09-20T00:00:00.000Z");
    expect(windowStartIso("2026-03-01T05:00:00.000Z", 2)).toBe("2026-02-28T00:00:00.000Z");
  });

  it("uses nearest-rank percentiles on the sorted values", () => {
    expect(percentileNearestRank([5, 1, 3, 2, 4], 50)).toBe(3);
    expect(percentileNearestRank([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
    expect(percentileNearestRank([7], 95)).toBe(7);
    expect(percentileNearestRank([], 50)).toBeNull();
  });
});

describe("who may see which metric", () => {
  it("shows AI cost and quality only to owners, and the Finance review time only to roles that can open the ledger", () => {
    const keysFor = (role: (typeof STAFF_ROLES)[number]) => new Set(inboxOutcomeMetricsVisibleTo(role).map((metric) => metric.key));
    expect(keysFor("ADMIN").has("AI_COST_PER_ENRICHED_CONVERSATION_USD")).toBe(true);
    expect(keysFor("CEO").has("AI_COST_PER_ENRICHED_CONVERSATION_USD")).toBe(true);
    for (const role of ["MARKETING", "OPERATIONS", "FINANCE", "VISA"] as const) expect(keysFor(role).has("AI_COST_PER_ENRICHED_CONVERSATION_USD")).toBe(false);
    expect(keysFor("FINANCE").has("FINANCE_REVIEW_TIME_P50_SECONDS")).toBe(true);
    expect(keysFor("MARKETING").has("FINANCE_REVIEW_TIME_P50_SECONDS")).toBe(false);
    expect(keysFor("OPERATIONS").has("OVERDUE_CONVERSATIONS")).toBe(true);
  });

  it("shows nothing to a role with no Inbox access", () => {
    expect(inboxOutcomeMetricsVisibleTo("GUIDE")).toEqual([]);
  });
});
