import { notFound } from "next/navigation";
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

  const { create, template: templateParam } = await searchParams;

  const [everyGroup, templates, assignedGroupIds] = await Promise.all([
    // Archived groups are fetched too, then split — the archived view reads from
    // the same list rather than a second round trip.
    listDepartureGroups({ includeArchived: true }),
    // Only fetched for roles that can actually start a group. Drafts are
    // only ever included for ADMIN — see `listPackageTemplateOptions()`'s
    // own comment and the sheet's "Include drafts" toggle.
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

  // "Create Departure Group" deep link from the Packages list/detail screens
  // (`/departure-groups?create=1&template=<id>`) — previously ignored
  // entirely, landing on the plain group list (finding C4). The id is
  // checked against the templates this role can actually see before being
  // trusted, so a stale or tampered id can't preselect something this
  // person couldn't otherwise pick from the list.
  const initialCreateTemplateId =
    create === "1" && templateParam && templates.some((t) => t.id === templateParam)
      ? templateParam
      : null;

  return (
    <DepartureCapabilitiesProvider value={can}>
    <DepartureGroupsList
      groups={groups}
      archivedGroups={archivedGroups}
      templates={templates}
      role={role}
      assignedGroupIds={assignedGroupIds}
      autoOpenCreate={create === "1"}
      initialCreateTemplateId={initialCreateTemplateId}
    />
    </DepartureCapabilitiesProvider>
  );
}
