/**
 * The provider simulator, inbound half (TASK-032 S3): builds Meta-shaped webhook payloads, signs them exactly as Meta does, and delivers
 * them to this app's own webhook routes. It lets a test (or the production go-live gate) drive a conversation end to end without a real
 * phone, Page or Instagram account.
 *
 * Deliberately free of `server-only` and of runtime `@/` imports so the same file runs inside the app's test runner, Playwright, and a plain
 * Node script.
 *
 * Safety: a payload is signed with the real app secret, so it would be accepted for a REAL agency if it named a real account. Every account
 * id is therefore refused unless it starts with `sim` (real WhatsApp phone-number ids and Page ids are numeric). A test agency is seeded
 * with `sim-` ids; nothing built here can reach a customer's real number or Page.
 */

import { createHmac, randomUUID } from "node:crypto";

import type { MessengerWebhookPayload } from "../../channels/messenger/webhook";
import type { WhatsAppWebhookPayload } from "../../types/whatsapp";

export type SimulatedChannel = "WHATSAPP" | "MESSENGER" | "INSTAGRAM";

export const WEBHOOK_PATHS: Record<SimulatedChannel, string> = {
  WHATSAPP: "/api/webhooks/whatsapp",
  MESSENGER: "/api/webhooks/messenger",
  INSTAGRAM: "/api/webhooks/instagram",
};

/** Throws unless the id is a simulator id. See the file header for why. */
export function assertSimulatedAccountId(id: string, what: string): void {
  if (!/^sim[-_.]/i.test(id)) {
    throw new Error(`Refusing to build a webhook for ${what} "${id}": simulator account ids must start with "sim-" so a real account can never be addressed.`);
  }
}

function newId(prefix: string): string {
  return `${prefix}.sim.${randomUUID()}`;
}

/* ── WhatsApp ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────── */

export interface SimulatedWhatsAppNumber {
  /** The connected number's phone_number_id, which is how the app finds the agency. Must start with `sim-`. */
  phoneNumberId: string;
  displayPhoneNumber?: string;
  wabaId?: string;
}

function whatsAppEnvelope(number: SimulatedWhatsAppNumber, value: Record<string, unknown>): WhatsAppWebhookPayload {
  assertSimulatedAccountId(number.phoneNumberId, "the WhatsApp phone number");
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: number.wabaId ?? "sim-waba",
        changes: [
          {
            field: "messages",
            value: {
              metadata: { phone_number_id: number.phoneNumberId, display_phone_number: number.displayPhoneNumber ?? "15550000000" },
              ...value,
            } as NonNullable<NonNullable<NonNullable<WhatsAppWebhookPayload["entry"]>[number]["changes"]>[number]["value"]>,
          },
        ],
      },
    ],
  };
}

export function whatsappTextMessage(
  number: SimulatedWhatsAppNumber,
  input: { from: string; text: string; name?: string; messageId?: string; timestampSeconds?: number },
): WhatsAppWebhookPayload {
  const timestamp = String(input.timestampSeconds ?? Math.floor(Date.now() / 1000));
  return whatsAppEnvelope(number, {
    contacts: [{ wa_id: input.from, profile: { name: input.name ?? "Simulated Customer" } }],
    messages: [{ id: input.messageId ?? newId("wamid"), from: input.from, timestamp, type: "text", text: { body: input.text } }],
  });
}

export function whatsappImageMessage(
  number: SimulatedWhatsAppNumber,
  input: { from: string; mediaId?: string; caption?: string; name?: string; messageId?: string; timestampSeconds?: number },
): WhatsAppWebhookPayload {
  const timestamp = String(input.timestampSeconds ?? Math.floor(Date.now() / 1000));
  return whatsAppEnvelope(number, {
    contacts: [{ wa_id: input.from, profile: { name: input.name ?? "Simulated Customer" } }],
    messages: [
      {
        id: input.messageId ?? newId("wamid"),
        from: input.from,
        timestamp,
        type: "image",
        image: { id: input.mediaId ?? newId("media"), mime_type: "image/png", ...(input.caption ? { caption: input.caption } : {}) },
      },
    ],
  });
}

export type SimulatedStatus = "sent" | "delivered" | "read" | "failed";

/** A delivery receipt for a message WE sent. `messageId` is the provider id the outbound send was given (`sim.whatsapp.…`). */
export function whatsappStatus(
  number: SimulatedWhatsAppNumber,
  input: { messageId: string; recipientId: string; status: SimulatedStatus; errorCode?: number; timestampSeconds?: number },
): WhatsAppWebhookPayload {
  return whatsAppEnvelope(number, {
    statuses: [
      {
        id: input.messageId,
        status: input.status,
        timestamp: String(input.timestampSeconds ?? Math.floor(Date.now() / 1000)),
        recipient_id: input.recipientId,
        ...(input.status === "failed" ? { errors: [{ code: input.errorCode ?? 131026, title: "Message undeliverable" }] } : {}),
      },
    ],
  });
}

