/**
 * The intelligence pipeline orchestrator — MI2.4 of docs/inbox/implementation-plan.md (Architecture §6).
 * It runs S0 (the gate) → S1 (triage) → S2 (travel intent) → S3 (offer matching) → commercial stage; later slices add stages behind these.
 *
 * One `ENRICH` job = one run of `runEnrichment` for one conversation:
 *   1. load the conversation, its recent messages, its stored projection and the surface setting;
 *   2. ask the S0 gate (`shouldEnrich`) — the decision and its reason are ALWAYS logged (the S0 skip-rate KPI);
 *   3. red flags (refund, distress, unapproved bank number) are recorded as rule signals WHATEVER the gate decided —
 *      risk is never gated on cost;
 *   4. if the gate says skip, stop: no model call, and the stored projection is left as it was;
 *   5. otherwise update the rolling digest, run S1 triage (one model call, rule fallback), then S2 (travel intent) and S3
 *      (live offer matching, no model), and write the projection once.
 *
 * The surface is `INBOX_TRIAGE`. An agency with no `ai_surface_settings` row for it is OFF, not permissive: this
 * surface costs money, so a missing row must not mean "run".
 *
 * The handler is idempotent (the job runner requires it): a replay with the same input finds the same fingerprint and
 * `upsertIntelligence` writes nothing; signals are de-duplicated per (code, message).
 */

import "server-only";

import { createHash } from "node:crypto";

import { z } from "zod";

import type { Db } from "@/lib/ai/db";
import { readTravelIntent } from "@/lib/ai/surfaces/inbox/travel-intent";
import { loadCommercialRecords } from "@/lib/data/inbox-commercial-repository";
import { matchOffersForConversation } from "@/lib/data/inbox-offer-repository";
import { assignConversationOwner } from "@/lib/data/inbox-routing-repository";
import { loadApprovedAccounts, openInterventionsForSignals, runRiskForConversation } from "@/lib/data/inbox-risk-repository";
import { triageConversation } from "@/lib/ai/surfaces/inbox/triage";
import {
  loadIntelligence,
  recordSignals,
  upsertIntelligence,
  type RecordSignalInput,
} from "@/lib/data/conversation-intelligence-repository";
import type { ConversationHandlingMode } from "@/lib/inbox/contracts";
import { COMMERCIAL_INTENT_CODES, travelIntentSchema, type ConversationIntelligence, type GateReason, type IntentCode } from "@/lib/inbox/intelligence/contracts";
import { buildDigest, updateDigest, type DigestTurn } from "@/lib/inbox/intelligence/digest";
import { deriveCommercialState } from "@/lib/inbox/intelligence/commercial-stage";
import { hasOfferInputs } from "@/lib/inbox/intelligence/offer";
import { shouldEnrich, type GateMessageType } from "@/lib/inbox/intelligence/gate";
import { recordGateDecision } from "@/lib/inbox/intelligence/gate-log";
import type { LaneJobHandler } from "@/lib/inbox/jobs/drain";
import { resolveAiDegradation, resolveEntitlements } from "@/lib/billing/entitlements";
import { resolveInboxFeatureAvailability } from "@/lib/inbox/feature-availability";
import { meterAiConversation, utcMonthStart } from "@/lib/billing/meter";

/** Bump when the triage prompt or the mapping changes: every stored projection is then recomputed on its next message. */
export const PIPELINE_VERSION = 1;
const RECENT_MESSAGE_LIMIT = 20;
const INBOX_TRIAGE_SURFACE_NAME = "INBOX_TRIAGE";
const INBOX_INTENT_SURFACE_NAME = "INBOX_INTENT";
const INBOX_RISK_SURFACE_NAME = "INBOX_RISK";
const INBOX_RISK_MODEL_SURFACE_NAME = "INBOX_RISK_MODEL";

