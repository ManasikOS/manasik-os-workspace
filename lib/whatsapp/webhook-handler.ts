/**
 * The shared body of the WhatsApp webhook — one implementation, two routes
 * (§5 E5 of docs/modules/whatsapp-meta-connection-implementation-plan.md):
 *
 *  - `app/api/webhooks/whatsapp/route.ts` — the unkeyed route, verifying
 *    against OUR platform app secret (`META_APP_SECRET`/`WHATSAPP_VERIFY_TOKEN`).
 *    Serves every Mode B (Embedded Signup) tenant, since they all share our app.
 *  - `app/api/webhooks/whatsapp/[connectionKey]/route.ts` — the keyed route,
 *    verifying against the ONE tenant's own app secret/verify token stored
 *    in Vault (D3). Serves Mode A (own-app) tenants, each of whom owns a
 *    different Meta app and therefore signs with a different secret.
 *
 * The one rule this file exists to enforce: **never call the model here.**
 * Meta's timeout is short and its retry behaviour on a non-200 is
 * aggressive — this handler does pure, fast I/O against Postgres and
 * returns. The AI turn runs in the job queue drain (§6.3 of
 * docs/modules/whatsapp-ai-agent-implementation-plan.md), kicked opportunistically
 * via `after()` once the response has already gone out.
 */

import { after, NextResponse, type NextRequest } from "next/server";

import { processDueJobs } from "@/lib/agent/whatsapp/drain";
import "@/lib/inbox/intelligence/register-handlers";
import { drainRealtimeLaneAfterWebhook } from "@/lib/inbox/jobs/drain";
import { isInboxWorkerActive } from "@/lib/inbox/worker/mode";
import { countryForWaId, waIdToMobile } from "@/lib/agent/whatsapp/phone";
import { markWebhookVerified, recordConnectionEvent } from "@/lib/data/whatsapp-connection-repository";
import { findMessageAttribution, upsertMessageCharge, upsertVolumeTierIfEarlier, syncTemplateStatus } from "@/lib/data/whatsapp-billing-repository";
import {
  insertMessage,
  markConversationHandledFromBusinessApp,
  recordWebhookEvent,
  resolveAgencyForPhoneNumberId,
} from "@/lib/data/whatsapp-repository";
import { recordMessageDelivery } from "@/lib/inbox/delivery/delivery-updates";
import { isValidMetaHandshake } from "@/lib/meta/signature";
import { verifyWhatsAppSignature } from "@/lib/whatsapp/signature";
import type { WhatsAppTemplateStatus, WhatsAppWebhookPayload } from "@/lib/types/whatsapp";
import { createAdminClient } from "@/utils/supabase/admin";
import { readBoundedWebhookBody } from "@/lib/security/webhook-body";
import { extractMessageText, extractMessageType, ingestWhatsAppInboundMessages, isReactionMessage, storableInboundMessageIds } from "@/lib/whatsapp/inbound-ingest";
export { storableInboundMessageIds };
import { isUnsupportedWhatsAppMessage, sendWhatsAppUnsupportedNotice } from "@/lib/inbox/media/unsupported-notice";

export interface WebhookIdentity {
  /** Our platform verify token (unkeyed route) or the tenant's own generated one (keyed route). */
  verifyToken: string | undefined;
  /** Our platform app secret (unkeyed route) or the tenant's own Meta app secret (keyed route). */
  appSecret: string | undefined;
}

