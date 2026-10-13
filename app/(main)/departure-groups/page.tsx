import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";

import {
  capabilitiesFor,
  filterGroupsForRole,
} from "@/lib/access/departure-groups-access";
import {
  getCurrentDepartureCapabilities,
  getCurrentStaffRole,
  listDepartureGroups,
  listPackageTemplateOptions,
} from "@/lib/data/departure-groups";
import { loadAssignedGroupIds } from "@/lib/data/team-repository";
import { createClient } from "@/utils/supabase/server";

import DepartureGroupsList from "./components/departure-groups-list";
import { DepartureCapabilitiesProvider } from "./capabilities-context";

export default async function DepartureGroupsPage({
  searchParams,
}: {
  searchParams: Promise<{ create?: string; template?: string }>;
}) {
  const { role, staffId } = await getCurrentStaffRole();

  const can = await getCurrentDepartureCapabilities();
  // A role without module access must not be able to reach it by URL.
  if (!can.viewModule) notFound();

  // Creating a group is its own page now. Bookmarks and links made while it
  // was a dialog (`?create=1&template=<id>`) land there instead.
  const { create, template: templateParam } = await searchParams;
  if (create === "1" && can.createGroup) {
    redirect(
      templateParam
        ? `/departure-groups/new?template=${encodeURIComponent(templateParam)}`
        : "/departure-groups/new",
    );
  }

  const [everyGroup, templates, assignedGroupIds] = await Promise.all([
    // Archived groups are fetched too, then split — the archived view reads from
    // the same list rather than a second round trip.
    listDepartureGroups({ includeArchived: true }),
    // Only fetched for roles that can actually start a group (the import
    // dialog maps CSV rows to them). Drafts are only ever included for ADMIN.
    can.createGroup
      ? listPackageTemplateOptions({ includeDrafts: role === "ADMIN" })
      : Promise.resolve([]),
    // Fetched for every role, not only GUIDE: `filterGroupsForRole()` below
    // only consults it for GUIDE, but the "My Assigned Groups" saved view
    // (`applySavedView()` in ../utils.ts) is available to everyone and needs
    // the same `staff_group_assignments` data regardless of role.
    staffId ? loadAssignedGroupIds(createClient(await cookies()), staffId) : Promise.resolve([]),
  ]);

  // Guides only ever receive the groups they are assigned to — the rest never
  // reach the client.
  const visibleGroups = filterGroupsForRole(everyGroup, role, assignedGroupIds);
  const groups = visibleGroups.filter((group) => !group.archived);
  const archivedGroups = visibleGroups.filter((group) => group.archived);

  return (
    <DepartureCapabilitiesProvider value={can}>
    <DepartureGroupsList
      groups={groups}
      archivedGroups={archivedGroups}
      templates={templates}
      role={role}
      assignedGroupIds={assignedGroupIds}
    />
    </DepartureCapabilitiesProvider>
  );
}
