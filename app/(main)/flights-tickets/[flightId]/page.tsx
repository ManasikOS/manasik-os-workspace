import { notFound } from "next/navigation";
import { cookies } from "next/headers";

import { capabilitiesFor } from "@/lib/access/departure-groups-access";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import {
  getFlight,
  listFlightManifest,
  listUnassignedForFlight,
} from "@/lib/data/flights-repository";
import { loadAssignedGroupIds } from "@/lib/data/team-repository";
import { createClient } from "@/utils/supabase/server";

import FlightManifestView from "./components/flight-manifest-view";

/**
 * One flight's passenger manifest and baggage rules — the gap flagged when
 * Flights first shipped ("per-flight passenger manifests/baggage rules are
 * deferred"). See supabase/migrations/20261025090000_flight_manifests_and_rooming_board.sql
 * for why this needed a junction table rather than a column on
 * departure_group_pilgrims.
 */
export default async function FlightManifestPage({
  params,
}: {
  params: Promise<{ flightId: string }>;
}) {
  const { flightId } = await params;
  const { role, staffId } = await getCurrentStaffRole();
  const can = capabilitiesFor(role);
  if (!can.viewModule) notFound();

  const supabase = createClient(await cookies());
  const flight = await getFlight(supabase, flightId);
  if (!flight) notFound();

  if (can.restrictedToAssignedGroups) {
    const assignedGroupIds = staffId ? await loadAssignedGroupIds(supabase, staffId) : [];
    if (!assignedGroupIds.includes(flight.departureGroupId)) notFound();
  }

  const [manifest, unassigned] = await Promise.all([
    listFlightManifest(supabase, flightId),
    can.manageFlights ? listUnassignedForFlight(supabase, flight.departureGroupId, flightId) : Promise.resolve([]),
  ]);

  return (
    <FlightManifestView
      flight={flight}
      manifest={manifest}
      unassigned={unassigned}
      canManage={can.manageFlights}
    />
  );
}
