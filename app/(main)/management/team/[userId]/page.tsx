import { notFound } from "next/navigation";
import { cookies } from "next/headers";

import {
  capabilitiesForTeam,
  visibleTabsForTeamMember,
  type TeamTabId,
} from "@/lib/access/team-access";
import { loadDynamicCapabilities } from "@/lib/access/dynamic-capabilities";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { listBranches } from "@/lib/data/settings-repository";
import { buildTeamMemberProfile, toStaffTaskListItems } from "@/lib/data/team";
import { ACTIVITY_FEED_CAP } from "@/lib/data/team-copy";
import {
  loadAssignableDepartureGroups,
  loadMergedActivityFeed,
  loadStaffProfile,
  loadTasksForStaff,
} from "@/lib/data/team-repository";
import { hasAdminClient } from "@/utils/supabase/admin";
import { createClient } from "@/utils/supabase/server";

import TeamMemberDetailView from "./components/team-member-detail";

/**
 * Team member profile. A Server Component so every "18 minutes ago" /
 * workload derivation is measured against a clock decided once and
 * serialised down — same reasoning as `app/(main)/suppliers/[supplierId]/page.tsx`.
 *
 * Reachable by the profile's own owner, by Admin/CEO (full directory), and by
 * Operations (to assign departure groups from a colleague's profile) — see
 * `docs/modules/team-module-implementation-plan.md` §5.1.
 */
export const dynamic = "force-dynamic";

export default async function TeamMemberProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const [{ userId }, { tab }] = await Promise.all([params, searchParams]);
  const { role, roleId, staffId } = await getCurrentStaffRole();
  const isSelf = staffId === userId;

  const supabase = createClient(await cookies());
  const can = await loadDynamicCapabilities(supabase, roleId, "team", capabilitiesForTeam(role));

  if (!isSelf && !can.viewFullDirectory && !can.assignGroups) notFound();

  // Tab visibility stays keyed to the static role-tier check — a coarser,
  // display-only concern (which tabs exist at all) than the per-button `can`
  // gating within each tab, which is fully dynamic above.
  const tabs: TeamTabId[] = visibleTabsForTeamMember(role, isSelf);
  const canSeeTasks = tabs.includes("tasks");
  const canSeeActivity = tabs.includes("activity");

  const [bundle, assignableGroups, taskRows, activity, branchRows] = await Promise.all([
    loadStaffProfile(supabase, userId),
    can.assignGroups
      ? loadAssignableDepartureGroups(supabase)
      : Promise.resolve([]),
    canSeeTasks ? loadTasksForStaff(supabase, userId) : Promise.resolve([]),
    canSeeActivity
      ? loadMergedActivityFeed(supabase, userId, ACTIVITY_FEED_CAP)
      : Promise.resolve([]),
    can.editProfile ? listBranches(supabase) : Promise.resolve([]),
  ]);
  if (!bundle) notFound();

  const nowIso = new Date().toISOString();
  const profile = buildTeamMemberProfile(bundle);
  const groupOptions = assignableGroups.map((g) => ({
    id: g.id,
    groupName: g.group_name,
    groupCode: g.group_code,
  }));
  const branchOptions = branchRows
    .filter((b) => b.status === "ACTIVE")
    .map((b) => ({ id: b.id, name: b.name, code: b.code }));
  const tasks = toStaffTaskListItems(taskRows, nowIso);

  const initialTab = tabs.includes(tab as TeamTabId)
    ? (tab as TeamTabId)
    : "overview";

  return (
    <TeamMemberDetailView
      profile={profile}
      nowIso={nowIso}
      role={role}
      can={can}
      isSelf={isSelf}
      visibleTabs={tabs}
      initialTab={initialTab}
      groupOptions={groupOptions}
      branchOptions={branchOptions}
      tasks={tasks}
      activity={activity}
      hasAdminClient={hasAdminClient()}
    />
  );
}
