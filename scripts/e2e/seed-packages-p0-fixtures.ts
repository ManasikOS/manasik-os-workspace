import { loadEnvConfig } from "@next/env";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  PACKAGES_FIXTURE_CODE_PREFIX,
  assertPackagesFixtureTarget,
  buildFixtureForm,
  buildFixtureRow,
  bulkFixtureCode,
  packagesFixtureAgency,
  packagesFixtureOtherAgencyPlan,
  packagesFixtureOtherAgencySlug,
  packagesFixturePlans,
  packagesFixtureStaff,
  parseBulkCount,
  planNeedsVersion,
  PACKAGES_FIXTURE_BULK_PREFIX,
  type PackagesFixturePlan,
  type PackagesFixtureStaffKey,
} from "./packages-p0-fixtures-config";

/**
 * Seeds the data the Packages P0 run needs (docs/runbooks/packages-screen-p0-run-sheet.md, section 3): the test agency, one profile per role,
 * fixtures P1-P13, their departure groups, and a package in a second agency for the isolation tests.
 *
 *   npx tsx scripts/e2e/seed-packages-p0-fixtures.ts                      dry run: reads only, prints what it would do
 *   npx tsx scripts/e2e/seed-packages-p0-fixtures.ts --execute            writes
 *   npx tsx scripts/e2e/seed-packages-p0-fixtures.ts --execute --bulk 600 also adds 600 on-sale packages for PKG-PRF-03
 *
 * It never creates sign-in accounts: the staff users must already exist in Supabase Auth, one email per role in the PACKAGES_E2E_*_EMAIL
 * variables. It only ever writes inside the test agency and the second fixture agency, and it refuses to run against a production project.
 * Re-running resets each fixture to its starting state, so a half-finished run can be repeated.
 *
 * The service role skips the lifecycle triggers (they only hold `authenticated` and `anon`), which is what lets this create an Archived or Open
 * for Sale row directly. That is also why this must never be pointed at real data.
 */
loadEnvConfig(process.cwd());

const execute = process.argv.includes("--execute");
const bulkCount = parseBulkCount(process.argv);
/** A refusal to start is a one-line message and a non-zero exit, not a stack trace. */
function refuse(message: string): never {
  console.error(message);
  process.exit(1);
}

const target = (() => {
  try {
    return assertPackagesFixtureTarget(process.env);
  } catch (error) {
    return refuse(error instanceof Error ? error.message : String(error));
  }
})();
const secretKey = process.env.SUPABASE_SECRET_KEY;
if (!secretKey) refuse("SUPABASE_SECRET_KEY is required.");
const db: SupabaseClient = createClient(target.url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });

const log = (message: string) => console.error(message);
const action = (verb: string, what: string) => log(`${execute ? "" : "(dry run) would "}${verb} ${what}`);

type AgencyRef = { id: string; isNew: boolean };

async function ensureAgency(slug: string, name: string, kind: "test" | "other"): Promise<AgencyRef> {
  const existing = await db.from("agencies").select("id, is_test").eq("slug", slug).maybeSingle();
  if (existing.error) throw new Error(`Could not look up ${slug}: ${existing.error.message}`);
  if (existing.data) {
    if (existing.data.is_test !== true) {
      // The Packages test agency is only ever created by this script, so an existing one that is not a test agency is not ours to touch.
      if (kind === "test") throw new Error(`The agency ${slug} exists but is not a test agency (is_test is false). Refusing to use it.`);
      if (execute) {
        const marked = await db.from("agencies").update({ is_test: true }).eq("id", existing.data.id as string);
        if (marked.error) throw new Error(`Could not mark ${slug} as a test agency: ${marked.error.message}`);
      }
    }
    return { id: existing.data.id as string, isNew: false };
  }
  action("create the agency", `${slug} (is_test = true)`);
  if (!execute) return { id: `(new ${slug})`, isNew: true };
  const created = await db.from("agencies").insert({ name, slug, is_test: true }).select("id").single();
  if (created.error) throw new Error(`Could not create ${slug}: ${created.error.message}`);
  return { id: created.data.id as string, isNew: true };
}

async function findAuthUserIdsByEmail(emails: Map<string, PackagesFixtureStaffKey>): Promise<Partial<Record<PackagesFixtureStaffKey, string>>> {
  const found: Partial<Record<PackagesFixtureStaffKey, string>> = {};
  for (let page = 1; page <= 20 && Object.keys(found).length < emails.size; page += 1) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`Could not list auth users: ${error.message}`);
    for (const user of data.users) {
      const key = emails.get((user.email ?? "").toLowerCase());
      if (key) found[key] = user.id;
    }
    if (data.users.length < 200) break;
  }
  return found;
}

