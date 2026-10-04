import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";

import { capabilitiesForTeam } from "@/lib/access/team-access";
import { loadDynamicCapabilities } from "@/lib/access/dynamic-capabilities";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { listBranches } from "@/lib/data/settings-repository";
import {
  toTeamInvitationListItems,
  toTeamMemberListItems,
} from "@/lib/data/team";
import {
  loadAssignableDepartureGroups,
  loadInvitationHistory,
  loadTeamDirectory,
  loadUnassignedTaskCount,
} from "@/lib/data/team-repository";
import { createClient } from "@/utils/supabase/server";

import TeamList from "./components/team-list";
import { TeamProvider } from "./team-store";

/**
 * Team directory list. A Server Component so every "18 minutes ago" /
 * "60+ days" derivation is measured against a clock decided once and
 * serialised down — same reasoning as `app/(main)/suppliers/page.tsx`.
 *
 * Only Admin and CEO browse the full directory (`can.viewFullDirectory`).
 * Everyone else — including Operations, who can still assign groups from a
 * colleague's profile — lands directly on their own profile page instead.
 */
export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const { role, roleId, staffId } = await getCurrentStaffRole();
  const supabase = createClient(await cookies());
  const can = await loadDynamicCapabilities(supabase, roleId, "team", capabilitiesForTeam(role));

  if (!can.viewFullDirectory) {
    if (staffId) redirect(`/management/team/${staffId}`);
    notFound();
  }

  const [rows, unassignedTaskCount, invitationRows, groupOptions, branchRows] =
    await Promise.all([
      loadTeamDirectory(supabase),
      loadUnassignedTaskCount(supabase),
      can.inviteStaff ? loadInvitationHistory(supabase) : Promise.resolve([]),
      can.assignGroups
        ? loadAssignableDepartureGroups(supabase)
        : Promise.resolve([]),
      can.inviteStaff || can.editProfile ? listBranches(supabase) : Promise.resolve([]),
    ]);
  const nowIso = new Date().toISOString();

  const teamMembers = toTeamMemberListItems(rows);
  const currentStaffMember = teamMembers.find((m) => m.id === staffId);

  return (
    <TeamProvider
      teamMembers={teamMembers}
      unassignedTaskCount={unassignedTaskCount}
      invitationHistory={toTeamInvitationListItems(invitationRows, nowIso)}
      groupOptions={groupOptions.map((g) => ({
        id: g.id,
        groupName: g.group_name,
        groupCode: g.group_code,
      }))}
      branchOptions={branchRows
        .filter((b) => b.status === "ACTIVE")
        .map((b) => ({ id: b.id, name: b.name, code: b.code }))}
      nowIso={nowIso}
      currentStaffName={currentStaffMember?.fullName ?? null}
      currentStaffId={staffId}
      role={role}
      capabilities={can}
    >
      <TeamList />
    </TeamProvider>
  );
}
