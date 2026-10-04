/**
 * The single place every business rule for "may we nudge this quiet customer now?" lives (§6.1 of
 * docs/modules/lead-retention-followups-implementation-plan.md). Pure and import-light so it is heavily
 * unit-tested; the sweep only loads facts, calls this, and acts on the answer.
 *
 * Meta policy is enforced here, in one place: on Messenger and Instagram nothing is ever sent once the
 * 24-hour window is (nearly) closed; on WhatsApp outside the window only an approved template may be sent.
 */

import { checkConsent, type ConsentFacts } from "@/lib/ai/trust/consent-gate";
import { CLOSED_STAGES, type LeadStage } from "@/lib/types/leads";

/** Stop treating the window as open this long before it really closes, so a send never races the deadline. */
export const WINDOW_SAFETY_MARGIN_MS = 60 * 60_000;
/** Never two nudges to one customer closer together than this. */
export const MIN_GAP_BETWEEN_NUDGES_MS = 2 * 60 * 60_000;

/** Channels the sweep knows how to nudge on. Anything else (email, web chat) is left alone. */
const NUDGE_CHANNELS = new Set(["WHATSAPP", "MESSENGER", "INSTAGRAM"]);
const ASSISTANT_STATES = new Set(["AI_ACTIVE", "AI_RESUMED"]);

export interface QuietLeadInput {
  now: Date;
  settings: {
    /** ai_settings.enabled && followups_enabled. */
    enabled: boolean;
    dryRun: boolean;
    delaysHours: number[];
    /** A WhatsApp template is configured AND still approved. */
    hasApprovedTemplate: boolean;
  };
  /** channel_connections is CONNECTED and its ai_enabled is on. */
  connectionReady: boolean;
  /** Whether the agency's working hours allow sending now; true when no hours are set. */
  withinWorkingHours: boolean;
  conversation: {
    channel: string;
    state: string;
    aiEnabled: boolean;
    lastInboundAt: string | null;
    lastOutboundAt: string | null;
    serviceWindowExpiresAt: string | null;
  };
  lead: { stage: LeadStage; postponedUntil: string | null } | null;
  consent: ConsentFacts;
  /** Ledger state for the customer message the timing is measured from. */
  ledger: {
    /** QUIET_NUDGE rows already recorded for this anchor (any status). */
    nudgesRecorded: number;
    /** Newest SENT or DRY_RUN nudge for this conversation, whatever the anchor. */
    lastNudgeAt: string | null;
    /** A FAILED or SKIPPED row exists for this anchor — the sequence stops there (D8, D6). */
    stopped: boolean;
  };
}

export type QuietLeadWaitReason =
  | "DISABLED"
  | "CONNECTION_NOT_READY"
  | "UNSUPPORTED_CHANNEL"
  | "STAFF_OWNS"
  | "CUSTOMER_SPOKE_LAST"
  | "NO_LEAD"
  | "LEAD_CLOSED"
  | "LEAD_POSTPONED"
  | "SEQUENCE_STOPPED"
  | "SEQUENCE_DONE"
  | "NOT_DUE_YET"
  | "TOO_SOON_AFTER_LAST_NUDGE"
  | "OUTSIDE_WORKING_HOURS";

export type QuietLeadSkipReason = "WINDOW_CLOSED" | "NO_TEMPLATE" | "CONSENT";

export type QuietLeadDecision =
  | { action: "WAIT"; reason: QuietLeadWaitReason }
  /** Recorded in the ledger as SKIPPED, which also stops the sequence for this customer message. */
  | { action: "SKIP"; reason: QuietLeadSkipReason }
  | { action: "SEND"; sequence: number; mode: "TEXT" | "TEMPLATE"; dryRun: boolean };

function wait(reason: QuietLeadWaitReason): QuietLeadDecision {
  return { action: "WAIT", reason };
}

