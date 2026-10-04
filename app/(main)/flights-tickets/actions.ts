"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

import { capabilitiesFor } from "@/lib/access/departure-groups-access";
import {
  assignPassengerToFlight,
  removePassengerFromFlight,
  updateFlightBaggageRules,
} from "@/lib/data/flights-repository";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { requireUser } from "@/lib/dal";
import { createClient } from "@/utils/supabase/server";

interface ActionResult {
  ok: boolean;
  error?: string;
}

async function db() {
  return createClient(await cookies());
}

/** Same gate as the group's own Flights tab (can.manageFlights) — a manifest/baggage edit is still a flight edit. */
async function requireCanManage() {
  await requireUser();
  const { role, name } = await getCurrentStaffRole();
  return { ok: capabilitiesFor(role).manageFlights, name };
}

function revalidateFlight(flightId: string) {
  revalidatePath(`/flights-tickets/${flightId}`);
  revalidatePath("/operations");
}

export async function assignPassengerToFlightAction(flightId: string, departureGroupPilgrimId: string): Promise<ActionResult> {
  const { ok, name } = await requireCanManage();
  if (!ok) return { ok: false, error: "Your role cannot edit this flight's manifest." };

  const supabase = await db();
  await assignPassengerToFlight(supabase, flightId, departureGroupPilgrimId, name ?? "Staff");
  revalidateFlight(flightId);
  return { ok: true };
}

export async function removePassengerFromFlightAction(flightId: string, departureGroupPilgrimId: string): Promise<ActionResult> {
  const { ok } = await requireCanManage();
  if (!ok) return { ok: false, error: "Your role cannot edit this flight's manifest." };

  const supabase = await db();
  await removePassengerFromFlight(supabase, flightId, departureGroupPilgrimId);
  revalidateFlight(flightId);
  return { ok: true };
}

export async function updateFlightBaggageRulesAction(
  flightId: string,
  input: { allowanceKg: number | null; notes: string | null },
): Promise<ActionResult> {
  const { ok } = await requireCanManage();
  if (!ok) return { ok: false, error: "Your role cannot edit baggage rules." };

  const supabase = await db();
  await updateFlightBaggageRules(supabase, flightId, input);
  revalidateFlight(flightId);
  return { ok: true };
}
