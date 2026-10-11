import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * TASK-041 (F1, F2). The behavioural proof lives in supabase/tests/database/packages_policies_agency_and_role.test.sql and needs a database. These checks
 * run in the normal suite and guard the migration's shape: every staff policy on `packages` names an agency check, and the write policies name a role check.
 */
const sql = readFileSync(join(process.cwd(), "supabase/migrations/20270119090000_packages_policies_agency_and_role.sql"), "utf8").replace(/^\s*--.*$/gm, "");

function policyBlock(name: string): string {
  const start = sql.indexOf(`create policy "${name}"`);
  expect(start, `policy "${name}" is created`).toBeGreaterThan(-1);
  const end = sql.indexOf("create policy", start + 1);
  return sql.slice(start, end === -1 ? undefined : end);
}

describe("packages policies migration", () => {
  it.each(["staff read packages", "staff insert packages", "staff update packages", "staff delete packages"])("%s checks the caller's agency", (name) => {
    expect(policyBlock(name)).toMatch(/agency_id = \(select public\.current_agency_id\(\)\)/);
  });

  it.each(["staff read packages", "staff insert packages", "staff update packages", "staff delete packages"])("%s checks the caller's role", (name) => {
    expect(policyBlock(name)).toMatch(/public\.staff_role_in\(/);
  });

  it("never falls back to an always-true condition", () => {
    expect(sql).not.toMatch(/\band true\b/i);
    expect(sql).not.toMatch(/using\s*\(\s*true\s*\)/i);
  });

  it("checks the agency on both sides of an update, so a row cannot be moved to another agency", () => {
    const update = policyBlock("staff update packages");
    expect(update.match(/agency_id = \(select public\.current_agency_id\(\)\)/g)).toHaveLength(2);
    expect(update).toMatch(/with check/);
  });

  it("keeps the insert owner check and the MARKETING Draft restriction", () => {
    const insert = policyBlock("staff insert packages");
    expect(insert).toMatch(/owner_id = \(select auth\.uid\(\)\)/);
    expect(insert).toMatch(/status = 'Draft'/);
    expect(insert).toMatch(/featured = false/);
  });

  it("allows only ADMIN to delete and keeps GUIDE out of reading", () => {
    expect(policyBlock("staff delete packages")).toMatch(/staff_role_in\('ADMIN'\)/);
    expect(policyBlock("staff read packages")).not.toMatch(/GUIDE/);
  });

  it("is idempotent and changes no table, column or row", () => {
    expect(sql).toMatch(/drop policy if exists "staff insert packages"/);
    expect(sql).not.toMatch(/alter table|drop table|delete from|insert into|update public/i);
  });
});
