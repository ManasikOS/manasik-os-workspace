# Messenger — Meta setup and first end-to-end test

The manual steps to take the Messenger channel (Phases 2–4 of
[`../modules/messenger-instagram-ai-agent-implementation-plan.md`](../modules/messenger-instagram-ai-agent-implementation-plan.md))
from "built and unit-tested" to "proven against real Meta", then to App Review.

Written 2026-09-19. **Meta moves dashboard menus often.** Steps marked **(docs)** were checked against
Meta's documentation on that date; steps marked **(from memory)** were not, so if a menu is not where
this says, search the App Dashboard for the setting's name rather than assuming the step is wrong.

**Instagram is not covered beyond §12** — it is Phase 5 and is not built yet.

---

## 0. What you need before starting

| Need | Why |
|---|---|
| The Meta app you already use for WhatsApp (**Manasik OS**) | One app serves every channel (plan D2). Do not create a second one. |
| A **test Facebook Page** you administer — create a new one, do not use the agency's real Page | So a mistake never reaches a real customer |
| **Account A**: a personal Facebook account that is an admin of that test Page | Connects the Page in the CRM |
| **Account B**: a *different* personal Facebook account | Plays the customer |
| Both accounts added to the app's **Roles** (§5) | **Until Advanced Access is approved, Meta only delivers messages from people who have a role on the app** **(docs)**. Account B without a role sends messages that never arrive — the most common false alarm. |
| Awareness that the database is **live** | There is no branch or dev copy (§1). The migrations are additive and the data is small, but the WhatsApp connection is real. |
| The CRM logged in as an **ADMIN** | Only `editIntegrations` can connect a Page |

---

## 1. Apply the three migrations

They are additive. Apply **in this order**:

1. `supabase/migrations/20261129090000_messenger_channel_foundation.sql` — `channel_webhook_events`, `channel_connections.ai_enabled`, the global Page-uniqueness index, the `RECONCILE_ECHO` job kind
2. `supabase/migrations/20261129090100_channel_vault_functions.sql` — `channel_store_token` / `channel_read_token` / `channel_delete_token`
3. `supabase/migrations/20261129090200_phone_less_leads_and_agent_run_channel.sql` — `leads.preferred_channel` accepts `INSTAGRAM`/`MESSENGER`; `agent_runs.channel`

> **Read this before running `supabase db push`.** As of 2026-09-19 the CLI is linked to the project
> **Manasik OS** (`klognjpwmqwlgeibvanf`) — the only project, holding live WhatsApp data (one agency, one
> connected number) — and it has **no Supabase branches**, so there is no disposable copy. `db push` there
> stops with *"Remote migration versions not found in local migrations directory"*: nine migrations were
> applied straight to the database (recorded under the time they ran, `20260918…`/`20260919…`) and saved
> locally under later sequence numbers (`20261124…`–`20261128…`), so the two histories disagree.
>
> **Do NOT run only the `migration repair --status reverted …` command the CLI prints.** It marks the nine
> remote migrations as reverted but leaves their local twins unapplied, so the next push would **re-run all
> nine** (including `lock_down_definer_functions` and `reset_agency_data_service_role_only`) against the live
> database. The repair must be done in both directions, below.

**Option A — SQL editor (simplest, no history fix).** Supabase dashboard → SQL editor → paste and run each of
the three files in order. Fine while the data is this small; the history mismatch stays.

**Option B — repair the history once, then `db push` works from now on.** Each pair below is the same
migration under two version numbers (matched by name; verified against the remote list on 2026-09-19).
Run **both** commands, then dry-run, and only push if the dry run lists **exactly the three Messenger files**:

