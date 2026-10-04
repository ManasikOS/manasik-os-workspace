import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { STAFF_ROLES } from "@/lib/access/departure-groups-access";
import { viewForQueue } from "@/lib/inbox/views";
import { INBOX_OUTCOME_METRICS, inboxOutcomeMetricsVisibleTo } from "@/lib/metrics/inbox-outcomes";

import { loadCommercialRecords, loadInboxOutcomeCardsForRole, loadInboxOutcomes } from "./inbox-commercial-repository";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NOW = new Date("2026-09-20T10:00:00.000Z");

type Row = Record<string, unknown>;

/** Two agencies in one in-memory database. A read only returns rows when it filtered by agency, exactly like RLS plus the explicit filter. */
function twoAgencyDb(tables: Record<string, Row[]>, options: { failTable?: string; limitCapture?: number[] } = {}) {
  const reads: Array<{ table: string; filters: Array<[string, unknown]>; head: boolean }> = [];
  const db = {
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      const tests: Array<(row: Row) => boolean> = [];
      let head = false;
      let limit: number | null = null;
      const query: Record<string, unknown> = {
        select: (_columns: string, config?: { head?: boolean }) => {
          head = Boolean(config?.head);
          return query;
        },
        eq: (column: string, value: unknown) => (filters.push([column, value]), tests.push((row) => row[column] === value), query),
        in: (column: string, values: unknown[]) => (filters.push([column, values]), tests.push((row) => values.includes(row[column])), query),
        gte: (column: string, value: string) => (filters.push([column, value]), tests.push((row) => String(row[column]) >= value), query),
        limit: (count: number) => ((limit = count), options.limitCapture?.push(count), query),
        then: (resolve: (value: unknown) => unknown) => {
          reads.push({ table, filters, head });
          if (options.failTable === table) return resolve({ data: null, count: null, error: { message: "boom" } });
          const matched = (tables[table] ?? []).filter((row) => tests.every((test) => test(row)));
          const rows = limit === null ? matched : matched.slice(0, limit);
          return resolve({ data: head ? null : rows, count: head ? matched.length : null, error: null });
        },
      };
      return query;
    },
  };
  return { db: db as never, reads };
}

const member = (agency: string, queue: string, id: string): Row => ({ agency_id: agency, queue_code: queue, conversation_id: id });
const review = (agency: string, kind: string, status: string, severity: string, createdAt: string, resolvedAt: string | null): Row => ({ agency_id: agency, kind, status, severity, created_at: createdAt, resolved_at: resolvedAt });

const fixture = {
  conversation_queue_membership: [
    member(A, "SLA_BREACHED", "a1"), member(A, "SLA_BREACHED", "a2"), member(A, "UNASSIGNED", "a3"), member(A, "QUOTE_SENT", "a4"),
    member(B, "SLA_BREACHED", "b1"), member(B, "SLA_BREACHED", "b2"), member(B, "SLA_BREACHED", "b3"), member(B, "UNASSIGNED", "b4"),
  ],
  inbox_intelligence_kpis_daily: [
    { agency_id: A, day: "2026-09-19", gate_evaluated: 10, gate_skipped: 4, ai_cost_usd: "0.5", conversations_enriched: 2 },
    { agency_id: A, day: "2026-08-01", gate_evaluated: 999, gate_skipped: 999, ai_cost_usd: "99", conversations_enriched: 99 },
    { agency_id: B, day: "2026-09-19", gate_evaluated: 500, gate_skipped: 5, ai_cost_usd: "50", conversations_enriched: 10 },
  ],
  conversation_interventions: [
    review(A, "PAYMENT_CLAIM", "RESOLVED", "BLOCK", "2026-09-19T08:00:00Z", "2026-09-19T09:00:00Z"),
    review(A, "BANK_DETAIL_MISMATCH", "RESOLVED", "BLOCK", "2026-09-19T08:00:00Z", "2026-09-19T08:30:00Z"),
    review(A, "COMPLAINT", "RESOLVED", "REVIEW", "2026-09-19T08:00:00Z", "2026-09-19T08:05:00Z"),
    review(A, "PAYMENT_CLAIM", "OPEN", "BLOCK", "2026-09-19T08:00:00Z", null),
    review(A, "COMPLAINT", "ACKNOWLEDGED", "REVIEW", "2026-09-19T08:00:00Z", null),
    review(B, "PAYMENT_CLAIM", "RESOLVED", "BLOCK", "2026-09-19T08:00:00Z", "2026-09-19T20:00:00Z"),
    review(B, "PAYMENT_CLAIM", "OPEN", "BLOCK", "2026-09-19T08:00:00Z", null),
    review(B, "PAYMENT_CLAIM", "OPEN", "BLOCK", "2026-09-19T08:00:00Z", null),
  ],
};

