import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  path.resolve(__dirname, "../../supabase/migrations/20261202093300_fix7_exact_queue_counts_at_scale.sql"),
  "utf8",
);
const decrementFixMigration = readFileSync(
  path.resolve(
    __dirname,
    "../../supabase/migrations/20261202093800_fix_inbox_queue_count_decrement.sql",
  ),
  "utf8",
);

describe("FIX7 exact queue counts migration", () => {
  it("uses agency-scoped atomic membership deltas and serializes concurrent refreshes", () => {
    expect(migration).toMatch(/create table if not exists public\.conversation_queue_counts/);
    expect(migration).toMatch(/primary key \(agency_id, queue_code\)/);
    expect(migration).toMatch(/pg_advisory_xact_lock/);
    expect(migration).toMatch(/select unnest\(v_new_queue_codes\)[\s\S]*union all[\s\S]*select unnest\(v_old_queue_codes\)/);
    expect(migration).toMatch(/q\.agency_id = v_agency_id and q\.conversation_count = 0/);
  });

  it("keeps counters private and exposes only an agency- and role-checked count RPC", () => {
    expect(migration).toMatch(/alter table public\.conversation_queue_counts enable row level security/);
    expect(migration).toMatch(/revoke all on table public\.conversation_queue_counts from public, anon, authenticated/);
    expect(migration).toMatch(/v_agency uuid := public\.current_agency_id\(\)/);
    expect(migration).toMatch(/not public\.staff_role_in\('ADMIN', 'CEO', 'MARKETING', 'OPERATIONS', 'FINANCE', 'VISA'\)/);
    expect(migration).toMatch(/from public\.conversation_queue_counts q/);
  });

  it("updates negative deltas instead of inserting a row that violates the count check", () => {
    expect(decrementFixMigration).toMatch(
      /having sum\(d\.delta\) > 0[\s\S]*insert into public\.conversation_queue_counts/,
    );
    expect(decrementFixMigration).toMatch(
      /having sum\(d\.delta\) < 0[\s\S]*update public\.conversation_queue_counts/,
    );
  });
});
