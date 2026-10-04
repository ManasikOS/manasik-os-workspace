/**
 * Data access for the SLA policy and its calendar — MI2.6 of docs/inbox/implementation-plan.md (Architecture §16 R2).
 *
 * The calendar is `ai_settings.working_hours` and the timezone `agency_settings.timezone`; no second calendar exists.
 * Reads work on either the service-role client (the sweep) or a signed-in one (the settings form); every query filters by
 * agency. Writes take the signed-in client so RLS (`owners manage inbox_sla_policies`: ADMIN and CEO only) is the backstop.
 */

import "server-only";

import type { Db } from "@/lib/ai/db";
import { DEFAULT_TIMEZONE, parseWorkingHours, type BusinessCalendar } from "@/lib/inbox/sla/business-hours";
import type { QueueCode } from "@/lib/inbox/intelligence/contracts";
import type { SlaPolicy } from "@/lib/inbox/sla/due-at";
import { mergeSlaPolicies, slaPolicyInputSchema, type SlaPolicyInput } from "@/lib/inbox/sla/policies";

export interface SlaSettings {
  policies: Map<QueueCode, SlaPolicy>;
  calendar: BusinessCalendar | null;
  /** False when the agency has not saved working hours: business-hours queues then run around the clock. */
  hasCalendar: boolean;
  timezone: string;
}

function isKnownTimezone(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export async function loadSlaSettings(db: Db, agencyId: string): Promise<SlaSettings> {
  const [policyRows, settings, ai] = await Promise.all([
    db.from("inbox_sla_policies").select("queue_code, first_reply_minutes, resolution_minutes, clock, opens_intervention_on_breach").eq("agency_id", agencyId),
    db.from("agency_settings").select("timezone").eq("agency_id", agencyId).maybeSingle(),
    db.from("ai_settings").select("working_hours").eq("agency_id", agencyId).maybeSingle(),
  ]);
  if (policyRows.error) throw new Error(`Could not read the SLA policies: ${policyRows.error.message}`);
  if (settings.error) throw new Error(`Could not read the agency timezone: ${settings.error.message}`);
  if (ai.error) throw new Error(`Could not read the working hours: ${ai.error.message}`);

  const calendar = parseWorkingHours((ai.data as { working_hours?: unknown } | null)?.working_hours);
  const timezone = (settings.data as { timezone?: unknown } | null)?.timezone;
  return {
    policies: mergeSlaPolicies((policyRows.data ?? []) as Parameters<typeof mergeSlaPolicies>[0]),
    calendar,
    hasCalendar: calendar !== null,
    timezone: isKnownTimezone(timezone) ? timezone : DEFAULT_TIMEZONE,
  };
}

/** Saves one queue's policy for the signed-in agency. Validated here as well as at the action, so no caller can skip it. */
export async function saveSlaPolicy(db: Db, agencyId: string, staffId: string, input: SlaPolicyInput): Promise<void> {
  const parsed = slaPolicyInputSchema.parse(input);
  const { error } = await db.from("inbox_sla_policies").upsert(
    {
      agency_id: agencyId,
      queue_code: parsed.queueCode,
      first_reply_minutes: parsed.firstReplyMinutes,
      resolution_minutes: parsed.resolutionMinutes,
      clock: parsed.clock,
      opens_intervention_on_breach: parsed.opensInterventionOnBreach,
      updated_by: staffId,
    },
    { onConflict: "agency_id,queue_code" },
  );
  if (error) throw new Error(`Could not save the reply targets: ${error.message}`);
}
