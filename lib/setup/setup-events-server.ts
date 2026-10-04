import "server-only";

import { createAdminClient } from "@/utils/supabase/admin";

import { buildOnboardingEventRow, type OnboardingEventInput } from "./setup-events";

/**
 * Records one funnel event. Never throws and never blocks the caller's outcome:
 * a setup step must not fail because a counter could not be written. Uses the
 * service-role client (the table has no policies) with the agency id set
 * explicitly by the caller.
 */
export async function recordOnboardingEvent(input: OnboardingEventInput): Promise<void> {
  const row = buildOnboardingEventRow(input);
  if (!row) {
    console.error("[onboarding] refused a malformed funnel event", { event: input.event });
    return;
  }

  try {
    const { error } = await createAdminClient().from("onboarding_events").insert(row);
    if (error) console.error("[onboarding] could not record funnel event", { event: row.event, message: error.message });
  } catch (cause) {
    console.error("[onboarding] could not record funnel event", { event: row.event, cause });
  }
}