/** Meta's subscription handshake — identical shape on both routes, just a different expected token. */
export function handleVerifyRequest(request: NextRequest, identity: WebhookIdentity): NextResponse {
  const { searchParams } = new URL(request.url);
  const challenge = searchParams.get("hub.challenge");
  const valid = isValidMetaHandshake(
    { mode: searchParams.get("hub.mode"), token: searchParams.get("hub.verify_token"), challenge },
    identity.verifyToken,
  );

  if (valid && challenge) {
    return new NextResponse(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

export async function handleWebhookDelivery(request: NextRequest, identity: WebhookIdentity): Promise<NextResponse> {
  // Signature verification needs the exact bytes Meta sent — read the raw
  // body before anything parses it.
  // Bounded: an unauthenticated caller must not be able to make us buffer or store an arbitrarily large body.
  const rawBody = await readBoundedWebhookBody(request);
  if (rawBody === null) return new NextResponse("Payload Too Large", { status: 413 });

  if (!identity.appSecret) {
    // Misconfigured deployment: fail loudly in logs, but still 200 Meta so
    // it doesn't disable the subscription over an ops mistake it can't fix.
    console.error("WhatsApp webhook: no app secret configured for this route.");
    return NextResponse.json({ status: "misconfigured" }, { status: 200 });
  }

  const signatureHeader = request.headers.get("x-hub-signature-256");
  const signatureValid = verifyWhatsAppSignature(rawBody, signatureHeader, identity.appSecret);

  const admin = createAdminClient();

  if (!signatureValid) {
    // Recorded (agencyId unresolved) for the audit floor, but never parsed or processed — an unsigned or forged
    // payload never reaches a conversation. Only a size stub is stored: the body is attacker-written, so keeping
    // it would let anyone fill the table with arbitrary content. This is also the guard D3 relies on: an event
    // signed with agency A's secret posted to agency B's keyed route fails HERE, before either agency's data is touched.
    await recordWebhookEvent(admin, {
      agencyId: null,
      externalEventId: crypto.randomUUID(),
      payload: { rejected: "invalid_signature", bytes: rawBody.length },
      signatureValid: false,
    }).catch(() => undefined);
    return new NextResponse("Unauthorized", { status: 401 });
  }

  let payload: WhatsAppWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as WhatsAppWebhookPayload;
  } catch {
    return new NextResponse("Bad Request", { status: 400 });
  }

  const phoneNumberId = extractPhoneNumberId(payload);

  // D2 — the tenant gate. No match means the event is not for a number we
  // have connected; record it and stop, never guess an agency.
  const integration = phoneNumberId ? await resolveAgencyForPhoneNumberId(admin, phoneNumberId) : null;

  const isNew = await recordWebhookEvent(admin, {
    agencyId: integration?.agency_id ?? null,
    externalEventId: whatsAppWebhookExternalEventId(payload) ?? crypto.randomUUID(),
    payload,
    signatureValid: true,
    expectedMessageIds: storableInboundMessageIds(payload),
  });

  if (!isNew) {
    // Meta redelivery of an event we already have — F8. Nothing to do.
    return NextResponse.json({ status: "duplicate" }, { status: 200 });
  }

  // Account-state fields (F10) can arrive even when phone_number_id doesn't
  // resolve to a message-bearing `value` shape (account_update's `value` is
  // WABA-level, not phone-scoped) — handle those independent of `integration`
  // being set, by resolving the agency from the WABA id in the payload itself.
  await handleAccountStateChanges(admin, payload);

  if (!integration) {
    return NextResponse.json({ status: "unknown_number" }, { status: 200 });
  }

  // A token check or WABA subscription proves outbound API access, not
  // inbound delivery. The first signed event that resolves to the stored
  // phone number is the end-to-end proof used by the setup UI.
  const firstVerifiedDelivery = await markWebhookVerified(admin, integration.id);
  if (firstVerifiedDelivery) {
    await recordConnectionEvent(admin, {
      agencyId: integration.agency_id,
      integrationId: integration.id,
      kind: "WEBHOOK_VERIFIED",
      detail: { phoneNumberId },
    }).catch((error) => console.error("WhatsApp webhook: failed to record verification event:", error));
  }

  const inbound = await ingestWhatsAppInboundMessages(admin, integration.agency_id, payload);
  const { enqueuedJobIds, enrichQueued, unsupportedNoticeRecipients } = inbound;

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value) continue;

      // Coexistence: something the agency typed in the WhatsApp Business app. Show it in the CRM thread as a
      // staff message and keep the assistant quiet on that conversation.
      for (const echo of value.message_echoes ?? []) {
        if (!echo.to || !echo.id) continue;
        // Staff tapping a reaction on a customer message from their own phone echoes here the same way a typed
        // message does, but carries no text. Not a message of its own: dropped, same as a customer's reaction
        // is dropped in ingestWhatsAppInboundMessages.
        if (isReactionMessage(echo)) continue;
        // Apply the same media policy to Business app echoes without sending a customer refusal for staff activity.
        if (isUnsupportedWhatsAppMessage(echo)) continue;
        const conversation = await markConversationHandledFromBusinessApp(admin, {
          agencyId: integration.agency_id,
          waId: echo.to,
          contactName: waIdToMobile(echo.to),
        });
        await insertMessage(admin, {
          agencyId: integration.agency_id,
          conversationId: conversation.id,
          externalMessageId: echo.id,
          role: "staff",
          actorKind: "STAFF",
          actorName: "WhatsApp Business app",
          content: extractMessageText(echo),
          messageType: extractMessageType(echo),
          deliveryStatus: "SENT",
          metadata: { raw_type: echo.type, source: "whatsapp_business_app" },
        });
      }

      for (const status of value.statuses ?? []) {
        if (!status.id || !status.status) continue;
        await recordMessageDelivery(admin, status.id, integration.agency_id, {
          deliveryStatus: mapDeliveryStatus(status.status),
          deliveryError: status.errors?.[0]?.title ?? null,
        }).catch(() => undefined); // a status for a message we don't have (e.g. pre-migration) is not fatal

        // F15 — capture billability/category/type the moment Meta reports
        // it. Priced later by the nightly sync (E10); never priced here —
        // this loop stays fast I/O, per the rule at the top of this file.
        if (status.pricing) {
          const attribution = await findMessageAttribution(admin, integration.agency_id, status.id).catch(() => null);
          await upsertMessageCharge(admin, {
            agencyId: integration.agency_id,
            conversationId: attribution?.conversationId ?? null,
            messageId: attribution?.messageId ?? null,
            externalMessageId: status.id,
            direction: "OUTBOUND",
            billable: Boolean(status.pricing.billable),
            pricingModel: status.pricing.pricing_model ?? null,
            pricingCategory: status.pricing.category ?? null,
            pricingType: status.pricing.type ?? null,
            recipientCountry: status.recipient_id ? countryForWaId(status.recipient_id) : null,
            actorKind: attribution?.actorKind ?? null,
            actorId: attribution?.actorId ?? null,
            leadId: attribution?.leadId ?? null,
          }).catch((error) => console.error("WhatsApp webhook: failed to record outbound charge row:", error));
        }
      }
    }
  }

  // Opportunistic low-latency drain: runs after this response has already
  // been sent, so it never delays Meta's 200. The cron route (§6.3) is the
  // guarantee that a job still drains even if this process dies mid-request.
  // Skipped when the always-on worker is running (INBOX_WORKER_ACTIVE): it is already draining the queues, and the webhook's function
  // can return at once instead of staying alive for the drain. The scheduled drains remain the guarantee either way.
  const workerDrains = isInboxWorkerActive();
  if (!workerDrains && enqueuedJobIds.length > 0) {
    after(() => processDueJobs({ budgetMs: 25_000 }).catch((error) => console.error("WhatsApp drain (after) failed:", error)));
  }
  // Inbox intelligence REALTIME lane (channel_jobs) — a separate, short drain; the agent drain above is unchanged.
  if (!workerDrains && (enqueuedJobIds.length > 0 || enrichQueued)) {
    after(() => drainRealtimeLaneAfterWebhook());
  }

  if (unsupportedNoticeRecipients.length > 0) {
    after(async () => {
      for (const recipient of unsupportedNoticeRecipients) await sendWhatsAppUnsupportedNotice(admin, integration, recipient);
    });
  }

  return NextResponse.json({ status: "ok" }, { status: 200 });
}

