import type { SupabaseClient } from "@supabase/supabase-js";

export type ProvisionSignupOutcome =
  | { kind: "provisioned"; agencyId: string }
  | { kind: "no_signup" }
  | { kind: "expired" }
  | { kind: "failed" };

/**
 * Turns the confirmed user's staged signup into an agency through the single
 * atomic RPC (`provision_agency_from_signup`, docs/onboarding/plan.md M2).
 *
 * Takes the service-role client because `pending_agency_signups` and the RPC
 * have no grant for `authenticated`. The caller must already have proved the
 * email through `requireUser()`; the RPC re-checks that the email matches the
 * staged row.
 *
 * Database messages never reach the caller: they are mapped to a small set of
 * outcomes the page can turn into plain-language screens.
 */
export async function provisionAgencyForSignup(
  admin: SupabaseClient,
  input: { userId: string; email: string },
): Promise<ProvisionSignupOutcome> {
  const email = input.email.trim().toLowerCase();

  const { data: pending } = await admin
    .from("pending_agency_signups")
    .select("id")
    .eq("email", email)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!pending) return { kind: "no_signup" };

  const { data: agencyId, error } = await admin.rpc("provision_agency_from_signup", {
    p_pending_id: pending.id,
    p_user_id: input.userId,
    p_email: email,
  });

  if (error || !agencyId) {
    if (error?.message?.includes("pending_signup_expired")) return { kind: "expired" };
    console.error("[onboarding] provision_agency_from_signup failed", { pendingId: pending.id, message: error?.message });
    return { kind: "failed" };
  }

  return { kind: "provisioned", agencyId: agencyId as string };
}
