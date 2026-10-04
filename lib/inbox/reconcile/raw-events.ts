/**
 * Raw-event reconciler (I2). Repairs a webhook delivery whose messages never landed.
 *
 * The webhook stores the raw delivery first, then the messages. If the process dies between the two, or Meta stops retrying, the
 * customer's message is in `whatsapp_webhook_events` / `channel_webhook_events` but not in the Inbox. This looks at deliveries that
 * hold messages, once they are old enough that a live request cannot still be working on them, checks each message is stored, and
 * replays the missing ones through the same idempotent ingest the webhook uses. An event is stamped `processed_at` once every
 * message in it is accounted for, so it is examined once.
 *
 * It replays messages only: never the unsupported-media notice, delivery ticks, echoes or account changes, and it never messages a
 * customer. Ingest is keyed on the message id, so a replay racing the live path stores the message once.
 *
 * Errors written to the event are a message, never the payload. Logs carry counts only.
 */

import "server-only";

import { parseMessengerWebhook, type MessengerWebhookPayload, type PageMessagingChannel } from "@/lib/channels/messenger/webhook";
import { processMessengerEvents } from "@/lib/channels/messenger/process-events";
import {
  isAgencyAssistantEnabled,
  resolveConnectionByAccountId,
  type ChannelConnectionRecord,
} from "@/lib/data/channel-connection-repository";
import { resolveAgencyForPhoneNumberId } from "@/lib/data/whatsapp-repository";
import type { Db } from "@/lib/ai/db";
import type { WhatsAppWebhookPayload } from "@/lib/types/whatsapp";
import { ingestWhatsAppInboundMessages, storableInboundMessageIds } from "@/lib/whatsapp/inbound-ingest";

export interface ReconcileOptions {
  /** A delivery younger than this may still be in flight on the live path. */
  minAgeMs?: number;
  /** Older than this is left alone (and later removed by retention). */
  maxAgeMs?: number;
  batchSize?: number;
}

export interface ReconcileResult {
  /** Deliveries examined. */
  checked: number;
  /** Deliveries whose messages were all already stored. */
  landed: number;
  /** Deliveries whose missing messages were replayed. */
  replayed: number;
  /** Deliveries that could not be replayed; they stay eligible until they age out. */
  failed: number;
}

export interface ReconcileDeps {
  ingestWhatsApp: typeof ingestWhatsAppInboundMessages;
  processMessenger: typeof processMessengerEvents;
  resolveIntegration: typeof resolveAgencyForPhoneNumberId;
  resolveConnection: typeof resolveConnectionByAccountId;
  isAssistantOn: typeof isAgencyAssistantEnabled;
}

const defaultDeps: ReconcileDeps = {
  ingestWhatsApp: ingestWhatsAppInboundMessages,
  processMessenger: processMessengerEvents,
  resolveIntegration: resolveAgencyForPhoneNumberId,
  resolveConnection: resolveConnectionByAccountId,
  isAssistantOn: isAgencyAssistantEnabled,
};

interface RawEventRow {
  id: string;
  provider: string;
  agency_id: string;
  payload: unknown;
  error: string | null;
}

const LOOKUP_CHUNK = 100;

/** Which of these external message ids are already stored for the agency. */
async function storedMessageIds(db: Db, agencyId: string, ids: string[]): Promise<Set<string>> {
  const stored = new Set<string>();
  for (let i = 0; i < ids.length; i += LOOKUP_CHUNK) {
    const { data, error } = await db
      .from("conversation_messages")
      .select("external_message_id")
      .eq("agency_id", agencyId)
      .in("external_message_id", ids.slice(i, i + LOOKUP_CHUNK));
    if (error) throw new Error(`message lookup failed: ${error.message}`);
    for (const row of (data ?? []) as Array<{ external_message_id: string }>) stored.add(row.external_message_id);
  }
  return stored;
}

function errorText(cause: unknown): string {
  return `reconcile: ${cause instanceof Error ? cause.message : "unknown error"}`.slice(0, 300);
}