```powershell
# 1. the nine remote versions that have no local file
supabase migration repair --status reverted 20260918144826 20260918150346 20260918151006 20260918174727 20260918175014 20260919011825 20260919041243 20260919055324 20260919055427

# 2. their local twins (plus 20261126090002, whose effect — the OpenRouter model rates — is already in the database)
supabase migration repair --status applied 20261124090000 20261125090000 20261125090001 20261126090000 20261126090001 20261126090002 20261127090000 20261127090100 20261128090000 20261128090100

# 3. MUST list only 20261129090000, 20261129090100, 20261129090200. Anything else: stop.
supabase db push --dry-run

# 4. only then
supabase db push
```

`repair` edits only the migration bookkeeping table, not your data. If step 3 shows any other file, do not push.

Live-schema assumptions these migrations make were checked read-only on 2026-09-19: `agent_jobs_kind_check` and
`leads_preferred_channel_check` exist under those names; `channel_webhook_events`, the `channel_*_token`
functions and the new columns do not exist yet; `supabase_vault`, `pg_net` and `pg_cron` are installed.

**Check it worked** (run in the SQL editor):

```sql
-- 1. new table + columns exist
select column_name from information_schema.columns
 where table_schema = 'public' and table_name = 'channel_connections'
   and column_name in ('ai_enabled', 'credential_expires_at');            -- expect 2 rows

select to_regclass('public.channel_webhook_events');                       -- expect the table name, not null

-- 2. vault functions exist and are NOT callable by staff sessions
select proname from pg_proc where proname in ('channel_store_token','channel_read_token','channel_delete_token'); -- expect 3

-- 3. WhatsApp connections were switched on, not off
select provider, ai_enabled, count(*) from public.channel_connections group by 1, 2; -- WHATSAPP rows: ai_enabled = true

-- 4. job kind + lead channel + run channel
select pg_get_constraintdef(oid) from pg_constraint where conname = 'agent_jobs_kind_check';          -- contains RECONCILE_ECHO
select pg_get_constraintdef(oid) from pg_constraint where conname = 'leads_preferred_channel_check';  -- contains MESSENGER
select column_name from information_schema.columns where table_name = 'agent_runs' and column_name = 'channel'; -- 1 row
```

If check 4's first query returns a *second* `agent_jobs` check constraint, the original had a different
name than assumed: drop it by name, or `RECONCILE_ECHO` jobs will be rejected.

---

## 2. A public HTTPS address for local testing

Meta must be able to call your webhook, and it **rejects self-signed certificates and needs `200 OK`
within 5 seconds** **(docs)**. `npm run dev` serves a self-signed certificate on `localhost`, which Meta
cannot use. So:

1. Run the plain-HTTP dev server (there is a launch config for it, `crm-dev-http`):
   ```powershell
   npm run dev:http
   ```
2. Put a tunnel with a **valid public certificate** in front of it. Either:
   ```powershell
   ngrok http 3000                       # free plan gives a static domain — use it (see below)
   cloudflared tunnel --url http://localhost:3000
   ```
3. **Use a stable address.** A random tunnel URL changes every run, and you would have to re-enter it in
   three Meta settings each time. An ngrok static domain or a named Cloudflare tunnel avoids that.

Call the tunnel address `https://TUNNEL` below.

Two app settings that trip people up here:

- **`NEXT_PUBLIC_SITE_URL`** — if set (production sets it), the connect flow uses it as the OAuth
  `redirect_uri` instead of the tunnel address, and Meta will refuse the login. **Unset it in `.env.local`
  for this test**, or set it to `https://TUNNEL`. (`lib/site-url.ts`)
- **`allowedDevOrigins`** — Next.js dev mode can block the dev assets when a page is opened from a domain
  other than `localhost`, leaving the CRM unhydrated (buttons dead). It is not set in `next.config.ts`.
  If the CRM loads but does nothing through the tunnel, add `allowedDevOrigins: ["TUNNEL-HOSTNAME"]`
  (hostname only, no `https://`) to the config for the test. **(from memory)**

You will also have to **log in to the CRM again** on the tunnel address (cookies are per-domain).

---

## 3. Meta App Dashboard — add Messenger and the webhook

