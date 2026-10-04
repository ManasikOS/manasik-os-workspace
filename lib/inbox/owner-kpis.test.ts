import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { OWNER_INBOX_KPI_DEFINITIONS, ownerInboxMetricsFromRow } from "./owner-kpis";

describe("G10 owner Inbox intelligence", () => {
  it("maps every deterministic view column to its drill-through queue", () => {
    const row = Object.fromEntries(OWNER_INBOX_KPI_DEFINITIONS.map(([, key], index) => [key, index + 1]));
    const metrics = ownerInboxMetricsFromRow(row);
    expect(metrics).toHaveLength(10);
    expect(metrics.map((metric) => metric.value)).toEqual([1,2,3,4,5,6,7,8,9,10]);
    expect(metrics.every((metric) => metric.queueCode.length > 0)).toBe(true);
  });

  it("keeps the SQL view caller-scoped and based only on deterministic tables", () => {
    const sql = readFileSync(path.resolve(__dirname, "../../supabase/migrations/20261202092600_mi6_3_inbox_owner_kpis.sql"), "utf8");
    expect(sql).toMatch(/security_invoker\s*=\s*true/i);
    expect(sql).toMatch(/conversation_queue_membership/);
    expect(sql).toMatch(/conversation_interventions/);
    expect(sql).not.toMatch(/ai_runs|model|prompt/i);
  });
});
