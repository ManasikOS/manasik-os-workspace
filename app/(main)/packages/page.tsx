import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";

import { getSessionUser } from "@/lib/dal";
import { capabilitiesForPackages } from "@/lib/access/packages-access";
import { loadDynamicCapabilities } from "@/lib/access/dynamic-capabilities";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { listPackages, listPendingPackageChanges } from "@/lib/data/packages-repository";
import { createClient } from "@/utils/supabase/server";

import PackagesList from "./components/packages-list";

export default async function PackagesPage({
  searchParams,
}: {
  searchParams: Promise<{ create?: string }>;
}) {
  const { create } = await searchParams;
  // Old deep link: creating a package is now its own page (TASK-044).
  if (create === "1") redirect("/packages/new");
  const { role, roleId } = await getCurrentStaffRole();
  const supabase = createClient(await cookies());
  // A custom role's saved overrides (Management → Roles & Permissions),
  // merged over its base role's hardcoded default — see
  // docs/modules/packages-production-readiness-plan.md, finding A4. Resolved once
  // here and passed down to `PackagesList` as a prop, rather than the
  // client component re-deriving it from a bare `role` with
  // `capabilitiesForPackages(role)`, which would silently ignore any
  // override.
  const can = await loadDynamicCapabilities(supabase, roleId, "packages", capabilitiesForPackages(role));
  if (!can.viewModule) notFound();

  const user = await getSessionUser();
  // Fetched once, archived rows included — filtering, search, sort and
  // pagination all happen client-side against this array, the same shape as
  // the Departure Groups list.
  const [everyPackage, pendingChanges] = await Promise.all([
    listPackages(role, user?.id ?? null),
    // Changes to packages on sale that are waiting for approval. Row security shows each person only what they may read.
    listPendingPackageChanges(),
  ]);

  const packages = everyPackage.filter((p) => !p.archived);
  const archivedPackages = everyPackage.filter((p) => p.archived);

  return (
    <PackagesList
      packages={packages}
      archivedPackages={archivedPackages}
      can={can}
      currentUserId={user?.id ?? null}
      pendingChanges={pendingChanges}
    />
  );
}