App Dashboard → **Manasik OS**.

1. **Add the product.** Add **Messenger** (in newer dashboards it may appear under *Use cases* as
   "Engage with customers on Messenger"). **(docs)**
2. **Configure the webhook.** Messenger → Settings (or Messenger API settings) → **Webhooks**. **(docs)**
   - **Callback URL:** `https://TUNNEL/api/webhooks/messenger`
   - **Verify token:** the value you put in `MESSENGER_VERIFY_TOKEN` (§6). Generate one:
     ```powershell
     [guid]::NewGuid().ToString("N")
     ```
   - Click **Verify and save**. Meta sends a GET to the URL; the dev server must be running with the token
     already in `.env.local` and **restarted**. A green result means the handshake worked.
   - Prove the handshake yourself first if it fails:
     ```powershell
     curl "https://TUNNEL/api/webhooks/messenger?hub.mode=subscribe&hub.verify_token=YOUR_TOKEN&hub.challenge=abc"
     # must print: abc      (a 403 means the token is wrong or MESSENGER_VERIFY_TOKEN is not set)
     ```
3. **Subscribe the webhook fields** for the **Page** object: `messages`, `messaging_postbacks`,
   `message_deliveries`, `message_reads`, `message_echoes`. **(docs)** These are the fields the handler
   acts on. (The CRM also subscribes each connected Page to the app when you connect it in §7 — both are
   needed: the app-level fields here, the per-Page subscription from the connect flow.)
4. **The app must be Live.** Meta's guide lists a published app as a prerequisite **(docs)**, and
   Instagram webhooks are not sent to apps in Development mode **(docs)**. The app already serves
   WhatsApp, so it is probably Live — check the toggle at the top of the dashboard.
5. Settings → Basic: add `TUNNEL-HOSTNAME` to **App Domains**. **(from memory)**

---

## 4. Facebook Login for Business — the connect configuration

This is what the "Connect with Facebook" button opens.

1. Add the **Facebook Login for Business** product. **(docs)**
2. Facebook Login for Business → Settings: add **`https://TUNNEL/`** (trailing slash, exactly) to
   **Valid OAuth Redirect URIs**. Keep the production domain's `https://<domain>/` there too — WhatsApp
   already uses the site root. **(from memory)**
3. **Configurations → Create configuration.** **(docs)**
   - **Name:** e.g. `Manasik Messenger connect`
   - **Token type:** see the note below.
   - **Assets:** **Pages**.
   - **Permissions:** `pages_messaging`, `pages_manage_metadata`, `pages_show_list`. Meta also requires
     `email` and `public_profile` alongside at least one business permission **(docs)**.
4. Save. Meta shows a **Configuration ID**. Put it in `META_MESSENGER_CONFIG_ID` (§6).

> **Token type — choose "System-user access token" if it is offered, and tell me what you saw.**
> Meta's guide says a system-user token "defaults to never expire" **(docs)** and a user token "expires
> quickly" **(docs)**. The connect code gets a Page token from whichever it receives and stores it; it does
> **not** yet exchange a user token for a long-lived one. With a *user-token* configuration the stored Page
> token may therefore expire within hours, and Messenger would stop sending until someone reconnects.
> This is an untested gap (plan finding F15). Two ways to find out: run the test in §8 and, **the next
> day**, press **Test Connection** on the card; or tell me which token type your configuration produced and
> I will add the exchange and an expiry check. Do not treat Messenger as production-ready until this is settled.

---

## 5. App roles — who is allowed to talk to the Page

App Dashboard → **App roles → Roles**. **(docs: Standard Access covers people with app roles)**

- Add **Account A** and **Account B** as **Developer** or **Tester** (Administrator also works).
- Each must **accept** the invitation: they open `developers.facebook.com/requests` (or the notification)
  while logged in as that account.
- Account A must be an **admin of the test Page** (Page settings → Page access) — otherwise the login in §7
  shares no Page.

