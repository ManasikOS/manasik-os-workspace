import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * TASK-032 S1. The behavioural proof lives in supabase/tests/database/agencies_is_test.test.sql and needs a database. These checks run in
 * the normal suite and guard the migration's shape: the flag is additive and defaults to false, and only the service role can set it.
 */
const sql = readFileSync(join(process.cwd(), "supabase/migrations/20270102090000_agencies_is_test.sql"), "utf8").replace(/^\s*--.*$/gm, "");

describe("agencies.is_test migration", () => {
  it("adds a not-null boolean that defaults to false, so every existing agency stays a real agency", () => {
    expect(sql).toMatch(/add column if not exists is_test boolean not null default false/);
  });

  it("blocks the signed-in and anonymous roles from setting or changing the flag", () => {
    expect(sql).toMatch(/current_user in \('authenticated', 'anon'\)/);
    expect(sql).toMatch(/tg_op = 'INSERT' and new\.is_test/);
    expect(sql).toMatch(/tg_op = 'UPDATE' and new\.is_test is distinct from old\.is_test/);
    expect(sql).toMatch(/errcode = '42501'/);
  });

  it("is not security definer, because the check depends on the caller's own role", () => {
    expect(sql).not.toMatch(/security definer/i);
  });

  it("fires on insert and on updates of the column", () => {
    expect(sql).toMatch(/before insert or update of is_test on public\.agencies/);
  });

  it("does not touch any policy", () => {
    expect(sql).not.toMatch(/create policy|drop policy|alter policy/i);
  });
});
