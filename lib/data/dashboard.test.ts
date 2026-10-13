import { describe, expect, it } from "vitest";

import type { AdminKpi } from "@/lib/types/dashboard";

import type { ExecutiveSummary } from "@/lib/data/reports";

import { activityTypeFor, buildKpiCandidates, kpiTrendFromPercent, selectKpis } from "./dashboard";

function kpi(id: string): AdminKpi {
  return { id, title: id, value: "1", destination: `/${id}` };
}

function built(...ids: string[]): Record<string, AdminKpi> {
  return Object.fromEntries(ids.map((id) => [id, kpi(id)]));
}

describe("selectKpis", () => {
  it("returns the tiles in the role's order, not the order they were built in", () => {
    const result = selectKpis(["b", "a", "c"], built("a", "b", "c"), 6);
    expect(result.map((k) => k.id)).toEqual(["b", "a", "c"]);
  });

  it("drops a tile that was not built and lets the next one fill the slot", () => {
    const result = selectKpis(["a", "missing", "b", "c"], built("a", "b", "c"), 2);
    expect(result.map((k) => k.id)).toEqual(["a", "b"]);
  });

  it("never returns more than the cap", () => {
    const ids = ["a", "b", "c", "d", "e", "f", "g", "h"];
    expect(selectKpis(ids, built(...ids), 6)).toHaveLength(6);
  });

  it("ignores a built tile the role did not ask for", () => {
    expect(selectKpis(["a"], built("a", "z"), 6).map((k) => k.id)).toEqual(["a"]);
  });

  it("returns nothing when nothing the role asked for could be built", () => {
    expect(selectKpis(["a", "b"], {}, 6)).toEqual([]);
  });
});

/* ── buildKpiCandidates ───────────────────────────────────────────────────── */

type Candidates = Parameters<typeof buildKpiCandidates>[0];
type Group = Candidates["groups"][number];

function group(overrides: Partial<Group> = {}): Group {
  return {
    groupStatus: "OPEN",
    pilgrimCount: 10,
    daysUntilDeparture: 20,
    readinessStatus: "READY",
    bookedSeats: 10,
    capacity: 40,
    ...overrides,
  } as Group;
}

function summary(overrides: Partial<ExecutiveSummary> = {}): ExecutiveSummary {
  return {
    revenue: 3_000_000,
    revenueByCurrency: { LKR: 3_000_000 },
    revenueDeltaPercent: 12.4,
    bookingsCount: 5,
    bookingsDeltaPercent: null,
    pilgrimsCount: 20,
    activeGroupsCount: 2,
    collectionRatePercent: null,
    avgGroupReadinessPercent: 80,
    atRiskGroupCount: 0,
    projectedGrossMarginPercent: 40,
    ...overrides,
  };
}

function input(overrides: Partial<Candidates> = {}): Candidates {
  return {
    groups: [group()],
    outstandingBalance: 0,
    periodLabel: "This quarter",
    newInquiries: null,
    collections: null,
    groupsAtRisk: 0,
    supplierConfirmationsPending: 0,
    openTaskCount: 0,
    myOpenTaskCount: null,
    overdueBalance: null,
    refundsPending: null,
    executive: null,
    visaQueue: null,
    ...overrides,
  };
}

describe("buildKpiCandidates - operational tiles", () => {
  it("states groups at risk, supplier confirmations and open tasks exactly as Operations derived them", () => {
    const k = buildKpiCandidates(input({ groupsAtRisk: 3, supplierConfirmationsPending: 7, openTaskCount: 12 }));
    expect(k["groups-at-risk"]?.value).toBe("3");
    expect(k["supplier-confirmations-pending"]?.value).toBe("7");
    expect(k["open-tasks"]?.value).toBe("12");
  });

  it("builds My open tasks only when the person's tasks were read - a real zero is a tile, an unread list is not", () => {
    expect(buildKpiCandidates(input({ myOpenTaskCount: 0 }))["my-open-tasks"]?.value).toBe("0");
    expect(buildKpiCandidates(input({ myOpenTaskCount: null }))["my-open-tasks"]).toBeUndefined();
  });

  it("counts My groups from active groups only", () => {
    const k = buildKpiCandidates(
      input({ groups: [group(), group(), group({ groupStatus: "COMPLETED" }), group({ groupStatus: "CANCELLED" })] }),
    );
    expect(k["my-groups"]?.value).toBe("2");
  });

  it("weights average seat fill by capacity and ignores departed and zero-capacity groups", () => {
    const k = buildKpiCandidates(
      input({
        groups: [
          group({ bookedSeats: 10, capacity: 40, daysUntilDeparture: 10 }),
          group({ bookedSeats: 30, capacity: 40, daysUntilDeparture: 20 }),
          group({ bookedSeats: 40, capacity: 40, daysUntilDeparture: -1 }),
          group({ bookedSeats: 0, capacity: 0, daysUntilDeparture: 5 }),
        ],
      }),
    );
    expect(k["avg-seat-fill"]?.value).toBe("50%");
  });

  it("omits average seat fill when no group has capacity to measure against", () => {
    expect(buildKpiCandidates(input({ groups: [] }))["avg-seat-fill"]).toBeUndefined();
  });
});