/** Consent for a nudge: a free-text nudge inside the window continues the customer's own conversation, so only an explicit opt-out / do-not-contact blocks it; a WhatsApp template needs channel consent as well. */
function consentAllows(mode: "TEXT" | "TEMPLATE", facts: ConsentFacts): boolean {
  if (mode === "TEMPLATE") return checkConsent(facts, "WHATSAPP", true).allowed;
  return !facts.doNotContact && facts.consentStatus !== "OPTED_OUT";
}

export function decideQuietLeadNudge(input: QuietLeadInput): QuietLeadDecision {
  const { now, settings, conversation, lead, ledger } = input;

  if (!settings.enabled) return wait("DISABLED");
  if (!input.connectionReady) return wait("CONNECTION_NOT_READY");
  if (!NUDGE_CHANNELS.has(conversation.channel)) return wait("UNSUPPORTED_CHANNEL");
  if (!conversation.aiEnabled || !ASSISTANT_STATES.has(conversation.state)) return wait("STAFF_OWNS");

  if (!conversation.lastInboundAt) return wait("CUSTOMER_SPOKE_LAST");
  const lastInbound = new Date(conversation.lastInboundAt).getTime();
  const lastOutbound = conversation.lastOutboundAt ? new Date(conversation.lastOutboundAt).getTime() : Number.NEGATIVE_INFINITY;
  if (!(lastOutbound > lastInbound)) return wait("CUSTOMER_SPOKE_LAST"); // they wrote last — they are waiting on us, not the other way round

  if (!lead) return wait("NO_LEAD");
  if ((CLOSED_STAGES as readonly string[]).includes(lead.stage)) return wait("LEAD_CLOSED");
  if (lead.postponedUntil && new Date(lead.postponedUntil).getTime() > now.getTime()) return wait("LEAD_POSTPONED");

  if (ledger.stopped) return wait("SEQUENCE_STOPPED");
  const sequence = ledger.nudgesRecorded + 1;
  if (sequence > settings.delaysHours.length) return wait("SEQUENCE_DONE");

  // Timing is measured from the customer's last message, never from our own (D3).
  const silentMs = now.getTime() - lastInbound;
  if (silentMs < settings.delaysHours[sequence - 1] * 3_600_000) return wait("NOT_DUE_YET");

  if (ledger.lastNudgeAt && now.getTime() - new Date(ledger.lastNudgeAt).getTime() < MIN_GAP_BETWEEN_NUDGES_MS) {
    return wait("TOO_SOON_AFTER_LAST_NUDGE");
  }
  if (!input.withinWorkingHours) return wait("OUTSIDE_WORKING_HOURS");

  // The window rule (D6). An unknown expiry is treated as closed — the safe reading.
  const expiresAt = conversation.serviceWindowExpiresAt ? new Date(conversation.serviceWindowExpiresAt).getTime() : null;
  const windowOpen = expiresAt !== null && expiresAt - now.getTime() > WINDOW_SAFETY_MARGIN_MS;

  let mode: "TEXT" | "TEMPLATE";
  if (windowOpen) {
    mode = "TEXT";
  } else if (conversation.channel === "WHATSAPP") {
    if (!settings.hasApprovedTemplate) return { action: "SKIP", reason: "NO_TEMPLATE" };
    mode = "TEMPLATE";
  } else {
    return { action: "SKIP", reason: "WINDOW_CLOSED" }; // Messenger / Instagram: Meta forbids it, no template exists
  }

  if (!consentAllows(mode, input.consent)) return { action: "SKIP", reason: "CONSENT" };

  return { action: "SEND", sequence, mode, dryRun: settings.dryRun };
}

/** The customer's first name for `{name}`, or "there" when none is known. */
export function firstNameForNudge(contactName: string | null | undefined): string {
  const first = (contactName ?? "").trim().split(/\s+/)[0] ?? "";
  // A phone-number placeholder (e.g. "+9477…") or a lone symbol is not a name.
  return /\p{L}/u.test(first) ? first : "there";
}

/** Fills `{name}` in the agency's nudge text. */
export function renderNudgeText(template: string, contactName: string | null | undefined): string {
  return template.replace(/\{name\}/gi, firstNameForNudge(contactName)).trim();
}
