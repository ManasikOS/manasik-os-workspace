/**
 * Data access for the provider-neutral `channel_connections` and `channel_webhook_events` tables, used by
 * the Messenger and Instagram webhooks. Service-role client only, and — as in whatsapp-repository.ts —
 * every query is scoped by hand because the admin client bypasses RLS.
 */

import "server-only";

import type { ChannelProvider } from "@/lib/inbox/contracts";
import type { Db } from "@/lib/data/whatsapp-repository";

/**
 * What may be said about a database failure in an error message, and so in a log: its code and message, never the
 * rest of Postgres's answer. A failed insert's `details` can quote the row that was being written — for a webhook
 * event that is the raw delivery, a customer's message — and must not reach the logs.
 */
export function describePersistenceCause(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === "object" && cause !== null) {
    const { code, message } = cause as { code?: unknown; message?: unknown };
    const parts = [typeof code === "string" ? `[${code}]` : null, typeof message === "string" ? message : null].filter(Boolean);
    if (parts.length > 0) return parts.join(" ");
  }
  return "unknown database error";
}

export class ChannelPersistenceError extends Error {
  constructor(table: string, op: string, cause: unknown) {
    super(`channel.${table}.${op} failed: ${describePersistenceCause(cause)}`);
    this.name = "ChannelPersistenceError";
  }
}

export interface ChannelConnectionRecord {
  id: string;
  agency_id: string;
  provider: ChannelProvider;
  provider_account_id: string | null;
  display_name: string;
  status: string;
  credential_ref: string | null;
  ai_enabled: boolean;
  credential_expires_at: string | null;
  /** Never a secret. For Instagram it says which connect method made the row (`connect_method`), and so which Graph host its token belongs to. */
  provider_metadata?: Record<string, unknown> | null;
}

const CONNECTION_COLUMNS = "id, agency_id, provider, provider_account_id, display_name, status, credential_ref, ai_enabled, credential_expires_at, provider_metadata";

/**
 * The tenant gate for Messenger/Instagram: the Page / account id in a webhook resolves to exactly one
 * connection (a unique index guarantees it) or to nothing, in which case the caller records the event and
 * drops it. A DISCONNECTED or ERROR connection is not resolved — inbound for it is dropped rather than
 * being attributed to an agency that has revoked the connection.
 */
export async function resolveConnectionByAccountId(
  db: Db,
  provider: ChannelProvider,
  accountId: string,
): Promise<ChannelConnectionRecord | null> {
  const { data, error } = await db
    .from("channel_connections")
    .select(CONNECTION_COLUMNS)
    .eq("provider", provider)
    .eq("provider_account_id", accountId)
    .in("status", ["CONNECTED", "DEGRADED"])
    .maybeSingle();
  if (error) throw new ChannelPersistenceError("channel_connections", "select", error);
  return (data as ChannelConnectionRecord | null) ?? null;
}

export async function touchConnectionInbound(db: Db, connectionId: string, agencyId: string): Promise<void> {
  const { error } = await db
    .from("channel_connections")
    .update({ last_inbound_at: new Date().toISOString() })
    .eq("id", connectionId)
    .eq("agency_id", agencyId);
  if (error) throw new ChannelPersistenceError("channel_connections", "update", error);
}

/**
 * Appends the raw delivery to the audit floor. Returns false when a byte-identical delivery was already
 * recorded. Callers do NOT skip processing on false: a redelivery after a partial failure is exactly when
 * the un-processed remainder must still run, and message-level idempotency (external_message_id) already
 * prevents any duplicate effect.
 */
export async function recordChannelWebhookEvent(
  db: Db,
  input: {
    provider: "MESSENGER" | "INSTAGRAM";
    agencyId: string | null;
    connectionId: string | null;
    externalEventId: string;
    payload: unknown;
    signatureValid: boolean;
  },
): Promise<boolean> {
  const { error } = await db.from("channel_webhook_events").insert({
    provider: input.provider,
    agency_id: input.agencyId,
    connection_id: input.connectionId,
    external_event_id: input.externalEventId,
    payload: input.payload,
    signature_valid: input.signatureValid,
  });
  if (!error) return true;
  if ((error as { code?: string }).code === "23505") return false;
  throw new ChannelPersistenceError("channel_webhook_events", "insert", error);
}

/** Whether the agency has its assistant switched on (`ai_settings.enabled`) — the master switch new channels honour. */
export async function isAgencyAssistantEnabled(db: Db, agencyId: string): Promise<boolean> {
  const { data, error } = await db.from("ai_settings").select("enabled").eq("agency_id", agencyId).maybeSingle();
  if (error) throw new ChannelPersistenceError("ai_settings", "select", error);
  return Boolean((data as { enabled: boolean } | null)?.enabled);
}

