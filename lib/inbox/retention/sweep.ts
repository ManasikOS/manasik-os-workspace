import "server-only";
import type { Db } from "@/lib/ai/db";
import { FINISHED_JOB_RETENTION_DAYS, FINISHED_JOB_STATUSES, resolveRetention } from "./policy";

export interface RetentionSweepSummary { scope: string; rowsDeleted: number; objectsDeleted: number; dryRun: boolean; error: string | null }

interface StoredAttachment { id: string; storage_path: string | null }

async function removeAttachmentObjects(db: Db, attachments: StoredAttachment[], dryRun: boolean): Promise<number> {
  const paths = [...new Set(attachments.flatMap((attachment) => attachment.storage_path ? [attachment.storage_path] : []))];
  if (dryRun || paths.length === 0) return paths.length;
  const { error } = await db.storage.from("inbox-attachments").remove(paths);
  if (error) throw new Error(`Could not delete retained attachment objects: ${error.message}`);
  return paths.length;
}

/** Shared destructive primitive for nightly expiry and explicit deletion callbacks. */
export async function deleteConversationMessageBatch(db: Db, input: { agencyId: string; messageIds: string[]; dryRun: boolean }): Promise<{ rowsDeleted: number; objectsDeleted: number }> {
  if (input.messageIds.length === 0) return { rowsDeleted: 0, objectsDeleted: 0 };
  const { data: attachmentRows, error: attachmentError } = await db.from("message_attachments").select("id,storage_path").eq("agency_id", input.agencyId).in("message_id", input.messageIds);
  if (attachmentError) throw new Error(attachmentError.message);
  const objectsDeleted = await removeAttachmentObjects(db, (attachmentRows ?? []) as StoredAttachment[], input.dryRun);
  if (input.dryRun) return { rowsDeleted: input.messageIds.length, objectsDeleted };
  const deletion = await db.from("conversation_messages").delete({ count: "exact" }).eq("agency_id", input.agencyId).in("id", input.messageIds);
  if (deletion.error) throw new Error(deletion.error.message);
  return { rowsDeleted: deletion.count ?? input.messageIds.length, objectsDeleted };
}

/** Explicit privacy deletion uses the same object/message deletion primitive as retention. */
export async function deleteInboxConversations(db: Db, input: { agencyId: string; conversationIds: string[]; batchSize?: number }): Promise<{ conversationsDeleted: number; messagesDeleted: number; objectsDeleted: number }> {
  if (input.conversationIds.length === 0) return { conversationsDeleted: 0, messagesDeleted: 0, objectsDeleted: 0 };
  const batchSize = input.batchSize ?? 250;
  // The send queue points at the conversation and its messages with ON DELETE RESTRICT, so its rows must go first or every delete
  // below fails for any chat that ever had a staff reply.
  const outbox = await db.from("outbox_messages").delete().eq("agency_id", input.agencyId).in("conversation_id", input.conversationIds);
  if (outbox.error) throw new Error(outbox.error.message);
  let messagesDeleted = 0;
  let objectsDeleted = 0;
  for (;;) {
    const { data, error } = await db.from("conversation_messages").select("id").eq("agency_id", input.agencyId).in("conversation_id", input.conversationIds).limit(batchSize);
    if (error) throw new Error(error.message);
    const ids = ((data ?? []) as Array<{ id: string }>).map((row) => row.id);
    if (ids.length === 0) break;
    const deleted = await deleteConversationMessageBatch(db, { agencyId: input.agencyId, messageIds: ids, dryRun: false });
    messagesDeleted += deleted.rowsDeleted;
    objectsDeleted += deleted.objectsDeleted;
  }
  const [aiRuns, agentRuns] = await Promise.all([
    db.from("ai_runs").delete().eq("agency_id", input.agencyId).eq("subject_type", "CONVERSATION").in("subject_id", input.conversationIds),
    db.from("agent_runs").delete().eq("agency_id", input.agencyId).in("conversation_id", input.conversationIds),
  ]);
  if (aiRuns.error) throw new Error(aiRuns.error.message);
  if (agentRuns.error) throw new Error(agentRuns.error.message);
  const removed = await db.from("conversations").delete({ count: "exact" }).eq("agency_id", input.agencyId).in("id", input.conversationIds);
  if (removed.error) throw new Error(removed.error.message);
  return { conversationsDeleted: removed.count ?? input.conversationIds.length, messagesDeleted, objectsDeleted };
}