function phoneNumberIdOf(payload: WhatsAppWebhookPayload): string | null {
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const id = change.value?.metadata?.phone_number_id;
      if (id) return id;
    }
  }
  return null;
}

/** Message events Messenger/Instagram ingest actually stores (video is refused, not stored). */
function isStorableMessengerMessage(event: { kind: string; contentKind?: string; attachments?: Array<{ type?: string }> }): boolean {
  if (event.kind !== "message") return false;
  return !(event.contentKind === "video" || (event.attachments ?? []).some((attachment) => attachment.type === "video"));
}

async function reconcileWhatsApp(db: Db, rows: RawEventRow[], deps: ReconcileDeps): Promise<{ result: ReconcileResult; done: string[]; failed: Array<{ id: string; error: string }> }> {
  const result: ReconcileResult = { checked: rows.length, landed: 0, replayed: 0, failed: 0 };
  const done: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];

  const idsByRow = new Map<string, string[]>();
  const idsByAgency = new Map<string, Set<string>>();
  for (const row of rows) {
    const ids = storableInboundMessageIds(row.payload as WhatsAppWebhookPayload);
    idsByRow.set(row.id, ids);
    if (ids.length === 0) continue;
    const set = idsByAgency.get(row.agency_id) ?? new Set<string>();
    ids.forEach((id) => set.add(id));
    idsByAgency.set(row.agency_id, set);
  }
  const stored = new Map<string, Set<string>>();
  for (const [agencyId, ids] of idsByAgency) stored.set(agencyId, await storedMessageIds(db, agencyId, [...ids]));

  for (const row of rows) {
    const ids = idsByRow.get(row.id) ?? [];
    const have = stored.get(row.agency_id);
    if (ids.every((id) => have?.has(id))) {
      result.landed += 1;
      done.push(row.id);
      continue;
    }
    try {
      const payload = row.payload as WhatsAppWebhookPayload;
      const phoneNumberId = phoneNumberIdOf(payload);
      const integration = phoneNumberId ? await deps.resolveIntegration(db, phoneNumberId) : null;
      // The tenant gate again: replay only into the agency the event was recorded for, and only while the number is connected.
      if (!integration || integration.agency_id !== row.agency_id) throw new Error("the number is not connected to this agency");
      await deps.ingestWhatsApp(db, integration.agency_id, payload);
      result.replayed += 1;
      done.push(row.id);
    } catch (cause) {
      result.failed += 1;
      failed.push({ id: row.id, error: errorText(cause) });
    }
  }
  return { result, done, failed };
}

async function reconcileChannel(db: Db, rows: RawEventRow[], deps: ReconcileDeps): Promise<{ result: ReconcileResult; done: string[]; failed: Array<{ id: string; error: string }> }> {
  const result: ReconcileResult = { checked: rows.length, landed: 0, replayed: 0, failed: 0 };
  const done: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];

  const parsedByRow = new Map<string, ReturnType<typeof parseMessengerWebhook>>();
  const idsByAgency = new Map<string, Set<string>>();
  for (const row of rows) {
    const channel = row.provider as PageMessagingChannel;
    const events = parseMessengerWebhook(row.payload as MessengerWebhookPayload, channel);
    parsedByRow.set(row.id, events);
    for (const event of events ?? []) {
      if (!isStorableMessengerMessage(event) || event.kind !== "message") continue;
      const set = idsByAgency.get(row.agency_id) ?? new Set<string>();
      set.add(event.mid);
      idsByAgency.set(row.agency_id, set);
    }
  }
  const stored = new Map<string, Set<string>>();
  for (const [agencyId, ids] of idsByAgency) stored.set(agencyId, await storedMessageIds(db, agencyId, [...ids]));

  for (const row of rows) {
    const channel = row.provider as PageMessagingChannel;
    const have = stored.get(row.agency_id);
    const missing = (parsedByRow.get(row.id) ?? []).filter(
      (event) => event.kind === "message" && isStorableMessengerMessage(event) && !have?.has(event.mid),
    );
    if (missing.length === 0) {
      result.landed += 1;
      done.push(row.id);
      continue;
    }
    try {
      const byPage = new Map<string, typeof missing>();
      for (const event of missing) {
        if (event.kind !== "message") continue;
        byPage.set(event.pageId, [...(byPage.get(event.pageId) ?? []), event]);
      }
      for (const [pageId, events] of byPage) {
        const connection: ChannelConnectionRecord | null = await deps.resolveConnection(db, channel, pageId);
        if (!connection || connection.agency_id !== row.agency_id) throw new Error("the page is not connected to this agency");
        // Same fail-closed rule as the live path: the assistant answers only when the connection AND the agency have it on.
        const agentAllowed = connection.ai_enabled && (await deps.isAssistantOn(db, connection.agency_id));
        await deps.processMessenger(db, connection, events, { agentAllowed, ownAppId: process.env.META_APP_ID, channel });
      }
      result.replayed += 1;
      done.push(row.id);
    } catch (cause) {
      result.failed += 1;
      failed.push({ id: row.id, error: errorText(cause) });
    }
  }
  return { result, done, failed };
}

