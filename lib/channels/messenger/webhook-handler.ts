/**
 * The Messenger webhook (`object: "page"`) and the Instagram webhook (`object: "instagram"`) — the same
 * handler, told which channel it serves. One endpoint per channel, every agency's account (Tech Provider
 * model): the tenant is resolved from the account id in the payload (the Page id, or the Instagram
 * professional account id), never guessed. Same rules as the WhatsApp handler:
 *
 *  - verify the signature over the RAW body before anything is parsed;
 *  - record the raw delivery (the audit floor) and answer 200 quickly;
 *  - an unknown Page is recorded and dropped, never attributed to an agency;
 *  - **never call the model here** — inbound messages are stored and a job is queued; the AI turn runs in
 *    the job drain (lib/agent/whatsapp/drain.ts), kicked via `after()` once the response has gone out.
 *
 * Structure: `handleMessengerDelivery` is the I/O shell (signature, tenant gate, audit, scheduling);
 * `processMessengerEvents` is the per-connection logic with its collaborators injected, so it is unit tested.
 */

import { createHash } from "node:crypto";

import { after, NextResponse, type NextRequest } from "next/server";

import { processDueJobs } from "@/lib/agent/whatsapp/drain";
import "@/lib/inbox/intelligence/register-handlers";
import { drainRealtimeLaneAfterWebhook } from "@/lib/inbox/jobs/drain";
import { isInboxWorkerActive } from "@/lib/inbox/worker/mode";
import { fetchInstagramLoginCustomerName } from "@/lib/channels/instagram/login/client";
import { isInstagramLoginMetadata } from "@/lib/channels/instagram/login/oauth";
import { ECHO_RECONCILE_DELAY_MS } from "@/lib/channels/messenger/echo";
import { applyMessengerProfileName, fetchMessengerProfileName } from "@/lib/channels/messenger/profile";
import {
  parseMessengerWebhook,
  type MessengerWebhookPayload,
  type PageMessagingChannel,
} from "@/lib/channels/messenger/webhook";
import {
  isAgencyAssistantEnabled,
  recordChannelWebhookEvent,
  resolveConnectionByAccountId,
  touchConnectionInbound,
  type ChannelConnectionRecord,
} from "@/lib/data/channel-connection-repository";
import { isValidMetaHandshake, verifyMetaSignature } from "@/lib/meta/signature";
import { readChannelToken } from "@/lib/channels/vault";
import { createAdminClient } from "@/utils/supabase/admin";
import { readBoundedWebhookBody } from "@/lib/security/webhook-body";
import { mayRecordUnsignedEvent } from "@/lib/security/unsigned-event-throttle";
import { processMessengerEvents } from "@/lib/channels/messenger/process-events";
export { processMessengerEvents };
export type { MessengerProcessDeps, MessengerProcessResult } from "@/lib/channels/messenger/process-events";

/* ── Verification handshake ───────────────────────────────────────────────── */

/** Each webhook object is verified separately in Meta's dashboard; Instagram may reuse the Messenger token so only one has to be set. */
function verifyTokenFor(channel: PageMessagingChannel): string | undefined {
  if (channel === "INSTAGRAM") return process.env.INSTAGRAM_VERIFY_TOKEN?.trim() || process.env.MESSENGER_VERIFY_TOKEN;
  return process.env.MESSENGER_VERIFY_TOKEN;
}

/** The secrets a delivery may be signed with. Instagram may have its own app secret (plan F9); the main app's is always accepted. */
function signingSecretsFor(channel: PageMessagingChannel): string[] {
  const secrets = [process.env.META_APP_SECRET];
  if (channel === "INSTAGRAM") secrets.push(process.env.INSTAGRAM_APP_SECRET);
  return secrets.filter((secret): secret is string => Boolean(secret && secret.trim()));
}

