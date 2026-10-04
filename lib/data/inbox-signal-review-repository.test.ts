import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { listSignalsForReview, loadSignalPrecision, recordSignalVerdict } = await import("./inbox-signal-review-repository");

const AGENCY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SIGNAL = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const STAFF = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

type Call = { method: string; args: unknown[] };

/** A recording query builder: every chained call is logged, and the awaited / maybeSingle result is scripted. */
function recorder(result: { data: unknown; error: { message: string } | null }) {
  const calls: Call[] = [];
  const builder: Record<string, unknown> = new Proxy({}, {
    get: (_target, method: string) => {
      if (method === "then") return (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
      if (method === "maybeSingle") return async () => result;
      return (...args: unknown[]) => { calls.push({ method, args }); return builder; };
    },
  });
  return { db: { from: (table: string) => { calls.push({ method: "from", args: [table] }); return builder; } } as never, calls };
}
const eqOf = (calls: Call[], column: string) => calls.find((call) => call.method === "eq" && call.args[0] === column)?.args[1];

describe("recordSignalVerdict", () => {
  it("writes the verdict with the reviewer, scoped to the agency and to an unjudged signal", async () => {
    const { db, calls } = recorder({ data: { id: SIGNAL }, error: null });
    await recordSignalVerdict(db, { agencyId: AGENCY, signalId: SIGNAL, verdict: "WRONG", reviewerId: STAFF, now: new Date("2026-09-21T10:00:00Z") });
    expect(calls.find((call) => call.method === "update")?.args[0]).toEqual({ review_verdict: "WRONG", reviewed_by: STAFF, reviewed_at: "2026-09-21T10:00:00.000Z" });
    expect(eqOf(calls, "agency_id")).toBe(AGENCY);
    expect(eqOf(calls, "id")).toBe(SIGNAL);
    expect(calls.some((call) => call.method === "is" && call.args[0] === "review_verdict" && call.args[1] === null)).toBe(true);
  });

  it("refuses a signal that was already judged or belongs to another agency, rather than overwriting", async () => {
    const { db } = recorder({ data: null, error: null });
    await expect(recordSignalVerdict(db, { agencyId: AGENCY, signalId: SIGNAL, verdict: "CORRECT", reviewerId: STAFF })).rejects.toThrow("already judged");
  });

  it("surfaces a database failure", async () => {
    const { db } = recorder({ data: null, error: { message: "boom" } });
    await expect(recordSignalVerdict(db, { agencyId: AGENCY, signalId: SIGNAL, verdict: "CORRECT", reviewerId: STAFF })).rejects.toThrow("boom");
  });
});

describe("listSignalsForReview and loadSignalPrecision", () => {
  it("reads only this agency's unjudged signals, skipping housekeeping codes", async () => {
    const { db, calls } = recorder({ data: [{ id: SIGNAL, conversation_id: "c", signal_code: "REFUND_REQUEST", detector: "RULE", confidence: "1", evidence: [{ snippet: "I want my money back" }], created_at: "2026-09-21" }], error: null });
    const [signal] = await listSignalsForReview(db, AGENCY, 5);
    expect(eqOf(calls, "agency_id")).toBe(AGENCY);
    expect(calls.some((call) => call.method === "not" && String(call.args[2]).includes("CONCURRENT_COMPOSER"))).toBe(true);
    expect(signal).toMatchObject({ id: SIGNAL, signalCode: "REFUND_REQUEST", snippets: ["I want my money back"] });
  });

  it("summarises precision from the agency's own view rows", async () => {
    const { db, calls } = recorder({ data: [{ signal_code: "PAYMENT_CLAIM_UNVERIFIED", detector: "RULE", total_signals: 30, reviewed: 20, correct: 19, wrong: 1 }], error: null });
    const [summary] = await loadSignalPrecision(db, AGENCY);
    expect(eqOf(calls, "agency_id")).toBe(AGENCY);
    expect(summary).toMatchObject({ precision: 0.95, gate: "MET" });
  });
});

describe("MI4.1b migration security", () => {
  const sql = readFileSync(path.resolve(process.cwd(), "supabase/migrations/20261202091900_mi4_1b_signal_review_verdicts.sql"), "utf8");

  it("limits staff writes to the three review columns and to unjudged rows of their own agency", () => {
    expect(sql).toMatch(/grant update \(review_verdict, reviewed_by, reviewed_at\) on table public\.conversation_signals to authenticated/);
    expect(sql).toMatch(/using \([\s\S]*review_verdict is null/);
    expect(sql).toMatch(/reviewed_by = \(select auth\.uid\(\)\)/);
  });

  it("ties the reviewer to the same agency and keeps verdict, reviewer and time together", () => {
    expect(sql).toMatch(/foreign key \(reviewed_by, agency_id\) references public\.staff_profiles \(id, agency_id\)/);
    expect(sql).toMatch(/conversation_signals_review_complete_check/);
  });

  it("makes the precision view security invoker so it inherits the signals' RLS", () => {
    expect(sql).toMatch(/security_invoker = true/);
  });
});
