"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/dal";
import { createClient } from "@/utils/supabase/server";

/**
 * Switches the caller's active agency. Server-side only — calls the
 * `switch_active_agency()` Postgres function (Phase 3 of
 * docs/architecture/multi-tenancy-implementation-plan.md), which verifies the caller
 * holds an ACTIVE membership in an ACTIVE agency before moving it onto
 * `staff_profiles`, the row every RLS policy actually reads.
 *
 * Switching agency changes that one shared row, so it affects every open
 * session for this person, not just the tab that clicked — see the
 * migration's header comment for why that trade-off was made.
 */
export async function switchAgencyAction(
  agencyId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireUser();

  const supabase = createClient(await cookies());
  const { error } = await supabase.rpc("switch_active_agency", { p_agency_id: agencyId });

  if (error) {
    return {
      ok: false,
      error: error.code === "42501" ? "You are not an active member of that workspace." : error.message,
    };
  }

  // Every cached read keyed off getCurrentStaffRole() — the whole app — is
  // now stale for this session.
  revalidatePath("/", "layout");

  return { ok: true };
}