/* ── Connect / disconnect ─────────────────────────────────────────────────── */

/** Another agency's live connection to this Page/account, if any — checked before touching Meta so the message is clear. */
export async function findConnectionOwnedByAnotherAgency(
  db: Db,
  provider: ChannelProvider,
  accountId: string,
  agencyId: string,
): Promise<boolean> {
  const { data, error } = await db
    .from("channel_connections")
    .select("id")
    .eq("provider", provider)
    .eq("provider_account_id", accountId)
    .neq("status", "DISCONNECTED")
    .neq("agency_id", agencyId)
    .limit(1);
  if (error) throw new ChannelPersistenceError("channel_connections", "select", error);
  return (data ?? []).length > 0;
}

/** The agency's live connection for a provider (any Page/account), or null. */
export async function getActiveConnectionForAgency(db: Db, agencyId: string, provider: ChannelProvider): Promise<ChannelConnectionRecord | null> {
  const { data, error } = await db
    .from("channel_connections")
    .select(CONNECTION_COLUMNS)
    .eq("agency_id", agencyId)
    .eq("provider", provider)
    .neq("status", "DISCONNECTED")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new ChannelPersistenceError("channel_connections", "select", error);
  return (data as ChannelConnectionRecord | null) ?? null;
}

export interface SaveChannelConnectionInput {
  agencyId: string;
  provider: ChannelProvider;
  accountId: string;
  displayName: string;
  credentialRef: string;
  credentialExpiresAt?: string | null;
  metadata?: Record<string, unknown>;
}

export type SaveChannelConnectionResult =
  | { ok: true; id: string; previousCredentialRef: string | null }
  | { ok: false; reason: "ALREADY_CONNECTED_ELSEWHERE" | "DATABASE"; message: string };

/**
 * Creates the connection, or reconnects the agency's existing row for the same Page/account (keeping its
 * conversations and its `ai_enabled` choice). A new connection starts with the assistant OFF. Done as
 * select-then-write because the uniqueness is a partial index, which an upsert cannot target. The global
 * unique index is the backstop: a second agency claiming a live Page fails with 23505 and is reported plainly.
 */
export async function saveChannelConnection(db: Db, input: SaveChannelConnectionInput): Promise<SaveChannelConnectionResult> {
  const { data: existing, error: selectError } = await db
    .from("channel_connections")
    .select("id, credential_ref")
    .eq("agency_id", input.agencyId)
    .eq("provider", input.provider)
    .eq("provider_account_id", input.accountId)
    .maybeSingle();
  if (selectError) return { ok: false, reason: "DATABASE", message: selectError.message };

  const fields = {
    display_name: input.displayName,
    status: "CONNECTED",
    credential_ref: input.credentialRef,
    credential_expires_at: input.credentialExpiresAt ?? null,
    provider_metadata: input.metadata ?? {},
    last_error: null,
    health_checked_at: new Date().toISOString(),
  };

  const write = existing
    ? await db.from("channel_connections").update(fields).eq("id", (existing as { id: string }).id).eq("agency_id", input.agencyId).select("id").single()
    : await db
        .from("channel_connections")
        .insert({ ...fields, agency_id: input.agencyId, provider: input.provider, provider_account_id: input.accountId, ai_enabled: false })
        .select("id")
        .single();

  if (write.error) {
    if ((write.error as { code?: string }).code === "23505") {
      return { ok: false, reason: "ALREADY_CONNECTED_ELSEWHERE", message: "This account is already connected to another agency." };
    }
    return { ok: false, reason: "DATABASE", message: write.error.message };
  }
  return {
    ok: true,
    id: (write.data as { id: string }).id,
    previousCredentialRef: existing ? ((existing as { credential_ref: string | null }).credential_ref ?? null) : null,
  };
}

export async function markConnectionDisconnected(db: Db, connectionId: string, agencyId: string): Promise<void> {
  const { error } = await db
    .from("channel_connections")
    .update({ status: "DISCONNECTED", credential_ref: null, credential_expires_at: null, ai_enabled: false, last_error: null })
    .eq("id", connectionId)
    .eq("agency_id", agencyId);
  if (error) throw new ChannelPersistenceError("channel_connections", "update", error);
}

export async function setConnectionAiEnabled(db: Db, connectionId: string, agencyId: string, enabled: boolean): Promise<void> {
  const { error } = await db.from("channel_connections").update({ ai_enabled: enabled }).eq("id", connectionId).eq("agency_id", agencyId);
  if (error) throw new ChannelPersistenceError("channel_connections", "update", error);
}
