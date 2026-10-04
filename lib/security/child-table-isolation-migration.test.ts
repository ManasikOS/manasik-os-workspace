import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * TASK-029 P2.4 finding F2. The behavioural proof lives in supabase/tests/database/child_table_tenant_isolation.test.sql and needs a
 * database. These checks run in the normal suite and guard the migration's shape.
 */
const root = process.cwd();
const sql = readFileSync(join(root, "supabase/migrations/20261231090000_fix_child_table_tenant_isolation.sql"), "utf8").replace(/^--.*$/gm, "");

function policyBlock(name: string): string {
  const quoted = name.includes(" ") ? `"${name}"` : name;
  const start = sql.indexOf(`create policy ${quoted}`);
  expect(start, `${name} is created`).toBeGreaterThan(-1);
  // A policy statement contains no semicolon until its end. Do not search for a semicolon plus newline: the file may have Windows line
  // endings, which would make each block run to the end of the file and let a missing check go unnoticed.
  const end = sql.indexOf(";", start);
  expect(end, `${name} ends`).toBeGreaterThan(start);
  return sql.slice(start, end);
}

const DEPARTURE_GROUP_CHECK = /exists \(select 1 from public\.departure_groups g where g\.id = \w+\.departure_group_id and g\.agency_id = \(select public\.current_agency_id\(\)\)\)/;
const BOOKING_CHECK = /exists \(select 1 from public\.departure_group_bookings b where b\.id = \w+\.booking_id and b\.agency_id = \(select public\.current_agency_id\(\)\)\)/;
const QUOTE_CHECK = /exists \(select 1 from public\.lead_quotes q where q\.id = quote_line_items\.quote_id and q\.agency_id = \(select public\.current_agency_id\(\)\)\)/;

const FINANCE_TABLES = ["payment_reminders", "booking_collection_risk", "milestone_change_events"];

describe("child table tenant isolation migration", () => {
  it.each(FINANCE_TABLES)("%s read and write policies check the departure group's agency and a role, and never just `true`", (table) => {
    const read = policyBlock(`${table}_select`);
    const write = policyBlock(`${table}_write`);
    for (const block of [read, write]) {
      expect(block).toMatch(DEPARTURE_GROUP_CHECK);
      expect(block).toContain("public.staff_role_in(");
      expect(block).toContain("to authenticated");
      expect(block).not.toMatch(/using\s*\(\s*true\s*\)|with check\s*\(\s*true\s*\)/);
    }
    expect(read).toContain("'ADMIN', 'FINANCE', 'CEO', 'OPERATIONS', 'MARKETING'");
    expect(write).toContain("staff_role_in('ADMIN', 'FINANCE')");
  });

  it.each(FINANCE_TABLES)("%s writes also require the booking to belong to the caller's agency", (table) => {
    expect(policyBlock(`${table}_write`)).toMatch(BOOKING_CHECK);
  });

  it("keeps milestone_change_events append-only: its write policy is for insert only", () => {
    expect(policyBlock("milestone_change_events_write")).toContain("for insert to authenticated");
  });

  it("scopes quote_line_items through the quote's agency, mirroring lead_quotes' roles", () => {
    const read = policyBlock("staff read quote_line_items");
    const write = policyBlock("staff write quote_line_items");
    expect(read).toMatch(QUOTE_CHECK);
    expect(write).toMatch(QUOTE_CHECK);
    expect(read).toContain("'ADMIN', 'CEO', 'MARKETING', 'FINANCE', 'OPERATIONS', 'VISA'");
    expect(write).toContain("staff_role_in('ADMIN', 'MARKETING')");
  });

  it("checks the parent's agency directly instead of inheriting the parent's own policy, so pilgrim portal access to a group does not leak finance data", () => {
    expect(sql).not.toMatch(/exists \(select 1 from public\.departure_groups g where g\.id = \w+\.departure_group_id\)/);
    expect(sql).toContain("g.agency_id = (select public.current_agency_id())");
  });

  it("removes the staging-only package_* policies without dropping the tables, and skips tables that do not exist", () => {
    expect(sql).toContain("to_regclass(format('public.%I', v_table)) is not null");
    for (const table of ["package_content", "package_faqs", "package_media", "package_seo_analyses"]) expect(sql).toContain(`'${table}'`);
    expect(sql).toContain("enable row level security");
    expect(sql).not.toMatch(/\bdrop table\b/i);
  });

  it("fails the migration if any unconditional policy remains outside the two global reference tables", () => {
    expect(sql).toContain("'ai_model_rates', 'country_locale_defaults'");
    expect(sql).toMatch(/raise exception 'Tenant isolation: these policies are still unconditional/);
  });

  it("changes policies only: no table, column, data or index change", () => {
    expect(sql).not.toMatch(/\b(create|alter)\s+table\b(?!.*enable row level security)/i);
    expect(sql).not.toMatch(/\binsert into\b|\bdelete from\b|\bupdate\s+public\./i);
    expect(sql).not.toMatch(/\bcreate\s+(unique\s+)?index\b/i);
  });
});

describe("child_table_tenant_isolation.test.sql", () => {
  const test = readFileSync(join(root, "supabase/tests/database/child_table_tenant_isolation.test.sql"), "utf8");

  it("plans exactly as many assertions as it runs", () => {
    const planned = Number(test.match(/select plan\((\d+)\);/)?.[1]);
    const assertions = test.match(/^select (results_eq|lives_ok|throws_ok|ok|is_empty)\(/gm)?.length ?? 0;
    expect(planned).toBe(assertions);
  });

  it("runs in a transaction that rolls back, so it can be run against staging", () => {
    expect(test.trimStart().startsWith("begin;")).toBe(true);
    expect(test.trimEnd().endsWith("rollback;")).toBe(true);
  });
});