export interface PipelineMessage {
  id: string;
  actor: "CUSTOMER" | "AI" | "STAFF" | "SYSTEM";
  text: string;
  type: GateMessageType;
  createdAt: string;
  /** A file name the customer sent, when the channel gave one (read by the sensitive-document detector). */
  attachmentName?: string | null;
}

export interface EnrichmentContext {
  conversation: {
    lifecycleStatus: "OPEN" | "CLOSED" | "SPAM";
    handlingMode: ConversationHandlingMode | null;
    /** Who owns it now. Absent (older callers and tests) is treated as "do not route". */
    assignedToId?: string | null;
  };
  /** Oldest first. */
  messages: PipelineMessage[];
  previous: ConversationIntelligence | null;
  /** null = the agency has no row for the surface, which means OFF. */
  surface: { enabled: boolean; mode: "OFF" | "SHADOW" | "PROPOSE" | "ACTIVE" } | null;
  /** The S2 travel-intent surface (`INBOX_INTENT`). null = no row = OFF, exactly like `surface`. */
  intentSurface: { enabled: boolean; mode: "OFF" | "SHADOW" | "PROPOSE" | "ACTIVE" } | null;
  /** The S4 detectors' surface (`INBOX_RISK`). null = no row = OFF. SHADOW records signals staff do not see. */
  riskSurface?: { enabled: boolean; mode: "OFF" | "SHADOW" | "PROPOSE" | "ACTIVE" } | null;
  /** The model half of the risk flags (`INBOX_RISK_MODEL`). null/absent = OFF: the lexicon alone decides, and no model call is made. */
  riskModelSurface?: { enabled: boolean; mode: "OFF" | "SHADOW" | "PROPOSE" | "ACTIVE" } | null;
  /** Digits of the agency's approved bank accounts. Empty means every account number in a message is unverified. */
  approvedAccounts?: string[];
}

export interface EnrichmentDeps {
  loadContext: (db: Db, agencyId: string, conversationId: string) => Promise<EnrichmentContext | null>;
  triage: typeof triageConversation;
  readTravelIntent: typeof readTravelIntent;
  matchOffers: typeof matchOffersForConversation;
  loadCommercialRecords: typeof loadCommercialRecords;
  assignOwner: typeof assignConversationOwner;
  runRisk: typeof runRiskForConversation;
  openInterventions: typeof openInterventionsForSignals;
  recordGate: typeof recordGateDecision;
  saveIntelligence: typeof upsertIntelligence;
  saveSignals: (db: Db, agencyId: string, conversationId: string, signals: RecordSignalInput[]) => Promise<number>;
  now: () => Date;
  loadEntitlements?: typeof resolveEntitlements;
  meterConversation?: typeof meterAiConversation;
}

export type EnrichmentOutcome =
  | { status: "MISSING" }
  | { status: "SKIPPED"; reason: GateReason; escalatedToRisk: boolean }
  | { status: "ENRICHED"; source: "RULES" | "LLM"; note: string | null; unchanged: boolean };

const enrichPayloadSchema = z.object({ conversationId: z.string().uuid(), messageId: z.string().uuid().optional() });

const surfaceModes = ["OFF", "SHADOW", "PROPOSE", "ACTIVE"] as const;

/* ── Pure helpers (exported for tests) ────────────────────────────────────── */

export function digestTurnOf(message: PipelineMessage): DigestTurn | null {
  if (message.actor === "SYSTEM") return null;
  return { speaker: message.actor === "CUSTOMER" ? "customer" : "team", text: message.text };
}

/** The last time a person (not the AI) spoke in the thread — the gate's "human active" evidence. */
export function lastStaffActivity(messages: readonly PipelineMessage[]): Date | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].actor === "STAFF") {
      const at = new Date(messages[index].createdAt);
      return Number.isNaN(at.getTime()) ? null : at;
    }
  }
  return null;
}

