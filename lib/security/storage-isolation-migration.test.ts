import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * TASK-029 P2.4 finding F1. The behavioural proof lives in supabase/tests/database/storage_tenant_isolation.test.sql and needs a
 * database. These checks run in the normal suite and guard the migration's shape, so it cannot quietly lose an agency check.
 */
const root = process.cwd();
const migration = readFileSync(join(root, "supabase/migrations/20261230090000_fix_pilgrim_documents_storage_isolation.sql"), "utf8");
const original = readFileSync(join(root, "supabase/migrations/20260827090000_tenant_storage_isolation.sql"), "utf8");
const code = (sql: string) => sql.replace(/^--.*$/gm, "");

function policyBlock(sql: string, name: string): string {
  const start = sql.indexOf(`create policy "${name}"`);
  expect(start, `${name} is created`).toBeGreaterThan(-1);
  const end = sql.indexOf(";", start);
  return sql.slice(start, end);
}

const PILGRIM_POLICIES = ["staff read pilgrim documents", "staff upload pilgrim documents", "staff update pilgrim documents", "staff delete pilgrim documents"];
const WHATSAPP_POLICIES = ["staff read whatsapp media", "staff write whatsapp media"];

describe("pilgrim-documents and whatsapp-media storage isolation migration", () => {
  const sql = code(migration);

  it.each([...PILGRIM_POLICIES, ...WHATSAPP_POLICIES])("%s is dropped and re-created with an agency folder check and a role check", (name) => {
    expect(sql).toContain(`drop policy if exists "${name}" on storage.objects;`);
    expect(sql.indexOf(`drop policy if exists "${name}"`)).toBeLessThan(sql.indexOf(`create policy "${name}"`));
    const block = policyBlock(sql, name);
    expect(block).toContain("(storage.foldername(name))[1] = (select public.current_agency_id())::text");
    expect(block).toContain("public.staff_role_in(");
    expect(block).toContain("to authenticated");
  });

  it("gives the pilgrim document policies exactly the role lists the original scoping migration defined", () => {
    for (const name of PILGRIM_POLICIES) {
      const wanted = policyBlock(code(original), name).match(/staff_role_in\(([^)]*)\)/)?.[1];
      expect(wanted, `original role list for ${name}`).toBeTruthy();
      expect(policyBlock(sql, name)).toContain(`staff_role_in(${wanted})`);
    }
  });

  it("never leaves a policy that checks only the bucket name", () => {
    expect(sql).not.toMatch(/using\s*\(\s*bucket_id = 'pilgrim-documents'\s*\)/);
    expect(sql).not.toMatch(/with check\s*\(\s*bucket_id = '(pilgrim-documents|whatsapp-media)'\s*\)/);
  });

  it("fails the migration if any policy on either bucket still lacks the agency check", () => {
    expect(sql).toMatch(/raise exception 'Tenant isolation:/);
    expect(sql).toContain("not like '%current_agency_id%'");
  });

  it("changes policies only: no table, column, bucket or data change", () => {
    expect(sql).not.toMatch(/\b(create|alter|drop)\s+(table|index|function|trigger)\b/i);
    expect(sql).not.toMatch(/storage\.buckets/);
    expect(sql).not.toMatch(/\b(update|delete)\s+(from\s+)?storage\.objects\b/i);
    expect(sql).not.toMatch(/insert into/i);
  });

  it("leaves the already scoped support-case attachment policies alone", () => {
    expect(sql).not.toContain("support case attachments");
  });
});

describe("storage_tenant_isolation.test.sql", () => {
  const test = readFileSync(join(root, "supabase/tests/database/storage_tenant_isolation.test.sql"), "utf8");

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
