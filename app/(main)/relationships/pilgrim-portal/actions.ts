"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

import { capabilitiesForPilgrims } from "@/lib/access/pilgrims-access";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import {
  invitePilgrimToPortal,
  markPilgrimPortalActivated,
  revokePilgrimPortalAccess,
} from "@/lib/data/portal-access-repository";
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
  const { role, name } = await getCurrentStaffRole();
  return { ok: capabilitiesForPilgrims(role).managePortalAccess, name };
}

function revalidatePortal() {
  revalidatePath("/relationships/pilgrim-portal");
}

export async function invitePilgrimToPortalAction(pilgrimId: string): Promise<ActionResult> {
  const { ok, name } = await requireCanManage();
  if (!ok) return { ok: false, error: "Your role cannot manage portal access." };

  const supabase = await db();
  // Sign-in is email magic-link only in this first version (see
  // supabase/migrations/20261026090000_pilgrim_portal_auth.sql) — a pilgrim
  // with no email on file has nowhere for the link to go.
  const { data: pilgrim } = await supabase.from("pilgrims").select("email").eq("id", pilgrimId).maybeSingle();
  if (!pilgrim?.email) {
    return { ok: false, error: "Add an email address to this pilgrim before inviting them to the portal." };
  }

  await invitePilgrimToPortal(supabase, pilgrimId, name ?? "Staff");
  revalidatePortal();
  return { ok: true };
}

export async function revokePilgrimPortalAccessAction(pilgrimId: string): Promise<ActionResult> {
  const { ok, name } = await requireCanManage();
  if (!ok) return { ok: false, error: "Your role cannot manage portal access." };

  const supabase = await db();
  await revokePilgrimPortalAccess(supabase, pilgrimId, name ?? "Staff");
  revalidatePortal();
  return { ok: true };
}

export async function markPilgrimPortalActivatedAction(pilgrimId: string): Promise<ActionResult> {
  const { ok, name } = await requireCanManage();
  if (!ok) return { ok: false, error: "Your role cannot manage portal access." };

  const supabase = await db();
  await markPilgrimPortalActivated(supabase, pilgrimId, name ?? "Staff");
  revalidatePortal();
  return { ok: true };
}
