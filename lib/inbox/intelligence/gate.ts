/**
 * S0 — the gate. MI2.3 of docs/inbox/implementation-plan.md, Architecture §6 S0.
 *
 * Decides, for one inbound message, (a) whether it deserves enrichment (S1 onward — the model calls) and (b) whether
 * the rule-only risk scan must run regardless. Pure: no I/O, no clock (the caller passes `now`), no model. It is the
 * single biggest lever on AI cost — the target is that 55–70 % of inbound messages exit here — so every rule is a
 * plain, tested predicate and every skip returns exactly one reason for the KPI view `inbox_gate_skip_reasons`.
 *
 * THE RULE THAT MUST NEVER BE RELAXED: risk is never gated on cost. A refund request, distress language or a
 * bank-detail mismatch sets `escalateToRisk` even when every skip rule holds — a switched-off surface, an exhausted
 * plan, a closed or spam conversation, an active human, an unchanged fingerprint or a one-word acknowledgement.
 * Detecting these costs nothing (rules only), and a missed complaint costs an agency a customer. The test that pins
 * this in `gate.test.ts` must never be deleted.
 */

import type { ConversationHandlingMode } from "@/lib/inbox/contracts";
import type { GateReason, GateRedFlag, IntelligenceState } from "@/lib/inbox/intelligence/contracts";

export type GateMessageType = "TEXT" | "AUDIO" | "IMAGE" | "DOCUMENT" | "TEMPLATE" | "INTERACTIVE" | "SYSTEM" | "STICKER";

export interface GateInput {
  message: { text: string; type: GateMessageType };
  conversation: {
    lifecycleStatus: "OPEN" | "CLOSED" | "SPAM";
    handlingMode: ConversationHandlingMode | null;
    /** We asked the customer a question and are waiting for the answer: a bare "ok" or "sure" IS the answer, not an acknowledgement. */
    awaitingCustomerAnswer: boolean;
  };
  staff: { lastActiveAt: Date | null };
  /** The stored projection, or null when the conversation has never been evaluated. */
  previous: { fingerprint: string; state: IntelligenceState; pipelineVersion: number } | null;
  current: { fingerprint: string; pipelineVersion: number };
  /** `ai_surface_settings` for the Inbox surface. A disabled surface is off whatever its mode says. */
  surface: { enabled: boolean; mode: "OFF" | "SHADOW" | "PROPOSE" | "ACTIVE" };
  /** True once the plan's allowance is used up and the agency has not opted into overage (Architecture §8.6). */
  entitlementExhausted: boolean;
  /** Digits of the agency's approved bank accounts. Empty or absent means every account number in a message is unverified. */
  approvedAccountNumbers?: readonly string[];
  now: Date;
  config?: { humanActiveWindowMs?: number; acknowledgementMaxTokens?: number };
}

export interface GateDecision {
  /** Run S1 onward (the intelligence pipeline). */
  enrich: boolean;
  reason: GateReason;
  /** Run the rule-only S4 risk scan whatever `enrich` says. */
  escalateToRisk: boolean;
  /** Which red flags fired, for the risk scan to start from and for the log. */
  redFlags: GateRedFlag[];
}

/** A staff member active this recently already has the conversation's context (Architecture §6 S0). */
export const HUMAN_ACTIVE_WINDOW_MS = 2 * 60 * 1000;
export const ACKNOWLEDGEMENT_MAX_TOKENS = 4;

/* ── Text normalisation ───────────────────────────────────────────────────── */

const EMOJI_PATTERN = /[\p{Extended_Pictographic}\p{Emoji_Modifier}‍️⃣]/gu;

/** Emoji that carry a feeling the sentiment stage needs: never treated as a throwaway acknowledgement. */
const NEGATIVE_EMOJI = /[😡😠🤬😤😢😭😞😔😟😨😱🆘🚨⚠❗‼]/u;