---

## 6. Environment variables

`.env.local` (all documented in `.env.example`):

```bash
META_APP_ID=                       # already set (WhatsApp)
META_APP_SECRET=                   # already set — signs Messenger webhooks too
META_GRAPH_VERSION=v25.0           # set explicitly; the code falls back to v21.0 otherwise
MESSENGER_VERIFY_TOKEN=            # the token from §3
META_MESSENGER_CONFIG_ID=          # the Configuration ID from §4
NEXT_PUBLIC_SITE_URL=              # leave EMPTY for the tunnel test (see §2)
```

**Restart the dev server after changing them.** Nothing is picked up live.

---

## 7. Connect the test Page in the CRM

1. Open `https://TUNNEL/management/settings/integrations`, logged in as ADMIN.
2. The **Messenger** card is beside WhatsApp. Press **Connect with Facebook**.
   - "not configured … META_MESSENGER_CONFIG_ID is missing" → §6 was not applied / server not restarted.
3. Log in as **Account A** on Facebook, tick the **test Page**, approve.
4. You return to Integrations. **Expected:** the card says **Connected** with the Page name. If you shared
   more than one Page it asks "Which Facebook Page…" first.
5. Confirm in SQL:
   ```sql
   select provider, provider_account_id, display_name, status, ai_enabled,
          credential_ref is not null as has_token, last_inbound_at
     from public.channel_connections where provider = 'MESSENGER';
   -- expect: status CONNECTED, ai_enabled false (the assistant starts OFF), has_token true
   ```

---

## 8. The end-to-end test

Run in order. Use **Account B** as the customer, on the test Page's Messenger (messenger.com or the app).

| # | Do | Expected | If not |
|---|---|---|---|
| **T1** | Account B sends "Salam, Umrah in March?" to the Page | Within seconds a **Messenger** conversation appears in the Inbox, marked **waiting for staff** (the assistant is off). A lead exists with source **Facebook** and **no phone** ("No phone yet"). The card's "Last message received" updates. | §10 |
| **T2** | Inbox → **Take control**, reply "Hello from the team" | Arrives in Account B's Messenger. Ticks progress to delivered/read. The conversation stays **Human active**. | §10 |
| **T3** | As staff, send a **long** reply (paste ~2,500 characters) | Arrives as **2 or more messages in order**, none cut mid-word. The conversation does **not** flip state. | Records the real text limit — see §9 |
| **T4** | AI Agent page → turn the assistant **on**. Card → switch **Let the assistant reply on Messenger** on. Inbox → **Release to AI**. Account B sends "What departures do you have?" | A reply within ~10 s that **says it is an automated assistant** and answers from live departures. Wait **60 s**: the conversation must still be **AI active**. | If it flips to **Human active**, the echo of our own send was mistaken for a person — **stop and send me the rows from §9.** |
| **T5** | Account B: "I'm interested in booking" → assistant asks for a number → Account B types `0771234567` | The lead now shows the number. A note says it was typed and **unverified**. | — |
| **T6** | Repeat T5 with a number that **already belongs to another lead** | The lead does **not** get the number and is **not** merged. A staff note names the matching lead reference. The customer sees only a thank-you. | Any merge here is a security bug — stop and tell me. |
| **T7** | As **Account A**, open the Page's own inbox (Meta Business Suite → Inbox, or facebook.com Page inbox) and reply to Account B by hand | Within ~10–60 s the CRM conversation flips to **Human active**, the message shows as **Messenger Page inbox**, and the assistant stays quiet. | — |
| **T8** | Card → **Disconnect**. Account B sends a message. Then **Connect** the same Page again | After disconnect the message is **not** stored (webhook answers 200, "unknown page"). After reconnect the **old conversations are still there**, and the assistant switch is back to **off**. | — |

---

## 9. What to record — this settles the plan's "Verify" items

Pull the raw deliveries after T1–T7:

