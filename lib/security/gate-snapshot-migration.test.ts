import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * TASK-032 S7. The behavioural proof lives in supabase/tests/database/gate_snapshot.test.sql and needs a database. These checks run in the
 * normal suite and guard the migration's shape: the function only reads, only the service role can call it, and the keys it returns are the
 * ones the gate reads.
 */
const root = process.cwd();
const sql = readFileSync(join(root, "supabase/migrations/20270105090000_gate_snapshot.sql"), "utf8").replace(/^\s*--.*$/gm, "");

describe("gate_snapshot migration", () => {
  it("is security definer with a fixed search_path and is read-only (stable)", () => {
    expect(sql).toMatch(/security definer/);
    expect(sql).toMatch(/set search_path = public, pg_temp/);
    expect(sql).toMatch(/\bstable\b/);
  });

  it("changes no data and no schema beyond the function itself", () => {
    expect(sql).not.toMatch(/\b(insert\s+into|update\s+[a-z_.]+\s+set|delete\s+from|truncate\s+(table\s+)?[a-z_.]+|alter\s+table|create\s+table|drop\s+table|create\s+policy|drop\s+policy)\b/i);
  });

  it("is executable by the service role only", () => {
    expect(sql).toMatch(/revoke all on function public\.gate_snapshot\(\) from public, anon, authenticated;/);
    expect(sql).toMatch(/grant execute on function public\.gate_snapshot\(\) to service_role;/);
    expect(sql).not.toMatch(/grant execute on function public\.gate_snapshot\(\) to (anon|authenticated|public)/);
  });

  it("returns every key the gate reads", () => {
    const types = readFileSync(join(root, "lib/ops/gate/types.ts"), "utf8");
    const block = types.slice(types.indexOf("export interface GateSnapshot"), types.indexOf("/** What `GET /api/health/config`"));
    const keys = [...block.matchAll(/^\s{2}(\w+):/gm)].map((match) => match[1]);
    expect(keys.length).toBeGreaterThanOrEqual(10);
    for (const key of keys) expect(sql, `the snapshot does not return ${key}`).toContain(`'${key}'`);
  });

  it("returns names and states, never row data from a customer table", () => {
    expect(sql).not.toMatch(/from public\.(conversations|conversation_messages|agencies|staff_profiles|leads|bookings)\b/i);
  });
});