/** We asked and are waiting: the message before the customer's newest is ours and ends in a question mark. */
export function isAwaitingCustomerAnswer(messages: readonly PipelineMessage[]): boolean {
  const latestCustomer = findLatestCustomerIndex(messages);
  if (latestCustomer <= 0) return false;
  for (let index = latestCustomer - 1; index >= 0; index -= 1) {
    const before = messages[index];
    if (before.actor === "SYSTEM") continue;
    return before.actor !== "CUSTOMER" && /[?？]\s*$/u.test(before.text.trim());
  }
  return false;
}

function findLatestCustomerIndex(messages: readonly PipelineMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) if (messages[index].actor === "CUSTOMER") return index;
  return -1;
}

/**
 * The digest after this run. Incremental when a same-version digest exists (append what arrived since it was
 * computed); rebuilt from the recent window otherwise.
 */
export function nextDigest(previous: ConversationIntelligence | null, messages: readonly PipelineMessage[]): string | null {
  const turnsOf = (list: readonly PipelineMessage[]) => list.map(digestTurnOf).filter((turn): turn is DigestTurn => turn !== null);
  if (previous?.digest && previous.pipelineVersion === PIPELINE_VERSION) {
    const since = new Date(previous.computedAt).getTime();
    const fresh = messages.filter((message) => new Date(message.createdAt).getTime() > since);
    return updateDigest(previous.digest, turnsOf(fresh));
  }
  return buildDigest(turnsOf(messages));
}

/** The rule/model intent is validated against the contract before it is stored; the per-field evidence is stored either way. */
function travelFieldsToSave(travel: NonNullable<Awaited<ReturnType<typeof readTravelIntent>>>) {
  const parsed = travelIntentSchema.safeParse(travel.intent);
  return { travelIntentEvidence: travel.readings, ...(parsed.success ? { travelIntent: parsed.data } : {}) };
}

/** Everyone travelling, or null when nobody was read (a party of zero adults is "not known", not "empty"). */
function partySizeOf(travellers: { adults: number; children: number; infants: number } | undefined): number | null {
  return travellers && travellers.adults > 0 ? travellers.adults + travellers.children + travellers.infants : null;
}

export function isCommercial(intent: IntentCode): boolean {
  return (COMMERCIAL_INTENT_CODES as readonly IntentCode[]).includes(intent);
}

/** INBOX_RISK past SHADOW: findings open review cards, and staff see them. In SHADOW nothing is opened. */
function interventionsAreOn(surface: EnrichmentContext["riskSurface"]): boolean {
  return Boolean(surface && surface.enabled && (surface.mode === "PROPOSE" || surface.mode === "ACTIVE"));
}

function surfaceIsOn(surface: EnrichmentContext["intentSurface"]): boolean {
  return surface !== null && surface.enabled && surface.mode !== "OFF";
}

export function inputFingerprint(latestCustomerMessageId: string, digest: string | null): string {
  return createHash("sha256").update(`${PIPELINE_VERSION}|${latestCustomerMessageId}|${digest ?? ""}`).digest("hex");
}

/* ── The run ──────────────────────────────────────────────────────────────── */