/* ── Messenger and Instagram ────────────────────────────────────────────────────────────────────────────────────────────────────── */

function pageEnvelope(channel: "MESSENGER" | "INSTAGRAM", accountId: string, messaging: NonNullable<NonNullable<MessengerWebhookPayload["entry"]>[number]["messaging"]>): MessengerWebhookPayload {
  assertSimulatedAccountId(accountId, channel === "MESSENGER" ? "the Facebook Page" : "the Instagram account");
  return { object: channel === "MESSENGER" ? "page" : "instagram", entry: [{ id: accountId, time: Date.now(), messaging }] };
}

export function pageTextMessage(
  channel: "MESSENGER" | "INSTAGRAM",
  accountId: string,
  input: { senderId: string; text: string; mid?: string; timestampMs?: number },
): MessengerWebhookPayload {
  return pageEnvelope(channel, accountId, [
    { sender: { id: input.senderId }, recipient: { id: accountId }, timestamp: input.timestampMs ?? Date.now(), message: { mid: input.mid ?? newId("m"), text: input.text } },
  ]);
}

export function pageImageMessage(
  channel: "MESSENGER" | "INSTAGRAM",
  accountId: string,
  input: { senderId: string; url?: string; mid?: string; timestampMs?: number },
): MessengerWebhookPayload {
  return pageEnvelope(channel, accountId, [
    {
      sender: { id: input.senderId },
      recipient: { id: accountId },
      timestamp: input.timestampMs ?? Date.now(),
      message: { mid: input.mid ?? newId("m"), attachments: [{ type: "image", payload: { url: input.url ?? "https://simulator.invalid/image.png" } }] },
    },
  ]);
}

/** Messenger's delivery receipt for messages WE sent. */
export function pageDelivery(
  channel: "MESSENGER" | "INSTAGRAM",
  accountId: string,
  input: { senderId: string; mids: string[]; watermarkMs?: number },
): MessengerWebhookPayload {
  return pageEnvelope(channel, accountId, [
    { sender: { id: input.senderId }, recipient: { id: accountId }, timestamp: input.watermarkMs ?? Date.now(), delivery: { mids: input.mids, watermark: input.watermarkMs ?? Date.now() } },
  ]);
}

/* ── Signing and delivery ───────────────────────────────────────────────────────────────────────────────────────────────────── */

/** Meta's `X-Hub-Signature-256` value for a raw body. The signature covers the exact bytes sent, so serialize once and send those bytes. */
export function signMetaWebhookBody(rawBody: string, appSecret: string): string {
  if (!appSecret) throw new Error("An app secret is required to sign a simulated webhook.");
  return `sha256=${createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex")}`;
}

export interface WebhookDeliveryResult {
  status: number;
  body: string;
}

export interface WebhookDeliveryOptions {
  baseUrl: string;
  channel: SimulatedChannel;
  payload: WhatsAppWebhookPayload | MessengerWebhookPayload;
  appSecret: string;
  /** Override to send a deliberately wrong signature (a forged-event test). */
  signatureOverride?: string | null;
  fetchImpl?: typeof fetch;
}

/** Posts one signed webhook delivery to the app and returns what the app answered. */
export async function deliverSignedWebhook(options: WebhookDeliveryOptions): Promise<WebhookDeliveryResult> {
  const rawBody = JSON.stringify(options.payload);
  const signature = options.signatureOverride === undefined ? signMetaWebhookBody(rawBody, options.appSecret) : options.signatureOverride;
  const response = await (options.fetchImpl ?? fetch)(new URL(WEBHOOK_PATHS[options.channel], options.baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(signature ? { "X-Hub-Signature-256": signature } : {}) },
    body: rawBody,
  });
  return { status: response.status, body: await response.text() };
}

/** Meta redelivers events it did not see acknowledged: the same bytes, twice. The app must keep exactly one. */
export async function deliverDuplicateWebhook(options: WebhookDeliveryOptions): Promise<[WebhookDeliveryResult, WebhookDeliveryResult]> {
  const first = await deliverSignedWebhook(options);
  const second = await deliverSignedWebhook(options);
  return [first, second];
}

/** Meta's subscription handshake: a GET with the verify token that must be answered with the challenge, verbatim. */
export async function requestWebhookHandshake(options: { baseUrl: string; channel: SimulatedChannel; verifyToken: string; challenge?: string; fetchImpl?: typeof fetch }): Promise<WebhookDeliveryResult & { challenge: string }> {
  const challenge = options.challenge ?? randomUUID();
  const url = new URL(WEBHOOK_PATHS[options.channel], options.baseUrl);
  url.searchParams.set("hub.mode", "subscribe");
  url.searchParams.set("hub.verify_token", options.verifyToken);
  url.searchParams.set("hub.challenge", challenge);
  const response = await (options.fetchImpl ?? fetch)(url, { method: "GET" });
  return { status: response.status, body: await response.text(), challenge };
}