/* ── Account-state fields (F10/F15) ──────────────────────────────────────── */

type Db = ReturnType<typeof createAdminClient>;

/**
 * `account_update`, `message_template_status_update` and the volume-tier
 * shape of `account_update` all carry a WABA id at `entry[].id`, not a
 * `phone_number_id` — so they're resolved to an agency independently of the
 * message-bearing tenant gate above. A WABA id we don't recognise is
 * dropped silently, same posture as an unknown phone_number_id (D2).
 */
async function handleAccountStateChanges(admin: Db, payload: WhatsAppWebhookPayload): Promise<void> {
  for (const entry of payload.entry ?? []) {
    const wabaId = entry.id;
    if (!wabaId) continue;

    for (const change of entry.changes ?? []) {
      const field = change.field;
      const value = change.value as Record<string, unknown> | undefined;
      if (!value) continue;

      if (field === "account_update") {
        await handleSingleAccountUpdate(admin, wabaId, value);
      } else if (field === "message_template_status_update") {
        await handleTemplateStatusUpdate(admin, wabaId, value);
      } else if (field === "phone_number_quality_update") {
        await handleQualityUpdate(admin, wabaId, value);
      }
    }
  }
}

async function resolveAgencyIdForWaba(admin: Db, wabaId: string): Promise<{ agencyId: string; integrationId: string } | null> {
  const { data } = await admin
    .from("whatsapp_integrations")
    .select("id, agency_id")
    .eq("business_account_id", wabaId)
    .maybeSingle();
  if (!data) return null;
  return { agencyId: (data as { agency_id: string }).agency_id, integrationId: (data as { id: string }).id };
}

