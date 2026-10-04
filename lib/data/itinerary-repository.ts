/**
 * Server-only read/write access for Itinerary & Services.
 *
 * Backed by the `itineraries` / `itinerary_days` / `itinerary_events` tables
 * added in `supabase/migrations/20261011090000_itinerary_services.sql` — a
 * departure group's live operational plan, separate from the frozen
 * `itinerary_snapshot` on its package snapshot. RLS on all three tables
 * enforces `agency_id = current_agency_id()`; this file adds nothing on top
 * beyond typing, the same posture as `bookings-repository.ts`.
 *
 * NOTE: this migration has not been applied to any live database by this
 * change — see the PR/commit description. Every function here will fail
 * against a database that hasn't run `supabase db push` for it yet.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Db = SupabaseClient<any, any, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

export class ItineraryPersistenceError extends Error {
  constructor(
    readonly table: string,
    readonly operation: "select" | "insert" | "update" | "delete",
    cause: unknown,
  ) {
    const detail =
      cause && typeof cause === "object" && "message" in cause
        ? String((cause as { message: unknown }).message)
        : String(cause);
    super(`Itinerary: ${operation} on ${table} failed — ${detail}`);
    this.name = "ItineraryPersistenceError";
  }
}

export type ItineraryStatus = "DRAFT" | "PUBLISHED";
export type ItineraryCity = "MAKKAH" | "MADINAH" | "MINA" | "ARAFAT" | "OTHER";
export type ItineraryEventType =
  | "ZIYARAH"
  | "MEAL"
  | "TRANSPORT"
  | "HOTEL_CHECK_IN"
  | "HOTEL_CHECK_OUT"
  | "FLIGHT"
  | "FREE_TIME"
  | "BRIEFING"
  | "OTHER";

export interface ItineraryRow {
  id: string;
  departureGroupId: string;
  status: ItineraryStatus;
  publishedAt: string | null;
  publishedByName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ItineraryDayRow {
  id: string;
  itineraryId: string;
  dayNumber: number;
  date: string | null;
  city: ItineraryCity;
  title: string;
}

export interface ItineraryEventRow {
  id: string;
  itineraryDayId: string;
  departureGroupId: string;
  sortOrder: number;
  startTime: string | null;
  title: string;
  eventType: ItineraryEventType;
  location: string | null;
  guideName: string | null;
  supplierName: string | null;
  confirmed: boolean;
  capacity: number | null;
  internalNotes: string | null;
  pilgrimFacingNotes: string | null;
  visibleToPilgrims: boolean;
}

export interface CrossGroupItinerarySummary {
  departureGroupId: string;
  groupName: string;
  groupCode: string;
  groupStatus: string;
  departureDate: string;
  itineraryId: string | null;
  status: ItineraryStatus | "NOT_STARTED";
  dayCount: number;
  eventCount: number;
  unconfirmedCount: number;
}

function mapItinerary(row: {
  id: string;
  departure_group_id: string;
  status: ItineraryStatus;
  published_at: string | null;
  published_by_name: string | null;
  created_at: string;
  updated_at: string;
}): ItineraryRow {
  return {
    id: row.id,
    departureGroupId: row.departure_group_id,
    status: row.status,
    publishedAt: row.published_at,
    publishedByName: row.published_by_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Fetches a group's itinerary, or null if one has never been started. */
export async function getItinerary(client: Db, departureGroupId: string): Promise<ItineraryRow | null> {
  const { data, error } = await client
    .from("itineraries")
    .select("*")
    .eq("departure_group_id", departureGroupId)
    .maybeSingle();
  if (error) throw new ItineraryPersistenceError("itineraries", "select", error);
  return data ? mapItinerary(data) : null;
}

/** Creates the (draft) itinerary row the first time a group's builder is opened. */
export async function createItinerary(client: Db, departureGroupId: string): Promise<ItineraryRow> {
  const { data, error } = await client
    .from("itineraries")
    .insert({ departure_group_id: departureGroupId })
    .select("*")
    .single();
  if (error) throw new ItineraryPersistenceError("itineraries", "insert", error);
  return mapItinerary(data);
}