async function findRows(db: Db, source: "WHATSAPP" | "CHANNEL", minAgeMs: number, maxAgeMs: number, limit: number): Promise<RawEventRow[]> {
  const { data, error } = await db.rpc("find_unreconciled_raw_events", {
    p_source: source,
    p_min_age_seconds: Math.floor(minAgeMs / 1000),
    p_max_age_seconds: Math.floor(maxAgeMs / 1000),
    p_limit: limit,
  });
  if (error) throw new Error(`find_unreconciled_raw_events failed: ${error.message}`);
  return (data ?? []) as RawEventRow[];
}

async function mark(db: Db, source: "WHATSAPP" | "CHANNEL", ids: string[], error: string | null): Promise<void> {
  if (ids.length === 0) return;
  const { error: markError } = await db.rpc("mark_raw_events_reconciled", { p_source: source, p_ids: ids, p_error: error });
  if (markError) throw new Error(`mark_raw_events_reconciled failed: ${markError.message}`);
}

export async function reconcileRawEvents(db: Db, options: ReconcileOptions = {}, deps: ReconcileDeps = defaultDeps): Promise<ReconcileResult> {
  const minAgeMs = options.minAgeMs ?? 120_000;
  const maxAgeMs = options.maxAgeMs ?? 6 * 60 * 60 * 1000;
  const limit = options.batchSize ?? 200;
  const total: ReconcileResult = { checked: 0, landed: 0, replayed: 0, failed: 0 };

  for (const source of ["WHATSAPP", "CHANNEL"] as const) {
    const rows = await findRows(db, source, minAgeMs, maxAgeMs, limit);
    if (rows.length === 0) continue;
    const outcome = source === "WHATSAPP" ? await reconcileWhatsApp(db, rows, deps) : await reconcileChannel(db, rows, deps);
    await mark(db, source, outcome.done, null);
    for (const failure of outcome.failed) await mark(db, source, [failure.id], failure.error);
    total.checked += outcome.result.checked;
    total.landed += outcome.result.landed;
    total.replayed += outcome.result.replayed;
    total.failed += outcome.result.failed;
  }
  return total;
}

/**
 * Wraps a pass so the worker's loop (which polls every second) runs it at most once per `everyMs`. In between it reports nothing
 * processed, so the loop idles.
 */
export function everyMs<T extends { processed: number; failed: number }>(
  intervalMs: number,
  run: () => Promise<T>,
  now: () => number = Date.now,
): () => Promise<{ processed: number; failed: number }> {
  let last = Number.NEGATIVE_INFINITY;
  return async () => {
    if (now() - last < intervalMs) return { processed: 0, failed: 0 };
    last = now();
    const result = await run();
    return { processed: result.processed, failed: result.failed };
  };
}
