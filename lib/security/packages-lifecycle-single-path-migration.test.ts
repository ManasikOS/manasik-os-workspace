import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * TASK-043 Phase 1 (PKG-01, PKG-05). The behavioural proof lives in
 * supabase/tests/database/packages_lifecycle_single_path.test.sql and needs a database. These checks run in the normal suite and guard the
 * shape of the two migrations: the guard names every lifecycle column, the publish function can only write allow-listed columns, the
 * version writer takes no content from the caller, and the grants stay closed.
 */
const read = (name: string) =>
  readFileSync(join(process.cwd(), "supabase/migrations", name), "utf8").replace(/\r\n/g, "\n").replace(/^\s*--.*$/gm, "");

const basics = read("20270120090000_packages_phase1_hardening_basics.sql");
const single = read("20270120090100_packages_lifecycle_single_path.sql");

function functionBody(sql: string, name: string): string {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  expect(start, `${name} is defined`).toBeGreaterThan(-1);
  const end = sql.indexOf("\n$$;", sql.indexOf("$$", start) + 2);
  expect(end, `${name} ends`).toBeGreaterThan(start);
  return sql.slice(start, end);
}

const LIFECYCLE_COLUMNS = ["status", "previous_status", "archived_at", "published_at", "published_version_id"];

describe("packages hardening basics migration", () => {
  it("pins the search_path of staff_role_in and keeps its signature and result", () => {
    const body = functionBody(basics, "staff_role_in");
    expect(body).toContain("variadic roles text[]");
    expect(body).toMatch(/set search_path = public/);
    expect(body).toContain("coalesce(public.current_staff_role() = any(roles), false)");
  });

  it("removes PUBLIC and anon from the list function and keeps signed-in staff", () => {
    expect(basics).toMatch(/revoke execute on function public\.list_packages_with_usage\(text, uuid\) from public, anon/);
    expect(basics).toMatch(/grant execute on function public\.list_packages_with_usage\(text, uuid\) to authenticated/);
  });

  it("caps the activity-log reason without rewriting existing rows", () => {
    expect(basics).toMatch(/char_length\(reason\) <= 500\) not valid/);
  });

  it("changes no policy, table data or column", () => {
    expect(basics).not.toMatch(/create policy|drop policy|delete from|insert into|update public|drop column/i);
  });
});

