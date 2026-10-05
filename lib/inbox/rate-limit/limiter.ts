import "server-only";

import type { Db } from "@/lib/ai/db";

import {
  DEFAULT_INBOX_RATE_LIMITS,
  dayWindowStart,
  hourWindowStart,
  RATE_LIMIT_UNAVAILABLE_MESSAGE,
  rateLimitRefusalMessage,
  resolveInboxRateLimits,
  type InboxRateLimitedAction,
  type InboxRateLimitOverride,
} from "./policy";

/**
 * Counts one use of an Inbox action against the person's hour and the agency's day, in one atomic database step (`consume_inbox_rate_limit`).
 * Both must have room. The caller must use the service-role client: the counters are server-only.
 *
 * `giveBack` returns the use when the action turned out not to happen (Meta refused the send). It is safe to call once; it never goes below zero.
 */
export type InboxRateLimitResult = { ok: true; giveBack: () => Promise<void> } | { ok: false; error: string };

const nothingToGiveBack = async (): Promise<void> => undefined;

export async function consumeInboxRateLimit(
  admin: Db,
  input: { agencyId: string; userId: string; action: InboxRateLimitedAction; now?: Date },
): Promise<InboxRateLimitResult> {
  const now = input.now ?? new Date();
  const policy = DEFAULT_INBOX_RATE_LIMITS[input.action];
  const unavailable = (): InboxRateLimitResult => (policy.whenUnavailable === "ALLOW" ? { ok: true, giveBack: nothingToGiveBack } : { ok: false, error: RATE_LIMIT_UNAVAILABLE_MESSAGE });

  // The platform's override for this agency, if it has one. If it cannot be read the defaults apply: they are the stricter safe choice for a
  // new agency, and refusing everything over a missing override would be worse.
  let override: InboxRateLimitOverride | null = null;
  const { data: overrideRow, error: overrideError } = await admin
    .from("inbox_rate_limit_overrides")
    .select("per_user_hourly, per_agency_daily")
    .eq("agency_id", input.agencyId)
    .eq("action", input.action)
    .maybeSingle();
  if (overrideError) console.error(`Could not read the ${input.action} limit override; using the defaults:`, overrideError.message);
  else override = (overrideRow as InboxRateLimitOverride | null) ?? null;

  const limits = resolveInboxRateLimits(input.action, override);
  const hourStart = hourWindowStart(now).toISOString();
  const dayStart = dayWindowStart(now).toISOString();

  const { data, error } = await admin.rpc("consume_inbox_rate_limit", {
    p_agency_id: input.agencyId,
    p_user_id: input.userId,
    p_action: input.action,
    p_user_limit: limits.perUserHourly,
    p_agency_limit: limits.perAgencyDaily,
    p_hour_start: hourStart,
    p_day_start: dayStart,
  });
  const verdict = data as { allowed?: boolean; blocked_by?: "USER" | "AGENCY" | null } | null;
  if (error || !verdict || typeof verdict.allowed !== "boolean") {
    console.error(`Could not check the ${input.action} limit:`, error?.message ?? "unexpected answer");
    return unavailable();
  }

  if (!verdict.allowed) {
    const blockedBy = verdict.blocked_by === "USER" ? "USER" : "AGENCY";
    return { ok: false, error: rateLimitRefusalMessage({ action: input.action, blockedBy, limit: blockedBy === "USER" ? limits.perUserHourly : limits.perAgencyDaily, now }) };
  }

  let givenBack = false;
  return {
    ok: true,
    giveBack: async () => {
      if (givenBack) return;
      givenBack = true;
      const { error: refundError } = await admin.rpc("refund_inbox_rate_limit", {
        p_agency_id: input.agencyId,
        p_user_id: input.userId,
        p_action: input.action,
        p_hour_start: hourStart,
        p_day_start: dayStart,
      });
      if (refundError) console.error(`Could not give back a ${input.action} use:`, refundError.message);
    },
  };
}
