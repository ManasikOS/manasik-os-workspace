import { createHash } from "node:crypto";

import { loadEnvConfig } from "@next/env";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  PACKAGES_FIXTURE_CODE_PREFIX,
  assertPackagesFixtureTarget,
  packagesFixtureAgency,
  packagesFixtureOtherAgencySlug,
} from "./packages-p0-fixtures-config";

/**
 * Removes what the Packages P0 run left behind, and can fingerprint any agency's packages (PKG-SEC-17).
 *
 *   npx tsx scripts/e2e/cleanup-packages-p0-fixtures.ts                         dry run: counts what it would remove
 *   npx tsx scripts/e2e/cleanup-packages-p0-fixtures.ts --execute               removes it
 *   npx tsx scripts/e2e/cleanup-packages-p0-fixtures.ts --snapshot <agency id>  read only: prints a fingerprint of that agency's packages
 *
 * Scope, in full:
 *   - the test agency (slug e2e-packages-20261008): every package and every departure group in it. It refuses unless the agency has
 *     is_test = true, so it cannot be pointed at a working agency by a wrong slug;
 *   - the second fixture agency (lr2-fixture-agency-b): only packages whose code starts with ZZTEST-.
 * It does not delete agencies, staff profiles or sign-in accounts, so the next seed run can reuse them.
 *
 * Package versions, activity logs and change requests go with their package (their foreign keys cascade). Export logs and rate-limit events are
 * append-only and are not touched; the rate-limit events expire on their own after two hours.
 */
loadEnvConfig(process.cwd());

const execute = process.argv.includes("--execute");
const snapshotIndex = process.argv.indexOf("--snapshot");
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

async function countForAgency(table: "packages" | "departure_groups", agencyId: string): Promise<number> {
  const result = await db.from(table).select("id", { count: "exact", head: true }).eq("agency_id", agencyId);
  if (result.error) throw new Error(`Could not count ${table}: ${result.error.message}`);
  return result.count ?? 0;
}

async function snapshot(agencyId: string): Promise<void> {
  const rows: { id: string; internal_code: string; status: string; updated_at: string }[] = [];
  for (let from = 0; ; from += 1000) {
    const page = await db
      .from("packages")
      .select("id, internal_code, status, updated_at")
      .eq("agency_id", agencyId)
      .order("id")
      .range(from, from + 999);
    if (page.error) throw new Error(`Could not read packages: ${page.error.message}`);
    rows.push(...(page.data as typeof rows));
    if ((page.data?.length ?? 0) < 1000) break;
  }
  const digest = createHash("sha256").update(JSON.stringify(rows)).digest("hex");
  console.log(`agency=${agencyId}`);
  console.log(`packages=${rows.length}`);
  console.log(`sha256=${digest}`);
  log("Run this before and after the test pass. The three lines must be identical.");
}

async function removeTestAgencyData(): Promise<void> {
  const agency = await db.from("agencies").select("id, is_test").eq("slug", packagesFixtureAgency.slug).maybeSingle();
  if (agency.error) throw new Error(`Could not look up the test agency: ${agency.error.message}`);
  if (!agency.data) {
    log(`The test agency ${packagesFixtureAgency.slug} does not exist. Nothing to remove there.`);
    return;
  }
  if (agency.data.is_test !== true) throw new Error(`${packagesFixtureAgency.slug} is not a test agency (is_test is false). Refusing to delete from it.`);
  const agencyId = agency.data.id as string;

  const groups = await countForAgency("departure_groups", agencyId);
  const packages = await countForAgency("packages", agencyId);
  log(`Test agency ${agencyId}: ${packages} packages, ${groups} departure groups.`);
  if (!execute) {
    log("(dry run) would delete the departure groups first, then the packages.");
    return;
  }

  // Groups first: departure_groups and the group package snapshots reference packages with ON DELETE RESTRICT.
  const removedGroups = await db.from("departure_groups").delete().eq("agency_id", agencyId);
  if (removedGroups.error) {
    throw new Error(
      `Could not delete the departure groups: ${removedGroups.error.message}\n` +
        "A group with bookings or other records blocks this. Remove those in the app as the test ADMIN, then run again.",
    );
  }
  const removedPackages = await db.from("packages").delete().eq("agency_id", agencyId);
  if (removedPackages.error) throw new Error(`Could not delete the packages: ${removedPackages.error.message}`);

  const left = await countForAgency("packages", agencyId);
  log(`Removed. Packages left in the test agency: ${left}.`);
}

async function removeOtherAgencyFixtures(): Promise<void> {
  const agency = await db.from("agencies").select("id").eq("slug", packagesFixtureOtherAgencySlug).maybeSingle();
  if (agency.error) throw new Error(`Could not look up ${packagesFixtureOtherAgencySlug}: ${agency.error.message}`);
  if (!agency.data) return;
  const agencyId = agency.data.id as string;
  const found = await db.from("packages").select("id, internal_code").eq("agency_id", agencyId).like("internal_code", `${PACKAGES_FIXTURE_CODE_PREFIX}%`);
  if (found.error) throw new Error(`Could not read ${packagesFixtureOtherAgencySlug} packages: ${found.error.message}`);
  const ids = (found.data ?? []).map((row) => row.id as string);
  log(`${packagesFixtureOtherAgencySlug}: ${ids.length} fixture packages (${PACKAGES_FIXTURE_CODE_PREFIX}*).`);
  if (!execute || ids.length === 0) return;
  const removed = await db.from("packages").delete().in("id", ids).eq("agency_id", agencyId);
  if (removed.error) throw new Error(`Could not delete the other agency's fixture packages: ${removed.error.message}`);
}

async function main() {
  if (snapshotIndex !== -1) {
    const agencyId = process.argv[snapshotIndex + 1];
    if (!agencyId || agencyId.startsWith("--")) throw new Error("--snapshot needs an agency id.");
    await snapshot(agencyId);
    return;
  }
  log(`${execute ? "EXECUTE" : "DRY RUN"} on project ${target.projectRef}\n`);
  await removeTestAgencyData();
  await removeOtherAgencyFixtures();
  log(execute ? "\nCleanup finished." : "\nDry run finished; nothing was removed.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
