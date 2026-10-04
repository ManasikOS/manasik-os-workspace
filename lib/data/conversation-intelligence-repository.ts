/**
 * Data access for the intelligence projection — MI2.1 of docs/inbox/implementation-plan.md (Architecture §5.1–5.3).
 *
 * Writes run on the ADMIN client from server code (the four tables have no write policy for `authenticated`), so
 * every function takes `agencyId` explicitly and filters or stamps by it — the database's composite foreign keys are
 * the backstop, not the only defence. Rows read back are validated against the closed-enum Zod contracts, so an
 * out-of-range value from a stale row is surfaced, never trusted.
 *
 * `upsertIntelligence` is idempotent on `input_fingerprint`: replaying the same input costs one indexed read and no write.
 * `openIntervention` is idempotent per (conversation, kind) while one is open, backed by a partial unique index.
 */

import "server-only";

import type { Db } from "@/lib/ai/db";
import {
  OPEN_INTERVENTION_STATUSES,
  conversationIntelligenceSchema,
  conversationSignalSchema,
  interventionKindSchema,
  interventionSchema,
  interventionSeveritySchema,
  nextActionCodeSchema,
  signalCodeSchema,
  signalDetectorSchema,
  type ConversationIntelligence,
  type ConversationSignal,
  type Evidence,
  type Intervention,
  type InterventionKind,
  type SignalCode,
} from "@/lib/inbox/intelligence/contracts";
import { z } from "zod";

const POSTGRES_UNIQUE_VIOLATION = "23505";

function failed(what: string, error: { message: string }): never {
  throw new Error(`Could not ${what}: ${error.message}`);
}

type Row = Record<string, unknown>;

const nullableNumber = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value));

/* ── conversation_intelligence ────────────────────────────────────────────── */

const INTELLIGENCE_COLUMNS =
  "conversation_id, intent_code, intent_confidence, travel_intent, urgency, commercial_stage, sentiment, estimated_value_cents, estimated_value_currency, risk_level, next_action_code, language_code, summary, digest, travel_intent_evidence, open_questions, matched_offer, source, state, note, pipeline_version, input_fingerprint, computed_at, stale_at, ai_run_id";

export function toConversationIntelligence(row: Row): ConversationIntelligence {
  return conversationIntelligenceSchema.parse({
    conversationId: row.conversation_id,
    intentCode: row.intent_code ?? null,
    intentConfidence: nullableNumber(row.intent_confidence),
    travelIntent: row.travel_intent ?? null,
    urgency: row.urgency,
    commercialStage: row.commercial_stage,
    sentiment: row.sentiment,
    estimatedValueCents: nullableNumber(row.estimated_value_cents),
    estimatedValueCurrency: row.estimated_value_currency ?? null,
    riskLevel: row.risk_level,
    nextActionCode: row.next_action_code,
    languageCode: row.language_code ?? null,
    summary: row.summary ?? null,
    digest: row.digest ?? null,
    travelIntentEvidence: row.travel_intent_evidence ?? {},
    openQuestions: row.open_questions ?? [],
    matchedOffer: row.matched_offer ?? null,
    source: row.source,
    state: row.state,
    note: row.note ?? null,
    pipelineVersion: row.pipeline_version,
    inputFingerprint: row.input_fingerprint,
    computedAt: row.computed_at,
    staleAt: row.stale_at ?? null,
    aiRunId: row.ai_run_id ?? null,
  });
}

/** The projection for one conversation, or null when it has never been evaluated. Agency-scoped. */
export async function loadIntelligence(db: Db, agencyId: string, conversationId: string): Promise<ConversationIntelligence | null> {
  const { data, error } = await db
    .from("conversation_intelligence")
    .select(INTELLIGENCE_COLUMNS)
    .eq("agency_id", agencyId)
    .eq("conversation_id", conversationId)
    .maybeSingle();
  if (error) failed("load conversation intelligence", error);
  return data ? toConversationIntelligence(data as Row) : null;
}

/** What a stage writes. Anything omitted keeps the column default (a PENDING row is just `{conversationId, inputFingerprint}`). */
export type UpsertIntelligenceInput = Partial<Omit<ConversationIntelligence, "conversationId" | "computedAt">> & {
  conversationId: string;
  inputFingerprint: string;
  computedAt?: string;
};