describe("loadInboxOutcomes", () => {
  it("reconciles every queue count to the membership rows a drill-down would open, for the caller's agency only", async () => {
    const { db } = twoAgencyDb(fixture);
    const { values } = await loadInboxOutcomes(db, A, { now: NOW, windowDays: 30 });
    const rowsFor = (queue: string, agency: string) => fixture.conversation_queue_membership.filter((row) => row.agency_id === agency && row.queue_code === queue).length;
    expect(values.OVERDUE_CONVERSATIONS.value).toBe(rowsFor("SLA_BREACHED", A));
    expect(values.OVERDUE_CONVERSATIONS.value).toBe(2);
    expect(values.UNASSIGNED_CONVERSATIONS.value).toBe(1);
    expect(values.QUOTE_SENT_CONVERSATIONS.value).toBe(1);
    expect(values.NEW_ENQUIRY_CONVERSATIONS.value).toBe(0);
    const other = (await loadInboxOutcomes(twoAgencyDb(fixture).db, B, { now: NOW, windowDays: 30 })).values;
    expect(other.OVERDUE_CONVERSATIONS.value).toBe(rowsFor("SLA_BREACHED", B));
    expect(other.OVERDUE_CONVERSATIONS.value).toBe(3);
  });

  it("filters every single read by the caller's agency", async () => {
    const { db, reads } = twoAgencyDb(fixture);
    await loadInboxOutcomes(db, A, { now: NOW, windowDays: 30 });
    expect(reads.length).toBeGreaterThan(5);
    for (const read of reads) expect(read.filters).toContainEqual(["agency_id", A]);
  });

  it("counts queues with a head-only count, never by pulling the rows", async () => {
    const { db, reads } = twoAgencyDb(fixture);
    await loadInboxOutcomes(db, A, { now: NOW, windowDays: 30 });
    const queueReads = reads.filter((read) => read.table === "conversation_queue_membership");
    expect(queueReads.length).toBe(new Set(INBOX_OUTCOME_METRICS.flatMap((metric) => (metric.drillDown.kind === "QUEUE" ? [metric.drillDown.queue] : []))).size);
    expect(queueReads.every((read) => read.head)).toBe(true);
  });

  it("reconciles AI cost and skip rate to the daily rows inside the window, excluding other days and agencies", async () => {
    const { db } = twoAgencyDb(fixture);
    const { values } = await loadInboxOutcomes(db, A, { now: NOW, windowDays: 30 });
    expect(values.S0_SKIP_RATE).toMatchObject({ numerator: 4, denominator: 10, value: 0.4 });
    expect(values.AI_COST_PER_ENRICHED_CONVERSATION_USD).toMatchObject({ numerator: 0.5, denominator: 2, value: 0.25 });
  });

  it("reconciles review times and the open blocking count to the review rows", async () => {
    const { db } = twoAgencyDb(fixture);
    const { values } = await loadInboxOutcomes(db, A, { now: NOW, windowDays: 30 });
    // Two payment-type reviews resolved: 60 and 30 minutes. The complaint and the other agency's review are excluded.
    expect(values.FINANCE_REVIEW_TIME_P50_SECONDS).toMatchObject({ denominator: 2, value: 30 * 60 });
    expect(values.FINANCE_REVIEW_TIME_P95_SECONDS.value).toBe(60 * 60);
    // Agency A has exactly one open BLOCK review; agency B's two are not counted.
    expect(values.OPEN_BLOCKING_REVIEWS.value).toBe(1);
  });

  it("marks a source that could not be read as no data and lists the failure, instead of failing everything or showing zero", async () => {
    const { db } = twoAgencyDb(fixture, { failTable: "inbox_intelligence_kpis_daily" });
    const { values, failures } = await loadInboxOutcomes(db, A, { now: NOW, windowDays: 30 });
    expect(failures).toEqual(["inbox_intelligence_kpis_daily"]);
    expect(values.S0_SKIP_RATE).toMatchObject({ status: "NO_DATA", value: null });
    expect(values.OVERDUE_CONVERSATIONS).toMatchObject({ status: "OK", value: 2 });
  });

  it("marks the review durations partial when the bounded read was cut short", async () => {
    const many = Array.from({ length: 6 }, (_, index) => review(A, "PAYMENT_CLAIM", "RESOLVED", "BLOCK", "2026-09-19T08:00:00Z", `2026-09-19T08:0${index + 1}:00Z`));
    const { db } = twoAgencyDb({ ...fixture, conversation_interventions: many });
    const { values } = await loadInboxOutcomes(db, A, { now: NOW, windowDays: 30, reviewRowLimit: 5 });
    expect(values.FINANCE_REVIEW_TIME_P50_SECONDS.partial).toBe(true);
    expect(values.FINANCE_REVIEW_TIME_P50_SECONDS.denominator).toBe(5);
  });

  it("never reads message, attachment or document tables", async () => {
    const { db, reads } = twoAgencyDb(fixture);
    await loadInboxOutcomes(db, A, { now: NOW, windowDays: 30 });
    const tables = new Set(reads.map((read) => read.table));
    expect([...tables].sort()).toEqual(["conversation_interventions", "conversation_queue_membership", "inbox_intelligence_kpis_daily"]);
  });

  it("clamps the window to a sensible range", async () => {
    const { db, reads } = twoAgencyDb(fixture);
    await loadInboxOutcomes(db, A, { now: NOW, windowDays: 100_000 });
    const kpiRead = reads.find((read) => read.table === "inbox_intelligence_kpis_daily")!;
    const gte = kpiRead.filters.find(([column]) => column === "day")![1] as string;
    expect(gte >= "2025-09-20").toBe(true);
  });
});