export async function runEnrichment(
  db: Db,
  input: { agencyId: string; conversationId: string },
  deps: EnrichmentDeps = defaultEnrichmentDeps,
): Promise<EnrichmentOutcome> {
  const context = await deps.loadContext(db, input.agencyId, input.conversationId);
  if (!context) return { status: "MISSING" };

  const latestIndex = findLatestCustomerIndex(context.messages);
  if (latestIndex < 0) return { status: "MISSING" };
  const latest = context.messages[latestIndex];

  const digest = nextDigest(context.previous, context.messages);
  const fingerprint = inputFingerprint(latest.id, digest);
  const now = deps.now();

  const entitlements = deps.loadEntitlements ? await deps.loadEntitlements(db, input.agencyId, now) : null;
  // Test/legacy dependency injection without an entitlement loader predates
  // FIX9. Production always supplies the cached loader below and is fail-closed
  // when it cannot resolve a subscription.
  const availability = resolveInboxFeatureAvailability({
    entitlements: deps.loadEntitlements ? entitlements : { planCode: "LEGACY", aiConversationAllowance: null, autonomyCeiling: "L3", overageOptIn: true, usage: 0 },
    inboxQueuesV2: false,
  });
  const degradation = entitlements ? resolveAiDegradation(entitlements) : "FULL";
  const decision = shouldEnrich({
    message: { text: latest.text, type: latest.type },
    conversation: {
      lifecycleStatus: context.conversation.lifecycleStatus,
      handlingMode: context.conversation.handlingMode,
      awaitingCustomerAnswer: isAwaitingCustomerAnswer(context.messages),
    },
    staff: { lastActiveAt: lastStaffActivity(context.messages) },
    previous: context.previous
      ? { fingerprint: context.previous.inputFingerprint, state: context.previous.state, pipelineVersion: context.previous.pipelineVersion }
      : null,
    current: { fingerprint, pipelineVersion: PIPELINE_VERSION },
    surface: context.surface ?? { enabled: false, mode: "OFF" },
    approvedAccountNumbers: context.approvedAccounts ?? [],
    // Plan entitlements arrive with the AI-entitlement slice; until then nothing is exhausted.
    entitlementExhausted: degradation === "RULES_AND_MATCHING_ONLY" || degradation === "DETERMINISTIC_ONLY",
    now,
  });

  await deps.recordGate(db, { agencyId: input.agencyId, conversationId: input.conversationId, messageId: latest.id, decision });

  // Risk is never gated on cost: red flags are recorded as rule signals even when every skip rule holds.
  if (decision.escalateToRisk && decision.redFlags.length > 0) {
    await deps.saveSignals(
      db,
      input.agencyId,
      input.conversationId,
      decision.redFlags.map((flag) => ({
        signalCode: flag,
        messageId: latest.id,
        detector: "RULE" as const,
        confidence: 1,
        evidence: [{ messageId: latest.id, snippet: latest.text.slice(0, 300) }],
      })),
    );
  }

  // Past SHADOW, a red flag is a review card as well as a signal, whatever the gate decided: risk is never gated on cost.
  if (decision.escalateToRisk && decision.redFlags.length > 0 && interventionsAreOn(context.riskSurface ?? null)) {
    try {
      await deps.openInterventions(db, { agencyId: input.agencyId, conversationId: input.conversationId, codes: decision.redFlags });
    } catch (cause) {
      console.error("Could not open review cards for the red flags:", cause instanceof Error ? cause.message : cause);
    }
  }

  if (!decision.enrich) return { status: "SKIPPED", reason: decision.reason, escalatedToRisk: decision.escalateToRisk };

  // First time this conversation is evaluated: say so, so the rail can show "Copilot is reading this conversation".
  if (!context.previous) {
    await deps.saveIntelligence(db, input.agencyId, {
      conversationId: input.conversationId,
      inputFingerprint: fingerprint,
      pipelineVersion: PIPELINE_VERSION,
      state: "PENDING",
      digest,
    });
  }

  let outcome;
  try {
    outcome = await deps.triage({ agencyId: input.agencyId, conversationId: input.conversationId, digest, latestMessage: latest.text, db });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    await deps.saveIntelligence(db, input.agencyId, {
      conversationId: input.conversationId,
      inputFingerprint: fingerprint,
      pipelineVersion: PIPELINE_VERSION,
      state: "FAILED",
      note: `Triage failed: ${message}`.slice(0, 500),
    });
    throw cause;
  }

  // S2 — structured travel intent, only for commercial conversations and only where the agency switched the surface on.
  // A failure here never costs the triage result: it is written either way, just without travel details.
  let travel: Awaited<ReturnType<typeof readTravelIntent>> | null = null;
  if (isCommercial(outcome.intentCode) && surfaceIsOn(context.intentSurface)) {
    try {
      travel = await deps.readTravelIntent({
        agencyId: input.agencyId,
        conversationId: input.conversationId,
        customerMessages: context.messages.filter((message) => message.actor === "CUSTOMER" && message.text.trim().length > 0).map((message) => ({ id: message.id, text: message.text })),
        now: now.toISOString(),
        db,
      });
    } catch (cause) {
      console.error("S2 travel intent failed (triage kept):", cause instanceof Error ? cause.message : cause);
    }
  }

  // S3 — live offer matching. No model and no surface of its own: it runs whenever S2 read a journey and a party, and it
  // is what tells staff the best departure. `undefined` = did not run (the stored offer is left as it was); `null` = ran
  // and nothing is bookable (a stale offer is cleared). A failure here never costs triage or the travel details.
  let offer: Awaited<ReturnType<typeof matchOffersForConversation>>["snapshot"] | undefined;
  const offerIntent = travel ? travelIntentSchema.safeParse(travel.intent) : null;
  if (availability.offerMatching && travel && offerIntent?.success && hasOfferInputs(travel.readings)) {
    try {
      offer = (await deps.matchOffers(db, { agencyId: input.agencyId, conversationId: input.conversationId, intent: offerIntent.data, now: now.toISOString() })).snapshot;
    } catch (cause) {
      console.error("S3 offer matching failed (the earlier stages are kept):", cause instanceof Error ? cause.message : cause);
    }
  }

  // Commercial stage and value — deterministic, from records (lead stage, quotes, booking) and the matched offer; no model.
  // Written with everything else. A failed read leaves the stored stage as it was rather than guessing one.
  let commercial: ReturnType<typeof deriveCommercialState> | undefined;
  try {
    const records = await deps.loadCommercialRecords(db, input.agencyId, input.conversationId);
    commercial = deriveCommercialState({
      intentCode: outcome.intentCode,
      leadStage: records.leadStage,
      booking: records.booking,
      quoteStatuses: records.quoteStatuses,
      matchedOffer: offer !== undefined ? offer : (context.previous?.matchedOffer ?? null),
      readings: travel?.readings ?? context.previous?.travelIntentEvidence ?? {},
    });
  } catch (cause) {
    console.error("Commercial stage failed (the earlier stages are kept):", cause instanceof Error ? cause.message : cause);
  }

  const written = await deps.saveIntelligence(db, input.agencyId, {
    conversationId: input.conversationId,
    inputFingerprint: fingerprint,
    pipelineVersion: PIPELINE_VERSION,
    state: "FRESH",
    ...(travel ? travelFieldsToSave(travel) : {}),
    ...(offer !== undefined ? { matchedOffer: offer } : {}),
    ...(commercial ? { commercialStage: commercial.stage, estimatedValueCents: commercial.estimatedValueCents, estimatedValueCurrency: commercial.estimatedValueCurrency } : {}),
    intentCode: outcome.intentCode,
    intentConfidence: outcome.intentConfidence,
    urgency: outcome.urgency,
    sentiment: outcome.sentiment,
    languageCode: outcome.languageCode,
    source: outcome.source,
    note: outcome.note ?? travel?.note ?? null,
    aiRunId: outcome.aiRunId,
    digest,
    computedAt: now.toISOString(),
  });
  if (written.written && deps.meterConversation) {
    await deps.meterConversation(db, { agencyId: input.agencyId, conversationId: input.conversationId, periodStart: utcMonthStart(now) });
  }

  // S4 — the eleven rule-only risk detectors. No model. Only where INBOX_RISK is on; they record signals (in SHADOW, staff
  // do not see them) and never open an intervention in this slice. A failure never costs the reading that was just saved.
  if (surfaceIsOn(context.riskSurface ?? null)) {
    try {
      await deps.runRisk(db, {
        agencyId: input.agencyId,
        conversationId: input.conversationId,
        now,
        messages: context.messages,
        intentConfidence: outcome.intentConfidence,
        matchedOffer: offer !== undefined ? offer : (context.previous?.matchedOffer ?? null),
        travelIntent: travel ? (travelIntentSchema.safeParse(travel.intent).data ?? null) : (context.previous?.travelIntent ?? null),
        approvedAccounts: context.approvedAccounts ?? [],
        openInterventions: interventionsAreOn(context.riskSurface ?? null),
        classifyModel: surfaceIsOn(context.riskModelSurface ?? null),
      });
    } catch (cause) {
      console.error("Risk detectors failed (the reading is kept):", cause instanceof Error ? cause.message : cause);
    }
  }

  // Routing (R3): an unassigned, open conversation is offered to the four-step chain. Only agencies that switched routing on
  // are affected; a failure never costs the reading that was just saved.
  if (context.conversation.assignedToId === null && context.conversation.lifecycleStatus === "OPEN") {
    try {
      await deps.assignOwner(db, {
        agencyId: input.agencyId,
        conversationId: input.conversationId,
        now,
        partySize: partySizeOf(travel?.intent.travellers) ?? partySizeOf(context.previous?.travelIntent?.travellers),
        intentCode: outcome.intentCode,
      });
    } catch (cause) {
      console.error("Auto-assignment failed (the reading is kept):", cause instanceof Error ? cause.message : cause);
    }
  }

  return { status: "ENRICHED", source: outcome.source, note: outcome.note, unchanged: !written.written };
}

