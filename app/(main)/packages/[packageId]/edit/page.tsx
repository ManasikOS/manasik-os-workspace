import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";

import { getSessionUser } from "@/lib/dal";
import { canRoleViewPackage, capabilitiesForPackages } from "@/lib/access/packages-access";
import { loadDynamicCapabilities } from "@/lib/access/dynamic-capabilities";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { getPackage } from "@/lib/data/packages-repository";
import { isUuid } from "@/lib/utils";
import { createClient } from "@/utils/supabase/server";

/**
 * Package editing is a dialog (`CreatePackageDialog`, opened from the
 * package detail page), not a full-screen route — this URL exists only for
 * deep links. It redirects into the detail page with `?edit=1`, which
 * `PackageDetail` reads to open the dialog on mount.
 */
export default async function EditPackagePage({
  params,
}: {
  params: Promise<{ packageId: string }>;
}) {
  const { packageId } = await params;
  if (!isUuid(packageId)) notFound();

  const { role, roleId } = await getCurrentStaffRole();
  const supabase = createClient(await cookies());
  const can = await loadDynamicCapabilities(supabase, roleId, "packages", capabilitiesForPackages(role));
  if (!can.editPackage) notFound();

  const user = await getSessionUser();
  const existing = await getPackage(packageId);
  if (!existing) notFound();
  // `getPackage()` is an unfiltered full-row read with no object-level
  // check of its own (unlike `getPackageDetail`, whose page already runs
  // this same check) — without it, MARKETING could open the edit URL for
  // another user's draft or a package that isn't sellable. See
  // docs/modules/packages-production-readiness-plan.md, finding A5.
  if (!canRoleViewPackage(existing.status, role, existing.owner_id, user?.id ?? null)) {
    notFound();
  }

  redirect(`/packages/${packageId}?edit=1`);
}