describe("loadInboxOutcomeCardsForRole (OUT-02)", () => {
  it("builds exactly the cards each role may see, for every role", async () => {
    for (const role of STAFF_ROLES) {
      const { cards } = await loadInboxOutcomeCardsForRole(twoAgencyDb(fixture).db, A, role, { now: NOW });
      expect(cards.map((card) => card.key).sort()).toEqual(inboxOutcomeMetricsVisibleTo(role).map((metric) => metric.key).sort());
    }
  });

  it("reads nothing at all for a role that may not open the Inbox", async () => {
    const noInbox = STAFF_ROLES.filter((role) => inboxOutcomeMetricsVisibleTo(role).length === 0);
    for (const role of noInbox) {
      const { db, reads } = twoAgencyDb(fixture);
      expect((await loadInboxOutcomeCardsForRole(db, A, role, { now: NOW })).cards).toEqual([]);
      expect(reads).toHaveLength(0);
    }
  });

  it("keeps owner-only cost and quality cards, and Finance-only payment cards, out of other roles' cards", async () => {
    const cardsFor = async (role: (typeof STAFF_ROLES)[number]) => (await loadInboxOutcomeCardsForRole(twoAgencyDb(fixture).db, A, role, { now: NOW })).cards;
    const admin = await cardsFor("ADMIN");
    const finance = await cardsFor("FINANCE");
    expect(admin.some((card) => card.audience === "OWNER")).toBe(true);
    expect(finance.some((card) => card.audience === "OWNER")).toBe(false);
    expect(finance.some((card) => card.key === "PAYMENT_DISCUSSION_CONVERSATIONS")).toBe(true);
  });

  it("every count card's drill-down view opens exactly the rows its count was made from", async () => {
    const { cards } = await loadInboxOutcomeCardsForRole(twoAgencyDb(fixture).db, A, "ADMIN", { now: NOW });
    let checked = 0;
    for (const card of cards) {
      const metric = INBOX_OUTCOME_METRICS.find((entry) => entry.key === card.key)!;
      if (metric.drillDown.kind !== "QUEUE") continue;
      const queue = metric.drillDown.queue;
      expect(card.drillDownView).toBe(viewForQueue(queue));
      const rows = fixture.conversation_queue_membership.filter((row) => row.agency_id === A && row.queue_code === queue).length;
      expect(card).toMatchObject({ state: "VALUE", displayValue: String(rows) });
      checked += 1;
    }
    expect(checked).toBeGreaterThan(8);
  });

  it("shows an unreadable queue source as could not be read, never as zero", async () => {
    const { db } = twoAgencyDb(fixture, { failTable: "conversation_queue_membership" });
    const { cards, failures } = await loadInboxOutcomeCardsForRole(db, A, "ADMIN", { now: NOW });
    expect(failures).toContain("conversation_queue_membership");
    const overdue = cards.find((card) => card.key === "OVERDUE_CONVERSATIONS");
    expect(overdue).toMatchObject({ state: "UNAVAILABLE", displayValue: null });
    expect(cards.find((card) => card.key === "S0_SKIP_RATE")?.state).not.toBe("UNAVAILABLE");
  });
});

