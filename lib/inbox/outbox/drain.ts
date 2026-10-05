import "server-only";

import { assertSendMatchesAdapter, getChannelAdapterForAgency } from "@/lib/inbox/simulator/adapter-for-agency";
import type { ChannelProvider } from "@/lib/inbox/contracts";
import { createAdminClient } from "@/utils/supabase/admin";
import { recordAutomatedSendDecision, type AutomatedReplySource } from "@/lib/inbox/autonomy/runtime";
import { authorizeProviderSend, type ProviderSendAuthor } from "@/lib/inbox/outbound/authorize-provider-send";
import { outboundGateText } from "@/lib/inbox/risk/outbound-gate-text";
import { channelAcceptsAttachment, isStagedPathFor } from "@/lib/inbox/attachments/staff-attachment";

const ATTACHMENT_BUCKET = "inbox-attachments";
/** Long enough for Meta to fetch the file once, short enough that the URL is worthless afterwards. */
const MEDIA_URL_SECONDS = 600;

/**
 * A failure no retry can fix: the same facts would give the same answer. The row is dead-lettered on the spot, so staff see the
 * failure at once and, for an automated reply, the refusal is audited once (promotion evidence counts those rows).
 */
class PermanentOutboxFailure extends Error {}

type OutboxRow = {
  id: string;
  agency_id: string;
  connection_id: string;
  conversation_id: string;
  message_id: string;
  attempts: number;
  max_attempts: number;
  command: {
    content?: Array<{ type?: string; text?: string; kind?: string; storage_path?: string; filename?: string }>;
    /** Email only (docs/inbox/email-channel-implementation-plan.md, Phase 3) — absent on every other channel's command. */
    subject?: string | null;
    cc?: string[] | null;
    bcc?: string[] | null;
  };
};

/**
 * Claims provider-neutral outbox rows. Provider selection happens solely at
 * this boundary, so webhooks, the Inbox UI, and CRM workflows never import a
 * provider SDK. WhatsApp is the first registered adapter; other providers are
 * deliberately retried/dead-lettered instead of silently pretending to send.
 */
export async function processDueInboxOutbox(options: { budgetMs: number }) {
  const db = createAdminClient();
  const workerId = `inbox-${process.env.VERCEL_REGION ?? "local"}-${process.pid}-${Date.now()}`;
  const deadline = Date.now() + options.budgetMs;
  let processed = 0;
  let failed = 0;

  while (Date.now() < deadline) {
    const { data, error } = await db.rpc("claim_outbox_messages", { p_worker_id: workerId, p_limit: 10 });
    if (error) throw new Error(`Unable to claim Inbox outbox: ${error.message}`);
    const rows = (data ?? []) as OutboxRow[];
    if (rows.length === 0) break;

    for (const [index, row] of rows.entries()) {
      if (Date.now() >= deadline) {
        // Claimed but not reached: hand the rest straight back (refunding the attempt the claim counted) instead of leaving
        // staff messages RUNNING until the stale-lock sweep.
        await releaseUnreachedOutboxRows(db, workerId, rows.slice(index)).catch((error) =>
          console.error("Could not hand back unprocessed outbox rows:", error instanceof Error ? error.message : error),
        );
        break;
      }
      try {
        await deliverRow(db, row);
        processed++;
      } catch (error) {
        failed++;
        await rescheduleOrDeadLetter(db, row, error instanceof Error ? error.message : String(error), error instanceof PermanentOutboxFailure);
      }
    }
  }

  return { processed, failed };
}