export function handleMessengerVerify(request: NextRequest, channel: PageMessagingChannel = "MESSENGER"): NextResponse {
  const { searchParams } = new URL(request.url);
  const challenge = searchParams.get("hub.challenge");
  const valid = isValidMetaHandshake(
    { mode: searchParams.get("hub.mode"), token: searchParams.get("hub.verify_token"), challenge },
    verifyTokenFor(channel),
  );
  if (valid && challenge) return new NextResponse(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
  return new NextResponse("Forbidden", { status: 403 });
}

/* ── I/O shell ────────────────────────────────────────────────────────────── */

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function handleMessengerDelivery(request: NextRequest, channel: PageMessagingChannel = "MESSENGER"): Promise<NextResponse> {
  const channelName = channel === "INSTAGRAM" ? "Instagram" : "Messenger";
  // Signature verification needs the exact bytes Meta sent — read the raw body before anything parses it.
  const rawBody = await readBoundedWebhookBody(request);
  if (rawBody === null) return new NextResponse("Payload Too Large", { status: 413 });

  const appSecrets = signingSecretsFor(channel);
  if (appSecrets.length === 0) {
    // Misconfigured deployment: fail loudly in logs but still 200 Meta so it doesn't disable the subscription over an ops mistake it can't fix.
    console.error(`${channelName} webhook: META_APP_SECRET is not configured.`);
    return NextResponse.json({ status: "misconfigured" }, { status: 200 });
  }

  const admin = createAdminClient();
  // A byte-identical redelivery collapses to one audit row; message-level idempotency does the real work.
  const externalEventId = createHash("sha256").update(rawBody, "utf8").digest("hex");
  const signatureValid = verifyMetaSignature(rawBody, request.headers.get("x-hub-signature-256"), appSecrets);

  if (!signatureValid) {
    // Recorded for the audit floor (agency unresolved) but never parsed or processed: a forged payload never
    // reaches a conversation, and only a size stub is stored because the body is attacker-written.
    // Anyone can send this, so the stubs are capped per minute (SEC-7): the 401 below is never throttled, only the database write.
    if (await mayRecordUnsignedEvent(admin, "channel_webhook_events")) {
      await recordChannelWebhookEvent(admin, {
        provider: channel,
        agencyId: null,
        connectionId: null,
        externalEventId,
        payload: { rejected: "invalid_signature", bytes: rawBody.length },
        signatureValid: false,
      }).catch(() => undefined);
    }
    return new NextResponse("Unauthorized", { status: 401 });
  }

  let payload: MessengerWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as MessengerWebhookPayload;
  } catch {
    return new NextResponse("Bad Request", { status: 400 });
  }

  const events = parseMessengerWebhook(payload, channel);

  // The tenant gate: each Page id resolves to exactly one connection or is dropped.
  const connections = new Map<string, ChannelConnectionRecord>();
  for (const pageId of new Set((events ?? []).map((event) => event.pageId))) {
    const connection = await resolveConnectionByAccountId(admin, channel, pageId);
    if (connection) connections.set(pageId, connection);
  }
  const firstConnection = [...connections.values()][0] ?? null;

  await recordChannelWebhookEvent(admin, {
    provider: channel,
    agencyId: firstConnection?.agency_id ?? null,
    connectionId: firstConnection?.id ?? null,
    externalEventId,
    payload,
    signatureValid: true,
  }).catch((error) => console.error(`${channelName} webhook: could not record the delivery:`, error));

  if (events === null) return NextResponse.json({ status: "ignored" }, { status: 200 });
  if (connections.size === 0) return NextResponse.json({ status: "unknown_page" }, { status: 200 });

  const jobIds: string[] = [];
  let enrichQueued = false;
  let echoDeferred = false;
  const profileLookups: Array<{ connection: ChannelConnectionRecord; psid: string }> = [];

  for (const connection of connections.values()) {
    // Fail closed: the assistant answers only when BOTH this connection and the agency have it switched on.
    const agentAllowed = connection.ai_enabled && (await isAgencyAssistantEnabled(admin, connection.agency_id));
    const processed = await processMessengerEvents(admin, connection, events, { agentAllowed, ownAppId: process.env.META_APP_ID, channel });
    jobIds.push(...processed.jobIds);
    enrichQueued ||= processed.enrichQueued;
    echoDeferred ||= processed.echoDeferred;
    for (const psid of processed.profilePsids) profileLookups.push({ connection, psid });
    if (events.some((event) => event.kind === "message" && event.pageId === connection.provider_account_id)) {
      await touchConnectionInbound(admin, connection.id, connection.agency_id).catch(() => undefined);
    }
  }

  // After the response has gone out — never delays Meta's 200. The cron route is the guarantee.
  // Skipped when the always-on worker is running (INBOX_WORKER_ACTIVE): it is already draining the queues. The cron route stays the guarantee.
  const workerDrains = isInboxWorkerActive();
  if (!workerDrains && jobIds.length > 0) {
    after(() => processDueJobs({ budgetMs: 25_000 }).catch((error) => console.error(`${channelName} drain (after) failed:`, error)));
  }
  // Inbox intelligence REALTIME lane (channel_jobs) — a separate, short drain; the agent drain above is unchanged.
  if (!workerDrains && (jobIds.length > 0 || enrichQueued)) {
    after(() => drainRealtimeLaneAfterWebhook());
  }
  if (echoDeferred) {
    // Run the echo reconciliation as soon as it is due rather than waiting for the next cron tick, so a
    // colleague's Page-inbox reply silences the assistant before the customer's next message arrives.
    after(async () => {
      await sleep(ECHO_RECONCILE_DELAY_MS + 500);
      await processDueJobs({ budgetMs: 15_000 }).catch((error) => console.error(`${channelName} echo drain failed:`, error));
    });
  }
  if (profileLookups.length > 0) {
    after(async () => {
      for (const { connection, psid } of profileLookups) {
        if (!connection.credential_ref) continue;
        try {
          const token = await readChannelToken(admin, connection.credential_ref);
          if (!token) continue;
          // An Instagram Login connection's token belongs to graph.instagram.com; the Page lookups would be refused for it.
          const name =
            channel === "INSTAGRAM" && isInstagramLoginMetadata(connection.provider_metadata)
              ? await fetchInstagramLoginCustomerName(token, psid)
              : await fetchMessengerProfileName(token, psid, channel);
          if (name) await applyMessengerProfileName(admin, { agencyId: connection.agency_id, psid, name, channel });
        } catch (error) {
          console.warn(`${channelName} profile name update failed:`, error instanceof Error ? error.message : error);
        }
      }
    });
  }

  return NextResponse.json({ status: "ok" }, { status: 200 });
}
