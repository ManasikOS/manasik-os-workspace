import { notFound } from "next/navigation";
import { cookies } from "next/headers";

import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { loadStaffProfile } from "@/lib/data/team-repository";
import {
  getGuideProfile,
  listActiveAssignedGroups,
  listBriefingsForGuide,
  listCheckinsForGuide,
  listHandoversForGuide,
} from "@/lib/data/guide-field-team-repository";
import { createClient } from "@/utils/supabase/server";

import GuideFieldTeamDetailView from "./components/guide-field-team-detail-view";

/**
 * A guide's field-ops record: profile, briefings, handovers, check-ins.
 * ADMIN/CEO/OPERATIONS can open any guide; anyone else (including the
 * guide's own GUIDE-role account) may only open their own — enforced here
 * at the page level, on top of the RLS "own rows only" policies on the
 * self-service write paths (acknowledge briefing/handover, check in).
 */
export default async function GuideFieldTeamDetailPage({
  params,
}: {
  params: Promise<{ staffId: string }>;
}) {
  const { staffId } = await params;
  const { role, staffId: currentStaffId } = await getCurrentStaffRole();
  const canManageAny = role === "ADMIN" || role === "CEO" || role === "OPERATIONS";
  if (!canManageAny && staffId !== currentStaffId) notFound();

  const supabase = createClient(await cookies());
  const staffProfile = await loadStaffProfile(supabase, staffId);
  if (!staffProfile) notFound();

  const [guideProfile, briefings, handovers, checkins, assignedGroups] = await Promise.all([
    getGuideProfile(supabase, staffId),
    listBriefingsForGuide(supabase, staffId),
    listHandoversForGuide(supabase, staffId),
    listCheckinsForGuide(supabase, staffId),
    listActiveAssignedGroups(supabase, staffId),
  ]);

  return (
    <GuideFieldTeamDetailView
      staffId={staffId}
      fullName={staffProfile.profile.full_name}
      guideProfile={guideProfile}
      briefings={briefings}
      handovers={handovers}
      checkins={checkins}
      assignedGroups={assignedGroups}
      isOwnRecord={staffId === currentStaffId}
      canManage={canManageAny}
    />
  );
}