export async function listItineraryDays(client: Db, itineraryId: string): Promise<ItineraryDayRow[]> {
  const { data, error } = await client
    .from("itinerary_days")
    .select("id, itinerary_id, day_number, date, city, title")
    .eq("itinerary_id", itineraryId)
    .order("day_number", { ascending: true });
  if (error) throw new ItineraryPersistenceError("itinerary_days", "select", error);
  return (data ?? []).map((d) => ({
    id: d.id,
    itineraryId: d.itinerary_id,
    dayNumber: d.day_number,
    date: d.date,
    city: d.city,
    title: d.title,
  }));
}

export async function createItineraryDay(
  client: Db,
  input: { itineraryId: string; dayNumber: number; city: ItineraryCity; title: string; date: string | null },
): Promise<ItineraryDayRow> {
  const { data, error } = await client
    .from("itinerary_days")
    .insert({
      itinerary_id: input.itineraryId,
      day_number: input.dayNumber,
      city: input.city,
      title: input.title,
      date: input.date,
    })
    .select("id, itinerary_id, day_number, date, city, title")
    .single();
  if (error) throw new ItineraryPersistenceError("itinerary_days", "insert", error);
  return {
    id: data.id,
    itineraryId: data.itinerary_id,
    dayNumber: data.day_number,
    date: data.date,
    city: data.city,
    title: data.title,
  };
}

export async function deleteItineraryDay(client: Db, dayId: string): Promise<void> {
  const { error } = await client.from("itinerary_days").delete().eq("id", dayId);
  if (error) throw new ItineraryPersistenceError("itinerary_days", "delete", error);
}

function mapEvent(row: {
  id: string;
  itinerary_day_id: string;
  departure_group_id: string;
  sort_order: number;
  start_time: string | null;
  title: string;
  event_type: ItineraryEventType;
  location: string | null;
  guide_name: string | null;
  supplier_name: string | null;
  confirmed: boolean;
  capacity: number | null;
  internal_notes: string | null;
  pilgrim_facing_notes: string | null;
  visible_to_pilgrims: boolean;
}): ItineraryEventRow {
  return {
    id: row.id,
    itineraryDayId: row.itinerary_day_id,
    departureGroupId: row.departure_group_id,
    sortOrder: row.sort_order,
    startTime: row.start_time,
    title: row.title,
    eventType: row.event_type,
    location: row.location,
    guideName: row.guide_name,
    supplierName: row.supplier_name,
    confirmed: row.confirmed,
    capacity: row.capacity,
    internalNotes: row.internal_notes,
    pilgrimFacingNotes: row.pilgrim_facing_notes,
    visibleToPilgrims: row.visible_to_pilgrims,
  };
}

export async function listItineraryEvents(client: Db, dayIds: string[]): Promise<ItineraryEventRow[]> {
  if (dayIds.length === 0) return [];
  const { data, error } = await client
    .from("itinerary_events")
    .select("*")
    .in("itinerary_day_id", dayIds)
    .order("sort_order", { ascending: true });
  if (error) throw new ItineraryPersistenceError("itinerary_events", "select", error);
  return (data ?? []).map(mapEvent);
}

export interface CreateEventInput {
  itineraryDayId: string;
  departureGroupId: string;
  sortOrder: number;
  startTime: string | null;
  title: string;
  eventType: ItineraryEventType;
  location: string | null;
  guideName: string | null;
  supplierName: string | null;
  capacity: number | null;
  internalNotes: string | null;
  pilgrimFacingNotes: string | null;
  visibleToPilgrims: boolean;
}

export async function createItineraryEvent(client: Db, input: CreateEventInput): Promise<ItineraryEventRow> {
  const { data, error } = await client
    .from("itinerary_events")
    .insert({
      itinerary_day_id: input.itineraryDayId,
      departure_group_id: input.departureGroupId,
      sort_order: input.sortOrder,
      start_time: input.startTime,
      title: input.title,
      event_type: input.eventType,
      location: input.location,
      guide_name: input.guideName,
      supplier_name: input.supplierName,
      capacity: input.capacity,
      internal_notes: input.internalNotes,
      pilgrim_facing_notes: input.pilgrimFacingNotes,
      visible_to_pilgrims: input.visibleToPilgrims,
    })
    .select("*")
    .single();
  if (error) throw new ItineraryPersistenceError("itinerary_events", "insert", error);
  return mapEvent(data);
}

