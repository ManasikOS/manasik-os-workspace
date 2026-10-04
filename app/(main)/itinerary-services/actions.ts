"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

import { capabilitiesFor } from "@/lib/access/departure-groups-access";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import {
  createItinerary,
  createItineraryDay,
  createItineraryEvent,
  deleteItineraryDay,
  deleteItineraryEvent,
  getItinerary,
  issueVoucher,
  listEventAttendance,
  listVouchersForEvent,
  publishItinerary,
  setAttendance,
  setItineraryEventConfirmed,
  updateVoucherStatus,
  type AttendanceStatus,
  type AttendanceWithPilgrim,
  type CreateEventInput,
  type ItineraryCity,
  type VoucherStatus,
  type VoucherWithPilgrim,
} from "@/lib/data/itinerary-repository";
import { requireUser } from "@/lib/dal";
import { createClient } from "@/utils/supabase/server";

interface ActionResult {
  ok: boolean;
  error?: string;
}

async function db() {
  return createClient(await cookies());
}

async function requireCanManage() {
  await requireUser();
  const { role, name, staffId } = await getCurrentStaffRole();
  const can = capabilitiesFor(role);
  return { ok: can.editGroupDetails, role, name, staffId };
}

function revalidateItinerary(departureGroupId: string) {
  revalidatePath("/itinerary-services");
  revalidatePath(`/itinerary-services/${departureGroupId}`);
}

/** Lazily creates the draft itinerary the first time a group's builder opens. */
export async function ensureItineraryAction(
  departureGroupId: string,
): Promise<ActionResult & { itineraryId?: string }> {
  const { ok } = await requireCanManage();
  if (!ok) return { ok: false, error: "Your role cannot manage itineraries." };

  const supabase = await db();
  const existing = await getItinerary(supabase, departureGroupId);
  if (existing) return { ok: true, itineraryId: existing.id };

  const created = await createItinerary(supabase, departureGroupId);
  revalidateItinerary(departureGroupId);
  return { ok: true, itineraryId: created.id };
}

export async function addItineraryDayAction(input: {
  departureGroupId: string;
  itineraryId: string;
  dayNumber: number;
  city: ItineraryCity;
  title: string;
  date: string | null;
}): Promise<ActionResult> {
  const { ok } = await requireCanManage();
  if (!ok) return { ok: false, error: "Your role cannot manage itineraries." };
  if (!input.title.trim()) return { ok: false, error: "Give the day a title." };

  const supabase = await db();
  try {
    await createItineraryDay(supabase, {
      itineraryId: input.itineraryId,
      dayNumber: input.dayNumber,
      city: input.city,
      title: input.title.trim(),
      date: input.date,
    });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not add the day." };
  }
  revalidateItinerary(input.departureGroupId);
  return { ok: true };
}

export async function removeItineraryDayAction(
  departureGroupId: string,
  dayId: string,
): Promise<ActionResult> {
  const { ok } = await requireCanManage();
  if (!ok) return { ok: false, error: "Your role cannot manage itineraries." };

  const supabase = await db();
  await deleteItineraryDay(supabase, dayId);
  revalidateItinerary(departureGroupId);
  return { ok: true };
}

export async function addItineraryEventAction(input: CreateEventInput): Promise<ActionResult> {
  const { ok } = await requireCanManage();
  if (!ok) return { ok: false, error: "Your role cannot manage itineraries." };
  if (!input.title.trim()) return { ok: false, error: "Give the event a title." };
  if (input.visibleToPilgrims && !input.pilgrimFacingNotes?.trim()) {
    return { ok: false, error: "An event visible to pilgrims needs pilgrim-facing wording." };
  }

  const supabase = await db();
  try {
    await createItineraryEvent(supabase, input);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not add the event." };
  }
  revalidateItinerary(input.departureGroupId);
  return { ok: true };
}