async function ensureStaff(agencyIds: { test: AgencyRef; other: AgencyRef }): Promise<Record<PackagesFixtureStaffKey, string>> {
  const emails = new Map<string, PackagesFixtureStaffKey>();
  const problems: string[] = [];
  for (const key of Object.keys(packagesFixtureStaff) as PackagesFixtureStaffKey[]) {
    const envName = packagesFixtureStaff[key].emailEnv;
    const email = process.env[envName]?.trim().toLowerCase();
    if (!email) problems.push(`${envName} is not set`);
    else emails.set(email, key);
  }
  const ids = await findAuthUserIdsByEmail(emails);
  for (const [email, key] of emails) if (!ids[key]) problems.push(`${email} (${key}) has no Supabase Auth user yet`);

  if (problems.length > 0) {
    const message = `Cannot seed the staff profiles:\n  - ${problems.join("\n  - ")}\nCreate the users in Supabase Auth, set the variables, then run again.`;
    if (execute) throw new Error(message);
    log(`(dry run) ${message}`);
  }

  for (const key of Object.keys(packagesFixtureStaff) as PackagesFixtureStaffKey[]) {
    const plan = packagesFixtureStaff[key];
    const userId = ids[key];
    if (!userId) continue;
    const agencyId = plan.agency === "test" ? agencyIds.test.id : agencyIds.other.id;
    const existing = await db.from("staff_profiles").select("agency_id").eq("id", userId).maybeSingle();
    if (existing.error) throw new Error(existing.error.message);
    const known = [agencyIds.test.id, agencyIds.other.id];
    if (existing.data?.agency_id && !known.includes(existing.data.agency_id as string)) {
      throw new Error(`${process.env[plan.emailEnv]} already belongs to another agency. Use a dedicated test user instead of moving a real one.`);
    }
    action("save the staff profile", `${plan.role} ${process.env[plan.emailEnv]}`);
    if (!execute) continue;
    const saved = await db.from("staff_profiles").upsert(
      {
        id: userId,
        email: process.env[plan.emailEnv]!.trim().toLowerCase(),
        full_name: plan.fullName,
        role: plan.role,
        status: "ACTIVE",
        employment_type: "PERMANENT",
        agency_id: agencyId,
      },
      { onConflict: "id" },
    );
    if (saved.error) throw new Error(`Could not save the ${key} staff profile: ${saved.error.message}`);
  }
  return ids as Record<PackagesFixtureStaffKey, string>;
}

async function findPackageId(agencyId: string, plan: PackagesFixturePlan): Promise<string | null> {
  const query = db.from("packages").select("id").eq("agency_id", agencyId);
  const result = plan.code !== "" ? await query.ilike("internal_code", plan.code).maybeSingle() : await query.eq("description", plan.marker ?? "").maybeSingle();
  if (result.error) throw new Error(`Could not look up ${plan.id}: ${result.error.message}`);
  return (result.data?.id as string | undefined) ?? null;
}

async function ensurePackage(plan: PackagesFixturePlan, agencyId: string, ownerId: string | undefined, now: Date): Promise<string> {
  const row = { ...buildFixtureRow(plan, now), agency_id: agencyId, owner_id: ownerId ?? null };
  const existingId = agencyId.startsWith("(") ? null : await findPackageId(agencyId, plan);
  const label = `${plan.id} ${plan.code || "(no code)"} [${plan.status}] ${plan.purpose}`;
  if (existingId) {
    action("reset", label);
    if (!execute) return existingId;
    const updated = await db.from("packages").update(row).eq("id", existingId).eq("agency_id", agencyId);
    if (updated.error) throw new Error(`Could not reset ${plan.id}: ${updated.error.message}`);
    return existingId;
  }
  action("create", label);
  if (!execute) return `(new ${plan.id})`;
  if (!ownerId) throw new Error(`No owner user for ${plan.id}.`);
  const created = await db.from("packages").insert(row).select("id").single();
  if (created.error) throw new Error(`Could not create ${plan.id}: ${created.error.message}`);
  return created.data.id as string;
}

/** A published version for every package that has been on sale, so the "on sale but no version" integrity check means something. */
async function ensureVersion(plan: PackagesFixturePlan, packageId: string, agencyId: string, publisherId: string | undefined, now: Date): Promise<void> {
  if (!planNeedsVersion(plan) || !execute) return;
  const existing = await db.from("package_versions").select("id").eq("package_id", packageId).eq("version_number", 1).maybeSingle();
  if (existing.error) throw new Error(`Could not read versions for ${plan.id}: ${existing.error.message}`);
  let versionId = existing.data?.id as string | undefined;
  if (!versionId) {
    const created = await db
      .from("package_versions")
      .insert({
        package_id: packageId,
        agency_id: agencyId,
        version_number: 1,
        snapshot: buildFixtureRow(plan, now),
        published_by: publisherId ?? null,
        published_by_name: packagesFixtureStaff.ADMIN.fullName,
      })
      .select("id")
      .single();
    if (created.error) throw new Error(`Could not create the version for ${plan.id}: ${created.error.message}`);
    versionId = created.data.id as string;
  }
  const linked = await db.from("packages").update({ published_version_id: versionId }).eq("id", packageId);
  if (linked.error) throw new Error(`Could not link the version for ${plan.id}: ${linked.error.message}`);
}