export type UpsertIntelligenceResult = { written: true } | { written: false; reason: "UNCHANGED" };

export async function upsertIntelligence(db: Db, agencyId: string, input: UpsertIntelligenceInput): Promise<UpsertIntelligenceResult> {
  const existing = await loadIntelligence(db, agencyId, input.conversationId);
  const pipelineVersion = input.pipelineVersion ?? existing?.pipelineVersion ?? 1;
  const state = input.state ?? "FRESH";

  // Idempotency: the same input, under the same pipeline version, already computed → nothing to do.
  if (existing && existing.state === "FRESH" && state === "FRESH" && existing.inputFingerprint === input.inputFingerprint && existing.pipelineVersion === pipelineVersion) {
    return { written: false, reason: "UNCHANGED" };
  }

  const row: Row = {
    conversation_id: input.conversationId,
    agency_id: agencyId,
    input_fingerprint: input.inputFingerprint,
    pipeline_version: pipelineVersion,
    state,
    computed_at: input.computedAt ?? new Date().toISOString(),
  };
  const optional: Array<[keyof UpsertIntelligenceInput, string]> = [
    ["intentCode", "intent_code"],
    ["intentConfidence", "intent_confidence"],
    ["travelIntent", "travel_intent"],
    ["urgency", "urgency"],
    ["commercialStage", "commercial_stage"],
    ["sentiment", "sentiment"],
    ["estimatedValueCents", "estimated_value_cents"],
    ["estimatedValueCurrency", "estimated_value_currency"],
    ["riskLevel", "risk_level"],
    ["nextActionCode", "next_action_code"],
    ["languageCode", "language_code"],
    ["summary", "summary"],
    ["digest", "digest"],
    ["travelIntentEvidence", "travel_intent_evidence"],
    ["openQuestions", "open_questions"],
    ["matchedOffer", "matched_offer"],
    ["source", "source"],
    ["note", "note"],
    ["staleAt", "stale_at"],
    ["aiRunId", "ai_run_id"],
  ];
  for (const [key, column] of optional) {
    if (input[key] !== undefined) row[column] = input[key];
  }

  const { error } = await db.from("conversation_intelligence").upsert(row, { onConflict: "conversation_id" });
  if (error) failed("save conversation intelligence", error);
  return { written: true };
}

/* ── conversation_signals ─────────────────────────────────────────────────── */

export const recordSignalInputSchema = z.object({
  signalCode: signalCodeSchema,
  messageId: z.string().uuid().nullable().default(null),
  detector: signalDetectorSchema,
  confidence: z.number().min(0).max(1).default(1),
  evidence: z.array(z.object({ messageId: z.string().uuid().nullable(), snippet: z.string().max(300) })).default([]),
});
export type RecordSignalInput = z.input<typeof recordSignalInputSchema>;

const signalKey = (code: string, messageId: string | null) => `${code}|${messageId ?? ""}`;

/**
 * Appends signals, skipping any that is already live for the same (code, message) — a replay never double-records.
 * Returns how many were actually new.
 */
export async function recordSignals(db: Db, agencyId: string, conversationId: string, signals: RecordSignalInput[]): Promise<number> {
  const parsed = signals.map((signal) => recordSignalInputSchema.parse(signal));
  if (parsed.length === 0) return 0;

  const { data: live, error: liveError } = await db
    .from("conversation_signals")
    .select("signal_code, message_id")
    .eq("agency_id", agencyId)
    .eq("conversation_id", conversationId)
    .is("superseded_at", null);
  if (liveError) failed("read live signals", liveError);
  const seen = new Set(((live ?? []) as Row[]).map((row) => signalKey(String(row.signal_code), (row.message_id as string | null) ?? null)));

  const fresh = [];
  for (const signal of parsed) {
    const key = signalKey(signal.signalCode, signal.messageId);
    if (seen.has(key)) continue;
    seen.add(key);
    fresh.push({
      agency_id: agencyId,
      conversation_id: conversationId,
      signal_code: signal.signalCode,
      message_id: signal.messageId,
      detector: signal.detector,
      confidence: signal.confidence,
      evidence: signal.evidence,
    });
  }
  if (fresh.length === 0) return 0;

  const { error } = await db.from("conversation_signals").insert(fresh);
  // A concurrent worker recorded the same live signal between our read and write: the unique index did its job.
  if (error && error.code !== POSTGRES_UNIQUE_VIOLATION) failed("record signals", error);
  return error ? 0 : fresh.length;
}

