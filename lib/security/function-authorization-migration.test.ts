import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * TASK-029 P2.4 finding F3. The behavioural proof lives in supabase/tests/database/function_authorization_and_realtime.test.sql and needs a
 * database. These checks run in the normal suite and guard the migration's shape.
 *
 * The cause being guarded against: a comparison with NULL is never true, and `if NULL then` does not raise. current_agency_id() is NULL for a
 * user with no staff profile and for staff of a suspended agency; staff_role_in() used to be NULL for a user with no profile.
 */
const root = process.cwd();
const sql = readFileSync(join(root, "supabase/migrations/20270101090000_fix_function_authorization_gaps.sql"), "utf8").replace(/^--.*$/gm, "");

/** The text of one `create or replace function` statement, from its name to the `$$;` that ends it. */
function functionBody(name: string): string {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  expect(start, `${name} is redefined`).toBeGreaterThan(-1);
  const end = sql.indexOf("$$;", sql.indexOf("$$", start) + 2);
  expect(end, `${name} ends`).toBeGreaterThan(start);
  return sql.slice(start, end);
}

describe("function authorisation migration", () => {
  it("makes staff_role_in answer false, never NULL", () => {
    expect(functionBody("staff_role_in")).toContain("coalesce(public.current_staff_role() = any(roles), false)");
  });

  it.each(["set_inbox_autonomy_level", "record_conversation_answer_candidate"])("%s refuses a caller with no agency and compares agencies NULL-safely", (name) => {
    const body = functionBody(name);
    expect(body).toContain("public.current_agency_id() is null");
    expect(body).toContain("p_agency_id is distinct from public.current_agency_id()");
    // The original bug: `<>` against a value that can be NULL.
    expect(body).not.toMatch(/p_agency_id\s*<>\s*public\.current_agency_id\(\)/);
    expect(body).toContain("service_role");
  });

  it("keeps the autonomy role test NULL-safe as well, so a missing role refuses", () => {
    expect(functionBody("set_inbox_autonomy_level")).toContain("not coalesce(public.staff_role_in('ADMIN','CEO'), false)");
    expect(functionBody("set_inbox_autonomy_level")).toContain("p_actor_id is distinct from auth.uid()");
  });

  it("raises the same errors the application and the tests rely on", () => {
    expect(functionBody("set_inbox_autonomy_level")).toContain("raise exception 'not permitted to change Inbox autonomy'");
    expect(functionBody("record_conversation_answer_candidate")).toContain("raise exception 'agency mismatch'");
  });

  it("keeps both functions security definer with an empty search path and the same signatures", () => {
    for (const name of ["set_inbox_autonomy_level", "record_conversation_answer_candidate"]) {
      expect(functionBody(name)).toMatch(/security definer set search_path = ''/);
    }
    expect(functionBody("set_inbox_autonomy_level")).toContain("p_agency_id uuid, p_surface text, p_level text, p_mode text, p_enabled boolean, p_autonomy jsonb, p_actor_id uuid, p_reason text, p_evidence jsonb");
  });

  it("removes execute on the internal package status step from signed-in users and leaves it to the service role", () => {
    expect(sql).toMatch(/revoke execute on function public\.packages_apply_status_transition\(uuid, timestamptz, text\[\], text, text, text\) from public, anon, authenticated;/);
    expect(sql).toMatch(/grant execute on function public\.packages_apply_status_transition\(uuid, timestamptz, text\[\], text, text, text\) to service_role;/);
    expect(sql).not.toMatch(/grant execute on function public\.packages_apply_status_transition[^;]*authenticated/);
  });

  it("restates the privileges the two replaced functions must keep", () => {
    expect(sql).toMatch(/grant execute on function public\.set_inbox_autonomy_level\([^)]*\) to authenticated, service_role;/);
    expect(sql).toMatch(/grant execute on function public\.record_conversation_answer_candidate\([^)]*\) to authenticated, service_role;/);
    expect(sql).toMatch(/revoke execute on function public\.set_inbox_autonomy_level\([^)]*\) from public, anon;/);
  });

  it("changes functions and privileges only: no table, policy, data or index change", () => {
    expect(sql).not.toMatch(/\b(create|alter|drop)\s+(table|index|policy|trigger)\b/i);
    expect(sql).not.toMatch(/\binsert into public\.(?!ai_surface_settings|inbox_autonomy_level_audit|conversation_answer_cache)/i);
    expect(sql).not.toMatch(/\bdelete from\b/i);
  });
});

describe("function_authorization_and_realtime.test.sql", () => {
  const test = readFileSync(join(root, "supabase/tests/database/function_authorization_and_realtime.test.sql"), "utf8");

  it("plans exactly as many assertions as it runs", () => {
    const planned = Number(test.match(/select plan\((\d+)\);/)?.[1]);
    const assertions = test.match(/^select (results_eq|lives_ok|throws_ok|ok|is_empty)\(/gm)?.length ?? 0;
    expect(planned).toBe(assertions);
  });

  it("runs in a transaction that rolls back, so it can be run against staging", () => {
    expect(test.trimStart().startsWith("begin;")).toBe(true);
    expect(test.trimEnd().endsWith("rollback;")).toBe(true);
  });

  it("covers both kinds of caller whose agency is NULL: a user with no profile and the admin of a suspended agency", () => {
    expect(test).toContain("'SUSPENDED'");
    expect(test).toContain("nobody@funciso.test");
    expect(test).toContain("The admin of a suspended agency cannot switch another agency to autonomous replies");
  });
});