function isoDate(base: Date, offsetDays: number): string {
  return new Date(base.getTime() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

async function ensureGroups(plan: PackagesFixturePlan, packageId: string, agencyId: string, now: Date): Promise<void> {
  if (!plan.groups?.length) return;
  const form = buildFixtureForm(plan);
  const journey = form.journeyType === "Hajj" ? "HAJJ" : form.journeyType === "Early Registration" ? "EARLY_REGISTRATION" : "UMRAH";
  for (const group of plan.groups) {
    const departure = isoDate(now, group.departInDays);
    const row = {
      agency_id: agencyId,
      package_template_id: packageId,
      group_code: group.code,
      group_name: group.name,
      journey_type: journey,
      capacity: group.capacity,
      booked_seats: group.bookedSeats,
      group_status: group.groupStatus,
      sales_status: group.salesStatus,
      archived: group.archived,
      departure_date: departure,
      return_date: isoDate(now, group.departInDays + Math.max(0, form.days - 1)),
    };
    action("save the departure group", `${group.code} (${group.groupStatus}${group.archived ? ", archived" : ""}) for ${plan.id}`);
    if (!execute) continue;
    const existing = await db.from("departure_groups").select("id").eq("agency_id", agencyId).eq("group_code", group.code).maybeSingle();
    if (existing.error) throw new Error(`Could not look up ${group.code}: ${existing.error.message}`);
    const saved = existing.data
      ? await db.from("departure_groups").update(row).eq("id", existing.data.id as string)
      : await db.from("departure_groups").insert(row);
    if (saved.error) throw new Error(`Could not save the group ${group.code}: ${saved.error.message}`);
  }
}

async function seedBulk(agencyId: string, ownerId: string | undefined, now: Date): Promise<void> {
  if (bulkCount === 0) return;
  const existing = new Set<string>();
  if (!agencyId.startsWith("(")) {
    const found = await db.from("packages").select("internal_code").eq("agency_id", agencyId).like("internal_code", `${PACKAGES_FIXTURE_BULK_PREFIX}%`).limit(5000);
    if (found.error) throw new Error(`Could not read the existing bulk packages: ${found.error.message}`);
    for (const row of found.data ?? []) existing.add(String(row.internal_code).toLowerCase());
  }
  const rows: Record<string, unknown>[] = [];
  for (let index = 1; index <= bulkCount; index += 1) {
    const code = bulkFixtureCode(index);
    if (existing.has(code.toLowerCase())) continue;
    const plan: PackagesFixturePlan = {
      id: `BULK-${index}`, planId: "BULK", code, title: `ZZTEST bulk package ${String(index).padStart(5, "0")}`,
      status: "Open for Sale", owner: "ADMIN", complete: true, purpose: "bulk",
    };
    rows.push({ ...buildFixtureRow(plan, now), agency_id: agencyId, owner_id: ownerId ?? null });
  }
  action("create", `${rows.length} bulk packages (${bulkCount - rows.length} already exist). They are on sale with no version row, so leave them out of PKG-SEC-13`);
  if (!execute || rows.length === 0) return;
  if (!ownerId) throw new Error("No ADMIN user to own the bulk packages.");
  for (let start = 0; start < rows.length; start += 100) {
    const inserted = await db.from("packages").insert(rows.slice(start, start + 100));
    if (inserted.error) throw new Error(`Could not create bulk packages ${start + 1}-${start + 100}: ${inserted.error.message}`);
  }
}

async function main() {
  log(`${execute ? "EXECUTE" : "DRY RUN"} on project ${target.projectRef}${bulkCount ? `, plus ${bulkCount} bulk packages` : ""}\n`);
  const now = new Date();

  const testAgency = await ensureAgency(packagesFixtureAgency.slug, packagesFixtureAgency.name, "test");
  const otherAgency = await ensureAgency(packagesFixtureOtherAgencySlug, "LR2 Fixture Agency B", "other");
  const userIds = await ensureStaff({ test: testAgency, other: otherAgency });

  for (const plan of packagesFixturePlans) {
    const packageId = await ensurePackage(plan, testAgency.id, userIds[plan.owner], now);
    await ensureVersion(plan, packageId, testAgency.id, userIds.ADMIN, now);
    await ensureGroups(plan, packageId, testAgency.id, now);
  }

  const otherId = await ensurePackage(packagesFixtureOtherAgencyPlan, otherAgency.id, userIds.OTHER_AGENCY_ADMIN, now);
  await ensureVersion(packagesFixtureOtherAgencyPlan, otherId, otherAgency.id, userIds.OTHER_AGENCY_ADMIN, now);

  await seedBulk(testAgency.id, userIds.ADMIN, now);

  log(
    `\n${execute ? "Seeded" : "Dry run finished; nothing was written"}.\n` +
      `Test agency: ${testAgency.id}\nOther agency (isolation tests): ${otherAgency.id}\n` +
      `Every package code starts with ${PACKAGES_FIXTURE_CODE_PREFIX}. Clean up with cleanup-packages-p0-fixtures.ts.`,
  );
  console.log(`PACKAGES_E2E_TEST_AGENCY_ID=${testAgency.id}`);
  console.log(`PACKAGES_E2E_OTHER_AGENCY_ID=${otherAgency.id}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
