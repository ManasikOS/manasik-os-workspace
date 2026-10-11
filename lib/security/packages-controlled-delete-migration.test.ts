import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * TASK-043 Phase 3 (PKG-10). The behavioural proof lives in supabase/tests/database/packages_controlled_delete.test.sql and needs a database.
 * These checks run in the normal suite and guard the migration's shape.
 */
const sql = readFileSync(join(process.cwd(), "supabase/migrations/20270120090600_packages_controlled_delete.sql"), "utf8")
  .replace(/\r\n/g, "\n")
  .replace(/^\s*--.*$/gm, "");

function functionBody(name: string): string {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  expect(start, `${name} is defined`).toBeGreaterThan(-1);
  const end = sql.indexOf("\n$$;", sql.indexOf("$$", start) + 2);
  expect(end, `${name} ends`).toBeGreaterThan(start);
  return sql.slice(start, end);
}

describe("controlled delete migration", () => {
  it("removes the DELETE policy so nobody deletes by writing to the table", () => {
    expect(sql).toMatch(/drop policy if exists "staff delete packages" on public\.packages/);
    expect(sql).not.toMatch(/create policy "staff delete packages"/);
  });

  it("keeps an append-only record with no write policy or privilege, readable only by the ADMIN tier of the same agency", () => {
    expect(sql).toMatch(/revoke insert, update, delete on public\.package_deletions from anon, authenticated/);
    expect(sql).not.toMatch(/create policy "[^"]*" on public\.package_deletions\s+for (insert|update|delete|all)/);
    const start = sql.indexOf('create policy "admin read package deletions"');
    const policy = sql.slice(start, sql.indexOf(";\n", start));
    expect(policy).toContain("staff_role_in('ADMIN')");
    expect(policy).toMatch(/agency_id = \(select public\.current_agency_id\(\)\)/);
    expect(sql).toMatch(/char_length\(btrim\(reason\)\) between 1 and 500/);
  });

  describe.each(["delete_package", "package_delete_impact"])("%s", (name) => {
    const body = functionBody(name);

    it("is security definer with a fixed search_path and needs the ADMIN tier AND the deletePackage capability, then an agency", () => {
      expect(body).toMatch(/security definer/);
      expect(body).toMatch(/set search_path to 'public'/);
      expect(body).toContain("not coalesce(public.staff_role_in('ADMIN'), false)");
      expect(body).toContain("has_package_capability('deletePackage')");
      expect(body.indexOf("Your role cannot delete packages.")).toBeLessThan(body.indexOf("Your session has no active agency."));
    });

    it("looks the package up inside the caller's agency", () => {
      expect(body).toMatch(/agency_id = v_agency/);
    });
  });

  describe("delete_package", () => {
    const body = functionBody("delete_package");

    it("needs a reason, locks the row, compares updated_at and allows only a Draft or an Archived package", () => {
      expect(body).toContain("A reason is required to delete a package.");
      expect(body).toMatch(/for update;/);
      expect(body).toContain("v_pkg.updated_at is distinct from p_expected_updated_at");
      expect(body).toContain("v_pkg.status not in ('Draft', 'Archived')");
    });

    it("requires the typed code (or the first 8 characters of the id when there is none)", () => {
      expect(body).toContain("left(v_pkg.id::text, 8)");
      expect(body).toContain("The confirmation text does not match the package code.");
    });

    it("refuses while groups, snapshots, quotes or agent submissions refer to the package", () => {
      expect(body).toContain("'departureGroups'");
      expect(body).toContain("'groupSnapshots'");
      expect(body).toContain("'leadQuotes'");
      expect(body).toContain("'agentSubmissions'");
      expect(body).toMatch(/This package cannot be deleted — departure groups use it/);
      expect(body).toMatch(/This package cannot be deleted — lead quotes or agent booking submissions refer to it/);
    });

    it("copies the package, its activity, versions and change requests into the record BEFORE deleting", () => {
      const record = body.indexOf("insert into public.package_deletions");
      const remove = body.indexOf("delete from public.packages");
      expect(record).toBeGreaterThan(-1);
      expect(remove).toBeGreaterThan(record);
      for (const source of ["to_jsonb(v_pkg)", "public.package_activity_logs", "public.package_versions", "public.package_change_requests"]) {
        expect(body.slice(record, remove)).toContain(source);
      }
    });
  });

  it("counts every table that points at a package, so nothing is removed or unlinked unannounced", () => {
    const body = functionBody("package_delete_impact");
    for (const table of [
      "departure_groups", "departure_group_package_snapshots", "lead_quotes", "agent_booking_submissions", "leads", "campaigns",
      "agent_package_allocations", "package_content", "package_faqs", "package_media", "package_seo_analyses", "package_change_requests",
    ]) {
      expect(body, table).toContain(`public.${table}`);
    }
  });

  it("grants both functions to signed-in users only", () => {
    expect(sql).toMatch(/revoke all on function public\.delete_package\(uuid, timestamptz, text, text\) from public, anon/);
    expect(sql).toMatch(/revoke all on function public\.package_delete_impact\(uuid\) from public, anon/);
  });
});
