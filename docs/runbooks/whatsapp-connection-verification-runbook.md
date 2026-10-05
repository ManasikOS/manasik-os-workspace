# WhatsApp Connection — E11 Verification Runbook

Companion to `docs/whatsapp-meta-connection-implementation-plan.md` §5 E11. These are the
hardening assertions the plan calls for that need a live database/deployment to actually check —
run them once against a staging environment (never production data) before trusting the connection
layer with a second real tenant.

---

## 1. Cross-tenant isolation

**Setup** — two agencies, each with a `whatsapp_integrations` row:

```sql
-- As service_role / SQL editor
select id, agency_id, connection_mode, connection_key, phone_number_id
from whatsapp_integrations
order by created_at desc
limit 5;
```

Pick two rows for agencies A and B. Note A's `connection_key` (Mode A) or `phone_number_id`
(Mode B).

**1a — Neither agency can read the other's row over PostgREST.** Sign in to the app as a staff
member of Agency A (ADMIN or CEO), open browser devtools, and run against your Supabase URL with
that session's own JWT:

```bash
curl "$SUPABASE_URL/rest/v1/whatsapp_integrations?select=*" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer <agency-A-staff-jwt>"
```

**Expected:** exactly one row (Agency A's), never Agency B's. Repeat as a Agency B staff member.

**1b — A webhook signed with Agency A's app secret is rejected on Agency B's keyed URL.** Mode A
only. Using Agency A's own app secret (from their Meta app's Basic Settings — you'll need to ask
them, or use a test agency you control):

```bash
BODY='{"entry":[{"id":"fake","changes":[{"field":"messages","value":{}}]}]}'
SIG="sha256=$(echo -n "$BODY" | openssl dgst -sha256 -hmac "<agency-A-app-secret>" | cut -d' ' -f2)"

curl -X POST "https://<your-domain>/api/webhooks/whatsapp/<agency-B-connection-key>" \
  -H "Content-Type: application/json" \
  -H "X-Hub-Signature-256: $SIG" \
  -d "$BODY"
```

**Expected:** `401 Unauthorized`. Confirm via:

```sql
select agency_id, signature_valid, received_at
from whatsapp_webhook_events
order by received_at desc
limit 5;
```

The row this created should have `signature_valid = false` and `agency_id = null` — never
Agency B's id.

These rejected-request rows are **capped at 30 a minute** (SEC-7): once a minute has 30, further bad requests still get `401` but are
not stored, and the server logs one "Webhook requests with a bad signature" warning that minute. So if you run this test during a flood
of bad requests, your own row may be missing even though the `401` came back. Retry after a minute, or check the request logs.

---

## 2. Idempotency — no duplicate on a Meta redelivery

Meta redelivers on any non-`200`. Simulate it directly:

```bash
BODY='{"entry":[{"id":"<a-real-waba-id>","changes":[{"field":"messages","value":{
  "metadata":{"phone_number_id":"<a-connected-phone-number-id>"},
  "messages":[{"id":"wamid.TEST123","from":"94770000000","type":"text","text":{"body":"ping"}}]
}}]}]}'
SIG="sha256=$(echo -n "$BODY" | openssl dgst -sha256 -hmac "<the-right-app-secret>" | cut -d' ' -f2)"

curl -X POST "https://<your-domain>/api/webhooks/whatsapp" \
  -H "X-Hub-Signature-256: $SIG" -H "Content-Type: application/json" -d "$BODY"

# fire the exact same request again
curl -X POST "https://<your-domain>/api/webhooks/whatsapp" \
  -H "X-Hub-Signature-256: $SIG" -H "Content-Type: application/json" -d "$BODY"
```

**Expected:** first call → `{"status":"ok"}`; second → `{"status":"duplicate"}`. Confirm exactly one
row exists:

```sql
select count(*) from conversation_messages where external_message_id = 'wamid.TEST123';
-- expect 1
```

## 3. Billing idempotency

Same redelivery, but for a `statuses` payload carrying `pricing`:

```sql
select count(*) from whatsapp_message_charges where external_message_id = '<the wamid you tested>';
-- expect 1, even after replaying the status webhook that carries it
```

Re-run the nightly sync twice in a row for the same day and confirm `whatsapp_billing_daily` and
`whatsapp_rate_observations` don't double:

```bash
curl "https://<your-domain>/api/cron/whatsapp-billing-sync" -H "Authorization: Bearer $CRON_SECRET"
curl "https://<your-domain>/api/cron/whatsapp-billing-sync" -H "Authorization: Bearer $CRON_SECRET"
```

```sql
select day, phone_number_id, country_code, pricing_category, pricing_type, tier, count(*)
from whatsapp_billing_daily
group by 1,2,3,4,5,6
having count(*) > 1;
-- expect zero rows
```

## 4. Rate limit on the keyed webhook route

```bash
for i in $(seq 1 130); do
  curl -s -o /dev/null -w "%{http_code}\n" -X POST \
    "https://<your-domain>/api/webhooks/whatsapp/<any-connection-key-real-or-fake>" \
    -H "Content-Type: application/json" -d '{}'
done | sort | uniq -c
```

**Expected:** the first ~120 return `200` (unsigned → recorded as invalid, still 200/401 per the
existing signature check — the point here is only that they're *accepted for processing*, not
rejected for volume), and the remainder return `429`. Confirm no rows piled up in
`whatsapp_webhook_hits` beyond the 10-minute prune window:

```sql
select connection_key, count(*), max(hit_at) from whatsapp_webhook_hits group by 1;
```

## 5. Burst load — no duplicate replies

With two test WhatsApp numbers across two staging agencies, send ~50 messages to each within a
short window (a WhatsApp Business API sandbox, or by hand). Confirm:

```sql
select conversation_id, count(*) from conversation_messages
where role = 'assistant' and created_at > now() - interval '10 minutes'
group by conversation_id
having count(*) > (
  select count(*) from conversation_messages cm2
  where cm2.conversation_id = conversation_messages.conversation_id and cm2.role = 'user'
);
-- more assistant replies than customer messages in the same window is the
-- signature of a duplicate-reply bug; expect zero rows
```

---

## What passing this runbook means

Sections 1–4 can be run today, on your own staging setup, without new infrastructure. Section 5
needs a real (or sandboxed) WhatsApp number and is worth doing once before onboarding a second
paying agency — it's the one failure mode (duplicate AI replies under load) that reaches a real
customer's phone if it's wrong.

None of this replaces an automated test suite — this repo has none yet (no `vitest`/`jest` in
`package.json`). If test coverage becomes a priority, that's a separate decision (which framework,
how to seed a test Supabase project) worth its own conversation rather than folding into this plan.