/* ── The job handler ──────────────────────────────────────────────────────── */

export const enrichLaneJobHandler: LaneJobHandler = async (job, context) => {
  const payload = enrichPayloadSchema.parse(job.payload);
  await runEnrichment(context.db, { agencyId: job.agencyId, conversationId: payload.conversationId });
};

/* ── Default dependencies: the real database ──────────────────────────────── */

const GATE_MESSAGE_TYPES: readonly GateMessageType[] = ["TEXT", "AUDIO", "IMAGE", "DOCUMENT", "TEMPLATE", "INTERACTIVE", "SYSTEM", "STICKER"];

/** The file name on a message's metadata, wherever the channel put it. */
function attachmentNameOf(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const record = metadata as Record<string, unknown>;
  const nested = record.document && typeof record.document === "object" ? (record.document as Record<string, unknown>).filename : undefined;
  const name = record.filename ?? record.file_name ?? nested;
  return typeof name === "string" && name.length > 0 ? name : null;
}

async function loadEnrichmentContext(db: Db, agencyId: string, conversationId: string): Promise<EnrichmentContext | null> {
  const { data: conversation, error: conversationError } = await db
    .from("conversations")
    .select("id, lifecycle_status, handling_mode, assigned_to_id")
    .eq("agency_id", agencyId)
    .eq("id", conversationId)
    .maybeSingle();
  if (conversationError) throw new Error(`Could not load conversation: ${conversationError.message}`);
  if (!conversation) return null;

  const { data: rows, error: messagesError } = await db
    .from("conversation_messages")
    .select("id, actor_kind, content, message_type, created_at, metadata")
    .eq("agency_id", agencyId)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(RECENT_MESSAGE_LIMIT);
  if (messagesError) throw new Error(`Could not load messages: ${messagesError.message}`);

  const { data: surfaceRow, error: surfaceError } = await db
    .from("ai_surface_settings")
    .select("enabled, mode")
    .eq("agency_id", agencyId)
    .eq("surface", INBOX_TRIAGE_SURFACE_NAME)
    .maybeSingle();
  if (surfaceError) throw new Error(`Could not load the surface setting: ${surfaceError.message}`);

  const { data: intentRow, error: intentError } = await db
    .from("ai_surface_settings")
    .select("enabled, mode")
    .eq("agency_id", agencyId)
    .eq("surface", INBOX_INTENT_SURFACE_NAME)
    .maybeSingle();
  if (intentError) throw new Error(`Could not load the travel-intent setting: ${intentError.message}`);

  const { data: riskRow, error: riskError } = await db.from("ai_surface_settings").select("enabled, mode").eq("agency_id", agencyId).eq("surface", INBOX_RISK_SURFACE_NAME).maybeSingle();
  if (riskError) throw new Error(`Could not load the risk setting: ${riskError.message}`);
  const { data: riskModelRow, error: riskModelError } = await db.from("ai_surface_settings").select("enabled, mode").eq("agency_id", agencyId).eq("surface", INBOX_RISK_MODEL_SURFACE_NAME).maybeSingle();
  if (riskModelError) throw new Error(`Could not load the risk classifier setting: ${riskModelError.message}`);
  const approvedAccounts = await loadApprovedAccounts(db, agencyId);

  const messages: PipelineMessage[] = ((rows ?? []) as Array<Record<string, unknown>>)
    .map((row) => ({
      id: String(row.id),
      actor: (["CUSTOMER", "AI", "STAFF", "SYSTEM"].includes(String(row.actor_kind)) ? row.actor_kind : "SYSTEM") as PipelineMessage["actor"],
      text: typeof row.content === "string" ? row.content : "",
      type: (GATE_MESSAGE_TYPES.includes(row.message_type as GateMessageType) ? row.message_type : "TEXT") as GateMessageType,
      createdAt: String(row.created_at),
      attachmentName: attachmentNameOf(row.metadata),
    }))
    .reverse();

  const mode = surfaceRow && (surfaceModes as readonly string[]).includes(String(surfaceRow.mode)) ? (surfaceRow.mode as (typeof surfaceModes)[number]) : "OFF";
  const lifecycle = String(conversation.lifecycle_status);

  return {
    conversation: {
      lifecycleStatus: lifecycle === "CLOSED" || lifecycle === "SPAM" ? lifecycle : "OPEN",
      handlingMode: (conversation.handling_mode as ConversationHandlingMode | null) ?? null,
      assignedToId: (conversation.assigned_to_id as string | null) ?? null,
    },
    messages,
    previous: await loadIntelligence(db, agencyId, conversationId),
    surface: surfaceRow ? { enabled: Boolean(surfaceRow.enabled), mode } : null,
    approvedAccounts,
    riskModelSurface: riskModelRow ? { enabled: Boolean(riskModelRow.enabled), mode: (surfaceModes as readonly string[]).includes(String(riskModelRow.mode)) ? (riskModelRow.mode as (typeof surfaceModes)[number]) : "OFF" } : null,
    riskSurface: riskRow ? { enabled: Boolean(riskRow.enabled), mode: (surfaceModes as readonly string[]).includes(String(riskRow.mode)) ? (riskRow.mode as (typeof surfaceModes)[number]) : "OFF" } : null,
    intentSurface: intentRow
      ? { enabled: Boolean(intentRow.enabled), mode: (surfaceModes as readonly string[]).includes(String(intentRow.mode)) ? (intentRow.mode as (typeof surfaceModes)[number]) : "OFF" }
      : null,
  };
}

const defaultEnrichmentDeps: EnrichmentDeps = {
  loadContext: loadEnrichmentContext,
  triage: triageConversation,
  readTravelIntent,
  matchOffers: matchOffersForConversation,
  loadCommercialRecords,
  assignOwner: assignConversationOwner,
  runRisk: runRiskForConversation,
  openInterventions: openInterventionsForSignals,
  recordGate: recordGateDecision,
  saveIntelligence: upsertIntelligence,
  saveSignals: recordSignals,
  loadEntitlements: resolveEntitlements,
  meterConversation: meterAiConversation,
  now: () => new Date(),
};
