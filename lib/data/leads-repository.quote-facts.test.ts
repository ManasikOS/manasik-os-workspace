import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { loadQuoteDashboardFacts } from "./leads-repository";

function dbReturning(result: { data: unknown; error: { message: string } | null }) {
  const selected: string[] = [];
  const db = {
    from: (table: string) => ({
      select: (columns: string) => {
        selected.push(`${table}:${columns}`);
        return Promise.resolve(result);
      },
    }),
  };
  return { db: db as never, selected };
}

describe("loadQuoteDashboardFacts", () => {
  it("selects only the five columns the dashboard counts from, never price or customer fields", async () => {
    const { db, selected } = dbReturning({ data: [], error: null });
    await loadQuoteDashboardFacts(db);
    expect(selected).toEqual(["lead_quotes:id, reference, status, valid_until, sent_at, created_at"]);
  });

  it("returns the rows", async () => {
    const rows = [{ id: "q1", reference: "Q-1", status: "SENT", valid_until: "2026-10-20", sent_at: null, created_at: "2026-10-01" }];
    const { db } = dbReturning({ data: rows, error: null });
    expect(await loadQuoteDashboardFacts(db)).toEqual(rows);
  });

  it("throws rather than returning an empty list when the read fails", async () => {
    const { db } = dbReturning({ data: null, error: { message: "boom" } });
    await expect(loadQuoteDashboardFacts(db)).rejects.toThrow();
  });
});
