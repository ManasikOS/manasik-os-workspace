import { notFound } from "next/navigation";
import { cookies } from "next/headers";

import { capabilitiesFor } from "@/lib/access/departure-groups-access";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import {
  createItinerary,
  getItinerary,
  listItineraryDays,
  listItineraryEvents,
} from "@/lib/data/itinerary-repository";
import { loadAssignedGroupIds } from "@/lib/data/team-repository";
import { createClient } from "@/utils/supabase/server";

import ItineraryBuilderView from "./components/itinerary-builder-view";

/**
 * One departure group's itinerary builder. The itinerary row is created
 * lazily (as a draft) the first time this page is opened for a group that
 * doesn't have one yet — mirroring how a booking's payment plan or a
 * pilgrim's document checklist come into existence on first touch rather
 * than through a separate "initialize" step.
 */
export default async function ItineraryBuilderPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  const { role, staffId } = await getCurrentStaffRole();
  const can = capabilitiesFor(role);
  if (!can.viewModule) notFound();

  const supabase = createClient(await cookies());

  const { data: group, error } = await supabase
    .from("departure_groups")
    .select("id, group_name, group_code, group_status, sales_status, departure_date")
    .eq("id", groupId)
    .maybeSingle();
  if (error) throw error;
  if (!group) notFound();

  // Same scoping as the group's own page (canRoleOpenGroup): a guide only
  // ever reaches groups they're assigned to; marketing only reaches groups
  // still open for sale.
  if (role === "GUIDE") {
    const assignedGroupIds = staffId ? await loadAssignedGroupIds(supabase, staffId) : [];
    if (!assignedGroupIds.includes(group.id)) notFound();
  } else if (role === "MARKETING") {
    const openStatuses = ["SELLING", "LIMITED_AVAILABILITY", "WAITLIST"];
    if (!openStatuses.includes(group.sales_status)) notFound();
  }

  let itinerary = await getItinerary(supabase, groupId);
  if (!itinerary && can.editGroupDetails) {
    itinerary = await createItinerary(supabase, groupId);
  }

  const days = itinerary ? await listItineraryDays(supabase, itinerary.id) : [];
  const events = await listItineraryEvents(supabase, days.map((d) => d.id));

  return (
    <ItineraryBuilderView
      group={{
        id: group.id,
        groupName: group.group_name,
        groupCode: group.group_code,
        groupStatus: group.group_status,
        departureDate: group.departure_date,
      }}
      itinerary={itinerary}
      days={days}
      events={events}
      canManage={can.editGroupDetails}
    />
  );
}
