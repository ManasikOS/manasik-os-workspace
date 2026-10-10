import { notFound } from "next/navigation";
import { cookies } from "next/headers";

import { capabilitiesForPackages } from "@/lib/access/packages-access";
import { loadDynamicCapabilities } from "@/lib/access/dynamic-capabilities";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { createClient } from "@/utils/supabase/server";

import PackageEditorScreen from "../components/package-editor/package-editor-screen";

/** Creating a package: the full-page editor (TASK-044). Also the deep link other modules use. */
export default async function NewPackagePage() {
  const { role, roleId } = await getCurrentStaffRole();
  const supabase = createClient(await cookies());
  const can = await loadDynamicCapabilities(supabase, roleId, "packages", capabilitiesForPackages(role));
  if (!can.createPackage) notFound();

  return <PackageEditorScreen mode="create" />;
}