export async function setItineraryEventConfirmed(client: Db, eventId: string, confirmed: boolean): Promise<void> {
  const { error } = await client.from("itinerary_events").update({ confirmed }).eq("id", eventId);
  if (error) throw new ItineraryPersistenceError("itinerary_events", "update", error);
}

export async function deleteItineraryEvent(client: Db, eventId: string): Promise<void> {
  const { error } = await client.from("itinerary_events").delete().eq("id", eventId);
  if (error) throw new ItineraryPersistenceError("itinerary_events", "delete", error);
}

export async function publishItinerary(
  client: Db,
  itineraryId: string,
  actor: { id: string | null; name: string },
): Promise<void> {
  const { error } = await client
    .from("itineraries")
    .update({
      status: "PUBLISHED",
      published_at: new Date().toISOString(),
      published_by: actor.id,
      published_by_name: actor.name,
    })
    .eq("id", itineraryId);
  if (error) throw new ItineraryPersistenceError("itineraries", "update", error);
}

/**
 * One row per departure group for `/itinerary-services` — status, day
 * count, event count and how many events still lack supplier/guide
 * confirmation. Three round trips (groups, itineraries+days, events) rather
 * than a database view, since this table set is new and a view can follow
 * once the shape has proven stable.
 */
export async function listAllItinerarySummaries(client: Db): Promise<CrossGroupItinerarySummary[]> {
  const [groupsResult, itinerariesResult] = await Promise.all([
    client.from("departure_groups").select("id, group_name, group_code, group_status, departure_date"),
    client.from("itineraries").select("id, departure_group_id, status"),
  ]);
  if (groupsResult.error)
    throw new ItineraryPersistenceError("departure_groups", "select", groupsResult.error);
  if (itinerariesResult.error)
    throw new ItineraryPersistenceError("itineraries", "select", itinerariesResult.error);

  interface GroupRow {
    id: string;
    group_name: string;
    group_code: string;
    group_status: string;
    departure_date: string;
  }
  interface ItinRow {
    id: string;
    departure_group_id: string;
    status: ItineraryStatus;
  }

  const itineraries = (itinerariesResult.data ?? []) as ItinRow[];
  const itineraryIds = itineraries.map((i) => i.id);

  const [daysResult, eventsResult] = await Promise.all([
    itineraryIds.length > 0
      ? client.from("itinerary_days").select("id, itinerary_id").in("itinerary_id", itineraryIds)
      : Promise.resolve({ data: [], error: null }),
    itineraryIds.length > 0
      ? client
          .from("itinerary_events")
          .select("id, departure_group_id, confirmed")
          .in(
            "departure_group_id",
            itineraries.map((i) => i.departure_group_id),
          )
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (daysResult.error) throw new ItineraryPersistenceError("itinerary_days", "select", daysResult.error);
  if (eventsResult.error) throw new ItineraryPersistenceError("itinerary_events", "select", eventsResult.error);

  const dayCountByItinerary = new Map<string, number>();
  for (const d of (daysResult.data ?? []) as { id: string; itinerary_id: string }[]) {
    dayCountByItinerary.set(d.itinerary_id, (dayCountByItinerary.get(d.itinerary_id) ?? 0) + 1);
  }

  const eventCountByGroup = new Map<string, number>();
  const unconfirmedByGroup = new Map<string, number>();
  for (const e of (eventsResult.data ?? []) as { id: string; departure_group_id: string; confirmed: boolean }[]) {
    eventCountByGroup.set(e.departure_group_id, (eventCountByGroup.get(e.departure_group_id) ?? 0) + 1);
    if (!e.confirmed) unconfirmedByGroup.set(e.departure_group_id, (unconfirmedByGroup.get(e.departure_group_id) ?? 0) + 1);
  }

  const itineraryByGroup = new Map(itineraries.map((i) => [i.departure_group_id, i]));

  return ((groupsResult.data ?? []) as GroupRow[])
    .map((g) => {
      const itinerary = itineraryByGroup.get(g.id);
      return {
        departureGroupId: g.id,
        groupName: g.group_name,
        groupCode: g.group_code,
        groupStatus: g.group_status,
        departureDate: g.departure_date,
        itineraryId: itinerary?.id ?? null,
        status: itinerary?.status ?? "NOT_STARTED",
        dayCount: itinerary ? (dayCountByItinerary.get(itinerary.id) ?? 0) : 0,
        eventCount: eventCountByGroup.get(g.id) ?? 0,
        unconfirmedCount: unconfirmedByGroup.get(g.id) ?? 0,
      } satisfies CrossGroupItinerarySummary;
    })
    .sort((a, b) => a.departureDate.localeCompare(b.departureDate));
}

/* ── Per-pilgrim attendance and service vouchers (M9 remainder) ─────────────
 * Backed by `itinerary_event_pilgrims` / `service_vouchers` added in
 * supabase/migrations/20261027090000_itinerary_attendance_and_vouchers.sql.
 */

export type AttendanceStatus = "REGISTERED" | "ATTENDED" | "NO_SHOW" | "CANCELLED";
export type VoucherStatus = "ISSUED" | "REDEEMED" | "CANCELLED";

export interface AttendanceRow {
  id: string;
  itineraryEventId: string;
  departureGroupPilgrimId: string;
  status: AttendanceStatus;
  markedByName: string | null;
  markedAt: string;
}

export interface AttendanceWithPilgrim extends AttendanceRow {
  fullName: string;
}

export interface VoucherRow {
  id: string;
  departureGroupPilgrimId: string;
  itineraryEventId: string | null;
  voucherCode: string;
  serviceName: string;
  status: VoucherStatus;
  notes: string | null;
  issuedByName: string;
  issuedAt: string;
  redeemedByName: string | null;
  redeemedAt: string | null;
}

export interface VoucherWithPilgrim extends VoucherRow {
  fullName: string;
}

/** Every traveller in the group, with their attendance record for one event if they have one — the roster the attendance dialog renders. */
export async function listEventAttendance(
  client: Db,
  departureGroupId: string,
  itineraryEventId: string,
): Promise<AttendanceWithPilgrim[]> {
  const [travellersResult, attendanceResult] = await Promise.all([
    client
      .from("departure_group_pilgrims")
      .select("id, full_name_snapshot")
      .eq("departure_group_id", departureGroupId),
    client.from("itinerary_event_pilgrims").select("*").eq("itinerary_event_id", itineraryEventId),
  ]);
  if (travellersResult.error) throw new ItineraryPersistenceError("departure_group_pilgrims", "select", travellersResult.error);
  if (attendanceResult.error) throw new ItineraryPersistenceError("itinerary_event_pilgrims", "select", attendanceResult.error);

  interface RawAttendance {
    id: string;
    itinerary_event_id: string;
    departure_group_pilgrim_id: string;
    status: AttendanceStatus;
    marked_by_name: string | null;
    marked_at: string;
  }
  const attendanceByPilgrim = new Map(
    ((attendanceResult.data ?? []) as RawAttendance[]).map((a) => [a.departure_group_pilgrim_id, a]),
  );

  return ((travellersResult.data ?? []) as { id: string; full_name_snapshot: string }[]).map((t) => {
    const existing = attendanceByPilgrim.get(t.id);
    return {
      id: existing?.id ?? "",
      itineraryEventId,
      departureGroupPilgrimId: t.id,
      status: existing?.status ?? "REGISTERED",
      markedByName: existing?.marked_by_name ?? null,
      markedAt: existing?.marked_at ?? "",
      fullName: t.full_name_snapshot,
    } satisfies AttendanceWithPilgrim;
  });
}

export async function setAttendance(
  client: Db,
  itineraryEventId: string,
  departureGroupPilgrimId: string,
  status: AttendanceStatus,
  markedByName: string,
): Promise<void> {
  const { error } = await client.from("itinerary_event_pilgrims").upsert(
    {
      itinerary_event_id: itineraryEventId,
      departure_group_pilgrim_id: departureGroupPilgrimId,
      status,
      marked_by_name: markedByName,
      marked_at: new Date().toISOString(),
    },
    { onConflict: "itinerary_event_id,departure_group_pilgrim_id" },
  );
  if (error) throw new ItineraryPersistenceError("itinerary_event_pilgrims", "insert", error);
}

export async function listVouchersForEvent(client: Db, itineraryEventId: string): Promise<VoucherWithPilgrim[]> {
  const { data, error } = await client
    .from("service_vouchers")
    .select("*, departure_group_pilgrims:departure_group_pilgrim_id ( full_name_snapshot )")
    .eq("itinerary_event_id", itineraryEventId)
    .order("issued_at", { ascending: false });
  if (error) throw new ItineraryPersistenceError("service_vouchers", "select", error);

  interface RawVoucher {
    id: string;
    departure_group_pilgrim_id: string;
    itinerary_event_id: string | null;
    voucher_code: string;
    service_name: string;
    status: VoucherStatus;
    notes: string | null;
    issued_by_name: string;
    issued_at: string;
    redeemed_by_name: string | null;
    redeemed_at: string | null;
    departure_group_pilgrims: { full_name_snapshot: string } | null;
  }

  return ((data ?? []) as unknown as RawVoucher[]).map((v) => ({
    id: v.id,
    departureGroupPilgrimId: v.departure_group_pilgrim_id,
    itineraryEventId: v.itinerary_event_id,
    voucherCode: v.voucher_code,
    serviceName: v.service_name,
    status: v.status,
    notes: v.notes,
    issuedByName: v.issued_by_name,
    issuedAt: v.issued_at,
    redeemedByName: v.redeemed_by_name,
    redeemedAt: v.redeemed_at,
    fullName: v.departure_group_pilgrims?.full_name_snapshot ?? "Unknown",
  }));
}

function randomVoucherCode(): string {
  return `VCH-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

export interface IssueVoucherInput {
  departureGroupPilgrimId: string;
  itineraryEventId: string | null;
  serviceName: string;
  notes: string | null;
  issuedByName: string;
}

export async function issueVoucher(client: Db, input: IssueVoucherInput): Promise<VoucherRow> {
  let code = randomVoucherCode();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { data, error } = await client
      .from("service_vouchers")
      .insert({
        departure_group_pilgrim_id: input.departureGroupPilgrimId,
        itinerary_event_id: input.itineraryEventId,
        voucher_code: code,
        service_name: input.serviceName,
        notes: input.notes,
        issued_by_name: input.issuedByName,
      })
      .select("*")
      .single();
    if (!error) {
      return {
        id: data.id,
        departureGroupPilgrimId: data.departure_group_pilgrim_id,
        itineraryEventId: data.itinerary_event_id,
        voucherCode: data.voucher_code,
        serviceName: data.service_name,
        status: data.status,
        notes: data.notes,
        issuedByName: data.issued_by_name,
        issuedAt: data.issued_at,
        redeemedByName: data.redeemed_by_name,
        redeemedAt: data.redeemed_at,
      } satisfies VoucherRow;
    }
    if (!error.message?.includes("voucher_code")) throw new ItineraryPersistenceError("service_vouchers", "insert", error);
    code = randomVoucherCode();
  }
  throw new ItineraryPersistenceError("service_vouchers", "insert", new Error("could not generate a unique voucher code"));
}

export async function updateVoucherStatus(
  client: Db,
  voucherId: string,
  status: VoucherStatus,
  actorName: string,
): Promise<void> {
  const patch: Record<string, unknown> = { status };
  if (status === "REDEEMED") {
    patch.redeemed_by_name = actorName;
    patch.redeemed_at = new Date().toISOString();
  }
  const { error } = await client.from("service_vouchers").update(patch).eq("id", voucherId);
  if (error) throw new ItineraryPersistenceError("service_vouchers", "update", error);
}