```sql
select received_at, signature_valid, agency_id is not null as resolved,
       payload -> 'entry' -> 0 -> 'messaging' -> 0 as event
  from public.channel_webhook_events
 where provider = 'MESSENGER'
 order by received_at desc limit 40;
```

Send me (or write down) these — each one confirms or corrects a decision already built:

| Question | Where to look | Why it matters |
|---|---|---|
| **`message.app_id` on the echo of the assistant's own reply (T4)** — present? does it equal `META_APP_ID`? | An event with `"is_echo": true` right after the AI reply | Own-echo recognition (F6). Not equal / absent → we rely only on the 10-second deferral. |
| **`message.app_id` on the echo of your hand-typed Page-inbox reply (T7)** — present or absent? | The echo at T7 | Whether we can tell a person from an app without the deferral |
| **Token type the connect produced** | §4 note; and whether the card still works next day | F15 / token expiry |
| **Any `signature_valid = false`** | column above | Wrong `META_APP_SECRET` (a different app's secret) |
| **Real text limit** — did the ~2,500-character message split, and where? | T3 | Profile says 2,000 characters; unconfirmed |
| **Customer's real name** — did the placeholder "Messenger customer" become a name? | T1 | Needs "Business Asset User Profile Access"; expected to stay a placeholder until it is approved |
| Latency of the assistant's reply | `select latency_ms from agent_runs where channel='MESSENGER' order by created_at desc limit 5;` | Meta's 30-second rule (plan §14.1) |

---

## 10. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| The message arrives in the Inbox and the assistant runs, but no reply reaches the customer; the thread shows "The assistant's reply could not be delivered on Messenger" (Meta error 10: *Cannot message users who are not admins, developers or testers of the app*) | The app is in Development mode and this customer account has no role on it | App Dashboard → App roles → add the account as **Tester**, and have it accept the invitation (developers.facebook.com/requests). Or make the app Live once `pages_messaging` is approved. |
| Meta: "callback URL couldn't be validated" | Server not reachable, tunnel down, verify token mismatch, or `MESSENGER_VERIFY_TOKEN` unset | Run the `curl` in §3; restart the server after editing `.env.local` |
| Connect says "did not share any Facebook Page" | Account A is not a Page admin, or the Page was not ticked | Fix the role (§5); run Connect again and tick the Page |
| Connect says "not sending … messages to this app yet" | The app is not Live, or the app-level fields in §3 are not subscribed | §3 steps 3–4 |
| Connect says a Page is "already connected to another agency" | Working as intended: one Page, one agency | Disconnect it from the other agency first |
| Account B's message never arrives | Account B has **no role on the app** (§5), or the Page is not subscribed | Add the role; check `channel_webhook_events` for the delivery |
| Deliveries arrive but the webhook returns **500** | A migration is not applied (the log names the missing column/table) | §1 |
| `channel_webhook_events.signature_valid = false` | `META_APP_SECRET` belongs to a different app | Use the secret of the app that owns the webhook |
| CRM replies never arrive | Outbox dead-lettered | `select status, last_error from outbox_messages order by created_at desc limit 5;` |
| A staff send says "outside the 24h reply window" | Correct — Meta only allows replies within 24 h of the customer's last message | Have Account B write again |
| Buttons do nothing when opened through the tunnel | Dev assets blocked cross-origin | `allowedDevOrigins` (§2) |

---

## 11. App Review — Messenger

Do this **only after §8 passes**. Advanced Access is what lets people **without a role on the app** reach an
agency's Page (F16).

**Before submitting**

- [ ] §8 passed end to end, recorded on video (below)
- [ ] The app is **Live**; **Business Verification** covers the same Business Portfolio (already done for WhatsApp — confirm)
- [ ] **Privacy Policy and Data Deletion pages mention Messenger and Facebook Pages.** *They currently mention only WhatsApp* (`app/legal/privacy`, `app/legal/data-deletion`) and Meta's reviewers read them. They need a Messenger section (what is stored: message text, the customer's page-scoped id, profile name if granted; how an agency disconnects a Page; how a customer requests deletion). **This is a code/content change — ask me to do it.**
- [ ] A working **Disconnect** (built) and a **data deletion callback** or instructions URL (the page exists)