/** Marks live signals superseded (never deletes). Restrict to `codes` to supersede only some. Returns the count. */
export async function supersedeSignals(db: Db, agencyId: string, conversationId: string, options: { codes?: SignalCode[] } = {}): Promise<number> {
  let query = db
    .from("conversation_signals")
    .update({ superseded_at: new Date().toISOString() })
    .eq("agency_id", agencyId)
    .eq("conversation_id", conversationId)
    .is("superseded_at", null);
  if (options.codes && options.codes.length > 0) query = query.in("signal_code", options.codes);
  const { data, error } = await query.select("id");
  if (error) failed("supersede signals", error);
  return (data ?? []).length;
}

export async function listLiveSignals(db: Db, agencyId: string, conversationId: string): Promise<ConversationSignal[]> {
  const { data, error } = await db
    .from("conversation_signals")
    .select("conversation_id, signal_code, message_id, detector, confidence, evidence, superseded_at, created_at")
    .eq("agency_id", agencyId)
    .eq("conversation_id", conversationId)
    .is("superseded_at", null)
    .order("created_at", { ascending: false });
  if (error) failed("list signals", error);
  return ((data ?? []) as Row[]).map((row) =>
    conversationSignalSchema.parse({
      conversationId: row.conversation_id,
      signalCode: row.signal_code,
      messageId: row.message_id ?? null,
      detector: row.detector,
      confidence: Number(row.confidence),
      evidence: (row.evidence ?? []) as Evidence[],
      supersededAt: row.superseded_at ?? null,
      createdAt: row.created_at,
    }),
  );
}

/* ── conversation_interventions ───────────────────────────────────────────── */

export const openInterventionInputSchema = z.object({
  conversationId: z.string().uuid(),
  kind: interventionKindSchema,
  severity: interventionSeveritySchema,
  headline: z.string().trim().min(1).max(200),
  guidance: z.string().trim().min(1).max(1000),
  requiredActionCode: nextActionCodeSchema,
  assignedRole: z.string().min(1).nullable().default(null),
  assignedToId: z.string().uuid().nullable().default(null),
  sourceSignalIds: z.array(z.string().uuid()).default([]),
});
export type OpenInterventionInput = z.input<typeof openInterventionInputSchema>;

const INTERVENTION_COLUMNS =
  "id, conversation_id, kind, severity, headline, guidance, required_action_code, assigned_role, assigned_to_id, status, resolved_by, resolution_note, source_signal_ids, created_at, resolved_at";

export function toIntervention(row: Row): Intervention {
  return interventionSchema.parse({
    id: row.id,
    conversationId: row.conversation_id,
    kind: row.kind,
    severity: row.severity,
    headline: row.headline,
    guidance: row.guidance,
    requiredActionCode: row.required_action_code,
    assignedRole: row.assigned_role ?? null,
    assignedToId: row.assigned_to_id ?? null,
    status: row.status,
    resolvedBy: row.resolved_by ?? null,
    resolutionNote: row.resolution_note ?? null,
    sourceSignalIds: row.source_signal_ids ?? [],
    createdAt: row.created_at,
    resolvedAt: row.resolved_at ?? null,
  });
}

/**
 * Opens an intervention. If one of the same kind is already open on the conversation, returns that one instead of
 * stacking a second card (`created: false`). The database rejects an intervention for another agency's conversation
 * through its composite foreign key, whatever this function is passed.
 */
