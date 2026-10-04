import { notFound } from "next/navigation";
import { cookies } from "next/headers";

import { capabilitiesForPilgrims, visibleTabsForPilgrim, type PilgrimTabId } from "@/lib/access/pilgrims-access";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { buildPilgrimProfile } from "@/lib/data/pilgrims";
import { loadJourneyDocuments, loadPilgrimJourneys, loadPilgrimStore } from "@/lib/data/pilgrims-repository";
import { loadAssignedGroupIds } from "@/lib/data/team-repository";
import { createClient } from "@/utils/supabase/server";

import PilgrimDetailView from "./components/pilgrim-detail";

export const dynamic = "force-dynamic";

export default async function PilgrimProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ pilgrimId: string }>;
  searchParams: Promise<{ tab?: string; journey?: string }>;
}) {
  const [{ pilgrimId }, { tab, journey }] = await Promise.all([params, searchParams]);
  const { role, staffId } = await getCurrentStaffRole();
  const can = capabilitiesForPilgrims(role);
  if (!can.viewModule) notFound();

  const supabase = createClient(await cookies());
  const [store, journeys] = await Promise.all([
    loadPilgrimStore(supabase, { pilgrimId }),
    loadPilgrimJourneys(supabase, { pilgrimId }),
  ]);

  const person = store.pilgrims[0];
  if (!person) notFound();

  if (can.assignedGroupOnly) {
    // `staff_group_assignments` is the actual source of truth for who is
    // assigned to a group — see `lib/access/departure-groups-access.ts`'s
    // comment on why a display-name match was replaced there. This gate
    // used to compare `journeys[].primary_guide_name` to the signed-in
    // user's name instead, which meant two staff sharing a name could read
    // each other's travellers, and renaming a guide silently locked them
    // out of every pilgrim they were assigned to.
    const assignedGroupIds = staffId ? await loadAssignedGroupIds(supabase, staffId) : [];
    const assigned = new Set(assignedGroupIds);
    if (!journeys.some((j) => j.departure_group_id && assigned.has(j.departure_group_id))) {
      notFound();
    }
  }

  const nowIso = new Date().toISOString();
  const profile = buildPilgrimProfile(person, journeys, store, nowIso, journey ?? null);

  const documents = profile.activeJourneyRaw ? await loadJourneyDocuments(supabase, profile.activeJourneyRaw.journey_id) : [];

  const tabs: PilgrimTabId[] = visibleTabsForPilgrim(role);
  const initialTab = tabs.includes(tab as PilgrimTabId) ? (tab as PilgrimTabId) : "overview";

  return (
    <PilgrimDetailView
      profile={profile}
      documents={documents}
      role={role}
      can={can}
      visibleTabs={tabs}
      initialTab={initialTab}
    />
  );
}
