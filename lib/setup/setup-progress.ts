import "server-only";

import { cookies } from "next/headers";
import { cache } from "react";

import { createClient } from "@/utils/supabase/server";

import { hasLiveChannel, loadConnectorStatuses } from "./connector-statuses";
import { deriveSetupProgress, type SetupProgress, type SetupStateRow } from "./setup-steps";

/** Reads the caller's agency state row, if any. Row-level security scopes it to the active agency. */
async function readSetupState(supabase: ReturnType<typeof createClient>): Promise<SetupStateRow> {
  const { data } = await supabase
    .from("agency_onboarding_state")
    .select("steps, basics_confirmed_at, password_set_at, guide_dismissed_at, last_step")
    .maybeSingle();

  return {
    steps: (data?.steps as Record<string, string> | null) ?? {},
    basicsConfirmedAt: (data?.basics_confirmed_at as string | null) ?? null,
    passwordSetAt: (data?.password_set_at as string | null) ?? null,
    guideDismissedAt: (data?.guide_dismissed_at as string | null) ?? null,
    lastStep: (data?.last_step as string | null) ?? null,
  };
}

/**
 * The setup guide's progress for the signed-in user's active agency: the few
 * stored facts plus live counts from the real tables. Every read goes through
 * the session client, so RLS scopes it to the caller's agency. Cached per
 * request; call `revalidatePath` after a mutation, not this.
 */
export const loadSetupProgress = cache(async (): Promise<SetupProgress> => {
  const supabase = createClient(await cookies());

  const [state, staff, connectors, payments, packages] = await Promise.all([
    readSetupState(supabase),
    supabase.from("staff_profiles").select("id", { count: "exact", head: true }).eq("status", "ACTIVE"),
    loadConnectorStatuses(),
    supabase.from("agency_payment_accounts").select("id", { count: "exact", head: true }).eq("active", true),
    supabase.from("packages").select("id", { count: "exact", head: true }),
  ]);

  return deriveSetupProgress(
    {
      activeStaffCount: staff.count ?? 0,
      channelConnected: hasLiveChannel(connectors),
      paymentAccountCount: payments.count ?? 0,
      packageCount: packages.count ?? 0,
    },
    state,
  );
});

/** Raw stored steps, for merge-on-write in the setup actions. */
export async function readStoredSetupSteps(): Promise<Record<string, string>> {
  const supabase = createClient(await cookies());
  return (await readSetupState(supabase)).steps;
}
