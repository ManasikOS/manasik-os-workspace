/**
 * Shared loader behind the booking detail screen — extracted so
 * `/bookings/[bookingId]` (the canonical route, Phase 1 P1.5) and
 * `/departure-groups/[groupId]/bookings/[bookingId]` (unchanged) render
 * the exact same data through the exact same access checks, rather than
 * two copies that could quietly drift apart.
 */

import { notFound } from "next/navigation";
import { cookies } from "next/headers";

import {
  canRoleOpenGroup,
  capabilitiesFor,
} from "@/lib/access/departure-groups-access";
import { capabilitiesForFinance } from "@/lib/access/finance-access";
import {
  getCurrentStaffRole,
  getDepartureGroupDetail,
  listMoveTargetGroups,
} from "@/lib/data/departure-groups";
import { getBookingCampaignAttribution, listCampaignOptions } from "@/lib/data/campaigns-repository";
import { loadAssignedGroupIds } from "@/lib/data/team-repository";
import { createClient } from "@/utils/supabase/server";

export async function loadBookingDetailData(groupId: string, bookingId: string) {
  const { role, staffId } = await getCurrentStaffRole();

  const can = capabilitiesFor(role);
  if (!can.viewModule) notFound();

  const detail = await getDepartureGroupDetail(groupId, role);
  if (!detail) notFound();

  const supabase = createClient(await cookies());
  const assignedGroupIds =
    role === "GUIDE" && staffId ? await loadAssignedGroupIds(supabase, staffId) : [];
  if (!canRoleOpenGroup(detail.group, role, assignedGroupIds)) notFound();

  const booking = detail.bookings.find((b) => b.id === bookingId);
  if (!booking) notFound();

  const travellers = detail.manifest.filter((row) => row.bookingId === bookingId);
  const travellerRelationships = detail.travellerRelationships.filter(
    (r) => r.bookingId === bookingId,
  );
  const moveTargets = can.editGroupDetails ? await listMoveTargetGroups(groupId) : [];
  const canInvoice = capabilitiesForFinance(role).createInvoices;
  const [campaignAttribution, campaignOptions] = await Promise.all([
    getBookingCampaignAttribution(supabase, bookingId).catch(() => ({ campaignId: null, attributionType: "UNKNOWN" as const })),
    listCampaignOptions(supabase).catch(() => []),
  ]);

  return {
    booking,
    travellers,
    group: detail.group,
    snapshot: detail.snapshot,
    activity: detail.activity,
    flights: detail.flights,
    accommodations: detail.accommodations,
    transports: detail.transports,
    serviceAddons: detail.serviceAddons,
    moveTargets,
    role,
    canInvoice,
    overdueBookingIds: detail.payments?.overdueBookingIds ?? [],
    campaignAttribution,
    campaignOptions,
    travellerRelationships,
  };
}

export async function resolveGroupIdForBooking(bookingId: string): Promise<string | null> {
  const supabase = createClient(await cookies());
  const { data } = await supabase
    .from("departure_group_bookings")
    .select("departure_group_id")
    .eq("id", bookingId)
    .maybeSingle();
  return data?.departure_group_id ?? null;
}
