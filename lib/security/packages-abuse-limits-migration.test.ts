import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * TASK-043 Phase 3 (PKG-13). The behavioural proof lives in supabase/tests/database/packages_abuse_limits.test.sql and needs a database.
 * These checks run in the normal suite and guard the migration's shape.
 */
const sql = readFileSync(join(process.cwd(), "supabase/migrations/20270120090800_packages_abuse_limits.sql"), "utf8")
  .replace(/\r\n/g, "\n")
  .replace(/^\s*--.*$/gm, "");

const start = sql.indexOf("create or replace function public.consume_package_rate_limit(");
const body = sql.slice(start, sql.indexOf("\n$$;", start));

describe("abuse limits migration", () => {
  it("gives clients no access to the event table", () => {
    expect(sql).toMatch(/alter table public\.package_rate_events enable row level security/);
    expect(sql).toMatch(/revoke all on public\.package_rate_events from anon, authenticated/);
    expect(sql).not.toMatch(/create policy [^;]*package_rate_events/);
  });

  it("counts per person and action, serialised, and only for the actions it knows", () => {
    expect(body).toMatch(/security definer/);
    expect(body).toMatch(/set search_path to 'public'/);
    expect(body).toContain("pg_advisory_xact_lock");
    expect(body.indexOf("pg_advisory_xact_lock")).toBeLessThan(body.indexOf("select count(*), min(created_at)"));
    for (const action of ["create_draft", "duplicate", "publish", "code_lookup"]) expect(body).toContain(`'${action}'`);
    expect(body).toContain("That action is not recognised.");
  });

  it("records the use only after the limit check passes, and prunes old rows", () => {
    expect(body.indexOf("insert into public.package_rate_events")).toBeGreaterThan(body.indexOf("if v_used >= v_limit"));
    expect(body).toMatch(/delete from public\.package_rate_events where user_id = v_actor and created_at < now\(\) - interval '2 hours'/);
  });

  it("is granted to signed-in users only", () => {
    expect(sql).toMatch(/revoke all on function public\.consume_package_rate_limit\(text\) from public, anon/);
  });

  it("caps an agency's drafts at 500 with a before-insert trigger", () => {
    expect(sql).toMatch(/create trigger packages_cap_agency_drafts\s+before insert on public\.packages/);
    expect(sql).toContain("status = 'Draft') >= 500");
    expect(sql).toContain("Your agency already holds 500 draft packages.");
  });
});