async function deliverRow(db: ReturnType<typeof createAdminClient>, row: OutboxRow) {
  const [{ data: connection }, { data: conversation }, { data: message }] = await Promise.all([
    db
      .from("channel_connections")
      .select("provider")
      .eq("id", row.connection_id)
      .eq("agency_id", row.agency_id)
      .single(),
    db
      .from("conversations")
      .select("external_conversation_id")
      .eq("id", row.conversation_id)
      .eq("agency_id", row.agency_id)
      .single(),
    db.from("conversation_messages").select("actor_kind,actor_id,metadata").eq("id", row.message_id).eq("agency_id", row.agency_id).single(),
  ]);
  if (!connection || !conversation || !message) throw new Error("Outbox connection, conversation or message is no longer available.");

  // Throws "No adapter is installed for X." for a provider without one — treated as permanent below.
  const adapter = await getChannelAdapterForAgency(db, row.agency_id, connection.provider as ChannelProvider);
  const channelName = adapter.profile.displayName;

  const resolved = await adapter.resolveConnectionForChannelConnection(db, row.agency_id, row.connection_id);
  if (!resolved) throw new Error(`${channelName} connection is missing its integration link.`);
  if (!resolved.accountId || !resolved.credentialRef || resolved.status !== "CONNECTED") {
    throw new Error(`${channelName} is not connected for this agency.`);
  }

  const caption = row.command.content?.find((part) => part.type === "text")?.text;
  const mediaPart = row.command.content?.find((part) => part.type === "media");
  // A file may go without a caption; a text message may not go without text.
  const text = caption ?? "";
  if (!mediaPart && !text) throw new Error("Outbox command has no text content.");
  let source: AutomatedReplySource | null = null;
  let author: ProviderSendAuthor;
  if (message.actor_kind === "AI") {
    const metadata = (message.metadata ?? {}) as Record<string, unknown>;
    const declaredSource = String(metadata.autonomy_source ?? "GENERATED");
    source = ["APPROVED_TEMPLATE", "APPROVED_ANSWER", "INTAKE_FLOW", "GENERATED"].includes(declaredSource)
      ? declaredSource as AutomatedReplySource
      : "GENERATED";
    const declaredAction = String(metadata.autonomy_action ?? "OTHER");
    const action = ["ACKNOWLEDGEMENT", "QUALIFYING_QUESTION", "APPROVED_FAQ", "OTHER"].includes(declaredAction)
      ? declaredAction as "ACKNOWLEDGEMENT" | "QUALIFYING_QUESTION" | "APPROVED_FAQ" | "OTHER"
      : "OTHER";
    author = { kind: "AI", source, action };
  } else if (message.actor_kind === "STAFF" && message.actor_id) author = { kind: "STAFF", actorId: String(message.actor_id) };
  else throw new Error("Outbox message has no supported author.");
  const token = await adapter.readToken(db, resolved);
  if (!token) throw new Error(`Could not read the ${channelName} access token.`);
  // A file is checked and given a fresh signed URL BEFORE the final authorization, so nothing is read between that decision and the
  // send. The URL is not stored anywhere: it lives for this send and expires shortly after.
  let fileToSend: { kind: "image" | "document"; url: string; filename: string } | null = null;
  if (mediaPart) {
    const kind = mediaPart.kind === "image" ? "image" : mediaPart.kind === "document" ? "document" : null;
    const path = mediaPart.storage_path ?? "";
    if (!kind || !isStagedPathFor(path, row.agency_id, row.conversation_id)) throw new Error("The attachment is not valid for this conversation.");
    if (!adapter.sendMedia || !channelAcceptsAttachment(connection.provider as string, kind)) throw new Error(`${channelName} can't send this kind of file.`);
    const signed = await db.storage.from(ATTACHMENT_BUCKET).createSignedUrl(path, MEDIA_URL_SECONDS);
    if (signed.error || !signed.data?.signedUrl) throw new Error("The attachment could not be read from storage.");
    fileToSend = { kind, url: signed.data.signedUrl, filename: mediaPart.filename || "file" };
  }
  // The protection gate reads everything the customer will see: the email subject and the file name as well as the text.
  const gateText = outboundGateText({ subject: row.command.subject, body: text, filename: mediaPart && "filename" in mediaPart ? mediaPart.filename : null });
  const authorization = await authorizeProviderSend(db, { agencyId: row.agency_id, conversationId: row.conversation_id, text, gateText, author });
  if (!authorization.allowed) {
    if (source && authorization.automatedAuthorization) {
      await recordAutomatedSendDecision(db, { agencyId: row.agency_id, conversationId: row.conversation_id, messageId: row.message_id, authorization: authorization.automatedAuthorization, source, decision: "REFUSED" }).catch((cause) => console.error("Could not audit the refused outbox send:", cause));
    }
    // A refusal is a decision about this conversation's state (control, window, an open review, the autonomy level), not an outage.
    throw new PermanentOutboxFailure(`Inbox send refused: ${authorization.reasons.join(" ")}`);
  }

  // A test agency was given the in-memory simulator and a real agency the real adapter; both decisions came from the same flag,
  // and if it changed in between, nothing is sent.
  assertSendMatchesAdapter(authorization, adapter);

  // Email only: authorizeProviderSend's own command carries just { text, metaTag? } — subject/cc/bcc come straight
  // from the outbox row exactly as the composer/compose-new action enqueued them, unaffected by send policy.
  const emailFields = {
    ...(row.command.subject ? { subject: row.command.subject } : {}),
    ...(row.command.cc?.length ? { cc: row.command.cc } : {}),
    ...(row.command.bcc?.length ? { bcc: row.command.bcc } : {}),
  };

  let result: { externalMessageId: string; partMessageIds?: string[]; captionFailed?: boolean };
  try {
    if (fileToSend && adapter.sendMedia) {
      result = await adapter.sendMedia(resolved, token, {
        to: conversation.external_conversation_id as string,
        ...fileToSend,
        ...(text ? { caption: text } : {}),
        ...(authorization.command.metaTag ? { metaTag: authorization.command.metaTag } : {}),
        ...emailFields,
      });
    } else {
      result = await adapter.sendReply(resolved, token, { to: conversation.external_conversation_id as string, ...authorization.command, ...emailFields });
    }
  } catch (error) {
    // A dead token or unfunded account is reflected on the connection at once so the Inbox shows it; the
    // error is still rethrown so this outbox row retries or dead-letters as before.
    const errorClass = adapter.classifyError(error);
    if (errorClass === "TOKEN_DEAD" || errorClass === "UNFUNDED") {
      await adapter.reflectSendFailure(db, resolved, row.agency_id, errorClass, error);
    }
    throw error;
  }

  const now = new Date().toISOString();
  await Promise.all([
    db
      .from("conversation_messages")
      .update({
        external_message_id: result.externalMessageId,
        delivery_status: "SENT",
        // The file reached the customer but its separate caption did not: say so, rather than hide it or resend the file.
        ...(result.captionFailed ? { delivery_error: "The file was sent, but its caption was not." } : {}),
        // A split reply echoes once per part; recording every id keeps each echo recognisable as our own send.
        ...(result.partMessageIds && result.partMessageIds.length > 1 ? { metadata: { part_mids: result.partMessageIds } } : {}),
      })
      .eq("id", row.message_id)
      .eq("agency_id", row.agency_id),
    db.from("outbox_messages").update({ status: "SENT", provider_message_id: result.externalMessageId, locked_at: null, locked_by: null }).eq("id", row.id).eq("agency_id", row.agency_id),
    db.from("message_delivery_events").insert({ agency_id: row.agency_id, message_id: row.message_id, provider_event_id: result.externalMessageId, status: "SENT", occurred_at: now }),
    source && authorization.automatedAuthorization ? recordAutomatedSendDecision(db, { agencyId: row.agency_id, conversationId: row.conversation_id, messageId: row.message_id, authorization: authorization.automatedAuthorization, source, decision: "SENT" }).catch((cause) => console.error("Could not audit the sent outbox message:", cause)) : Promise.resolve(),
  ]);
}