const isoBeforeDays = (now: Date, days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();

interface RetentionCursor { at: string; id: string }

const EPOCH_CURSOR: RetentionCursor = { at: "1970-01-01T00:00:00.000Z", id: "00000000-0000-0000-0000-000000000000" };
const DEFAULT_MAX_BATCHES = 20;
const DEFAULT_BUDGET_MS = 45_000;

async function loadRetentionCursor(db: Db, agencyId: string, scope: string): Promise<RetentionCursor> {
  const { data } = await db.from("inbox_retention_cursors").select("cursor_at,cursor_id").eq("agency_id", agencyId).eq("scope", scope).maybeSingle();
  const row = data as { cursor_at: string; cursor_id: string } | null;
  return row ? { at: row.cursor_at, id: row.cursor_id } : EPOCH_CURSOR;
}

async function saveRetentionCursor(db: Db, agencyId: string, scope: string, cursor: RetentionCursor): Promise<void> {
  const { error } = await db.from("inbox_retention_cursors").upsert({ agency_id: agencyId, scope, cursor_at: cursor.at, cursor_id: cursor.id, updated_at: new Date().toISOString() }, { onConflict: "agency_id,scope" });
  if (error) throw new Error(error.message);
}

interface RetentionCandidateConversation { id: string; last_activity_at: string; booking_linked: boolean }

/**
 * Loads one keyset page of booking-classified conversation candidates for the
 * MESSAGES scope. Booking-linked conversations (a direct
 * `departure_group_bookings.source_conversation_id` link, or a lead the
 * conversation created that later gained a `booking_id`) compare against the
 * longer booking cutoff; everyone else compares against the enquiry cutoff.
 */
async function loadMessageRetentionCandidates(db: Db, agencyId: string, input: { bookingCutoff: string; enquiryCutoff: string; cursor: RetentionCursor; limit: number }): Promise<RetentionCandidateConversation[]> {
  const { data, error } = await db.rpc("inbox_retention_candidate_conversations", {
    p_agency_id: agencyId,
    p_booking_cutoff: input.bookingCutoff,
    p_enquiry_cutoff: input.enquiryCutoff,
    p_cursor_at: input.cursor.at,
    p_cursor_id: input.cursor.id,
    p_limit: input.limit,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as RetentionCandidateConversation[];
}

interface SweepBudget { dryRun: boolean; batchSize: number; maxBatches: number; deadlineAt: number }
interface SweepRow { id: string; sortAt: string }

/**
 * The one destructive-sweep loop every scope shares: page candidates by a
 * persisted keyset cursor, delete a page, advance and persist the cursor only
 * after that page's deletion succeeds, and stop — without touching the
 * cursor — the instant a page fails, so a retried run repeats exactly the
 * failed page instead of skipping it or re-walking already-cleared rows. A
 * dry run pages and reports the same candidates but never advances the
 * persisted cursor, so it can be replayed for a preview without causing a
 * later live run to skip anything.
 */
async function runResumableSweep<T extends SweepRow>(
  db: Db,
  agencyId: string,
  scope: string,
  budget: SweepBudget,
  fetchPage: (cursor: RetentionCursor, limit: number) => Promise<T[]>,
  deleteBatch: (rows: T[], dryRun: boolean) => Promise<{ rowsDeleted: number; objectsDeleted: number }>,
): Promise<RetentionSweepSummary> {
  let cursor = await loadRetentionCursor(db, agencyId, scope);
  let rowsDeleted = 0;
  let objectsDeleted = 0;
  let sweepError: string | null = null;
  for (let batch = 0; batch < budget.maxBatches && Date.now() < budget.deadlineAt; batch += 1) {
    let rows: T[];
    try {
      rows = await fetchPage(cursor, budget.batchSize);
    } catch (cause) {
      sweepError = cause instanceof Error ? cause.message : String(cause);
      break;
    }
    if (rows.length === 0) break;
    try {
      const deleted = await deleteBatch(rows, budget.dryRun);
      rowsDeleted += deleted.rowsDeleted;
      objectsDeleted += deleted.objectsDeleted;
    } catch (cause) {
      sweepError = cause instanceof Error ? cause.message : String(cause);
      break;
    }
    const last = rows[rows.length - 1];
    cursor = { at: last.sortAt, id: last.id };
    if (!budget.dryRun) await saveRetentionCursor(db, agencyId, scope, cursor);
    if (rows.length < budget.batchSize) break;
  }
  const summary: RetentionSweepSummary = { scope, rowsDeleted, objectsDeleted, dryRun: budget.dryRun, error: sweepError };
  await db.from("inbox_retention_sweeps").insert({ agency_id: agencyId, scope, rows_deleted: rowsDeleted, objects_deleted: objectsDeleted, dry_run: budget.dryRun, cursor: cursor.id, error: sweepError?.slice(0, 2_000) ?? null });
  return summary;
}

interface ScopeCandidateRow extends SweepRow { storagePath: string | null }

/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- the postgrest query builder's chained type is not worth reproducing here */
type ScopeQuery = any;

/** One keyset page for a plain timestamp-ordered scope table (everything but MESSAGES). */
async function fetchScopeCandidates(db: Db, agencyId: string, config: { table: string; timestampColumn: string; idColumn?: string; cutoff: string; withStoragePath: boolean; extra?: (query: ScopeQuery) => ScopeQuery }, cursor: RetentionCursor, limit: number): Promise<ScopeCandidateRow[]> {
  const idColumn = config.idColumn ?? "id";
  const columns = config.withStoragePath ? `${idColumn},storage_path,${config.timestampColumn}` : `${idColumn},${config.timestampColumn}`;
  let query = db.from(config.table).select(columns).eq("agency_id", agencyId).lt(config.timestampColumn, config.cutoff)
    // Keyset page: strictly after the cursor's (timestamp, id), matching the
    // `order by timestampColumn, id` below so a resumed sweep neither re-walks
    // cleared rows nor skips a row that only just crossed its cutoff.
    .or(`${config.timestampColumn}.gt.${cursor.at},and(${config.timestampColumn}.eq.${cursor.at},${idColumn}.gt.${cursor.id})`)
    .order(config.timestampColumn, { ascending: true }).order(idColumn, { ascending: true }).limit(limit);
  if (config.extra) query = config.extra(query);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as Array<Record<string, unknown>>).map((row) => ({
    id: row[idColumn] as string,
    sortAt: row[config.timestampColumn] as string,
    storagePath: config.withStoragePath ? ((row.storage_path as string | null) ?? null) : null,
  }));
}

export async function runRetentionSweepForAgency(db: Db, agencyId: string, options: { dryRun: boolean; now?: Date; batchSize?: number; maxBatches?: number; budgetMs?: number } = { dryRun: true }): Promise<RetentionSweepSummary[]> {
  const now = options.now ?? new Date();
  const batchSize = options.batchSize ?? 250;
  const maxBatches = options.maxBatches ?? DEFAULT_MAX_BATCHES;
  const deadlineAt = now.getTime() + (options.budgetMs ?? DEFAULT_BUDGET_MS);
  const { data: settings, error: settingsError } = await db.from("agency_settings").select("booking_linked_message_retention_years, enquiry_message_retention_months, inbox_attachment_retention_days, voice_audio_retention_days, intelligence_retention_months, ai_run_retention_months, webhook_payload_retention_days").eq("agency_id", agencyId).single();
  if (settingsError || !settings) throw new Error(`Unable to load retention policy: ${settingsError?.message ?? "missing settings"}`);
  const policy = resolveRetention({
    bookingLinkedMessageRetentionYears: Number(settings.booking_linked_message_retention_years),
    enquiryMessageRetentionMonths: Number(settings.enquiry_message_retention_months),
    inboxAttachmentRetentionDays: Number(settings.inbox_attachment_retention_days),
    voiceAudioRetentionDays: Number(settings.voice_audio_retention_days),
    intelligenceRetentionMonths: Number(settings.intelligence_retention_months),
    aiRunRetentionMonths: Number(settings.ai_run_retention_months),
    webhookPayloadRetentionDays: Number(settings.webhook_payload_retention_days),
  });

  const budget: SweepBudget = { dryRun: options.dryRun, batchSize, maxBatches, deadlineAt };
  const enquiryCutoff = isoBeforeDays(now, policy.enquiryMessageRetentionMonths * 30.4375);
  const bookingCutoff = isoBeforeDays(now, policy.bookingLinkedMessageRetentionYears * 365.25);

  const scopes = [
    { scope: "ATTACHMENTS", table: "message_attachments", timestamp: "created_at", cutoff: isoBeforeDays(now, policy.inboxAttachmentRetentionDays), withStoragePath: true, extra: (q: ScopeQuery) => q.is("promoted_document_id", null).not("mime_type", "like", "audio/%") },
    { scope: "VOICE_AUDIO", table: "message_attachments", timestamp: "created_at", cutoff: isoBeforeDays(now, policy.voiceAudioRetentionDays), withStoragePath: true, extra: (q: ScopeQuery) => q.is("promoted_document_id", null).like("mime_type", "audio/%") },
    { scope: "INTELLIGENCE", table: "conversation_intelligence", idColumn: "conversation_id", timestamp: "computed_at", cutoff: isoBeforeDays(now, policy.intelligenceRetentionMonths * 30.4375), withStoragePath: false },
    { scope: "SIGNALS", table: "conversation_signals", timestamp: "created_at", cutoff: isoBeforeDays(now, policy.intelligenceRetentionMonths * 30.4375), withStoragePath: false },
    { scope: "AI_RUNS", table: "ai_runs", timestamp: "created_at", cutoff: isoBeforeDays(now, policy.aiRunRetentionMonths * 30.4375), withStoragePath: false },
    // Raw Messenger/Instagram and WhatsApp deliveries hold the customer's message verbatim: one window, the agency's webhook payload retention (R7).
    { scope: "WEBHOOK_PAYLOADS", table: "channel_webhook_events", timestamp: "received_at", cutoff: isoBeforeDays(now, policy.webhookPayloadRetentionDays), withStoragePath: false },
    { scope: "WHATSAPP_WEBHOOK_PAYLOADS", table: "whatsapp_webhook_events", timestamp: "received_at", cutoff: isoBeforeDays(now, policy.webhookPayloadRetentionDays), withStoragePath: false },
    // Finished queue rows are history nobody reads after a debugging window. Only DONE and DEAD: a queued, running or retrying job is never touched.
    { scope: "CHANNEL_JOBS", table: "channel_jobs", timestamp: "created_at", cutoff: isoBeforeDays(now, FINISHED_JOB_RETENTION_DAYS), withStoragePath: false, extra: (q: ScopeQuery) => q.in("status", FINISHED_JOB_STATUSES) },
    { scope: "AGENT_JOBS", table: "agent_jobs", timestamp: "created_at", cutoff: isoBeforeDays(now, FINISHED_JOB_RETENTION_DAYS), withStoragePath: false, extra: (q: ScopeQuery) => q.in("status", FINISHED_JOB_STATUSES) },
    // `agent_runs` is deliberately not swept here: there is no agency-configured
    // retention window for it (`ai_run_retention_months` names `ai_runs`, a
    // different table), and its rows are the operational trace of an
    // automated reply that is still authoritative evidence for as long as its
    // conversation exists. It is only ever removed alongside the conversation
    // itself, by `deleteInboxConversations` above, never on its own schedule.
  ] as const;

  const messagesSummary = await runResumableSweep<RetentionCandidateConversation & SweepRow>(
    db, agencyId, "MESSAGES", budget,
    async (cursor, limit) => {
      const conversations = await loadMessageRetentionCandidates(db, agencyId, { bookingCutoff, enquiryCutoff, cursor, limit });
      return conversations.map((row) => ({ ...row, sortAt: row.last_activity_at }));
    },
    async (rows, dryRun) => {
      const conversationIds = rows.map((row) => row.id);
      const { data: messageCandidates, error: messageError } = await db.from("conversation_messages").select("id").eq("agency_id", agencyId).in("conversation_id", conversationIds);
      if (messageError) throw new Error(messageError.message);
      const messageIds = ((messageCandidates ?? []) as Array<{ id: string }>).map((row) => row.id);
      // Delete the retained content, not the conversation container: resolved
      // interventions and routing history must outlive an expired message.
      return deleteConversationMessageBatch(db, { agencyId, messageIds, dryRun });
    },
  );

  const summaries: RetentionSweepSummary[] = [messagesSummary];
  for (const scopeConfig of scopes) {
    const summary = await runResumableSweep<ScopeCandidateRow>(
      db, agencyId, scopeConfig.scope, budget,
      (cursor, limit) => fetchScopeCandidates(db, agencyId, { table: scopeConfig.table, timestampColumn: scopeConfig.timestamp, idColumn: "idColumn" in scopeConfig ? scopeConfig.idColumn : undefined, cutoff: scopeConfig.cutoff, withStoragePath: scopeConfig.withStoragePath, extra: "extra" in scopeConfig ? scopeConfig.extra : undefined }, cursor, limit),
      async (rows, dryRun) => {
        const objectsDeleted = scopeConfig.withStoragePath ? await removeAttachmentObjects(db, rows.map((row) => ({ id: row.id, storage_path: row.storagePath })), dryRun) : 0;
        if (dryRun) return { rowsDeleted: rows.length, objectsDeleted };
        const ids = rows.map((row) => row.id);
        const deletion = await db.from(scopeConfig.table).delete({ count: "exact" }).eq("agency_id", agencyId).in("idColumn" in scopeConfig ? scopeConfig.idColumn : "id", ids);
        if (deletion.error) throw new Error(deletion.error.message);
        return { rowsDeleted: deletion.count ?? ids.length, objectsDeleted };
      },
    );
    summaries.push(summary);
  }
  return summaries;
}
