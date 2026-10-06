import { notFound } from "next/navigation";
import { cookies } from "next/headers";

import {
  canRoleOpenGroup,
  visibleTabsFor,
} from "@/lib/access/departure-groups-access";
import {
  getCurrentDepartureCapabilities,
  getCurrentStaffRole,
  getDepartureGroupDetail,
  listGroupBranches,
  listMoveTargetGroups,
} from "@/lib/data/departure-groups";
import { getGroupAgentPanel } from "@/lib/data/departure-groups-agent";
import { loadAssignedGroupIds } from "@/lib/data/team-repository";
import { createClient } from "@/utils/supabase/server";

import DepartureGroupDetailView from "./components/departure-group-detail";
import { DepartureCapabilitiesProvider } from "../capabilities-context";
import type { DepartureGroupTabId } from "../types";

export default async function DepartureGroupPage({
  params,
  searchParams,
}: {
  params: Promise<{ groupId: string }>;
  searchParams: Promise<{
    tab?: string;
    add?: string;
    edit?: string;
    compare?: string;
  }>;
}) {
  const [{ groupId }, { tab, add, edit, compare }] = await Promise.all([
    params,
    searchParams,
  ]);
  const { role, staffId, agencyId } = await getCurrentStaffRole();

  const can = await getCurrentDepartureCapabilities();
  // A role without module access must not be able to reach it by URL.
  if (!can.viewModule) notFound();

  const detail = await getDepartureGroupDetail(groupId, role);
  if (!detail) notFound();

  const supabase = createClient(await cookies());

  // A guide who is not on this group must not be able to reach it by URL.
  const assignedGroupIds =
    role === "GUIDE" && staffId ? await loadAssignedGroupIds(supabase, staffId) : [];
  if (!canRoleOpenGroup(detail.group, role, assignedGroupIds)) notFound();

  // Only roles that may actually move a booking are told what the options are,
  // and only roles that may edit need the branch list.
  const [moveTargets, branches, agentPanel] = await Promise.all([
    can.editGroupDetails ? listMoveTargetGroups(groupId) : [],
    can.editGroupDetails ? listGroupBranches() : [],
    agencyId
      ? getGroupAgentPanel(groupId, agencyId, supabase)
      : Promise.resolve({ state: null, latestRun: null, openProposals: [], recentDecisions: [] }),
  ]);

  const tabs = visibleTabsFor(role, can);
  // The list's row actions deep-link here: "Add Booking" with ?tab=pilgrims&add=1,
  // "Edit" with ?edit=1 and "Compare with template" with ?compare=1.
  const wantsAddBooking = add === "1";
  const initialTab = tabs.includes(tab as DepartureGroupTabId)
    ? (tab as DepartureGroupTabId)
    : wantsAddBooking
      ? "pilgrims"
      : "overview";

  return (
    <DepartureCapabilitiesProvider value={can}>
    <DepartureGroupDetailView
      detail={detail}
      role={role}
      moveTargets={moveTargets}
      branches={branches}
      agentPanel={agentPanel}
      visibleTabs={tabs}
      initialTab={initialTab}
      initialAddBooking={wantsAddBooking}
      initialEdit={edit === "1"}
      initialCompare={compare === "1"}
    />
    </DepartureCapabilitiesProvider>
  );
}