async function handleSingleAccountUpdate(admin: Db, wabaId: string, value: Record<string, unknown>): Promise<void> {
  const resolved = await resolveAgencyIdForWaba(admin, wabaId);
  if (!resolved) return;

  const event = value.event as string | undefined;

  // Volume-tier notifications carry tier_update_time — F15's "several
  // webhooks for one switch, smallest timestamp wins" case.
  if (typeof value.tier_update_time === "number" && typeof value.pricing_category === "string") {
    const tier = (value.tier as { lower?: number; upper?: number } | undefined) ?? {};
    await upsertVolumeTierIfEarlier(admin, {
      agencyId: resolved.agencyId,
      pricingCategory: value.pricing_category,
      region: (value.region as string) ?? "",
      tierLower: tier.lower ?? null,
      tierUpper: tier.upper ?? null,
      effectiveMonth: (value.effective_month as string) ?? null,
      tierUpdateTime: new Date((value.tier_update_time as number) * 1000).toISOString(),
    }).catch((error) => console.error("WhatsApp webhook: failed to upsert volume tier:", error));

    await recordConnectionEvent(admin, {
      agencyId: resolved.agencyId,
      integrationId: resolved.integrationId,
      kind: "VOLUME_TIER_UPDATE",
      detail: value,
    }).catch(() => undefined);
    return;
  }

  // F11 — revocation and account-health events. Never retried, only
  // reflected: the send path (E3's classifyWhatsAppError) is what stops
  // retrying against a dead token; this just makes the state visible.
  const patch: Record<string, unknown> = { platform_state: value };
  if (event === "PARTNER_APP_UNINSTALLED" || event === "DISABLED_UPDATE") {
    patch.status = "ERROR";
    patch.last_error = `Meta reported ${event} — the connection needs to be re-authorised.`;
  } else if (event === "ACCOUNT_VIOLATION" || event === "ACCOUNT_RESTRICTION") {
    patch.status = "RESTRICTED";
  } else if (event && /PAYMENT|BILLING|PREPAY/.test(event)) {
    // E9/F10 — "also from account_update", the other detection path
    // alongside the send-error taxonomy (131042, classifyWhatsAppError) and
    // the same one drain.ts / inbox actions.ts flip back on a successful
    // send. Meta's exact event name for a lapsed payment method varies by
    // API version, hence the substring match rather than an exact string.
    patch.status = "UNFUNDED";
    patch.funding_status = "UNFUNDED";
    patch.last_error = `Meta reported ${event} — no valid payment method is attached to this WhatsApp Business Account.`;
  } else if (event === "VERIFIED_ACCOUNT" || event === "ACCOUNT_UPDATE") {
    // A recovery signal — only clear ERROR/RESTRICTED, never override a
    // deliberate DISCONNECTED or an UNFUNDED state we set ourselves.
  }

  await admin.from("whatsapp_integrations").update(patch).eq("id", resolved.integrationId).then(
    () => undefined,
    () => undefined,
  );
  await recordConnectionEvent(admin, {
    agencyId: resolved.agencyId,
    integrationId: resolved.integrationId,
    kind: event ? `ACCOUNT_UPDATE_${event}` : "ACCOUNT_UPDATE",
    detail: value,
  }).catch(() => undefined);
}