export async function openIntervention(db: Db, agencyId: string, input: OpenInterventionInput): Promise<{ intervention: Intervention; created: boolean }> {
  const parsed = openInterventionInputSchema.parse(input);
  const { data, error } = await db
    .from("conversation_interventions")
    .insert({
      agency_id: agencyId,
      conversation_id: parsed.conversationId,
      kind: parsed.kind,
      severity: parsed.severity,
      headline: parsed.headline,
      guidance: parsed.guidance,
      required_action_code: parsed.requiredActionCode,
      assigned_role: parsed.assignedRole,
      assigned_to_id: parsed.assignedToId,
      source_signal_ids: parsed.sourceSignalIds,
    })
    .select(INTERVENTION_COLUMNS)
    .single();

  if (!error && data) return { intervention: toIntervention(data as Row), created: true };
  if (error?.code !== POSTGRES_UNIQUE_VIOLATION) failed("open intervention", error ?? { message: "no row returned" });

  const { data: existing, error: readError } = await db
    .from("conversation_interventions")
    .select(INTERVENTION_COLUMNS)
    .eq("agency_id", agencyId)
    .eq("conversation_id", parsed.conversationId)
    .eq("kind", parsed.kind)
    .in("status", [...OPEN_INTERVENTION_STATUSES])
    .maybeSingle();
  if (readError || !existing) failed("read the existing intervention", readError ?? { message: "it closed while being read" });
  return { intervention: toIntervention(existing as Row), created: false };
}

export const closeInterventionInputSchema = z.object({
  interventionId: z.string().uuid(),
  status: z.enum(["RESOLVED", "DISMISSED"]),
  /** A closed intervention is a decision someone answers for: the note is mandatory. */
  note: z.string().trim().min(1, "A note is required to close an intervention").max(1000),
  actorStaffId: z.string().uuid(),
});
export type CloseInterventionInput = z.input<typeof closeInterventionInputSchema>;

/** Resolves or dismisses an OPEN/ACKNOWLEDGED intervention. Returns null if it was already closed or belongs to another agency. */
export async function resolveIntervention(db: Db, agencyId: string, input: CloseInterventionInput): Promise<Intervention | null> {
  const parsed = closeInterventionInputSchema.parse(input);
  const { data, error } = await db
    .from("conversation_interventions")
    .update({ status: parsed.status, resolution_note: parsed.note, resolved_by: parsed.actorStaffId, resolved_at: new Date().toISOString() })
    .eq("agency_id", agencyId)
    .eq("id", parsed.interventionId)
    .in("status", [...OPEN_INTERVENTION_STATUSES])
    .select(INTERVENTION_COLUMNS)
    .maybeSingle();
  if (error) failed("close intervention", error);
  return data ? toIntervention(data as Row) : null;
}

export async function acknowledgeIntervention(db: Db, agencyId: string, interventionId: string): Promise<Intervention | null> {
  const id = z.string().uuid().parse(interventionId);
  const { data, error } = await db
    .from("conversation_interventions")
    .update({ status: "ACKNOWLEDGED" })
    .eq("agency_id", agencyId)
    .eq("id", id)
    .eq("status", "OPEN")
    .select(INTERVENTION_COLUMNS)
    .maybeSingle();
  if (error) failed("acknowledge intervention", error);
  return data ? toIntervention(data as Row) : null;
}

export async function listInterventions(db: Db, agencyId: string, conversationId: string, options: { openOnly?: boolean } = {}): Promise<Intervention[]> {
  let query = db
    .from("conversation_interventions")
    .select(INTERVENTION_COLUMNS)
    .eq("agency_id", agencyId)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false });
  if (options.openOnly) query = query.in("status", [...OPEN_INTERVENTION_STATUSES]);
  const { data, error } = await query;
  if (error) failed("list interventions", error);
  return ((data ?? []) as Row[]).map(toIntervention);
}

/**
 * The protection-gate query: the open interventions on a conversation, optionally only certain kinds. A caller that
 * cannot read the answer must treat that as "blocked", not "clear" — this throws on a read error rather than returning [].
 */
export async function findOpenInterventions(db: Db, agencyId: string, conversationId: string, kinds?: InterventionKind[]): Promise<Intervention[]> {
  let query = db
    .from("conversation_interventions")
    .select(INTERVENTION_COLUMNS)
    .eq("agency_id", agencyId)
    .eq("conversation_id", conversationId)
    .in("status", [...OPEN_INTERVENTION_STATUSES]);
  if (kinds && kinds.length > 0) query = query.in("kind", kinds);
  const { data, error } = await query;
  if (error) failed("check open interventions", error);
  return ((data ?? []) as Row[]).map(toIntervention);
}
