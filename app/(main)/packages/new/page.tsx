import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";

import { capabilitiesForPackages } from "@/lib/access/packages-access";
import { loadDynamicCapabilities } from "@/lib/access/dynamic-capabilities";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { createClient } from "@/utils/supabase/server";

/**
 * Package creation is a dialog (`CreatePackageDialog`, opened from the
 * Packages list) rather than a full-screen route — this URL exists only so
 * other modules can deep-link "create a package" (e.g. Departure Groups'
 * create sheet, when no template exists yet) without importing the dialog
 * directly. It redirects into the list with `?create=1`, which the list
 * reads to open the dialog on mount.
 */
export default async function NewPackagePage() {
  const { role, roleId } = await getCurrentStaffRole();
  const supabase = createClient(await cookies());
  const can = await loadDynamicCapabilities(supabase, roleId, "packages", capabilitiesForPackages(role));
  if (!can.createPackage) notFound();

  redirect("/packages?create=1");
}