async function handleTemplateStatusUpdate(admin: Db, wabaId: string, value: Record<string, unknown>): Promise<void> {
  const resolved = await resolveAgencyIdForWaba(admin, wabaId);
  if (!resolved) return;

  const name = value.message_template_name as string | undefined;
  const language = value.message_template_language as string | undefined;
  const event = (value.event as string | undefined)?.toUpperCase();
  if (!name || !language || !event) return;

  const statusMap: Record<string, WhatsAppTemplateStatus> = {
    APPROVED: "APPROVED",
    REJECTED: "REJECTED",
    PAUSED: "PAUSED",
    DISABLED: "DISABLED",
    PENDING: "PENDING",
    IN_APPEAL: "PENDING",
  };
  const status = statusMap[event];
  if (!status) return;

  await syncTemplateStatus(admin, resolved.agencyId, name, language, {
    status,
    rejectedReason: (value.reason as string) ?? null,
  }).catch((error) => console.error("WhatsApp webhook: failed to sync template status:", error));
}

async function handleQualityUpdate(admin: Db, wabaId: string, value: Record<string, unknown>): Promise<void> {
  const resolved = await resolveAgencyIdForWaba(admin, wabaId);
  if (!resolved) return;

  const qualityRating = value.current_limit ? null : ((value.quality_score as { rating?: string } | undefined)?.rating ?? null);
  const messagingLimitTier = (value.current_limit as string) ?? null;

  await admin
    .from("whatsapp_integrations")
    .update({
      ...(qualityRating ? { quality_rating: qualityRating } : {}),
      ...(messagingLimitTier ? { messaging_limit_tier: messagingLimitTier } : {}),
    })
    .eq("id", resolved.integrationId)
    .then(
      () => undefined,
      () => undefined,
    );

  await recordConnectionEvent(admin, {
    agencyId: resolved.agencyId,
    integrationId: resolved.integrationId,
    kind: "QUALITY_UPDATE",
    detail: value,
  }).catch(() => undefined);
}

/* ── Payload parsing helpers ──────────────────────────────────────────────── */

export function whatsAppWebhookExternalEventId(
  payload: WhatsAppWebhookPayload,
): string | null {
  // Meta gives no single event id at the top level. Message ids identify an
  // inbound delivery; outbound status callbacks also need the transition and
  // timestamp because sent, delivered and read share one message id.
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      const firstMessageId = value?.messages?.[0]?.id;
      if (firstMessageId) return firstMessageId;
      const firstEchoId = value?.message_echoes?.[0]?.id;
      if (firstEchoId) return firstEchoId;
      const firstStatusId = value?.statuses?.[0]?.id;
      if (firstStatusId) {
        const firstStatus = value?.statuses?.[0];
        return [firstStatusId, firstStatus?.status, firstStatus?.timestamp]
          .filter(Boolean)
          .join(":");
      }
    }
  }
  return null;
}

function extractPhoneNumberId(payload: WhatsAppWebhookPayload): string | null {
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const id = change.value?.metadata?.phone_number_id;
      if (id) return id;
    }
  }
  return null;
}

function mapDeliveryStatus(status: string): "SENT" | "DELIVERED" | "READ" | "FAILED" {
  switch (status) {
    case "delivered":
      return "DELIVERED";
    case "read":
      return "READ";
    case "failed":
      return "FAILED";
    default:
      return "SENT";
  }
}
