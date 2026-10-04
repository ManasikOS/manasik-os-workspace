import { describe, expect, it } from "vitest";

import { STAFF_ROLES, type StaffRole } from "@/lib/access/departure-groups-access";
import { viewForQueue } from "@/lib/inbox/views";
import {
  buildInboxOutcomeCards,
  formatOutcomeValue,
  metricKeysReadingFrom,
} from "./inbox-outcome-cards";
import { INBOX_OUTCOME_METRICS, computeInboxOutcomes, inboxOutcomeMetricsVisibleTo } from "./inbox-outcomes";

const ROLES: readonly StaffRole[] = STAFF_ROLES;

const NOW = "2026-10-01T10:00:00.000Z";

function computed(overrides: Partial<Parameters<typeof computeInboxOutcomes>[0]> = {}) {
  return computeInboxOutcomes({
    agencyId: "agency-a",
    nowIso: NOW,
    windowDays: 30,
    queueCounts: { SLA_BREACHED: 4, UNASSIGNED: 0 },
    kpiDays: [],
    resolvedReviews: [],
    resolvedReviewsTruncated: false,
    openBlockingReviews: 2,
    ...overrides,
  });
}

describe("role matrix", () => {
  it.each(ROLES)("%s sees exactly the metrics the contract allows, and nothing else", (role) => {
    const cards = buildInboxOutcomeCards({ role, values: computed() });
    expect(cards.map((card) => card.key).sort()).toEqual(inboxOutcomeMetricsVisibleTo(role).map((metric) => metric.key).sort());
  });

  it("never gives a role a card whose audience it is not allowed", () => {
    for (const role of ROLES) {
      const owner = role === "ADMIN" || role === "CEO";
      for (const card of buildInboxOutcomeCards({ role, values: computed() })) {
        if (card.audience === "OWNER") expect(owner).toBe(true);
      }
    }
  });

  it("gives a role without Inbox access no cards at all", () => {
    const noInbox = ROLES.filter((role) => inboxOutcomeMetricsVisibleTo(role).length === 0);
    for (const role of noInbox) expect(buildInboxOutcomeCards({ role, values: computed() })).toEqual([]);
  });

  it("keeps cost and quality cards away from non-owner roles", () => {
    const nonOwner = buildInboxOutcomeCards({ role: "MARKETING", values: computed() });
    expect(nonOwner.some((card) => card.audience === "OWNER")).toBe(false);
  });
});

describe("card states", () => {
  it("shows a count with its drill-down view", () => {
    const card = buildInboxOutcomeCards({ role: "ADMIN", values: computed() }).find((entry) => entry.key === "OVERDUE_CONVERSATIONS");
    expect(card).toMatchObject({ state: "VALUE", displayValue: "4", drillDownView: viewForQueue("SLA_BREACHED") });
  });

  it("shows zero as a real zero for a queue that was read", () => {
    const card = buildInboxOutcomeCards({ role: "ADMIN", values: computed() }).find((entry) => entry.key === "UNASSIGNED_CONVERSATIONS");
    expect(card).toMatchObject({ state: "VALUE", displayValue: "0" });
  });

  it("marks a blocked metric not measurable with its reason and no number", () => {
    const blocked = INBOX_OUTCOME_METRICS.find((metric) => metric.status === "BLOCKED" && metric.audience === "INBOX");
    expect(blocked).toBeDefined();
    const card = buildInboxOutcomeCards({ role: "ADMIN", values: computed() }).find((entry) => entry.key === blocked!.key);
    expect(card).toMatchObject({ state: "NOT_MEASURABLE", displayValue: null, drillDownView: null });
    expect(card?.note).toBeTruthy();
  });

  it("marks a metric with no denominator as no data, not zero", () => {
    const card = buildInboxOutcomeCards({ role: "ADMIN", values: computed() }).find((entry) => entry.key === "S0_SKIP_RATE");
    expect(card).toMatchObject({ state: "NO_DATA", displayValue: null });
  });

  it("marks a metric whose source could not be read as unavailable, not no data", () => {
    const values = computed({ queueCounts: {} });
    const unreadable = metricKeysReadingFrom(["conversation_queue_membership"], INBOX_OUTCOME_METRICS);
    const card = buildInboxOutcomeCards({ role: "ADMIN", values, unreadableMetricKeys: unreadable }).find((entry) => entry.key === "OVERDUE_CONVERSATIONS");
    expect(card).toMatchObject({ state: "UNAVAILABLE", displayValue: null });
  });

  it("says when a value covers only part of the period", () => {
    const resolvedReviews = [{ kind: "PAYMENT_CLAIM", createdAt: "2026-09-30T09:00:00.000Z", resolvedAt: "2026-09-30T09:10:00.000Z" }];
    const values = computed({ resolvedReviews, resolvedReviewsTruncated: true });
    const card = buildInboxOutcomeCards({ role: "ADMIN", values }).find((entry) => entry.key === "FINANCE_REVIEW_TIME_P50_SECONDS");
    expect(card).toMatchObject({ state: "VALUE", partial: true });
    expect(card?.note).toMatch(/part of this period/i);
  });

  it("only offers drill-downs for the counts that open a real queue view", () => {
    for (const card of buildInboxOutcomeCards({ role: "ADMIN", values: computed() })) {
      if (card.drillDownView) expect(card.state === "VALUE" || card.state === "UNAVAILABLE" || card.state === "NO_DATA").toBe(true);
    }
  });
});

describe("formatOutcomeValue", () => {
  it("formats each unit in plain language", () => {
    expect(formatOutcomeValue("COUNT", 12)).toBe("12");
    expect(formatOutcomeValue("RATIO", 0.1834)).toBe("18.3%");
    expect(formatOutcomeValue("USD", 0.0421)).toBe("$0.0421");
    expect(formatOutcomeValue("USD", 12.5)).toBe("$12.50");
    expect(formatOutcomeValue("SECONDS", 45)).toBe("45 sec");
    expect(formatOutcomeValue("SECONDS", 600)).toBe("10 min");
    expect(formatOutcomeValue("SECONDS", 7200)).toBe("2 hr");
  });
});

describe("cards carry no content", () => {
  it("has only the declared card fields, so no row, customer or document value can ride along", () => {
    const allowed = ["audience", "basis", "definition", "displayValue", "drillDownLabel", "drillDownView", "family", "key", "label", "note", "partial", "state", "unit"];
    for (const card of buildInboxOutcomeCards({ role: "ADMIN", values: computed() })) {
      expect(Object.keys(card).sort()).toEqual(allowed);
    }
  });
});
