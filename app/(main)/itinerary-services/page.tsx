import { notFound } from "next/navigation";
import { cookies } from "next/headers";

import { capabilitiesFor } from "@/lib/access/departure-groups-access";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { listAllItinerarySummaries } from "@/lib/data/itinerary-repository";
import { createClient } from "@/utils/supabase/server";

import ItineraryListView from "./components/itinerary-list-view";

/**
 * Cross-group itinerary status. Each group's actual day-by-day plan is
 * built and published from its own builder at
 * /itinerary-services/[groupId] — this page only shows which groups have
 * one, whether it's published, and how many events still need supplier or
 * guide confirmation.
 *
 * Requires supabase/migrations/20261011090000_itinerary_services.sql to
 * have been applied — see that file's header.
 */
export default async function ItineraryServicesPage() {
  const { role } = await getCurrentStaffRole();
  const can = capabilitiesFor(role);
  if (!can.viewModule) notFound();

  const supabase = createClient(await cookies());
  const summaries = await listAllItinerarySummaries(supabase);

  return <ItineraryListView summaries={summaries} canManage={can.editGroupDetails} />;
}