**Permissions to request**

| Permission / feature | For |
|---|---|
| `pages_messaging` | Sending and receiving Messenger messages on a connected Page |
| `pages_manage_metadata` | Subscribing a connected Page to our webhook |
| `pages_show_list` | Letting the agency choose which of its Pages to connect |
| `public_profile` (Advanced) | Required for Facebook Login for Business **(docs)** |
| **Business Asset User Profile Access** (feature) | Showing the customer's name in the Inbox. Without it names stay "Messenger customer". |
| **Human Agent** (feature) — *optional* | Staff replying between 24 hours and 7 days. Not built yet; skip for launch. |

**Draft justification (edit, then paste)**

> Manasik OS is an operations CRM for Hajj & Umrah travel agencies. An agency connects its own Facebook Page
> so customers who message that Page reach the agency's shared Inbox, where staff reply from the CRM. Where
> an agency turns it on, an automated assistant answers common questions from that agency's own trip data,
> tells the customer it is automated, and hands over to a person on request. We use `pages_messaging` to
> send and receive those messages, `pages_manage_metadata` to subscribe only the Page the agency chose, and
> `pages_show_list` so the agency can choose it. Data is scoped to the one agency that connected the Page;
> we never message people who have not written to the Page first.

**Screen recording** (the CRM's own UI, not a terminal; under ~3 minutes; narrate as you click)

1. Integrations → **Connect with Facebook** → choose the Page → "Connected".
2. Customer account sends a message → it appears in the Inbox.
3. Staff reply from the Inbox → shown arriving in Messenger.
4. Assistant on: a customer question → the reply that **states it is automated** → "talk to a person" → handoff.
5. **Disconnect**.

---

## 12. Instagram — built; see its own runbook

> Instagram is now built, with its own onboarding — see [instagram-meta-setup-and-test.md](instagram-meta-setup-and-test.md).
> The notes below were written before that and describe the alternative (Instagram Business Login) path.

Instagram permissions cannot be reviewed until there is a working flow to record, so nothing here is
urgent. Preparing costs nothing:

- Have a **test Instagram account switched to Professional (Business or Creator)** — personal accounts
  cannot use the messaging API **(docs)**.
- Expect **two more values** in the dashboard when the Instagram product is added: an **Instagram app ID**
  and **Instagram app secret**, separate from the Meta app's. Which secret signs Instagram webhooks is
  unconfirmed (plan F9). **(docs for the two-login-models split; from memory for the separate secret)**
- Expect to add your test account as an **Instagram Tester** and to switch on **Allow access to messages**
  in the Instagram app's privacy settings for connected tools. **(from memory — verify)**
- Instagram long-lived tokens last **60 days** and must be refreshed **(docs)** — Phase 5 builds the job.

---

## 13. Going to production (after §8 and §11)

- [ ] Apply the three migrations to **production** (in order, §1) — during a quiet period
- [ ] Set `MESSENGER_VERIFY_TOKEN`, `META_MESSENGER_CONFIG_ID`, `META_GRAPH_VERSION=v25.0` in the host's environment; leave `NEXT_PUBLIC_SITE_URL` set to the production domain
- [ ] Meta: webhook callback → `https://<production domain>/api/webhooks/messenger`; add `https://<production domain>/` to Valid OAuth Redirect URIs
- [ ] Advanced Access approved (§11)
- [ ] One real test with a customer account that has **no** app role
- [ ] Assistant stays **off** per agency until that agency turns it on (default)
- [ ] After a week, run the latency query in plan §14.1; claim the "automated" flag only if p95 is well under 30 s