export async function toggleEventConfirmedAction(
  departureGroupId: string,
  eventId: string,
  confirmed: boolean,
): Promise<ActionResult> {
  const { ok } = await requireCanManage();
  if (!ok) return { ok: false, error: "Your role cannot manage itineraries." };

  const supabase = await db();
  await setItineraryEventConfirmed(supabase, eventId, confirmed);
  revalidateItinerary(departureGroupId);
  return { ok: true };
}

export async function removeItineraryEventAction(
  departureGroupId: string,
  eventId: string,
): Promise<ActionResult> {
  const { ok } = await requireCanManage();
  if (!ok) return { ok: false, error: "Your role cannot manage itineraries." };

  const supabase = await db();
  await deleteItineraryEvent(supabase, eventId);
  revalidateItinerary(departureGroupId);
  return { ok: true };
}

/**
 * Publishing is the one action a pilgrim portal (future work) would ever
 * treat as "this itinerary is now real" — nothing else in this module
 * changes pilgrim-visible state.
 */
export async function publishItineraryAction(
  departureGroupId: string,
  itineraryId: string,
): Promise<ActionResult> {
  const { ok, name, staffId } = await requireCanManage();
  if (!ok) return { ok: false, error: "Your role cannot publish itineraries." };

  const supabase = await db();
  await publishItinerary(supabase, itineraryId, { id: staffId ?? null, name: name ?? "Staff" });
  revalidateItinerary(departureGroupId);
  return { ok: true };
}

export async function getEventAttendanceAction(
  departureGroupId: string,
  itineraryEventId: string,
): Promise<ActionResult & { attendance?: AttendanceWithPilgrim[] }> {
  const { ok } = await requireCanManage();
  if (!ok) return { ok: false, error: "Your role cannot view attendance." };

  const supabase = await db();
  const attendance = await listEventAttendance(supabase, departureGroupId, itineraryEventId);
  return { ok: true, attendance };
}

export async function getEventVouchersAction(
  itineraryEventId: string,
): Promise<ActionResult & { vouchers?: VoucherWithPilgrim[] }> {
  const { ok } = await requireCanManage();
  if (!ok) return { ok: false, error: "Your role cannot view vouchers." };

  const supabase = await db();
  const vouchers = await listVouchersForEvent(supabase, itineraryEventId);
  return { ok: true, vouchers };
}

export async function setAttendanceAction(
  departureGroupId: string,
  itineraryEventId: string,
  departureGroupPilgrimId: string,
  status: AttendanceStatus,
): Promise<ActionResult> {
  const { ok, name } = await requireCanManage();
  if (!ok) return { ok: false, error: "Your role cannot manage attendance." };

  const supabase = await db();
  await setAttendance(supabase, itineraryEventId, departureGroupPilgrimId, status, name ?? "Staff");
  revalidateItinerary(departureGroupId);
  return { ok: true };
}

export async function issueVoucherAction(input: {
  departureGroupId: string;
  departureGroupPilgrimId: string;
  itineraryEventId: string | null;
  serviceName: string;
  notes: string | null;
}): Promise<ActionResult> {
  const { ok, name } = await requireCanManage();
  if (!ok) return { ok: false, error: "Your role cannot issue vouchers." };
  if (!input.serviceName.trim()) return { ok: false, error: "Name the service this voucher is for." };

  const supabase = await db();
  await issueVoucher(supabase, { ...input, issuedByName: name ?? "Staff" });
  revalidateItinerary(input.departureGroupId);
  return { ok: true };
}

export async function updateVoucherStatusAction(
  departureGroupId: string,
  voucherId: string,
  status: VoucherStatus,
): Promise<ActionResult> {
  const { ok, name } = await requireCanManage();
  if (!ok) return { ok: false, error: "Your role cannot update this voucher." };

  const supabase = await db();
  await updateVoucherStatus(supabase, voucherId, status, name ?? "Staff");
  revalidateItinerary(departureGroupId);
  return { ok: true };
}