// ── MI3.4: the records the commercial stage is worked out from (pre-existing tests, kept unchanged) ──────────────

const AGENCY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

/** Records every filter per table, and answers from a fixed set of rows. */
function fakeDb(rows: Record<string, unknown>) {
  const filters: Array<[string, string, unknown]> = [];
  const db = {
    from(table: string) {
      const chain = {
        select: () => chain,
        eq: (column: string, value: unknown) => (filters.push([table, column, value]), chain),
        maybeSingle: async () => ({ data: rows[table] ?? null, error: null }),
        then: (resolve: (value: unknown) => unknown) => resolve({ data: rows[table] ?? [], error: null }),
      };
      return chain;
    },
  };
  return { db: db as never, filters };
}

describe("loadCommercialRecords", () => {
  it("has nothing to report for a conversation with no lead", async () => {
    const { db } = fakeDb({ conversations: { lead_id: null } });
    expect(await loadCommercialRecords(db, AGENCY, "c1")).toEqual({ leadStage: null, booking: null, quoteStatuses: [] });
  });

  it("reads the lead's stage, its booking and every quote, and names the agency on every read", async () => {
    const { db, filters } = fakeDb({
      conversations: { lead_id: "lead-1" },
      leads: { stage: "PROPOSAL_SENT", booking_id: "bk-1" },
      lead_quotes: [{ status: "SENT" }, { status: "DRAFT" }],
      departure_group_bookings: { booking_status: "HELD" },
    });
    expect(await loadCommercialRecords(db, AGENCY, "c1")).toEqual({ leadStage: "PROPOSAL_SENT", booking: { status: "HELD" }, quoteStatuses: ["SENT", "DRAFT"] });
    for (const table of ["conversations", "leads", "lead_quotes", "departure_group_bookings"]) expect(filters, table).toContainEqual([table, "agency_id", AGENCY]);
  });

  it("a lead that has vanished reads as no records rather than an error", async () => {
    const { db } = fakeDb({ conversations: { lead_id: "lead-1" }, leads: null, lead_quotes: [] });
    expect(await loadCommercialRecords(db, AGENCY, "c1")).toEqual({ leadStage: null, booking: null, quoteStatuses: [] });
  });
});
