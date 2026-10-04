import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * TASK-032 S4 / audit item D3. The behavioural proof lives in supabase/tests/database/package_wrapper_guards.test.sql and needs a database.
 * These checks run in the normal suite and guard the migration's shape: no NULL-blind role comparison, an explicit agency check, and
 * the same signatures, so `create or replace` cannot silently change what the application calls.
 */
const sql = readFileSync(join(process.cwd(), "supabase/migrations/20270104090000_harden_package_wrapper_guards.sql"), "utf8").replace(/\r\n/g, "\n").replace(/^\s*--.*$/gm, "");

const FUNCTIONS = {
  archive_package: "p_package_id uuid,\n  p_expected_updated_at timestamptz default null,\n  p_reason text default null,\n  p_force boolean default false",
  close_package_sales: "p_package_id uuid,\n  p_expected_updated_at timestamptz default null",
  publish_package: "p_package_id uuid,\n  p_expected_updated_at timestamptz default null",
  reopen_package: "p_package_id uuid,\n  p_expected_updated_at timestamptz default null",
  restore_package: "p_package_id uuid,\n  p_expected_updated_at timestamptz default null",
  package_versions_create: "p_package_id uuid, p_snapshot jsonb",
} as const;

/** The text of one `create or replace function` statement, from its name to the `$$;` that ends it. */
function functionBody(name: string): string {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  expect(start, `${name} is redefined`).toBeGreaterThan(-1);
  const end = sql.indexOf("$$;", sql.indexOf("$$", start) + 2);
  expect(end, `${name} ends`).toBeGreaterThan(start);
  return sql.slice(start, end);
}

describe("package wrapper guards migration", () => {
  it("redefines all six wrappers", () => {
    for (const name of Object.keys(FUNCTIONS)) expect(() => functionBody(name)).not.toThrow();
  });

  it.each(Object.entries(FUNCTIONS))("%s keeps its parameters, so the application's calls are unchanged", (name, parameters) => {
    expect(functionBody(name)).toContain(`(\n  ${parameters}\n)`.replace("(\n  p_package_id uuid, p_snapshot jsonb\n)", "(p_package_id uuid, p_snapshot jsonb)"));
  });

  it.each(Object.keys(FUNCTIONS))("%s is security definer with a fixed search_path, as before", (name) => {
    const body = functionBody(name);
    expect(body).toMatch(/security definer/);
    expect(body).toMatch(/set search_path to 'public'/);
  });

  it.each(Object.keys(FUNCTIONS))("%s no longer compares the role with a NULL-blind not in", (name) => {
    expect(functionBody(name)).not.toMatch(/current_staff_role\(\)\s+not\s+in/);
  });

  it.each(Object.keys(FUNCTIONS))("%s refuses a role outside ADMIN and OPERATIONS, treating no profile as refused", (name) => {
    expect(functionBody(name)).toContain("not coalesce(public.staff_role_in('ADMIN', 'OPERATIONS'), false)");
  });

  it.each(Object.keys(FUNCTIONS))("%s refuses a caller with no active agency before doing anything else", (name) => {
    const body = functionBody(name);
    expect(body).toMatch(/current_agency_id\(\)( is null|;)/);
    expect(body).toContain("Your session has no active agency.");
    expect(body.indexOf("Your role cannot")).toBeLessThan(body.indexOf("Your session has no active agency."));
  });

  it("makes archive_package confirm the package belongs to the caller's agency before reading about it", () => {
    const body = functionBody("archive_package");
    const ownership = body.indexOf("perform 1 from public.packages where id = p_package_id and agency_id = v_agency");
    expect(ownership).toBeGreaterThan(-1);
    expect(ownership).toBeLessThan(body.indexOf("from public.package_usage"));
  });

  it("keeps the force-archive rule limited to an administrator, now NULL-safe", () => {
    expect(functionBody("archive_package")).toContain("not coalesce(public.staff_role_in('ADMIN'), false)");
  });

  it("changes no grants or policies", () => {
    expect(sql).not.toMatch(/\bgrant\b|\brevoke\b|create policy|drop policy/i);
  });

  it("ends with a guard that fails the migration if any of the six keeps a weak guard", () => {
    expect(sql).toMatch(/raise exception 'Tenant isolation: these package functions still have a NULL-blind role guard or no agency check/);
  });
});