/** Puts claimed-but-unreached outbox rows back in the queue, refunding the attempt the claim counted. Guarded by `locked_by`. */
export async function releaseUnreachedOutboxRows(
  db: Pick<ReturnType<typeof createAdminClient>, "from">,
  workerId: string,
  rows: Array<Pick<OutboxRow, "id" | "agency_id" | "attempts">>,
): Promise<void> {
  await Promise.all(
    rows.map(async (row) => {
      const { error } = await db
        .from("outbox_messages")
        .update({ status: "QUEUED", locked_at: null, locked_by: null, attempts: Math.max(row.attempts - 1, 0) })
        .eq("id", row.id)
        .eq("agency_id", row.agency_id)
        .eq("status", "RUNNING")
        .eq("locked_by", workerId);
      if (error) throw new Error(error.message);
    }),
  );
}

async function rescheduleOrDeadLetter(db: ReturnType<typeof createAdminClient>, row: OutboxRow, message: string, forcedPermanent = false) {
  const permanent =
    forcedPermanent ||
    message.startsWith("No adapter") ||
    message.includes("no text content") ||
    message.includes("no longer available") ||
    message.includes("no supported author") ||
    message.includes("can't send") ||
    message.includes("attachment is not valid");
  const dead = permanent || row.attempts >= row.max_attempts;
  const delayMinutes = Math.min(30, 2 ** Math.max(0, row.attempts - 1));
  await db
    .from("outbox_messages")
    .update({
      status: dead ? "DEAD" : "QUEUED",
      last_error: message.slice(0, 2_000),
      locked_at: null,
      locked_by: null,
      run_after: new Date(Date.now() + delayMinutes * 60_000).toISOString(),
    })
    .eq("id", row.id)
    .eq("agency_id", row.agency_id);
  if (dead) await db.from("conversation_messages").update({ delivery_status: "FAILED", delivery_error: message.slice(0, 2_000) }).eq("id", row.message_id).eq("agency_id", row.agency_id);
}
