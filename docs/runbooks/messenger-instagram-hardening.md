# Runbook — Messenger and Instagram hardening (Phase 8)

Owner: whoever administers the Meta app · Last updated: 2026-09-19 · Branch `meta-messaging-unified-connect`

What Phase 8 added, how to check it, and what to configure in Meta. Facts are tagged **(docs)**, **(from memory —
verify)** or **(verify)** as in the other Meta runbooks.

---

## 1. What is enforced, and where it is pinned

| Guarantee | How | Test |
| --- | --- | --- |
| **No duplicate reply.** A message delivered three times at once queues one reply job | A unique index on the message; the handler treats "already stored" as a redelivery | `lib/channels/hardening-burst.test.ts` — 100 messages × 3 concurrent deliveries, two agencies, Messenger and Instagram |
| **No cross-agency row.** An event is only processed through the connection that owns the account it names | Tenant gate on the account id; every write carries the agency id | same file — spoofed, mixed-account and receipt/read cases |
| **A colleague's reply is recorded once** even if its echo is reconciled several times at once | `reconcileEcho` + the message unique index | same file |
| **A forged "which account?" cookie reads nothing.** The cookie holding a parked login is sealed to the agency that started it | HMAC over agency id + Vault reference | `lib/channels/pending-token-cookie.test.ts` |
| **No token, secret, header or OAuth code in a log** | Static audit of every `console.*` in the Meta channel code, plus runtime checks on error text | `lib/channels/redaction-audit.test.ts` |
| **No customer message in a database-error log.** A failed insert's `details` can quote the row | `describePersistenceCause` keeps only the code and message | same file |
| **A forged Meta callback changes nothing** | `signed_request` HMAC check with a timing-safe compare; an empty secret never verifies | `lib/meta/signed-request.test.ts`, `user-callbacks.test.ts` |
| **A campaign never counts a phone-less lead as reachable by WhatsApp** | `missingContactExclusion` | `lib/data/campaign-audience-rules.test.ts` |

The burst test simulates the handler with an in-memory store that enforces uniqueness the way the real index does;
it does not run against Postgres. WhatsApp has its own handler and is not in that simulation — its idempotency is
the same unique index (`lib/inbox/ingest.test.ts`).

---

## 2. Meta's deauthorize and data-deletion callbacks

Two routes, both under `/api/webhooks` (so the session redirect does not apply):

| Route | Meta setting | Answers |
| --- | --- | --- |
| `POST /api/webhooks/meta/deauthorize` | **Deauthorize Callback URL** | `200 {}`; `400` for a forged request |
| `POST /api/webhooks/meta/data-deletion` | **Data Deletion Request Callback URL** | `{ "url": "…/legal/data-deletion/status?code=…", "confirmation_code": "…" }` |

**Configure (from memory — verify the labels in your dashboard):**
1. App Dashboard → **Facebook Login for Business → Settings** → *Deauthorize callback URL* =
   `https://<domain>/api/webhooks/meta/deauthorize`.
2. App Dashboard → **App settings → Basic** → *Data Deletion Request URL* → choose **Data deletion request callback URL**
   = `https://<domain>/api/webhooks/meta/data-deletion`. (The existing *Data Deletion Instructions URL*,
   `/legal/data-deletion`, is the alternative Meta accepts; use one or the other.)
3. Meta's dashboard has a **test** button for each; it must return 200.

**What they do.** Every Messenger and Instagram connection records the Meta user who signed in to create it
(`provider_metadata.meta_user_id`). When Meta reports that user removed the app or asked for deletion, every live
connection that user made is **disconnected and its stored token deleted**, across agencies. The confirmation code is
stateless (signed with the app secret): the status page can tell a code we issued from an invented one, shows no
personal data, and states plainly what was and was not removed.

**What they do not do.** Conversations and business records belong to the agency, not to the person who connected the
account, so they are kept; the status and instructions pages say so and how to ask for them to be deleted. A Meta
user id that matches nothing — a system-user token, or someone who connected nothing — is a normal no-op.

**Verify:** connections made *before* this change have no `meta_user_id`, so a callback cannot find them; reconnect
once (or accept that they are disconnected only by hand). Whether a system-user token's `user_id` is the same one
Meta names in a callback is unconfirmed — check with the Dev-mode test below.

**Test in Dev mode:**
```powershell
# a forged request must be refused (expect 400)
curl -k -X POST -d "signed_request=abc.def" https://TUNNEL/api/webhooks/meta/deauthorize
```
Then use the dashboard's test button for each callback (expect 200), connect a Page, remove the app in your Facebook
settings, and confirm the card shows **Not Connected** and `channel_connections.credential_ref` is null.

---

## 3. The tenant-isolation check (SQL)

Run after any Dev-mode session with two agencies:

```sql
-- No message may sit under an agency other than its conversation's
select count(*) as cross_agency_messages
  from public.conversation_messages m
  join public.conversations c on c.id = m.conversation_id
 where m.agency_id <> c.agency_id;                                  -- expect 0

-- No conversation may be tied to a connection of another agency
select count(*) as cross_agency_conversations
  from public.conversations c
  join public.channel_connections cc on cc.id = c.connection_id
 where c.agency_id <> cc.agency_id;                                 -- expect 0

-- One reply job per customer message
select payload->>'messageId' as message_id, count(*)
  from public.agent_jobs
 where kind = 'PROCESS_INBOUND' and payload ? 'messageId'
 group by 1 having count(*) > 1;                                    -- expect no rows

-- The same assistant text sent twice in a row within a minute (a duplicate reply that got past the job check)
select a.conversation_id, a.created_at
  from public.conversation_messages a
  join public.conversation_messages b
    on b.conversation_id = a.conversation_id and b.id > a.id
   and a.role = 'assistant' and b.role = 'assistant' and b.content = a.content
   and abs(extract(epoch from (b.created_at - a.created_at))) < 60;   -- expect no rows

-- No secret in a column: a connection row must hold a Vault reference, never a token
select id, provider from public.channel_connections
 where credential_ref is not null and credential_ref !~ '^[0-9a-f-]{36}$';   -- expect no rows
```
All of these were run against the live database on 2026-09-19 and returned zero / no rows.

## 4. Redaction check on a real run

After the Dev-mode test, search your host's logs for the strings `EAA` (Meta tokens start with it), `Bearer`,
`access_token`, `client_secret`, `signed_request` and a customer's message text. Expect none. A hit is a defect —
send me the line.

---

## 5. Known limits (not defects)

- Every raw webhook delivery is kept in `channel_webhook_events` (the audit floor), including customer message text.
  There is no retention job yet; decide a period and add one before production.
- WhatsApp's own callbacks are unchanged: its connections do not record a Meta user, so a deauthorize callback does not
  disconnect WhatsApp — disconnect it from Settings.
- The partial-send case (part 2 of a split reply fails after part 1 was delivered) can resend part 1 on retry. Only
  reachable for staff text over the channel limit.
- Token lifetime of a Page token from a system-user token is still a **Verify** item (plan F15).
