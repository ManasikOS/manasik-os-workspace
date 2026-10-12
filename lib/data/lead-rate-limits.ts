/**
 * Limits on the Leads actions that cost money, move data in bulk, or answer "does this person exist?".
 *
 * None of these had any throttle: the AI actions each make a paid model call, the duplicate check returns another lead's name, number and owner for
 * any mobile or e-mail typed, and the import writes up to 500 rows. A stolen session, or a loop in a script, could run any of them as fast as the
 * server would answer.
 *
 * The numbers are per signed-in user per window, with an optional ceiling per agency per day for the actions that bill. They are generous for a
 * person working normally — the duplicate check fires as someone types a number — and stop automation. The counter lives in the database
 * (`consume_staff_rate_limit`) so it holds across every server instance.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Db = SupabaseClient<any, any, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

export type LeadRateLimitedAction =
  | "lead.import"
  | "lead.duplicate_check"
  | "copilot.analyse_enquiry"
  | "copilot.ask"
  | "copilot.draft_reply";

interface LeadRateLimitPolicy {
  userLimit: number;
  windowSeconds: number;
  /** Daily ceiling for the whole agency; only for actions that are billed. */
  agencyDailyLimit: number | null;
  /** What to do when the limiter itself cannot be reached: a sales team should not lose the duplicate check over a counter outage, but spend must not run unmetered. */
  whenUnavailable: "ALLOW" | "DENY";
}

export const LEAD_RATE_LIMITS: Record<LeadRateLimitedAction, LeadRateLimitPolicy> = {
  "lead.import": { userLimit: 10, windowSeconds: 3600, agencyDailyLimit: null, whenUnavailable: "ALLOW" },
  "lead.duplicate_check": { userLimit: 300, windowSeconds: 3600, agencyDailyLimit: null, whenUnavailable: "ALLOW" },
  "copilot.analyse_enquiry": { userLimit: 30, windowSeconds: 3600, agencyDailyLimit: 500, whenUnavailable: "DENY" },
  "copilot.ask": { userLimit: 60, windowSeconds: 3600, agencyDailyLimit: 1000, whenUnavailable: "DENY" },
  "copilot.draft_reply": { userLimit: 60, windowSeconds: 3600, agencyDailyLimit: 1000, whenUnavailable: "DENY" },
};

const LABEL: Record<LeadRateLimitedAction, string> = {
  "lead.import": "imports",
  "lead.duplicate_check": "duplicate checks",
  "copilot.analyse_enquiry": "enquiry analyses",
  "copilot.ask": "questions to Manasik",
  "copilot.draft_reply": "reply drafts",
};

export const LEAD_RATE_LIMIT_UNAVAILABLE = "This is temporarily unavailable. Try again in a few minutes.";

export function leadRateLimitMessage(action: LeadRateLimitedAction, blockedBy: "USER" | "AGENCY", retryAfterSeconds: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  const wait = minutes >= 120 ? `in about ${Math.ceil(minutes / 60)} hours` : `in about ${minutes} minute${minutes === 1 ? "" : "s"}`;
  return blockedBy === "USER"
    ? `You have used the hourly allowance of ${LABEL[action]}. Try again ${wait}.`
    : `Your agency has used today's allowance of ${LABEL[action]}. It resets ${wait}.`;
}

export type LeadRateLimitVerdict = { ok: true } | { ok: false; error: string };

/** Counts one use. Call it before the expensive work, with the signed-in user's own client (the function reads `auth.uid()`). */
export async function consumeLeadRateLimit(db: Db, action: LeadRateLimitedAction): Promise<LeadRateLimitVerdict> {
  const policy = LEAD_RATE_LIMITS[action];
  const unavailable = (): LeadRateLimitVerdict =>
    policy.whenUnavailable === "ALLOW" ? { ok: true } : { ok: false, error: LEAD_RATE_LIMIT_UNAVAILABLE };

  let data: unknown = null;
  let error: { message: string } | null = null;
  try {
    ({ data, error } = await db.rpc("consume_staff_rate_limit", {
      p_action: action,
      p_user_limit: policy.userLimit,
      p_window_seconds: policy.windowSeconds,
      p_agency_limit: policy.agencyDailyLimit,
    }));
  } catch (cause) {
    error = { message: cause instanceof Error ? cause.message : "limiter unreachable" };
  }

  const verdict = data as { allowed?: boolean; blocked_by?: "USER" | "AGENCY" | null; retry_after_seconds?: number } | null;
  if (error || !verdict || typeof verdict.allowed !== "boolean") {
    console.error(`[leads] could not check the ${action} limit:`, error?.message ?? "unexpected answer");
    return unavailable();
  }
  if (verdict.allowed) return { ok: true };

  return {
    ok: false,
    error: leadRateLimitMessage(action, verdict.blocked_by === "AGENCY" ? "AGENCY" : "USER", verdict.retry_after_seconds ?? 3600),
  };
}
