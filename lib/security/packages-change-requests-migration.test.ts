import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { itineraryStructureChanged, PACKAGE_CONTENT_COLUMNS, packageFieldTier } from "@/lib/access/package-field-tiers";

/**
 * TASK-043 Phase 1, step 2. The behavioural proof lives in supabase/tests/database/packages_change_requests.test.sql and needs a database.
 * These checks run in the normal suite: the TypeScript tier table equals the SQL one, and the migration's functions keep their guards.
 */
const read = (name: string) =>
  readFileSync(join(process.cwd(), "supabase/migrations", name), "utf8").replace(/\r\n/g, "\n").replace(/^\s*--.*$/gm, "");

const columnsSql = read("20270120090060_packages_content_columns_and_tiers.sql");
const requests = read("20270120090400_packages_change_requests.sql");

function functionBody(sql: string, name: string): string {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  expect(start, `${name} is defined`).toBeGreaterThan(-1);
  const end = sql.indexOf("\n$$;", sql.indexOf("$$", start) + 2);
  expect(end, `${name} ends`).toBeGreaterThan(start);
  return sql.slice(start, end);
}

/** Every quoted word inside the array literal(s) that follow `marker` up to the closing `]`. */
function quotedList(sql: string, marker: string): string[] {
  const start = sql.indexOf(marker);
  expect(start, marker).toBeGreaterThan(-1);
  const open = sql.indexOf("array[", start);
  return [...sql.slice(open, sql.indexOf("]", open)).matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
}

describe("the field-tier table", () => {
  const contentBody = functionBody(columnsSql, "package_content_columns");
  const sqlColumns = [...contentBody.slice(contentBody.indexOf("array["), contentBody.indexOf("]::text[]")).matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
  const tierBody = functionBody(columnsSql, "package_field_tier");
  const sqlTier1 = quotedList(tierBody, "when p_column = any (array['payment_milestones'");
  const sqlBasic = quotedList(tierBody.slice(tierBody.indexOf("when p_column = any (array[\n")), "when p_column = any (array[\n");

  it("lists the same content columns, in the same order, in TypeScript and SQL", () => {
    expect(sqlColumns).toEqual([...PACKAGE_CONTENT_COLUMNS]);
  });

  it("classifies every column the same way in TypeScript and SQL", () => {
    for (const column of PACKAGE_CONTENT_COLUMNS) {
      const sqlValue = sqlTier1.includes(column) ? 1 : sqlBasic.includes(column) ? 0 : 2;
      expect(packageFieldTier(column), column).toBe(sqlValue);
    }
  });

  it("never lists status, featured, ownership or a lifecycle column as content", () => {
    for (const forbidden of ["status", "featured", "owner_id", "agency_id", "id", "previous_status", "archived_at", "published_at", "published_version_id", "updated_at"]) {
      expect(PACKAGE_CONTENT_COLUMNS as readonly string[]).not.toContain(forbidden);
    }
  });

  it("puts the payment and contract terms in Tier 1 and treats an unlisted column as Tier 2", () => {
    for (const column of ["payment_milestones", "payment_terms", "cancellation_policy", "late_payment_policy", "price_change_disclaimer"]) {
      expect(packageFieldTier(column), column).toBe(1);
    }
    expect(packageFieldTier("title")).toBe(0);
    expect(packageFieldTier("some_future_column")).toBe(2);
  });

  it("agrees with the SQL itinerary rule: wording is basic, days / numbering / category are structure", () => {
    const base = [{ id: "a", dayNumber: 1, category: "Flight", title: "Depart" }];
    expect(itineraryStructureChanged(base, [{ ...base[0], title: "Departure day" }])).toBe(false);
    expect(itineraryStructureChanged(base, [{ ...base[0], category: "Hotel" }])).toBe(true);
    expect(itineraryStructureChanged(base, [{ ...base[0], dayNumber: 2 }])).toBe(true);
    expect(itineraryStructureChanged(base, [...base, { id: "b", dayNumber: 2, category: "Hotel" }])).toBe(true);
    const sqlBody = functionBody(columnsSql, "package_itinerary_structure_changed");
    expect(sqlBody).toContain("e -> 'id', e -> 'dayNumber', e -> 'category'");
  });
});

describe("the approval switches", () => {
  it("add two boolean columns that default to ON", () => {
    expect(requests).toMatch(/package_approval_money_contract boolean not null default true/);
    expect(requests).toMatch(/package_approval_bookings_ops boolean not null default true/);
  });

  it("can be changed only by an administrator who holds the policy capability, and every change is logged", () => {
    const guard = functionBody(requests, "agency_settings_guard_package_approval");
    expect(guard).toContain("has_package_approval_policy_capability()");
    expect(guard).toMatch(/errcode = '42501'/);
    expect(guard).toContain("insert into public.settings_activity_logs");
    expect(functionBody(requests, "has_package_approval_policy_capability")).toContain("staff_role_in('ADMIN')");
    expect(requests).toMatch(/before update on public\.agency_settings/);
  });

  it("treats a missing settings row as approval required", () => {
    expect(functionBody(requests, "package_change_requires_approval")).toMatch(/\s+true\)\s*$/);
  });
});

describe("package_change_requests", () => {
  it("has no write policy and no write privilege for signed-in users, and one pending request per package", () => {
    expect(requests).not.toMatch(/create policy "[^"]*" on public\.package_change_requests\s+for (insert|update|delete|all)/);
    expect(requests).toMatch(/revoke insert, update, delete on public\.package_change_requests from anon, authenticated/);
    expect(requests).toMatch(/package_change_requests_one_pending[\s\S]*where status = 'PENDING'/);
  });

  it("limits reading to the requester or ADMIN/CEO/OPERATIONS who can read the package", () => {
    const start = requests.indexOf('create policy "staff read package change requests"');
    const policy = requests.slice(start, requests.indexOf(";\n", start));
    expect(policy).toContain("requested_by = (select auth.uid())");
    expect(policy).toContain("staff_role_in('ADMIN', 'CEO', 'OPERATIONS')");
    expect(policy).toContain("exists (select 1 from public.packages p where p.id = package_change_requests.package_id)");
    expect(policy).toMatch(/agency_id = \(select public\.current_agency_id\(\)\)/);
  });

  it("requires a reason of 1 to 500 characters and a non-empty change set", () => {
    expect(requests).toMatch(/char_length\(btrim\(reason\)\) between 1 and 500/);
    expect(requests).toMatch(/changes <> '\{\}'::jsonb/);
  });
});

describe("submit_package_change", () => {
  const body = functionBody(requests, "submit_package_change");

  it("is security definer with a fixed search_path and checks tier, editPackage and agency first", () => {
    expect(body).toMatch(/security definer/);
    expect(body).toMatch(/set search_path to 'public'/);
    expect(body).toContain("not coalesce(public.staff_role_in('ADMIN', 'OPERATIONS'), false)");
    expect(body).toContain("has_package_capability('editPackage')");
    expect(body.indexOf("Your role cannot edit packages.")).toBeLessThan(body.indexOf("Your session has no active agency."));
  });

  it("accepts only allow-listed columns, requires the last-seen time, and locks the row", () => {
    expect(body).toContain("k <> all (public.package_content_columns())");
    expect(body).toContain("p_expected_updated_at is null");
    expect(body).toMatch(/for update;/);
    expect(body).toContain("v_row.updated_at is distinct from p_expected_updated_at");
  });

  it("works only on a package that is Open for Sale or Sales Closed", () => {
    expect(body).toContain("v_row.status not in ('Open for Sale', 'Sales Closed')");
  });

  it("needs editSensitiveTerms and a reason before any sensitive change, and sends approval-required tiers to a pending request", () => {
    expect(body).toContain("has_package_capability('editSensitiveTerms')");
    expect(body).toContain("A reason is required for changes to payment or booking terms.");
    expect(body).toContain("public.package_change_requires_approval(v_tier)");
    expect(body).toMatch(/'PENDING'/);
    expect(body).toMatch(/'APPLIED'/);
  });

  it("raises the itinerary to Tier 2 when its structure changes", () => {
    expect(body).toMatch(/v_key = 'itinerary' and public\.package_itinerary_structure_changed\(v_old, v_new\)/);
  });

  it("refuses a second pending request unless told to replace it, and never writes status or featured", () => {
    expect(body).toContain("Another change is already waiting for approval for this package.");
    expect(body).toContain("p_supersede");
    expect(body).not.toMatch(/update public\.packages[^;]*status/);
    expect(body).not.toMatch(/featured/);
  });

  it("records a version only when the package is Open for Sale", () => {
    expect(body).toMatch(/if v_row\.status = 'Open for Sale' then\s+v_version := public\.packages_record_version\(p_package_id\)/);
  });

  it("is not executable by anon or PUBLIC", () => {
    expect(requests).toMatch(/revoke all on function public\.submit_package_change\(uuid, jsonb, timestamptz, text, boolean\) from public, anon/);
  });
});

describe("decide_package_change", () => {
  const body = functionBody(requests, "decide_package_change");

  it("needs the approval capability and refuses your own request", () => {
    expect(body).toContain("has_package_capability('approvePackageChanges')");
    expect(body).toContain("v_req.requested_by is not distinct from v_actor");
    expect(body).toContain("You cannot approve your own change.");
  });

  it("only acts on a pending, unexpired request and requires a note to reject", () => {
    expect(body).toContain("v_req.status <> 'PENDING'");
    expect(body).toContain("v_req.expires_at <= now()");
    expect(body).toContain("A note is required when a change is rejected.");
  });

  it("applies a change only if every changed column still holds the value the request was made against", () => {
    expect(body).toContain("is distinct from (v_req.changes -> v_key -> 'old')");
    expect(body).toMatch(/errcode = '40001'/);
    expect(body.indexOf("is distinct from (v_req.changes")).toBeLessThan(body.indexOf("packages_apply_content"));
  });

  it("applies through the shared function, versions an Open for Sale package and logs it", () => {
    expect(body).toContain("public.packages_apply_content(v_req.package_id, v_content)");
    expect(body).toMatch(/if v_pkg\.status = 'Open for Sale' then\s+v_version := public\.packages_record_version/);
    expect(body).toContain("'CHANGE_APPLIED'");
  });
});

describe("withdraw_package_change and the guards", () => {
  it("lets only the requester or an approver withdraw a pending request", () => {
    const body = functionBody(requests, "withdraw_package_change");
    expect(body).toContain("v_req.status <> 'PENDING'");
    expect(body).toContain("v_req.requested_by is distinct from v_actor and not coalesce(public.has_package_capability('approvePackageChanges'), false)");
  });

  it("stops a direct API write from changing a Tier 1/2 column of a package on sale, or any content column of an archived one", () => {
    const body = functionBody(requests, "packages_guard_live_terms");
    expect(body).not.toMatch(/security definer/);
    expect(body).toContain("current_user not in ('authenticated', 'anon')");
    expect(body).toContain("old.status = 'Archived'");
    expect(body).toContain("old.status in ('Open for Sale', 'Sales Closed')");
    expect(body).toContain("public.package_field_tier(v_column) > 0");
    expect(requests).toMatch(/before update on public\.packages\s+for each row execute function public\.packages_guard_live_terms\(\)/);
  });

  it("adds the CHANGE_APPLIED action type and keeps the old ones", () => {
    for (const type of ["PUBLISHED", "SALES_CLOSED", "REOPENED", "ARCHIVED", "RESTORED", "CHANGE_APPLIED"]) {
      expect(requests).toContain(`'${type}'`);
    }
  });
});