describe("packages lifecycle single-path migration", () => {
  it("guards every lifecycle column on insert and on update, for direct API callers only", () => {
    const body = functionBody(single, "packages_guard_lifecycle_columns");
    for (const column of LIFECYCLE_COLUMNS) {
      expect(body, `new.${column}`).toContain(`new.${column}`);
      expect(body, `old.${column}`).toContain(`old.${column}`);
    }
    expect(body).toContain("current_user not in ('authenticated', 'anon')");
    expect(body).toMatch(/errcode = '42501'/);
    expect(single).toMatch(/before insert or update on public\.packages/);
  });

  it("is not a security definer function, so current_user is the real caller", () => {
    expect(functionBody(single, "packages_guard_lifecycle_columns")).not.toMatch(/security definer/);
  });

  it("builds a version from the package row and takes no content from the caller", () => {
    const body = functionBody(single, "packages_record_version");
    expect(body).toContain("to_jsonb(v_pkg)");
    expect(body).not.toMatch(/p_snapshot/);
    expect(single).toMatch(/revoke all on function public\.packages_record_version\(uuid\) from public, anon, authenticated/);
  });

  it("records a version inside the status transition, in the same transaction, only when the package becomes sellable", () => {
    const body = functionBody(single, "packages_apply_status_transition");
    expect(body).toMatch(/if p_to_status = 'Open for Sale' then\s+perform public\.packages_record_version\(p_package_id\)/);
    expect(body.indexOf("insert into public.package_activity_logs")).toBeLessThan(body.indexOf("packages_record_version"));
  });

  it("keeps package_versions_create's signature but ignores the caller's snapshot and closes it to signed-in users", () => {
    const body = functionBody(single, "package_versions_create");
    expect(body).toContain("(p_package_id uuid, p_snapshot jsonb)");
    expect(body).toContain("return public.packages_record_version(p_package_id)");
    expect(body.replace(/--[^\n]*/g, "")).not.toMatch(/p_snapshot[^\n]*(insert|into|=)/);
    expect(single).toMatch(/revoke all on function public\.package_versions_create\(uuid, jsonb\) from public, anon, authenticated/);
    expect(single).not.toMatch(/grant execute on function public\.package_versions_create\(uuid, jsonb\) to authenticated/);
  });

  describe("publish_package_with_content", () => {
    const body = functionBody(single, "publish_package_with_content");
    const columnsSql = read("20270120090060_packages_content_columns_and_tiers.sql");
    const columnsStart = columnsSql.indexOf("create or replace function public.package_content_columns()");
    const allowed = columnsSql.slice(columnsSql.indexOf("array[", columnsStart), columnsSql.indexOf("]::text[]", columnsStart));

    it("is security definer with a fixed search_path and refuses non ADMIN/OPERATIONS and no-agency callers first", () => {
      expect(body).toMatch(/security definer/);
      expect(body).toMatch(/set search_path to 'public'/);
      expect(body).toContain("not coalesce(public.staff_role_in('ADMIN', 'OPERATIONS'), false)");
      expect(body).toContain("Your session has no active agency.");
      expect(body.indexOf("Your role cannot publish packages.")).toBeLessThan(body.indexOf("Your session has no active agency."));
    });

    it("can never write status, featured, ownership, agency or any lifecycle column", () => {
      for (const forbidden of [...LIFECYCLE_COLUMNS, "featured", "owner_id", "agency_id", "id", "created_at", "updated_at"]) {
        expect(allowed, forbidden).not.toMatch(new RegExp(`'${forbidden}'`));
      }
    });

    it("writes exactly the columns the wizard's draft row contains", () => {
      const mappers = readFileSync(join(process.cwd(), "app/(main)/packages/create-package/mappers.ts"), "utf8");
      const rowBody = mappers.slice(mappers.indexOf("export function formDataToRow"), mappers.indexOf("export function formDataToDraftRow"));
      const wizardColumns = [...rowBody.matchAll(/^\s{4}([a-z_]+):/gm)].map((match) => match[1]).filter((column) => !["status", "featured"].includes(column));
      const allowedColumns = [...allowed.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
      expect([...allowedColumns].sort()).toEqual([...wizardColumns].sort());
      const applySql = columnsSql.slice(columnsSql.indexOf("create or replace function public.packages_apply_content"));
      for (const column of allowedColumns) expect(applySql, column).toContain(`${column} = r.${column}`);
    });

    it("writes the content through the shared apply function and reads its allow-list from package_content_columns()", () => {
      expect(body).toContain("public.packages_apply_content(v_id, p_content)");
      expect(body).toContain("public.package_content_columns()");
    });

    it("locks the row, compares updated_at, and only publishes from Draft or Sales Closed", () => {
      expect(body).toMatch(/for update/);
      expect(body).toContain("p_expected_updated_at is not null and v_updated is distinct from p_expected_updated_at");
      expect(body).toContain("array['Draft', 'Sales Closed'], 'Open for Sale'");
      expect(body).toContain("agency_id = v_agency");
    });

    it("is granted to signed-in users but not to anon or PUBLIC", () => {
      expect(single).toMatch(/revoke all on function public\.publish_package_with_content\(uuid, jsonb, timestamptz\) from public, anon/);
      expect(single).toMatch(/grant execute on function public\.publish_package_with_content\(uuid, jsonb, timestamptz\) to authenticated/);
    });
  });

  it("changes no policy and no table", () => {
    expect(single).not.toMatch(/create policy|drop policy|alter table|drop table|delete from/i);
  });
});
