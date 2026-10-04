/**
 * WhatsApp channel data access — the webhook, the cron drain, and the
 * agent's send path. Every function here takes the **service-role admin
 * client**, never the session client: there is no signed-in user behind an
 * inbound WhatsApp message (D3 in
 * docs/modules/whatsapp-ai-agent-implementation-plan.md). Because the admin client
 * bypasses RLS, every query in this file filters on `agency_id` explicitly
 * — the tenant isolation that RLS gives every other module for free has to
 * be hand-written here.
 *
 * Server Component / Server Action reads of these same tables (the Inbox,
 * §10 of the plan) go through the ordinary session client instead, exactly
 * like every other module, and rely on RLS as usual.
 */

import "server-only";

/* eslint-disable @typescript-eslint/no-explicit-any -- matches the Db convention in every other lib/data/*-repository.ts */
import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  AgentJobKind,
  AgentJobRow,
  ConversationMessageRow,
  ConversationRow,
  ConversationState,
  DeliveryStatus,
  MessageActorKind,
  MessageRole,
  MessageType,
  WhatsAppIntegrationRow,
} from "@/lib/types/whatsapp";
import type { ChannelProvider } from "@/lib/inbox/contracts";
import type { ResolvedCampaignAttribution } from "@/lib/whatsapp/campaign-attribution";
import { stateAfterInbound } from "@/lib/whatsapp/conversation-state";

export type Db = SupabaseClient<any, any, any>;

