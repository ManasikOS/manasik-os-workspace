# Provider simulator

How tests and the production go-live gate drive the Inbox without a real phone, Facebook Page or Instagram account (TASK-032 S3). Nothing here
messages a real person, and nothing needs Meta's approval.

## The two halves

| Half | What it does | Where |
|---|---|---|
| **Outbound** | A disposable test agency (`agencies.is_test = true`) is given an in-memory channel adapter. Every send, media send, typing indicator and download is answered locally; nothing leaves the process. | `lib/inbox/simulator/simulated-adapter.ts`, `adapter-for-agency.ts` |
| **Inbound** | Builds Meta-shaped webhook payloads, signs them with the app secret exactly as Meta does, and posts them to the app's own webhook routes. | `lib/inbox/simulator/inbound-payloads.ts` |

Everything between those two ends is the real code: the webhook handler, ingest, the policy gate (`authorizeProviderSend`), the outbox and
its worker, delivery bookkeeping and error handling. Only the network call to Meta is replaced.

## How a test agency is kept away from real providers

1. `agencies.is_test` can be set only by the service role or a SQL session; a signed-in user cannot (a trigger blocks it).
2. Every code path that picks a channel adapter for an agency uses `getChannelAdapterForAgency`, which returns the simulator for a test agency.
   A scan test fails if any other code calls `getChannelAdapter` directly.
3. Immediately before a send, `assertSendMatchesAdapter` checks that the policy decision and the adapter agree on whether the agency is a test
   agency. If the flag changed in between, nothing is sent.
4. Template sends return a simulated id for a test agency; announcements, the unsupported-file notice and the WhatsApp setup test message do not
   send at all.
5. The inbound builders refuse any account id that does not start with `sim-`, because a payload signed with the real app secret would be
   accepted for a real agency. Seed a test agency's WhatsApp number, Page and Instagram account with `sim-` ids.

## Injecting a failure

The outbound simulator reads the **recipient id** of the conversation. Give a test contact one of these ids to make its replies fail:

| Recipient contains | The send fails as |
|---|---|
| `sim-fail-token-dead` | a rejected token (the connection is marked as needing reconnection) |
| `sim-fail-rate-limited` | a rate limit (retried with back-off) |
| `sim-fail-unfunded` | an unfunded WhatsApp account |
| `sim-fail-outside-window` | outside the 24-hour service window |
| `sim-fail-not-registered` | a number not registered on WhatsApp |
| `sim-fail-unknown` | an unclassified provider error |

Any other recipient succeeds and gets an id such as `sim.whatsapp.<uuid>`. Audio downloads are not simulated (they fail on purpose); image
downloads return a 1x1 PNG.

## Driving a conversation from a test

```ts
import { deliverSignedWebhook, deliverDuplicateWebhook, whatsappTextMessage, whatsappStatus } from "@/lib/inbox/simulator/inbound-payloads";

const number = { phoneNumberId: "sim-phone-1" };
const base = { baseUrl: process.env.INBOX_E2E_BASE_URL!, channel: "WHATSAPP" as const, appSecret: process.env.META_APP_SECRET! };

await deliverSignedWebhook({ ...base, payload: whatsappTextMessage(number, { from: "94770000001", text: "Umrah in March?" }) }); // a customer writes
await deliverDuplicateWebhook({ ...base, payload: whatsappTextMessage(number, { from: "94770000001", text: "Hello?", messageId: "wamid.sim.same" }) }); // kept once
await deliverSignedWebhook({ ...base, payload: whatsappStatus(number, { messageId: "sim.whatsapp.<id>", recipientId: "94770000001", status: "delivered" }) });
await deliverSignedWebhook({ ...base, payload: whatsappTextMessage(number, { from: "1", text: "hi" }), signatureOverride: "sha256=bad" }); // must be rejected (401)
```

Out-of-order delivery is just a different order of the same calls (for example a `delivered` receipt before the message it refers to).
`requestWebhookHandshake` performs Meta's subscription handshake for the go-live gate.

## What it does not cover

- It does not prove Meta accepts your payloads or your approved templates; that is what the Meta test app and, later, the live review cover.
- Voice-note transcription is not simulated.
- The outbound allow-list for staging (TASK-032 S9) is separate: it limits who a non-test agency may message on staging.