function normalise(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

function wordsOf(text: string): string[] {
  return normalise(text)
    .replace(EMOJI_PATTERN, " ")
    // Keep combining marks (\p{M}): Sinhala and Tamil vowel signs are marks, and stripping them shatters every word.
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/* ── Acknowledgements ─────────────────────────────────────────────────────── */

/**
 * Words that only acknowledge. "yes", "no" and numbers are deliberately absent: they answer a question, which is
 * information. English, Sinhala (ස්තූතියි, හරි) and Tamil (நன்றி, சரி).
 */
const ACKNOWLEDGEMENT_WORDS: ReadonlySet<string> = new Set([
  "ok", "okay", "okey", "k", "kk", "okk", "thanks", "thank", "thx", "ty", "tysm", "thankyou", "noted", "got", "it", "sure",
  "fine", "alright", "cool", "great", "good", "nice", "perfect", "done", "received", "welcome", "you", "very", "much", "so",
  "a", "lot", "again", "anyway", "then", "will", "do", "wow", "amen", "mashallah", "alhamdulillah", "jazakallah", "jazakallahu", "khair",
  "ස්තූතියි", "ස්තුතියි", "හරි", "හොඳයි", "ok",
  "நன்றி", "சரி", "நல்லது",
]);

/** Filler that is only an acknowledgement next to a real one ("ok thanks"). Alone or together ("will do") they are not: that stays enriched, the cautious side. */
const AMBIGUOUS_ALONE: ReadonlySet<string> = new Set(["do", "then", "will", "it", "so", "a", "lot", "again", "anyway", "very", "much", "you"]);

/**
 * A pure acknowledgement: emoji or punctuation only, or up to a few words that all acknowledge. A message that
 * carries an attachment, an angry/distressed emoji, or that answers a question we asked is never one.
 */
export function isAcknowledgementOnly(input: Pick<GateInput, "message"> & { awaitingCustomerAnswer: boolean; maxTokens?: number }): boolean {
  const { message, awaitingCustomerAnswer } = input;
  if (message.type === "STICKER") return !awaitingCustomerAnswer;
  if (message.type !== "TEXT") return false;
  if (awaitingCustomerAnswer) return false;

  const raw = message.text.trim();
  if (raw.length === 0) return false;
  if (NEGATIVE_EMOJI.test(raw)) return false;

  const words = wordsOf(raw);
  if (words.length === 0) return true; // emoji and/or punctuation only
  if (words.length > (input.maxTokens ?? ACKNOWLEDGEMENT_MAX_TOKENS)) return false;
  if (!words.every((word) => ACKNOWLEDGEMENT_WORDS.has(word))) return false;
  // A run of only filler ("will", "do", "it") is not thanks or agreement.
  return words.some((word) => !AMBIGUOUS_ALONE.has(word));
}

/* ── Red flags: rule-level, free, never gated on cost ─────────────────────── */

const REFUND_PATTERNS: readonly RegExp[] = [
  /\brefund(s|ed|ing)?\b/u,
  /\bmoney back\b/u,
  /\bchargeback\b/u,
  /\b(return|give back|send back) (my|the|our) (money|payment|deposit|advance)\b/u,
  /\b(want|need|demand) (my|the|our) (money|payment|deposit|advance) back\b/u,
  /මුදල් ආපසු|මුදල ආපසු|ආපසු මුදල|රිෆන්ඩ්|මුදල් නැවත/u,
  /பணத்தை? (த்)?திருப்பி|பணம் திரும்ப|ரீஃபண்ட்|ரிஃபண்ட்|பணத்தைத் திருப்பி/u,
];

/**
 * Deliberately narrow: "help me choose a package" is an enquiry, "help me, I am stranded" is distress. A word that is
 * equally common in ordinary requests (help, urgent, please) is NOT here; urgency is triage's job, not the gate's.
 */
const DISTRESS_PATTERNS: readonly RegExp[] = [
  /\bemergency\b/u,
  /\bstranded\b/u,
  /\bambulance\b/u,
  /\bhospital(ised|ized)?\b/u,
  /\b(lost|stolen|missing) (my |our |the )?passports?\b/u,
  /\bpassports? (is |was |got )?(lost|stolen|missing)\b/u,
  /\b(i am|i'm|we are|we're|im) (very |so )?(scared|afraid|terrified)\b/u,
  /\b(nobody|no one) (is |are )?(answering|responding|helping|replying|picking)\b/u,
  /\b(cheated|scammed|defrauded|conned)\b/u,
  /හදිසි|රෝහල|ඇඹුලන්ස්|වංචා/u,
  /அவசர நிலை|மருத்துவமனை|ஆம்புலன்ஸ்|ஏமாற்று|பயமாக/u,
];

const BANK_CONTEXT = /\b(bank|account|a\/c|acc|acct|iban|swift|ifsc|sort code|routing)\b|ගිණුම|வங்கி|கணக்கு/u;

/** Digit runs of 6–20 digits, allowing single spaces or hyphens between groups ("1234 5678 90"). */
function accountLikeNumbers(text: string): string[] {
  const runs = text.match(/\d(?:[\s-]?\d){5,19}/g) ?? [];
  return runs.map((run) => run.replace(/\D/g, "")).filter((digits) => digits.length >= 6 && digits.length <= 20);
}

/**
 * A bank-account-like number next to a bank word that is not one of the agency's approved accounts. The approved list
 * arrives with MI4.1; until then every such number is flagged, which costs a free rule run, not a model call.
 */
export function mentionsUnapprovedBankDetails(text: string, approved: readonly string[] = []): boolean {
  const normalised = normalise(text);
  if (!BANK_CONTEXT.test(normalised)) return false;
  const known = new Set(approved.map((account) => account.replace(/\D/g, "")).filter(Boolean));
  return accountLikeNumbers(normalised).some((digits) => !known.has(digits));
}

export function detectRedFlags(text: string, approvedAccountNumbers: readonly string[] = []): GateRedFlag[] {
  const normalised = normalise(text);
  const flags: GateRedFlag[] = [];
  if (REFUND_PATTERNS.some((pattern) => pattern.test(normalised))) flags.push("REFUND_REQUEST");
  if (DISTRESS_PATTERNS.some((pattern) => pattern.test(normalised))) flags.push("DISTRESS_LANGUAGE");
  if (mentionsUnapprovedBankDetails(text, approvedAccountNumbers)) flags.push("BANK_DETAIL_MISMATCH");
  return flags;
}

/* ── The gate ─────────────────────────────────────────────────────────────── */

/** First skip rule that holds, in the order the KPI view reports them; null when the message should be enriched. */
function firstSkipReason(input: GateInput): Extract<GateReason, `SKIP_${string}`> | null {
  const { surface, conversation, previous, current } = input;
  if (!surface.enabled || surface.mode === "OFF") return "SKIP_SURFACE_OFF";
  if (input.entitlementExhausted) return "SKIP_ENTITLEMENT_EXHAUSTED";
  if (conversation.lifecycleStatus === "SPAM") return "SKIP_SPAM";
  if (conversation.lifecycleStatus === "CLOSED") return "SKIP_CLOSED";

  const windowMs = input.config?.humanActiveWindowMs ?? HUMAN_ACTIVE_WINDOW_MS;
  const staffActiveAt = input.staff.lastActiveAt?.getTime();
  if (
    conversation.handlingMode === "HUMAN_ACTIVE" &&
    staffActiveAt !== undefined &&
    input.now.getTime() - staffActiveAt <= windowMs &&
    input.now.getTime() >= staffActiveAt
  ) {
    return "SKIP_HUMAN_ACTIVE";
  }

  // Only a FRESH row under the same pipeline version counts as "already computed"; a FAILED or STALE one must retry.
  if (previous && previous.state === "FRESH" && previous.fingerprint === current.fingerprint && previous.pipelineVersion === current.pipelineVersion) {
    return "SKIP_UNCHANGED_INPUT";
  }

  if (
    isAcknowledgementOnly({
      message: input.message,
      awaitingCustomerAnswer: conversation.awaitingCustomerAnswer,
      maxTokens: input.config?.acknowledgementMaxTokens,
    })
  ) {
    return "SKIP_ACKNOWLEDGEMENT";
  }
  return null;
}

/** The gate. Pure and total: it always returns a decision, and a skip always carries a reason. */
export function shouldEnrich(input: GateInput): GateDecision {
  // Risk first, independent of every skip rule below.
  const redFlags = detectRedFlags(input.message.text, input.approvedAccountNumbers ?? []);
  const escalateToRisk = redFlags.length > 0;

  const skip = firstSkipReason(input);
  if (skip) return { enrich: false, reason: skip, escalateToRisk, redFlags };

  return {
    enrich: true,
    reason: input.previous ? "ENRICH_NEW_MESSAGE" : "ENRICH_NEW_CONVERSATION",
    escalateToRisk,
    redFlags,
  };
}
