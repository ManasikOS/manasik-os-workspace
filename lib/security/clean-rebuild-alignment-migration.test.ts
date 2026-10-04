import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * TASK-032 S5. The behavioural proof lives in supabase/tests/database/clean_rebuild_alignment.test.sql and needs a database. These checks run in the
 * normal suite and guard the shape of the clean-rebuild fixes: the two in-place edits, and the catch-up migration.
 */
const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n");
const withoutComments = (sql: string) => sql.replace(/^\s*--.*$/gm, "");

describe("the two migrations edited so a fresh database can build", () => {
  const addons = read("supabase/migrations/20261114090001_pilgrim_service_customisation.sql");
  const lockDown = read("supabase/migrations/20261126090000_lock_down_definer_functions.sql");

  it("seeds the add-on catalogue with the conflict target that matches the per-agency unique key", () => {
    const code = withoutComments(addons);
    expect(code).toMatch(/on conflict \(agency_id, code\) do nothing;/);
    expect(code).not.toMatch(/on conflict \(code\)/);
  });

  it("revokes on increment_conversation_unread only when the function exists, in both statements", () => {
    const code = withoutComments(lockDown);
    const guarded = code.match(/if to_regprocedure\('public\.increment_conversation_unread\(uuid\)'\) is not null then revoke execute on function public\.increment_conversation_unread\(uuid\) from [a-z, ]+; end if;/g) ?? [];
    expect(guarded).toHaveLength(2);
    expect(code).not.toMatch(/^revoke execute on function public\.increment_conversation_unread/m);
  });
});

describe("clean-rebuild alignment migration", () => {
  const sql = withoutComments(read("supabase/migrations/20270106090000_clean_rebuild_alignment.sql"));

  it("re-creates the marketing-scope trigger and function, as a security-definer function with a fixed search_path", () => {
    expect(sql).toMatch(/create or replace function public\.packages_enforce_marketing_column_scope\(\)/);
    expect(sql).toMatch(/security definer/);
    expect(sql).toMatch(/set search_path = public/);
    expect(sql).toMatch(/drop trigger if exists packages_enforce_marketing_scope on public\.packages;\s*create trigger packages_enforce_marketing_scope\s*before update on public\.packages/);
  });

  it("excludes generated columns from the comparison, so MARKETING can still change the featured flag", () => {
    expect(sql).toMatch(/a\.attgenerated <> ''/);
    expect(sql).toMatch(/scope_exclusions := scope_exclusions \|\|/);
    expect(sql).toMatch(/array\['featured', 'updated_at'\]/);
  });

  it("keeps the role rules: ADMIN and OPERATIONS pass, MARKETING is limited, everyone else is refused", () => {
    expect(sql).toMatch(/acting_role in \('ADMIN', 'OPERATIONS'\)/);
    expect(sql).toMatch(/acting_role = 'MARKETING'/);
    expect(sql).toMatch(/Your role cannot update packages\./);
  });

  it("takes every client privilege away from the trigger function", () => {
    expect(sql).toMatch(/revoke all on function public\.packages_enforce_marketing_column_scope\(\) from public, anon, authenticated;/);
  });

  it("drops the all-commands activity-log policy and the no-argument reset function, idempotently", () => {
    expect(sql).toMatch(/drop policy if exists "staff write departure_group_activity_logs" on public\.departure_group_activity_logs;/);
    expect(sql).toMatch(/drop function if exists public\.reset_agency_business_data\(\);/);
  });

  it("does not touch the agency-scoped reset function, the activity-log read or insert policies, or any data", () => {
    expect(sql).not.toMatch(/reset_agency_business_data\(uuid\)/);
    expect(sql).not.toMatch(/\b(insert\s+into|update\s+[a-z_.]+\s+set|delete\s+from|truncate\s+(table\s+)?[a-z_.]+|drop\s+table|drop\s+column)\b/i);
    expect(sql).not.toMatch(/drop policy[^;]*(read|insert) departure_group_activity_logs/);
  });

  it("ends with a guard that fails the migration if any of the four protections is missing", () => {
    expect(sql).toMatch(/raise exception 'Clean-rebuild alignment: %'/);
  });
});

describe("the repeatable rebuild script", () => {
  const script = read("scripts/local/rebuild-from-migrations.sh");

  it("refuses a database that already has tables, so it cannot be pointed at staging or production by accident", () => {
    expect(script).toMatch(/Refusing to run: the database already has/);
    expect(script).toMatch(/pg_tables where schemaname = 'public'/);
  });

  it("only talks to a local Docker container, never to a remote connection string", () => {
    expect(script).toMatch(/docker exec -i "\$CONTAINER" psql/);
    expect(script).not.toMatch(/postgres(ql)?:\/\//);
    expect(script).not.toMatch(/--host|-h [a-z]|PGHOST|SUPABASE_URL/);
  });

  it("applies each migration in its own transaction and stops at the first failure", () => {
    expect(script).toMatch(/echo "begin;"; cat "\$file"; echo; echo "commit;"/);
    expect(script).toMatch(/exit 1/);
  });
});
