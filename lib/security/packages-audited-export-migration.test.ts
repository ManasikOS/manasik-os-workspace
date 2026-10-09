import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * TASK-043 Phase 3 (PKG-17). The behavioural proof lives in supabase/tests/database/packages_audited_export.test.sql and needs a database.
 * These checks run in the normal suite and guard the migration's shape.
 */
const sql = readFileSync(join(process.cwd(), "supabase/migrations/20270120090700_packages_audited_export.sql"), "utf8")
  .replace(/\r\n/g, "\n")
  .replace(/^\s*--.*$/gm, "");

describe("audited export migration", () => {
  it("keeps an append-only log with no write privilege, readable only by the ADMIN tier of the same agency", () => {
    expect(sql).toMatch(/revoke insert, update, delete on public\.package_export_logs from anon, authenticated/);
    expect(sql).not.toMatch(/create policy "[^"]*" on public\.package_export_logs\s+for (insert|update|delete|all)/);
    const start = sql.indexOf('create policy "admin read package export logs"');
    const policy = sql.slice(start, sql.indexOf(";\n", start));
    expect(policy).toContain("staff_role_in('ADMIN')");
    expect(policy).toMatch(/agency_id = \(select public\.current_agency_id\(\)\)/);
  });

  describe("authorise_package_export", () => {
    const start = sql.indexOf("create or replace function public.authorise_package_export(");
    const body = sql.slice(start, sql.indexOf("\n$$;", start));

    it("is security definer with a fixed search_path", () => {
      expect(body).toMatch(/security definer/);
      expect(body).toMatch(/set search_path to 'public'/);
    });

    it("checks the exportCatalogue capability before the agency", () => {
      expect(body).toContain("has_package_capability('exportCatalogue')");
      expect(body.indexOf("Your role cannot export packages.")).toBeLessThan(body.indexOf("Your session has no active agency."));
    });

    it("limits each person to 10 exports an hour, serialised so two at once cannot both slip through", () => {
      expect(body).toContain("c_limit constant integer := 10");
      expect(body).toContain("pg_advisory_xact_lock");
      expect(body.indexOf("pg_advisory_xact_lock")).toBeLessThan(body.indexOf("from public.package_export_logs"));
      expect(body).toMatch(/interval '1 hour'/);
      expect(body).toContain("You have reached the limit of % exports an hour.");
    });

    it("records the export in the caller's own agency, after every check", () => {
      expect(body.indexOf("insert into public.package_export_logs")).toBeGreaterThan(body.indexOf("You have reached the limit"));
      expect(body).toMatch(/values \(v_agency, v_actor,/);
    });
  });

  it("grants the function to signed-in users only", () => {
    expect(sql).toMatch(/revoke all on function public\.authorise_package_export\(text, integer, jsonb\) from public, anon/);
  });
});
