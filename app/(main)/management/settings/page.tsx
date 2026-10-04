import { notFound, redirect } from "next/navigation";

import { defaultSettingsSection } from "@/lib/access/settings-access";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";

/**
 * `/management/settings` has no page of its own — it redirects to the first
 * section this role can see, so nobody lands on a permission denial by
 * default. Mirrors `app/(main)/management/page.tsx`.
 */
export default async function SettingsIndexPage() {
  const { role } = await getCurrentStaffRole();
  const section = defaultSettingsSection(role);

  if (!section) notFound();
  redirect(`/management/settings/${section}`);
}
