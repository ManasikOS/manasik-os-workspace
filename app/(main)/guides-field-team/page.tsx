import { notFound } from "next/navigation";
import { cookies } from "next/headers";

import { capabilitiesForOperations } from "@/lib/access/operations-access";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { loadTeamDirectory } from "@/lib/data/team-repository";
import { createClient } from "@/utils/supabase/server";

import GuidesListView, { type GuideRosterRow } from "./components/guides-list-view";

/**
 * The guide roster. Staff with role GUIDE, their current departure-group
 * assignments and task workload already exist via `team_directory_rows`
 * (the same source `/management/team` uses) — this page is an
 * operations-facing lens on it: only the fields relevant to field
 * coordination (name, contact, assignments, workload), none of the HR
 * fields (email, employment type, deactivation history) the Team module
 * itself shows.
 */
export const dynamic = "force-dynamic";

export default async function GuidesFieldTeamPage() {
  const { role } = await getCurrentStaffRole();
  const can = capabilitiesForOperations(role);
  if (!can.viewModule) notFound();

  const supabase = createClient(await cookies());
  const directory = await loadTeamDirectory(supabase);

  const guides: GuideRosterRow[] = directory
    .filter((row) => row.role === "GUIDE" && row.status !== "DEACTIVATED")
    .map((row) => ({
      id: row.id,
      fullName: row.full_name,
      whatsapp: row.whatsapp,
      branch: row.branch,
      status: row.status,
      assignedGroupCount: row.assigned_group_count,
      assignments: row.primary_groups,
      openTaskCount: row.open_task_count,
      overdueTaskCount: row.overdue_task_count,
      dueTodayCount: row.due_today_count,
      lastActiveAt: row.last_active_at,
    }));

  return <GuidesListView guides={guides} />;
}
