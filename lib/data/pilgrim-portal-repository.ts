/**
 * Read access for the pilgrim-facing portal itself (as opposed to
 * `lib/data/portal-access-repository.ts`, which is the staff-side access
 * lifecycle). Every function here runs on the portal pilgrim's own session
 * client — RLS (`supabase/migrations/20261026090000_pilgrim_portal_auth.sql`)
 * is what actually scopes every query to their own records; these functions
 * don't repeat that scoping themselves.
 *
 * v1 is read-only: journey/booking summary, a PUBLISHED itinerary's
 * pilgrim-visible events, and document checklist status. Payment schedule
 * viewing, document upload and support-request submission are deferred —
 * see the module's implementation notes.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Db = SupabaseClient<any, any, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface PortalBookingSummary {
  bookingRowId: string;
  departureGroupId: string;
  groupName: string;
  groupCode: string;
  departureDate: string;
  groupStatus: string;
  seatStatus: string;
  visaStatus: string;
  paymentStatus: string;
  documentsCompleted: number;
  documentsRequired: number;
  hasPublishedItinerary: boolean;
}

/** Every departure-group booking this portal pilgrim has, RLS-scoped to their own pilgrims.id. */
export async function listPortalBookings(client: Db): Promise<PortalBookingSummary[]> {
  const { data, error } = await client
    .from("departure_group_pilgrims")
    .select(
      `id, departure_group_id, seat_status, visa_status, payment_status,
       documents_completed, documents_required,
       departure_groups:departure_group_id ( group_name, group_code, departure_date, group_status )`,
    );
  if (error) throw error;

  const rows = (data ?? []) as unknown as {
    id: string;
    departure_group_id: string;
    seat_status: string;
    visa_status: string;
    payment_status: string;
    documents_completed: number;
    documents_required: number;
    departure_groups: { group_name: string; group_code: string; departure_date: string; group_status: string } | null;
  }[];
  if (rows.length === 0) return [];

  const { data: itineraries } = await client
    .from("itineraries")
    .select("departure_group_id")
    .eq("status", "PUBLISHED")
    .in("departure_group_id", rows.map((r) => r.departure_group_id));
  const publishedGroupIds = new Set(((itineraries ?? []) as { departure_group_id: string }[]).map((i) => i.departure_group_id));

  return rows.map((row) => {
    const group = row.departure_groups ?? { group_name: "—", group_code: "—", departure_date: "", group_status: "PLANNING" };
    return {
      bookingRowId: row.id,
      departureGroupId: row.departure_group_id,
      groupName: group.group_name,
      groupCode: group.group_code,
      departureDate: group.departure_date,
      groupStatus: group.group_status,
      seatStatus: row.seat_status,
      visaStatus: row.visa_status,
      paymentStatus: row.payment_status,
      documentsCompleted: row.documents_completed,
      documentsRequired: row.documents_required,
      hasPublishedItinerary: publishedGroupIds.has(row.departure_group_id),
    } satisfies PortalBookingSummary;
  });
}

export interface PortalItineraryEvent {
  id: string;
  dayNumber: number;
  date: string | null;
  city: string;
  dayTitle: string;
  startTime: string | null;
  title: string;
  eventType: string;
  location: string | null;
  pilgrimFacingNotes: string | null;
}

/** A published itinerary's pilgrim-visible events for one of this portal pilgrim's own groups — empty if unpublished or not theirs (RLS). */
export async function getPortalItinerary(client: Db, departureGroupId: string): Promise<PortalItineraryEvent[]> {
  const { data: itinerary } = await client
    .from("itineraries")
    .select("id")
    .eq("departure_group_id", departureGroupId)
    .eq("status", "PUBLISHED")
    .maybeSingle();
  if (!itinerary) return [];

  const { data: days, error } = await client
    .from("itinerary_days")
    .select(
      "id, day_number, date, city, title, itinerary_events ( id, start_time, title, event_type, location, pilgrim_facing_notes, visible_to_pilgrims, sort_order )",
    )
    .eq("itinerary_id", itinerary.id)
    .order("day_number", { ascending: true });
  if (error) throw error;

  interface RawDay {
    id: string;
    day_number: number;
    date: string | null;
    city: string;
    title: string;
    itinerary_events: {
      id: string;
      start_time: string | null;
      title: string;
      event_type: string;
      location: string | null;
      pilgrim_facing_notes: string | null;
      visible_to_pilgrims: boolean;
      sort_order: number;
    }[];
  }

  const events: PortalItineraryEvent[] = [];
  for (const day of ((days ?? []) as unknown as RawDay[])) {
    const visible = day.itinerary_events.filter((e) => e.visible_to_pilgrims).sort((a, b) => a.sort_order - b.sort_order);
    for (const event of visible) {
      events.push({
        id: event.id,
        dayNumber: day.day_number,
        date: day.date,
        city: day.city,
        dayTitle: day.title,
        startTime: event.start_time,
        title: event.title,
        eventType: event.event_type,
        location: event.location,
        pilgrimFacingNotes: event.pilgrim_facing_notes,
      });
    }
  }
  return events;
}

export interface PortalVoucher {
  itineraryEventId: string | null;
  voucherCode: string;
  serviceName: string;
  status: string;
}

/** This portal pilgrim's own vouchers for one group — RLS already scopes to their own departure_group_pilgrims row(s). */
export async function listPortalVouchers(client: Db, departureGroupId: string): Promise<PortalVoucher[]> {
  const { data: ownRows, error: ownError } = await client
    .from("departure_group_pilgrims")
    .select("id")
    .eq("departure_group_id", departureGroupId);
  if (ownError) throw ownError;
  const ownIds = ((ownRows ?? []) as { id: string }[]).map((r) => r.id);
  if (ownIds.length === 0) return [];

  const { data, error } = await client
    .from("service_vouchers")
    .select("itinerary_event_id, voucher_code, service_name, status")
    .in("departure_group_pilgrim_id", ownIds);
  if (error) throw error;
  return ((data ?? []) as { itinerary_event_id: string | null; voucher_code: string; service_name: string; status: string }[]).map(
    (v) => ({
      itineraryEventId: v.itinerary_event_id,
      voucherCode: v.voucher_code,
      serviceName: v.service_name,
      status: v.status,
    }),
  );
}

export interface PortalDocument {
  id: string;
  name: string;
  category: string;
  required: boolean;
  status: string;
}

/** This portal pilgrim's own document checklist for one group — status only, no upload in v1. */
export async function listPortalDocuments(client: Db, departureGroupId: string): Promise<PortalDocument[]> {
  const { data, error } = await client
    .from("departure_group_pilgrim_documents")
    .select("id, name, category, required, status")
    .eq("departure_group_id", departureGroupId)
    .order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as PortalDocument[];
}
