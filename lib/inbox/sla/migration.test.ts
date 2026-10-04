import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { NEARING_DEADLINE_MINUTES } from "./due-at";
import { DEFAULT_SLA_POLICIES } from "./policies";

const sql = readFileSync(path.resolve(__dirname, "../../../supabase/migrations/20261202091100_mi2_6_inbox_sla_policies.sql"), "utf8");

describe("the migration and the code agree (20261202091100_mi2_6_inbox_sla_policies)", () => {
  it("seeds exactly the defaults in lib/inbox/sla/policies.ts, row for row", () => {
    const block = /cross join \(values([\s\S]*?)\) as d\(queue_code/.exec(sql)?.[1] ?? "";
    const seeded = [...block.matchAll(/\('([A-Z_]+)',\s*(\d+),\s*(\d+|null),\s*'([A-Z_]+)',\s*(true|false)\)/g)].map((match) => ({
      queueCode: match[1],
      firstReplyMinutes: Number(match[2]),
      resolutionMinutes: match[3] === "null" ? null : Number(match[3]),
      clock: match[4],
      opensInterventionOnBreach: match[5] === "true",
    }));
    expect(seeded).toEqual(DEFAULT_SLA_POLICIES.map((policy) => ({ ...policy })));
  });

  it("allows a policy for exactly those queues, and none for the paused ones", () => {
    const allowed = [...(/queue_code\s+text not null check \(queue_code in \(([\s\S]*?)\)\)/.exec(sql)?.[1] ?? "").matchAll(/'([A-Z_]+)'/g)].map((match) => match[1]).sort();
    expect(allowed).toEqual(DEFAULT_SLA_POLICIES.map((policy) => policy.queueCode).sort());
    for (const paused of ["WAITING_CUSTOMER", "WAITING_TEAM", "RESOLVED"]) expect(allowed).not.toContain(paused);
  });

  it("uses the same nearing window in SQL as the code", () => {
    expect(sql).toContain(`interval '${NEARING_DEADLINE_MINUTES} minutes'`);
  });

  it("puts RLS on the new table in the same migration, with owner-only writes", () => {
    expect(sql).toMatch(/alter table public\.inbox_sla_policies enable row level security/);
    expect(sql).toMatch(/create policy "owners manage inbox_sla_policies"[\s\S]*staff_role_in\('ADMIN', 'CEO'\)/);
  });

  it("reuses the base handoff alert for the three fastest queues instead of a second setting", () => {
    expect(sql).toMatch(/handoff_alert_minutes from public\.ai_settings/);
  });

  it("does not re-implement business hours in SQL: the predicates only read sla_due_at", () => {
    expect(sql).not.toMatch(/working_hours\s*->/);
    expect(sql).toMatch(/r\.sla_due_at <= now\(\)/);
  });

  it("adds the sweep to the cron allow-list and schedules it", () => {
    expect(sql).toMatch(/'\/api\/cron\/inbox-sla'\s*\n\s*\) then/);
    expect(sql).toMatch(/cron\.schedule\(\s*'inbox-sla'/);
  });
});
