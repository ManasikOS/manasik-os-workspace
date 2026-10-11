import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * TASK-043 Phase 1 (PKG-03, PKG-12). The behavioural proof lives in supabase/tests/database/packages_marketing_visibility.test.sql and needs a
 * database. These checks run in the normal suite and guard the migration's shape.
 */
const sql = readFileSync(join(process.cwd(), "supabase/migrations/20270120090200_packages_marketing_visibility_and_group_revenue.sql"), "utf8")
  .replace(/\r\n/g, "\n")
  .replace(/^\s*--.*$/gm, "");

function policyBlock(name: string): string {
  const start = sql.indexOf(`create policy "${name}"`);
  expect(start, `policy "${name}" is created`).toBeGreaterThan(-1);
  const end = sql.indexOf(";", start);
  return sql.slice(start, end);
}

describe("packages marketing visibility migration", () => {
  it("limits MARKETING to live packages and its own, in the SELECT policy itself", () => {
    const read = policyBlock("staff read packages");
    expect(read).toMatch(/agency_id = \(select public\.current_agency_id\(\)\)/);
    expect(read).toMatch(/staff_role_in\('MARKETING'\)\s+and \(status = 'Open for Sale' or owner_id = \(select auth\.uid\(\)\)\)/);
  });

  it("keeps the other readers and keeps GUIDE out", () => {
    const read = policyBlock("staff read packages");
    expect(read).toContain("staff_role_in('ADMIN', 'CEO', 'OPERATIONS', 'FINANCE', 'VISA')");
    expect(read).not.toMatch(/GUIDE/);
    expect(read).not.toMatch(/\band true\b|using\s*\(\s*true\s*\)/i);
  });

  it.each(["staff read package versions", "staff read package activity"])("%s follows the package the caller can read", (name) => {
    const block = policyBlock(name);
    expect(block).toMatch(/agency_id = \(select public\.current_agency_id\(\)\)/);
    expect(block).toMatch(/exists \(select 1 from public\.packages p where p\.id = /);
  });

  it("makes the list function ignore its arguments and not filter on them", () => {
    const start = sql.indexOf("create or replace function public.list_packages_with_usage(");
    const body = sql.slice(start, sql.indexOf("$$;", sql.indexOf("as $$", start)));
    expect(body).toMatch(/security invoker/);
    expect(body).not.toMatch(/where\s/);
    expect(body).not.toMatch(/p_role is distinct from|p_current_user_id is not null/);
    expect(sql).toMatch(/revoke execute on function public\.list_packages_with_usage\(text, uuid\) from public, anon/);
  });

  it("limits group revenue figures to ADMIN, CEO and FINANCE and keeps the view invoker-secured", () => {
    const start = sql.indexOf("create or replace view public.departure_group_payment_summaries");
    const view = sql.slice(start, sql.indexOf("alter view", start));
    expect(view).toMatch(/where public\.staff_role_in\('ADMIN', 'CEO', 'FINANCE'\)\s+and \(select public\.has_package_capability\('viewInternalFinance'\)\);?\s*$/);
    for (const column of ["departure_group_id", "expected_revenue", "collected_amount", "outstanding_amount", "overdue_amount", "refund_pending_amount", "supplier_payables_due"]) {
      expect(view, column).toContain(column);
    }
    expect(sql).toMatch(/alter view public\.departure_group_payment_summaries set \(security_invoker = true\)/);
  });

  it("changes no table and no column", () => {
    expect(sql).not.toMatch(/alter table|drop table|drop column|delete from|insert into|update public/i);
  });
});
