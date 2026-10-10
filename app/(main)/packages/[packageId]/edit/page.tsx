import { notFound } from "next/navigation";
import { cookies } from "next/headers";

import { requireUser } from "@/lib/dal";
import { capabilitiesForPackages } from "@/lib/access/packages-access";
import { loadDynamicCapabilities } from "@/lib/access/dynamic-capabilities";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { isUuid } from "@/lib/utils";
import { createClient } from "@/utils/supabase/server";

import PackageEditorScreen from "../../components/package-editor/package-editor-screen";
import { loadPackageEditSnapshot } from "../../package-edit-snapshot";

/**
 * Editing a package: the full-page editor (TASK-044). The page loads the
 * package itself, so the editor opens with the data already in hand.
 *
 * `loadPackageEditSnapshot` runs the object-level `canRoleViewPackage` check, so
 * a role cannot open the edit URL of a package it may not see (finding A5 in
 * docs/modules/packages-production-readiness-plan.md).
 */
export default async function EditPackagePage({
  params,
}: {
  params: Promise<{ packageId: string }>;
}) {
  const { packageId } = await params;
  if (!isUuid(packageId)) notFound();

  const user = await requireUser();
  const { role, roleId } = await getCurrentStaffRole();
  const supabase = createClient(await cookies());
  const can = await loadDynamicCapabilities(supabase, roleId, "packages", capabilitiesForPackages(role));
  if (!can.editPackage) notFound();

  const loaded = await loadPackageEditSnapshot(packageId, {
    role,
    userId: user.id,
    canEditSensitiveTerms: can.editSensitiveTerms,
  });
  if (!loaded.ok) notFound();

  return <PackageEditorScreen mode="edit" packageId={packageId} snapshot={loaded.snapshot} />;
}