describe("buildKpiCandidates - finance tiles", () => {
  it("omits overdue and refunds when their reads did not happen, and shows a real zero when they did", () => {
    const absent = buildKpiCandidates(input());
    expect(absent["overdue-balance"]).toBeUndefined();
    expect(absent["refunds-pending"]).toBeUndefined();

    const zero = buildKpiCandidates(input({ overdueBalance: 0, refundsPending: 0 }));
    expect(zero["overdue-balance"]?.value).toBe("LKR 0");
    expect(zero["refunds-pending"]?.value).toBe("0");
  });

  it("formats the overdue balance like every other money tile", () => {
    expect(buildKpiCandidates(input({ overdueBalance: 2_000_000 }))["overdue-balance"]?.value).toBe("LKR 2M");
  });
});

describe("buildKpiCandidates - revenue and margin", () => {
  it("omits both when the overview was not read", () => {
    const k = buildKpiCandidates(input({ executive: null }));
    expect(k.revenue).toBeUndefined();
    expect(k["gross-margin"]).toBeUndefined();
  });

  it("shows revenue with the Reports delta", () => {
    const k = buildKpiCandidates(input({ executive: { summary: summary(), showMargin: true } }));
    expect(k.revenue?.value).toBe("LKR 3M");
    expect(k.revenue?.trend).toBe("+12% vs previous period");
    expect(k.revenue?.trendType).toBe("positive");
  });

  it("shows no revenue badge when there is no prior-period baseline", () => {
    const k = buildKpiCandidates(input({ executive: { summary: summary({ revenueDeltaPercent: null }), showMargin: true } }));
    expect(k.revenue?.trend).toBeUndefined();
  });

  it("omits revenue rather than adding across currencies", () => {
    const mixed = summary({ revenueByCurrency: { LKR: 1_000_000, SAR: 50_000 } });
    expect(buildKpiCandidates(input({ executive: { summary: mixed, showMargin: true } })).revenue).toBeUndefined();
  });

  it("labels a single non-LKR currency with its own code", () => {
    const usd = summary({ revenue: 1_500_000, revenueByCurrency: { USD: 1_500_000 } });
    expect(buildKpiCandidates(input({ executive: { summary: usd, showMargin: true } })).revenue?.value).toBe("USD 1.5M");
  });

  it("shows gross margin as a percentage and flags it when below target", () => {
    const healthy = buildKpiCandidates(input({ executive: { summary: summary({ projectedGrossMarginPercent: 40 }), showMargin: true } }));
    expect(healthy["gross-margin"]?.value).toBe("40%");
    expect(healthy["gross-margin"]?.trendType).not.toBe("negative");

    const thin = buildKpiCandidates(input({ executive: { summary: summary({ projectedGrossMarginPercent: 2 }), showMargin: true } }));
    expect(thin["gross-margin"]?.value).toBe("2%");
    expect(thin["gross-margin"]?.trendType).toBe("negative");
  });

  it("renders an unknown margin as an em dash, never 0%", () => {
    const k = buildKpiCandidates(input({ executive: { summary: summary({ projectedGrossMarginPercent: null }), showMargin: true } }));
    expect(k["gross-margin"]?.value).toBe("\u2014");
  });

  it("omits gross margin entirely for a role that may not see cost and margin", () => {
    const k = buildKpiCandidates(input({ executive: { summary: summary(), showMargin: false } }));
    expect(k["gross-margin"]).toBeUndefined();
    expect(k.revenue).toBeDefined();
  });
});

describe("kpiTrendFromPercent", () => {
  it("words a delta the way the other KPI badges do", () => {
    expect(kpiTrendFromPercent(12.4, "previous period")).toEqual({ trend: "+12% vs previous period", trendType: "positive" });
    expect(kpiTrendFromPercent(-8, "previous period")).toEqual({ trend: "-8% vs previous period", trendType: "negative" });
    expect(kpiTrendFromPercent(0.2, "previous period")).toEqual({ trend: "Flat vs previous period", trendType: "neutral" });
    expect(kpiTrendFromPercent(null, "previous period")).toBeUndefined();
  });
});

describe("activityTypeFor", () => {
  it("maps the group log's entity types to the dashboard's activity categories", () => {
    expect(activityTypeFor("PAYMENT")).toBe("payment");
    expect(activityTypeFor("DOCUMENT")).toBe("document");
    expect(activityTypeFor("VISA")).toBe("visa");
  });

  it("files every other entity type under operations", () => {
    for (const entity of ["GROUP", "FLIGHT", "ACCOMMODATION", "ROOM", "TRANSPORT", "BOOKING", "PILGRIM", "TASK", "READINESS_ITEM", "SOMETHING_NEW"]) {
      expect(activityTypeFor(entity)).toBe("operations");
    }
  });
});

describe("buildKpiCandidates - visa", () => {
  it("omits Visa Pending when the visa queue was not read", () => {
    expect(buildKpiCandidates(input({ visaQueue: null }))["visa-pending"]).toBeUndefined();
  });

  it("shows applications in flight, and how many need rework", () => {
    const k = buildKpiCandidates(
      input({ visaQueue: { readyToSubmit: 4, submittedPending: 3, visaIssues: 2, issued: 9 } }),
    );
    expect(k["visa-pending"]?.value).toBe("7");
    expect(k["visa-pending"]?.supportingText).toBe("2 need rework");
    expect(k["visa-pending"]?.destination).toBe("/visa");
  });

  it("shows a real zero when the queue was read and is empty", () => {
    const k = buildKpiCandidates(
      input({ visaQueue: { readyToSubmit: 0, submittedPending: 0, visaIssues: 0, issued: 0 } }),
    );
    expect(k["visa-pending"]?.value).toBe("0");
  });
});
