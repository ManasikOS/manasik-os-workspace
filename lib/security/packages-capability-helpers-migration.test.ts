import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { capabilitiesForPackages, type PackageCapabilities } from "@/lib/access/packages-access";
import type { StaffRole } from "@/lib/access/departure-groups-access";

/**
 * TASK-043 Phase 1 (PKG-04). The behavioural proof lives in supabase/tests/database/packages_capability_enforcement.test.sql and needs a database.
 * These checks run in the normal suite: the SQL tier defaults must equal the TypeScript ones, and the policies / trigger / functions must name a capability.
 */
const read = (name: string) =>
  readFileSync(join(process.cwd(), "supabase/migrations", name), "utf8").replace(/\r\n/g, "\n").replace(/^\s*--.*$/gm, "");

const helpers = read("20270120090050_packages_capability_helpers.sql");
const enforcement = read("20270120090300_packages_capability_enforcement.sql");

/** The keys the SQL default function lists for one tier, read straight from its text. */
function sqlDefaultsFor(role: string): string[] {
  const start = helpers.indexOf(`when '${role}' then p_key = any (array[`);
  expect(start, `${role} has a default list`).toBeGreaterThan(-1);
  const end = helpers.indexOf("])", start);
  return [...helpers.slice(start, end).matchAll(/'([A-Za-z]+)'/g)].map((match) => match[1]).filter((key) => key !== role);
}

const ROLES: StaffRole[] = ["ADMIN", "CEO", "OPERATIONS", "FINANCE", "MARKETING", "VISA", "GUIDE"];

describe("package tier defaults in SQL match packages-access.ts", () => {
  it.each(ROLES)("%s has the same default capabilities in TypeScript and SQL", (role) => {
    const fromTypeScript = (Object.entries(capabilitiesForPackages(role)) as [keyof PackageCapabilities, boolean][])
      .filter(([, allowed]) => allowed)
      .map(([key]) => key as string)
      .sort();
    const fromSql = role === "GUIDE" ? [] : sqlDefaultsFor(role).sort();
    expect(fromSql).toEqual(fromTypeScript);
  });
});

describe("has_package_capability", () => {
  const start = helpers.indexOf("create or replace function public.has_package_capability(");
  const body = helpers.slice(start, helpers.indexOf("$$;", helpers.indexOf("as $$", start)));

  it("is security definer with a fixed search_path, reads only the caller's own role, and denies a caller with no profile", () => {
    expect(body).toMatch(/security definer/);
    expect(body).toMatch(/set search_path = public/);
    expect(body).toContain("where sp.id = auth.uid()");
    expect(body).toMatch(/if v_role is null then\s+return false;/);
  });

  it("grants only on boolean true and falls back to the tier default for a missing key or row", () => {
    expect(body).toContain("(v_caps -> p_key) = 'true'::jsonb");
    expect(body).toContain("not (v_caps ? p_key)");
    expect(body).toContain("public.package_tier_default_capability(v_role, p_key)");
  });

  it("is not executable by anon or PUBLIC", () => {
    expect(helpers).toMatch(/revoke all on function public\.has_package_capability\(text\) from public, anon/);
    expect(helpers).toMatch(/grant execute on function public\.has_package_capability\(text\) to authenticated/);
  });
});

describe("packages capability enforcement migration", () => {
  function policyBlock(name: string): string {
    const start = enforcement.indexOf(`create policy "${name}"`);
    expect(start, `policy "${name}" is created`).toBeGreaterThan(-1);
    return enforcement.slice(start, enforcement.indexOf(";\n", start));
  }

  it("keeps the agency and tier checks and adds the right capability to each write policy", () => {
    const insert = policyBlock("staff insert packages");
    expect(insert).toMatch(/agency_id = \(select public\.current_agency_id\(\)\)/);
    expect(insert).toContain("owner_id = (select auth.uid())");
    expect(insert).toContain("has_package_capability('createPackage')");
    expect(insert).toContain("has_package_capability('duplicatePackage')");
    expect(insert).toContain("status = 'Draft'");

    const update = policyBlock("staff update packages");
    expect(update.match(/agency_id = \(select public\.current_agency_id\(\)\)/g)).toHaveLength(2);
    expect(update.match(/has_package_capability\('toggleFeatured'\)/g)!.length).toBeGreaterThanOrEqual(4);
    expect(update).toContain("has_package_capability('editPackage')");
    expect(update).toContain("status = 'Open for Sale' or owner_id = (select auth.uid())");

    const remove = policyBlock("staff delete packages");
    expect(remove).toContain("staff_role_in('ADMIN')");
    expect(remove).toContain("has_package_capability('deletePackage')");
  });

  it("never falls back to an always-true condition", () => {
    expect(enforcement).not.toMatch(/\band true\b|using\s*\(\s*true\s*\)/i);
  });

  describe("column-scope trigger", () => {
    const start = enforcement.indexOf("create or replace function public.packages_enforce_marketing_column_scope()");
    const body = enforcement.slice(start, enforcement.indexOf("$$;", enforcement.indexOf("as $$", start)));

    it("is SECURITY INVOKER so current_user is the real caller", () => {
      expect(body).not.toMatch(/security definer/);
      expect(body).toContain("current_user not in ('authenticated', 'anon')");
    });

    it("lets editPackage change any column, toggleFeatured only featured, and refuses the rest", () => {
      expect(body).toContain("has_package_capability('editPackage')");
      expect(body).toContain("has_package_capability('toggleFeatured')");
      expect(body).toMatch(/array\['featured', 'updated_at'\]/);
      expect(body).toMatch(/raise exception 'Your role cannot update packages\.'/);
    });
  });

  it.each([
    ["publish_package", "publishPackage"],
    ["close_package_sales", "publishPackage"],
    ["reopen_package", "publishPackage"],
    ["archive_package", "archiveOrRestorePackage"],
    ["restore_package", "archiveOrRestorePackage"],
  ])("%s requires the %s capability as well as the ADMIN/OPERATIONS tier", (name, capability) => {
    const start = enforcement.indexOf(`create or replace function public.${name}(`);
    expect(start, `${name} is redefined`).toBeGreaterThan(-1);
    const body = enforcement.slice(start, enforcement.indexOf("\n$$;", start));
    expect(body).toContain("not coalesce(public.staff_role_in('ADMIN', 'OPERATIONS'), false)");
    expect(body).toContain(`has_package_capability('${capability}')`);
    expect(body).toContain("Your session has no active agency.");
    expect(body).not.toMatch(/current_staff_role\(\)\s+not\s+in/);
  });

  it("keeps the force-archive rule limited to the ADMIN tier", () => {
    expect(enforcement).toContain("if not coalesce(public.staff_role_in('ADMIN'), false) then");
  });

  it("ends with a guard that fails the migration if a wrapper lacks a capability check", () => {
    expect(enforcement).toMatch(/raise exception 'Package capability enforcement:/);
  });
});
