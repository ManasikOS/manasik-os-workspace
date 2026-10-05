/**
 * What a staff member, and an agency, may do in the Inbox per hour and per day (SEC-6 in
 * docs/progress/2026-10-05-inbox-security-and-bug-audit.md). The numbers here are the defaults every agency gets; platform staff can change them
 * for ONE agency with a row in `inbox_rate_limit_overrides` (see docs/runbooks/inbox-rate-limits.md). Agency admins cannot.
 *
 * The defaults are sized from how the agencies use the Inbox: fewer than 30 brand-new chats a day each, but many more messages in chats that
 * already exist. So starting chats is held tight (a stolen session or a mistake there is what costs money and Meta quality rating) and
 * everything that happens inside an existing chat has a lot more room.
 */

export const INBOX_RATE_LIMITED_ACTIONS = [
  "START_WHATSAPP_CHAT",
  "START_EMAIL_CONVERSATION",
  "SEND_TEMPLATE",
  "SUGGEST_REPLY",
  "TRANSLATE",
  "PREPARE_OFFER",
] as const;

export type InboxRateLimitedAction = (typeof INBOX_RATE_LIMITED_ACTIONS)[number];

export interface InboxRateLimitPolicy {
  /** The most one staff member may do in one hour. */
  perUserHourly: number;
  /** The most a whole agency may do in one Sri Lanka day. */
  perAgencyDaily: number;
  /**
   * What to do when the counter itself cannot be read. Anything that costs money or could hurt the agency's WhatsApp standing is refused, so a
   * broken counter never becomes an open door. A draft or a translation is allowed (and the failure logged), because blocking staff over a
   * broken counter does more harm than a few extra suggestions.
   */
  whenUnavailable: "REFUSE" | "ALLOW";
  /** Words for the message the person sees: "the limit of 15 new WhatsApp chats per hour". */
  noun: string;
}

export const DEFAULT_INBOX_RATE_LIMITS: Record<InboxRateLimitedAction, InboxRateLimitPolicy> = {
  START_WHATSAPP_CHAT: { perUserHourly: 15, perAgencyDaily: 60, whenUnavailable: "REFUSE", noun: "new WhatsApp chats" },
  START_EMAIL_CONVERSATION: { perUserHourly: 20, perAgencyDaily: 100, whenUnavailable: "REFUSE", noun: "new email conversations" },
  SEND_TEMPLATE: { perUserHourly: 60, perAgencyDaily: 400, whenUnavailable: "REFUSE", noun: "template messages" },
  SUGGEST_REPLY: { perUserHourly: 40, perAgencyDaily: 600, whenUnavailable: "ALLOW", noun: "Copilot suggestions" },
  TRANSLATE: { perUserHourly: 60, perAgencyDaily: 600, whenUnavailable: "ALLOW", noun: "translations" },
  PREPARE_OFFER: { perUserHourly: 120, perAgencyDaily: 1000, whenUnavailable: "ALLOW", noun: "offer messages" },
};

/** A row of `inbox_rate_limit_overrides`. A null column keeps the default. */
export interface InboxRateLimitOverride {
  per_user_hourly: number | null;
  per_agency_daily: number | null;
}

export interface ResolvedInboxRateLimits {
  perUserHourly: number;
  perAgencyDaily: number;
}

/** The limits that apply to one agency: its override where it has one, the default otherwise. */
export function resolveInboxRateLimits(action: InboxRateLimitedAction, override: InboxRateLimitOverride | null | undefined): ResolvedInboxRateLimits {
  const defaults = DEFAULT_INBOX_RATE_LIMITS[action];
  return {
    perUserHourly: override?.per_user_hourly ?? defaults.perUserHourly,
    perAgencyDaily: override?.per_agency_daily ?? defaults.perAgencyDaily,
  };
}

/* ── Windows ──────────────────────────────────────────────────────────────── */

const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;
/** Sri Lanka is UTC+5:30 all year (no daylight saving). The agencies' "today" and "this hour" follow it, so a day resets at local midnight. */
const COLOMBO_OFFSET_MS = 5.5 * HOUR_MS;

function windowStart(now: Date, periodMs: number): Date {
  return new Date(Math.floor((now.getTime() + COLOMBO_OFFSET_MS) / periodMs) * periodMs - COLOMBO_OFFSET_MS);
}

export const hourWindowStart = (now: Date): Date => windowStart(now, HOUR_MS);
export const dayWindowStart = (now: Date): Date => windowStart(now, DAY_MS);

/* ── Words ────────────────────────────────────────────────────────────────── */

function colomboClock(at: Date): string {
  return new Intl.DateTimeFormat("en-GB", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Colombo" }).format(at);
}

/** What the person sees when the limit stops them. Plain words: what the limit is, and when they can go on. */
export function rateLimitRefusalMessage(input: { action: InboxRateLimitedAction; blockedBy: "USER" | "AGENCY"; limit: number; now: Date }): string {
  const { noun } = DEFAULT_INBOX_RATE_LIMITS[input.action];
  const capitalised = noun.charAt(0).toUpperCase() + noun.slice(1);
  if (input.limit === 0) {
    return `${capitalised} are switched off for your agency. If that is not expected, ask the platform team.`;
  }
  if (input.blockedBy === "USER") {
    const resetsAt = new Date(hourWindowStart(input.now).getTime() + HOUR_MS);
    return `You have reached the limit of ${input.limit} ${noun} per hour. You can try again after ${colomboClock(resetsAt)}.`;
  }
  return `Your agency has reached today's limit of ${input.limit} ${noun}. It starts again at midnight (Sri Lanka time). If you need more today, ask the platform team to raise it.`;
}

export const RATE_LIMIT_UNAVAILABLE_MESSAGE = "Could not check the usage limit just now, so nothing was done. Try again in a moment.";
