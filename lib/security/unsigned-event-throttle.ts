import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A webhook request with a bad or missing signature is refused with 401, and a small "rejected" stub is stored so staff can see in the database
 * that Meta IS calling and signing with the wrong secret (docs/runbooks/whatsapp-connection-verification-runbook.md and
 * messenger-meta-setup-and-test.md both tell people to look for these rows). But anyone on the internet can send such a request, so without a
 * limit a flood costs one database write per request and grows the table (SEC-7 in docs/progress/2026-10-05-inbox-security-and-bug-audit.md).
 *
 * This caps the stubs: at most `UNSIGNED_EVENT_STUBS_PER_MINUTE` are stored in any clock minute, counted in the database so every server
 * instance shares one budget. Once a minute's budget is spent, the instance remembers that and stops asking until the next minute, so a flood
 * costs one cheap count per instance per minute instead of a write per request. The 401 itself is never throttled, and every refused request
 * still shows up in the platform's request logs.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Db = SupabaseClient<any, any, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

export const UNSIGNED_EVENT_STUBS_PER_MINUTE = 30;
const MINUTE_MS = 60_000;

export type UnsignedEventTable = "whatsapp_webhook_events" | "channel_webhook_events";

interface MinuteState {
  minute: number;
  /** The database already holds a full minute's worth of stubs, so there is no need to ask again this minute. */
  spent: boolean;
  /** The "stopped storing" warning has been logged this minute. */
  warned: boolean;
}

const states = new Map<UnsignedEventTable, MinuteState>();

/** For tests: forget what this instance has seen. */
export function resetUnsignedEventThrottle(): void {
  states.clear();
}

/**
 * Whether one more stub may be stored now. If the count cannot be read the answer is no: the stub is a diagnostic, and a database that is
 * struggling should not be asked for an extra write by unauthenticated traffic.
 */
export async function mayRecordUnsignedEvent(db: Db, table: UnsignedEventTable, nowMs: number = Date.now()): Promise<boolean> {
  const minute = Math.floor(nowMs / MINUTE_MS);
  let state = states.get(table);
  if (!state || state.minute !== minute) {
    state = { minute, spent: false, warned: false };
    states.set(table, state);
  }
  if (state.spent) return false;

  const minuteStart = new Date(minute * MINUTE_MS).toISOString();
  const { count, error } = await db
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("signature_valid", false)
    .gte("received_at", minuteStart);
  if (error || count === null) {
    console.error(`Unsigned webhook throttle could not count recent rejected requests in ${table}:`, error?.message ?? "no count returned");
    return false;
  }

  if (count >= UNSIGNED_EVENT_STUBS_PER_MINUTE) {
    state.spent = true;
    if (!state.warned) {
      state.warned = true;
      console.warn(`Webhook requests with a bad signature: ${UNSIGNED_EVENT_STUBS_PER_MINUTE} are already stored in ${table} this minute, so the rest are refused without being stored.`);
    }
    return false;
  }
  return true;
}