export class WhatsAppPersistenceError extends Error {
  constructor(table: string, op: string, cause: unknown) {
    super(`whatsapp.${table}.${op} failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "WhatsAppPersistenceError";
  }
}

/* ── Integrations ─────────────────────────────────────────────────────────── */

/**
 * D2 — the tenant gate. Returns null (never throws) when no CONNECTED
 * integration matches the inbound `phone_number_id`, and the webhook drops
 * the event with a 200 rather than guessing which agency it belongs to.
 */
/** The conversation event written when a customer writes to a closed chat. The history block words it. */
export const CUSTOMER_REOPENED_EVENT_KIND = "CUSTOMER_REOPENED";

export async function resolveAgencyForPhoneNumberId(
  db: Db,
  phoneNumberId: string,
): Promise<WhatsAppIntegrationRow | null> {
  const { data, error } = await db
    .from("whatsapp_integrations")
    .select("*")
    .eq("phone_number_id", phoneNumberId)
    .eq("status", "CONNECTED")
    .maybeSingle();

  if (error) throw new WhatsAppPersistenceError("whatsapp_integrations", "select", error);
  return (data as WhatsAppIntegrationRow | null) ?? null;
}

export async function getIntegrationByAgency(db: Db, agencyId: string): Promise<WhatsAppIntegrationRow | null> {
  const { data, error } = await db
    .from("whatsapp_integrations")
    .select("*")
    .eq("agency_id", agencyId)
    .maybeSingle();

  if (error) throw new WhatsAppPersistenceError("whatsapp_integrations", "select", error);
  return (data as WhatsAppIntegrationRow | null) ?? null;
}

/* ── Raw webhook events (F8 idempotency floor) ───────────────────────────── */

/**
 * Idempotent insert keyed on Meta's own event id. A duplicate normally stops
 * immediately. An inbound event whose message never committed may retry;
 * conversation_messages has the final unique guard against duplicate work.
 */
export async function recordWebhookEvent(
  db: Db,
  input: {
    agencyId: string | null;
    externalEventId: string;
    payload: unknown;
    signatureValid: boolean;
    /**
     * Every inbound message id this delivery should have stored. Meta batches several messages into one delivery, but the
     * event key is only the first message's id, so a redelivery must be checked against ALL of them: if any is missing
     * (an earlier attempt failed part-way) the delivery is processed again. Ingest is idempotent per message, so
     * reprocessing a message that is already stored changes nothing.
     */
    expectedMessageIds?: string[];
  },
): Promise<boolean> {
  const { error } = await db.from("whatsapp_webhook_events").insert({
    agency_id: input.agencyId,
    external_event_id: input.externalEventId,
    payload: input.payload,
    signature_valid: input.signatureValid,
  });

  if (!error) return true;
  // A failed first attempt may have stored the audit event before message
  // ingest rolled back. Let that message retry; the message's own unique key
  // remains the final idempotency guard.
  if ((error as { code?: string }).code === "23505") {
    const expected = [...new Set(input.expectedMessageIds ?? [])];
    if (expected.length === 0 || !input.agencyId) return false;
    const { data, error: lookupError } = await db
      .from("conversation_messages")
      .select("external_message_id")
      .eq("agency_id", input.agencyId)
      .in("external_message_id", expected);
    if (lookupError) {
      throw new WhatsAppPersistenceError("conversation_messages", "select", lookupError);
    }
    const stored = new Set(((data ?? []) as Array<{ external_message_id: string }>).map((row) => row.external_message_id));
    return expected.some((id) => !stored.has(id));
  }
  throw new WhatsAppPersistenceError("whatsapp_webhook_events", "insert", error);
}

/* ── Conversations ────────────────────────────────────────────────────────── */

const SERVICE_WINDOW_HOURS = 24;

export async function upsertConversationForInbound(
  db: Db,
  input: {
    agencyId: string;
    /** Defaults to WHATSAPP. The table has always been provider-neutral; this is what makes the writer so too. */
    channel?: ChannelProvider;
    /** The customer's id on the channel: wa_id, Messenger PSID or Instagram IGSID. */
    externalConversationId: string;
    contactName: string;
    /**
     * The generic `channel_connections` row this thread arrives on. A database trigger fills it for WhatsApp
     * only, so Messenger/Instagram must pass it — staff replies find their connection through it.
     */
    connectionId?: string | null;
    leadId?: string | null;
    /**
     * Resolved from the opening message's text (see
     * lib/whatsapp/campaign-attribution.ts). Only ever written once per
     * conversation — before a lead exists — so a later message never
     * overwrites the first click-to-chat attribution.
     */
    attribution?: ResolvedCampaignAttribution | null;
    /** Called when another request created this conversation between our read and our insert. */
    onLostCreateRace?: () => void;
  },
  /** Internal: set on the single retry after losing a create race, so a second collision is reported, not looped on. */
  retriedAfterRace = false,
): Promise<ConversationRow> {
  const channel = input.channel ?? "WHATSAPP";
  const now = new Date();
  // Every channel Meta runs has a 24h reply window; the column name is WhatsApp-era but the meaning is the same.
  const serviceWindowExpiresAt = new Date(now.getTime() + SERVICE_WINDOW_HOURS * 60 * 60 * 1000).toISOString();

  const { data: existing, error: selectError } = await db
    .from("conversations")
    .select("*")
    .eq("agency_id", input.agencyId)
    .eq("channel", channel)
    .eq("external_conversation_id", input.externalConversationId)
    .maybeSingle();
  if (selectError) throw new WhatsAppPersistenceError("conversations", "select", selectError);

  if (existing) {
    const row = existing as ConversationRow;
    const patch: Record<string, unknown> = {
      last_inbound_at: now.toISOString(),
      service_window_expires_at: serviceWindowExpiresAt,
      contact_name: input.contactName || row.contact_name,
    };
    // A resumed or previously closed conversation becomes active on the
    // next inbound message. CLOSED must not be sticky: the Inbox hides
    // closed rows, so leaving it closed would make every future customer
    // message persist successfully but remain permanently invisible.
    // HUMAN_ACTIVE/HUMAN_REQUESTED are untouched — the agent must never
    // speak over a colleague (§10.1 of the plan).
    const nextState = stateAfterInbound(row.state);
    if (nextState !== row.state) patch.state = nextState;
    if (input.leadId && !row.lead_id) patch.lead_id = input.leadId;
    if (input.connectionId && !(row as { connection_id?: string | null }).connection_id) patch.connection_id = input.connectionId;
    // First-touch capture only: once a lead exists, or once an attribution
    // is already on file, a later message's tracking code (or lack of one)
    // must never overwrite it.
    if (input.attribution && !row.attributed_campaign_id && !row.lead_id) {
      patch.attributed_campaign_id = input.attribution.campaignId;
      patch.attribution_channel = input.attribution.channel;
      patch.attribution_tracking_code = input.attribution.trackingCode;
      patch.attribution_source_detail = input.attribution.sourceDetail;
      patch.attribution_confidence = "HIGH";
      patch.attribution_captured_at = now.toISOString();
    }

    const { data, error } = await db
      .from("conversations")
      .update(patch)
      .eq("id", row.id)
      .select("*")
      .single();
    if (error) throw new WhatsAppPersistenceError("conversations", "update", error);
    // A closed chat that comes back is worth saying so in its history: staff otherwise just see it reappear in a queue.
    // Best effort, like every other event write: the message is already stored and must never fail because of this.
    if (row.state === "CLOSED" && nextState !== "CLOSED") {
      try {
        const { error: eventError } = await db.from("conversation_events").insert({
          agency_id: input.agencyId,
          conversation_id: row.id,
          kind: CUSTOMER_REOPENED_EVENT_KIND,
          actor_kind: "CUSTOMER",
          actor_id: null,
          data: {},
        });
        if (eventError) console.error("Could not record that the customer reopened the conversation:", eventError.message);
      } catch (cause) {
        console.error("Could not record that the customer reopened the conversation:", cause instanceof Error ? cause.message : cause);
      }
    }
    return data as ConversationRow;
  }

  const { data, error } = await db
    .from("conversations")
    .insert({
      agency_id: input.agencyId,
      channel,
      external_conversation_id: input.externalConversationId,
      contact_name: input.contactName,
      // A wa_id is a phone number; a Messenger/Instagram id is not, and must never be stored as one.
      contact_phone: channel === "WHATSAPP" ? input.externalConversationId : "",
      ...(input.connectionId ? { connection_id: input.connectionId } : {}),
      lead_id: input.leadId ?? null,
      state: "AI_ACTIVE",
      last_inbound_at: now.toISOString(),
      service_window_expires_at: serviceWindowExpiresAt,
      ...(input.attribution
        ? {
            attributed_campaign_id: input.attribution.campaignId,
            attribution_channel: input.attribution.channel,
            attribution_tracking_code: input.attribution.trackingCode,
            attribution_source_detail: input.attribution.sourceDetail,
            attribution_confidence: "HIGH",
            attribution_captured_at: now.toISOString(),
          }
        : {}),
    })
    .select("*")
    .single();
  if (error) {
    // Two first messages from a new customer can arrive together: both selects miss, one insert wins, the other hits the
    // (agency, channel, external id) unique key. That is not a failure — the conversation exists now — so take the
    // existing-row path once instead of answering 500 and waiting for Meta's retry. The caller is told it lost the race.
    if ((error as { code?: string }).code === "23505" && !retriedAfterRace) {
      input.onLostCreateRace?.();
      return upsertConversationForInbound(db, input, true);
    }
    throw new WhatsAppPersistenceError("conversations", "insert", error);
  }
  return data as ConversationRow;
}

/**
 * A message a person typed outside the CRM — in the WhatsApp Business app (coexistence echo) or in a Messenger
 * Page inbox. The conversation is created if the customer was never seen here and handed to a person, so the
 * assistant never answers over a colleague; the customer's next message still reaches staff. `waId` is the
 * customer's id on the channel (a phone number on WhatsApp, a PSID on Messenger).
 */
export async function markConversationHandledFromBusinessApp(
  db: Db,
  input: { agencyId: string; waId: string; contactName: string; channel?: ChannelProvider; connectionId?: string | null },
): Promise<ConversationRow> {
  const channel = input.channel ?? "WHATSAPP";
  const now = new Date().toISOString();
  const { data: existing, error: selectError } = await db
    .from("conversations")
    .select("*")
    .eq("agency_id", input.agencyId)
    .eq("channel", channel)
    .eq("external_conversation_id", input.waId)
    .maybeSingle();
  if (selectError) throw new WhatsAppPersistenceError("conversations", "select", selectError);

  if (existing) {
    const { data, error } = await db
      .from("conversations")
      .update({ state: "HUMAN_ACTIVE", last_outbound_at: now })
      .eq("id", (existing as ConversationRow).id)
      .select("*")
      .single();
    if (error) throw new WhatsAppPersistenceError("conversations", "update", error);
    return data as ConversationRow;
  }

  const { data, error } = await db
    .from("conversations")
    .insert({
      agency_id: input.agencyId,
      channel,
      external_conversation_id: input.waId,
      contact_name: input.contactName,
      contact_phone: channel === "WHATSAPP" ? input.waId : "",
      ...(input.connectionId ? { connection_id: input.connectionId } : {}),
      state: "HUMAN_ACTIVE",
      last_outbound_at: now,
    })
    .select("*")
    .single();
  if (error) throw new WhatsAppPersistenceError("conversations", "insert", error);
  return data as ConversationRow;
}

export async function getConversation(db: Db, conversationId: string): Promise<ConversationRow | null> {
  const { data, error } = await db.from("conversations").select("*").eq("id", conversationId).maybeSingle();
  if (error) throw new WhatsAppPersistenceError("conversations", "select", error);
  return (data as ConversationRow | null) ?? null;
}

/**
 * True when a message with this provider id is already stored for the agency — the cheap "seen it" check.
 * With `includePartIds`, a reply that was sent in several parts also counts when the id is any of its parts
 * (recorded in `metadata.part_mids`): needed for echoes, since every part echoes with its own id.
 */
export async function messageExistsByExternalId(
  db: Db,
  agencyId: string,
  externalMessageId: string,
  options: { includePartIds?: boolean } = {},
): Promise<boolean> {
  const { data, error } = await db
    .from("conversation_messages")
    .select("id")
    .eq("agency_id", agencyId)
    .eq("external_message_id", externalMessageId)
    .limit(1);
  if (error) throw new WhatsAppPersistenceError("conversation_messages", "select", error);
  if ((data ?? []).length > 0) return true;
  if (!options.includePartIds) return false;

  const { data: parts, error: partsError } = await db
    .from("conversation_messages")
    .select("id")
    .eq("agency_id", agencyId)
    .contains("metadata", { part_mids: [externalMessageId] })
    .limit(1);
  if (partsError) throw new WhatsAppPersistenceError("conversation_messages", "select", partsError);
  return (parts ?? []).length > 0;
}

/** The stored display name of a thread, or null when the thread does not exist yet. */
export async function getConversationContactName(
  db: Db,
  agencyId: string,
  channel: ChannelProvider,
  externalConversationId: string,
): Promise<string | null> {
  const { data, error } = await db
    .from("conversations")
    .select("contact_name")
    .eq("agency_id", agencyId)
    .eq("channel", channel)
    .eq("external_conversation_id", externalConversationId)
    .maybeSingle();
  if (error) throw new WhatsAppPersistenceError("conversations", "select", error);
  return data ? ((data as { contact_name: string | null }).contact_name ?? "") : null;
}

/**
 * Marks the business's own messages in a thread as read, up to the customer's read watermark (a channel that
 * reports reads by time rather than per message). Only ever moves SENT/DELIVERED forward.
 */
export async function markOutboundMessagesReadUpTo(
  db: Db,
  input: { agencyId: string; channel: ChannelProvider; externalConversationId: string; upToMs: number },
): Promise<void> {
  const { data: conversation, error: selectError } = await db
    .from("conversations")
    .select("id")
    .eq("agency_id", input.agencyId)
    .eq("channel", input.channel)
    .eq("external_conversation_id", input.externalConversationId)
    .maybeSingle();
  if (selectError) throw new WhatsAppPersistenceError("conversations", "select", selectError);
  if (!conversation) return;

  const { error } = await db
    .from("conversation_messages")
    .update({ delivery_status: "READ" })
    .eq("agency_id", input.agencyId)
    .eq("conversation_id", (conversation as { id: string }).id)
    .in("actor_kind", ["AI", "STAFF"])
    .in("delivery_status", ["SENT", "DELIVERED"])
    .lte("created_at", new Date(input.upToMs).toISOString());
  if (error) throw new WhatsAppPersistenceError("conversation_messages", "update", error);
}

export async function setConversationState(
  db: Db,
  conversationId: string,
  state: ConversationState,
  patch: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await db.from("conversations").update({ state, ...patch }).eq("id", conversationId);
  if (error) throw new WhatsAppPersistenceError("conversations", "update", error);
}

/* ── Messages ─────────────────────────────────────────────────────────────── */

/** Idempotent on `external_message_id` — a Meta redelivery inserts nothing twice (F8). */
export async function insertMessage(
  db: Db,
  input: {
    agencyId: string;
    conversationId: string;
    externalMessageId?: string | null;
    role: MessageRole;
    actorKind: MessageActorKind;
    actorId?: string | null;
    actorName?: string | null;
    content: string;
    messageType?: MessageType;
    mediaPath?: string | null;
    deliveryStatus?: DeliveryStatus;
    metadata?: Record<string, unknown>;
  },
): Promise<ConversationMessageRow | null> {
  const { data, error } = await db
    .from("conversation_messages")
    .insert({
      agency_id: input.agencyId,
      conversation_id: input.conversationId,
      external_message_id: input.externalMessageId ?? null,
      role: input.role,
      actor_kind: input.actorKind,
      actor_id: input.actorId ?? null,
      actor_name_snapshot: input.actorName ?? null,
      content: input.content,
      message_type: input.messageType ?? "TEXT",
      media_path: input.mediaPath ?? null,
      delivery_status: input.deliveryStatus ?? "PENDING",
      metadata: input.metadata ?? {},
    })
    .select("*")
    .single();

  if (!error) return data as ConversationMessageRow;
  if ((error as { code?: string }).code === "23505") return null; // duplicate delivery — F8
  throw new WhatsAppPersistenceError("conversation_messages", "insert", error);
}

/** What the atomic inbound write reports back — the canonical identifiers, never a guess. */
export interface AtomicInboundResult {
  messageId: string;
  sequenceNumber: number | null;
  /** True when this provider message id was already stored: nothing was created. */
  duplicate: boolean;
  /** The legacy agent job queued in the same transaction, or null when none was requested / for a duplicate. */
  agentJobId: string | null;
  /** The coalesced REALTIME ENRICH job queued in the same transaction, or null for a duplicate. */
  enrichJobId: string | null;
}

/**
 * Stores an inbound customer message together with its required jobs in ONE database transaction
 * (`ingest_inbound_message_atomic`, docs/inbox/scaling.md §9). A message can no longer commit without its agent and
 * enrichment jobs, and a provider retry of a committed message is reported as a duplicate with its canonical ids.
 * Throws on any failure (retryable by the provider): the transaction committed nothing.
 */
export async function persistInboundMessageAtomic(
  db: Db,
  input: {
    agencyId: string;
    conversationId: string;
    externalMessageId: string;
    content: string;
    messageType: MessageType;
    metadata: Record<string, unknown>;
    /** Null when no agent turn should run (a person owns the thread, or the assistant is off). */
    agentJobKind: "PROCESS_INBOUND" | "TRANSCRIBE_AUDIO" | null;
    /** Seconds the enrichment waits so a burst reads as one turn; 0 for a first contact. */
    enrichDelaySeconds: number;
  },
): Promise<AtomicInboundResult> {
  const { data, error } = await db.rpc("ingest_inbound_message_atomic", {
    p_agency_id: input.agencyId,
    p_conversation_id: input.conversationId,
    p_external_message_id: input.externalMessageId,
    p_content: input.content,
    p_message_type: input.messageType,
    p_metadata: input.metadata,
    p_agent_job_kind: input.agentJobKind,
    p_enrich_delay_seconds: input.enrichDelaySeconds,
  });
  if (error) throw new WhatsAppPersistenceError("conversation_messages", "ingest", new Error(error.message));
  const row = (Array.isArray(data) ? data[0] : data) as
    | { message_id: string; sequence_number: number | string | null; is_duplicate: boolean; agent_job_id: string | null; enrich_job_id: string | null }
    | null
    | undefined;
  if (!row?.message_id) throw new WhatsAppPersistenceError("conversation_messages", "ingest", new Error("atomic ingest returned no message"));
  return {
    messageId: row.message_id,
    sequenceNumber: row.sequence_number === null || row.sequence_number === undefined ? null : Number(row.sequence_number),
    duplicate: row.is_duplicate,
    agentJobId: row.agent_job_id,
    enrichJobId: row.enrich_job_id,
  };
}

/**
 * The most recent `limit` messages of a conversation, oldest first. Selecting newest-first and reversing
 * matters: ascending order with a limit returns the OLDEST rows, so once a conversation passed `limit`
 * messages the assistant only ever saw its first ones, never the customer's latest, and answered every
 * message as if it were the opening greeting.
 */
export async function listMessages(db: Db, conversationId: string, limit = 50): Promise<ConversationMessageRow[]> {
  const { data, error } = await db
    .from("conversation_messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new WhatsAppPersistenceError("conversation_messages", "select", error);
  return ((data ?? []) as ConversationMessageRow[]).reverse();
}

/* ── Job queue (D5) ───────────────────────────────────────────────────────── */

export async function enqueueJob(
  db: Db,
  input: { agencyId: string; kind: AgentJobKind; payload: Record<string, unknown>; runAfter?: Date },
): Promise<string> {
  const { data, error } = await db
    .from("agent_jobs")
    .insert({
      agency_id: input.agencyId,
      kind: input.kind,
      payload: input.payload,
      run_after: (input.runAfter ?? new Date()).toISOString(),
    })
    .select("id")
    .single();
  if (error) throw new WhatsAppPersistenceError("agent_jobs", "insert", error);
  return (data as { id: string }).id;
}

/**
 * Claims up to `limit` due jobs with `FOR UPDATE SKIP LOCKED`, so concurrent
 * cron invocations (a slow drain overlapping the next tick) never process
 * the same job twice. Requires the `claim_agent_jobs` SQL function —
 * PostgREST has no client-side `SKIP LOCKED`, so the claim itself has to be
 * a stored procedure. See §6.3 of the plan.
 */
export async function claimJobs(db: Db, workerId: string, limit: number): Promise<AgentJobRow[]> {
  const { data, error } = await db.rpc("claim_agent_jobs", { p_worker_id: workerId, p_limit: limit });
  if (error) throw new WhatsAppPersistenceError("agent_jobs", "claim", error);
  return (data ?? []) as AgentJobRow[];
}

export async function completeJob(db: Db, jobId: string): Promise<void> {
  const { error } = await db.from("agent_jobs").update({ status: "DONE", locked_at: null, locked_by: null }).eq("id", jobId);
  if (error) throw new WhatsAppPersistenceError("agent_jobs", "update", error);
}

/** Increments attempts and moves to DEAD once max_attempts is reached; otherwise re-queues. */
export async function failJob(db: Db, job: AgentJobRow, errorMessage: string): Promise<void> {
  const attempts = job.attempts + 1;
  const status = attempts >= job.max_attempts ? "DEAD" : "QUEUED";
  const { error } = await db
    .from("agent_jobs")
    .update({
      status,
      attempts,
      last_error: errorMessage.slice(0, 2000),
      locked_at: null,
      locked_by: null,
      // Backoff before the next attempt: 30s, 2min, 8min…
      run_after: new Date(Date.now() + 30_000 * 4 ** attempts).toISOString(),
    })
    .eq("id", job.id);
  if (error) throw new WhatsAppPersistenceError("agent_jobs", "update", error);
}

/** Releases jobs a crashed worker never completed, so they can be re-claimed. */
/**
 * Hands back jobs this worker claimed but did not reach before its time budget ran out. `claim_agent_jobs` marks a
 * whole batch RUNNING up front; without this, whatever the loop did not get to stayed locked until the stale-lock
 * sweep, so a customer waited minutes for a reply that was ready to run. No attempt is spent: `claim_agent_jobs` does
 * not count one, and these jobs never ran. Guarded by `locked_by`, so it can never release another worker's job.
 */
export async function releaseClaimedJobs(db: Db, workerId: string, jobIds: string[]): Promise<void> {
  if (jobIds.length === 0) return;
  const { error } = await db
    .from("agent_jobs")
    .update({ status: "QUEUED", locked_at: null, locked_by: null })
    .in("id", jobIds)
    .eq("status", "RUNNING")
    .eq("locked_by", workerId);
  if (error) throw new WhatsAppPersistenceError("agent_jobs", "release_claimed", error);
}

export async function releaseStaleLocks(db: Db, olderThanMs = 5 * 60_000): Promise<void> {
  const { error } = await db
    .from("agent_jobs")
    .update({ status: "QUEUED", locked_at: null, locked_by: null })
    .eq("status", "RUNNING")
    .lt("locked_at", new Date(Date.now() - olderThanMs).toISOString());
  if (error) throw new WhatsAppPersistenceError("agent_jobs", "release_stale_locks", error);
}
