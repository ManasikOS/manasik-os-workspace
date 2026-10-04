# WhatsApp Connection — Basic Setup **and** One-Click Meta Login

**Implementation plan. Nothing here is built yet; this document is the contract for building it.**

Companion to `docs/whatsapp-ai-agent-implementation-plan.md`, which covers everything *after* a
number is connected (webhook → conversation → agent → booking). This plan covers only the
**connection layer**: how an agency's WhatsApp Business number becomes ours to send from, and how we
get Meta's permission to do that on other people's behalf.

---

## 0. The situation, stated plainly

You have a verified Meta business portfolio and a Meta app with the WhatsApp use case. That is
**Basic Setup**: you can run *your own* number on the Cloud API today, with no further approval.

You do **not** have Tech Provider status, because Meta gates it behind App Review for Advanced
Access on `whatsapp_business_messaging` and `whatsapp_business_management`, and App Review requires
**evidence that your app actually uses the API** — specifically two screen recordings:

1. a message being created, sent from your app, and received in a WhatsApp client;
2. your app creating a message template.

(Screen recordings of the API Setup cURL flow or WhatsApp Manager are accepted substitutes.)

That is the "proof of basic setup usage and policy" you were asked for. **It is not a chicken-and-egg
problem — it is a sequence.** Basic Setup is the thing that produces the evidence that unlocks Tech
Provider, which unlocks Embedded Signup (one-click Meta login) for every other agency.

So this plan has two tracks that run in parallel and join at one gate:

```text
Track M (Meta / calendar time)
  M1 Basic Setup live on our own number
     → M2 evidence pack (2 screencasts, policy pages, app settings)
        → M3 App Review: Advanced Access ×2
           → M4 Tech Provider enrolment + Access Verification
              ────────────────────────────────────────────▶ GATE ▶ Embedded Signup goes live

Track E (engineering)
  E1 schema ─ E3 Graph client ─ E2 BYO connect ─ E5 webhooks ─ E6 token lifecycle ─ E8 templates
                                                    └─ E10 billing tracker ─┘
                                                                     └─ E4 Embedded Signup ─┘ (gated)
```

**Neither track blocks the product.** Mode A (Basic Setup / bring-your-own Meta app) is shippable to
paying agencies *now*, and every downstream byte — webhook, conversation, agent, booking — is
identical in both modes. Embedded Signup only changes *how the row in `whatsapp_integrations` gets
populated*.

**And one consequence runs through both.** Because we are a Tech Provider and not a Solution
Partner, Meta bills each agency **directly** (F5) — we never see an invoice, and neither does the
agency until it arrives. That is precisely why the CRM has to show them what they are spending, as
they spend it. §5 E10 is that: a per-agency WhatsApp billing and usage tracker, fed by Meta's own
cost data and attributed by the CRM to the lead, conversation and staff member that caused it.
It is not a side feature of this plan; it is the other half of "you pay Meta yourself".

---

## 1. What already exists in this repo

Honest inventory, so the plan below is edits and not a rewrite.

| Piece | File | State |
|---|---|---|
| Graph HTTP client | `lib/whatsapp/client.ts` | Send text/interactive/template, mark read, media download, `verifyConnection`, `subscribeApp`, `registerPhoneNumber`, `exchangeCodeForToken`. **Missing:** `debug_token`, shared-WABA lookup, two-step PIN, phone-number listing, template CRUD, subscription readback |
| Token storage | `lib/whatsapp/vault.ts` + `whatsapp_store_token` / `whatsapp_read_token` RPCs | Working. Vault-backed, `service_role` only. Good — keep |
| Webhook signature | `lib/whatsapp/signature.ts` | Correct (raw body, timing-safe). **But** hardcoded to one app secret — see §3 D3 |
| Webhook route | `app/api/webhooks/whatsapp/route.ts` | Verify handshake, signature, idempotency, tenant gate by `phone_number_id`, job enqueue. Handles `messages` + `statuses` only |
| Embedded Signup (browser) | `.../integrations/whatsapp-connect-card.tsx` | FB SDK loader, `FB.login` with `config_id`, `postMessage` listener for `WA_EMBEDDED_SIGNUP`. **Untested against a live config; several v4 gaps — §5 E4** |
| Embedded Signup (server) | `.../integrations/whatsapp-actions.ts` → `connectWhatsApp()` | Exchange → verify → subscribe → Vault → upsert. **Does not** register the number, set a PIN, or resolve the WABA server-side |
| BYO-token connect | same file → `connectWhatsAppDirect()` | Exists. Verifies + stores. **Not** production-grade: no scope validation, no registration, no per-tenant webhook wiring |
| Schema | `supabase/migrations/20260825090000_whatsapp_channel.sql` | `whatsapp_integrations` (one per agency, globally unique `phone_number_id`), `whatsapp_webhook_events`, `conversations`, `conversation_messages`, `agent_jobs` |
| AI token accounting | `agent_runs` in `20260826090000_ai_agent.sql` | `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_creation_tokens` per run, joined to `conversation_id`. **No cost column** — D12 adds the rate table that turns these into money |
| Cost / usage tracking | — | **Nothing exists.** No charge rows, no analytics sync, no billing screen. §5 E10 in full |
| CSP | `next.config.ts` | Route-scoped allowance for `connect.facebook.net` / `graph.facebook.com` / `frame-src facebook.com` on the integrations route only. Good |
| Env | `.env.example` | `META_APP_ID`, `META_APP_SECRET`, `META_CONFIG_ID`, `META_GRAPH_VERSION`, `WHATSAPP_VERIFY_TOKEN` |

**Conclusion:** roughly 60% of the happy path for Embedded Signup is scaffolded, ~30% of the BYO
path, and 0% of billing. What is missing is everything that makes either mode survive contact with a
real tenant — registration, token lifecycle, per-tenant webhook identity, account-state webhooks,
the cost of it all, and the UI that explains any of it.

---

## 2. What Meta's rules force on the design

Sourced from Meta's current Business Messaging docs (see §11 for links). These are constraints, not
preferences.

**F1 — Two permissions, Advanced Access, App Review.** `whatsapp_business_messaging` (send on behalf
of clients) and `whatsapp_business_management` (reach clients' WABAs). Standard Access only reaches
assets whose roles include our own developers/testers — i.e. our own number. Advanced Access is the
whole difference between Mode A and Mode B.

**F2 — App Review evidence is a demo of working software.** Two videos as listed in §0. Plus app
icon, category, privacy policy URL, terms URL, and Data Deletion Instructions/callback. An app with
no icon and a dead privacy-policy link is rejected before anyone watches the video.

**F3 — Business Verification is separate from, and prior to, App Review.** Done, on your side.
2FA on the business portfolio is also required for the Tech Provider program.

**F4 — Tech Provider onboarding limits.** After enrolment you may onboard ~10 businesses per week;
completing Business Verification + App Review + **Access Verification** raises that to ~200/week.
Access Verification is a distinct step — plan for it, don't discover it.

**F5 — Tech Provider ≠ Solution Partner.** Solution Partners share a line of credit with the
businesses they onboard and get billed centrally. Tech Providers do not: **each agency must attach
its own payment method to its own WABA**, or every send fails. This must appear in onboarding copy,
in the connection UI as a distinct `UNFUNDED` state, and in your pricing conversation.

**F6 — Embedded Signup v4 mechanics.** `FB.login({ config_id, response_type: 'code',
override_default_response_type: true, extras: { setup: {}, … } })`, SDK ≥ v25.0. The returned
authorization **code expires in ~30 seconds** and must be exchanged server-side. The popup also
emits `window.postMessage` events of `type: "WA_EMBEDDED_SIGNUP"` with `event` ∈
`FINISH` | `FINISH_ONLY_WABA` | `CANCEL`, carrying `waba_id`, `phone_number_id`, `business_id`.
The origin check must accept any `*.facebook.com` origin, not only `https://www.facebook.com`.
Domains must be listed in the app's *Allowed Domains* and *Valid OAuth Redirect URIs*, with HTTPS
enforced and Strict Mode on.

**F7 — postMessage is a hint, not a source of truth.** A popup blocker, a cross-origin quirk, or a
user closing the window mid-flow loses it. The authoritative path is: exchange the code → call
`GET /debug_token` on the resulting token → read `granular_scopes` for the WABA ids our app was just
granted. Build the server flow to work with **only the code**, and treat `postMessage` data as an
optimisation and a UX signal.

**F8 — Post-signup onboarding is a sequence of Graph calls, not one.** Exchange code → debug_token →
`POST /{waba-id}/subscribed_apps` → `POST /{phone-number-id}/register` with a two-step PIN →
read back `/{waba-id}/subscribed_apps` and `/{waba-id}/phone_numbers` to confirm. Skipping
registration is the single most common reason a "successfully connected" number never receives a
message.

**F9 — Numbers coming off the WhatsApp Business *app* are a different flow.** The customer connects
their existing number inside the popup and confirms an OTP; chat history syncs. The Tech Provider
must **skip registration** (already registered), subscribe to three extra webhook fields — `history`,
`smb_app_state_sync`, `smb_message_echoes` — and complete sync **within 24 hours**, or the customer
must offboard and start over. Disappearing messages, view-once, live location and new broadcast
lists are permanently disabled on that number. **Most travel agencies are exactly this case.** Warn
before the popup, not after.

**F10 — Webhooks are per-field and per-WABA.** ~21 subscribable fields. Beyond `messages` we need
`account_update` (verification, eligibility, violations, disablement), `phone_number_quality_update`,
`message_template_status_update`, and `account_review_update`. `messages` needs
`whatsapp_business_messaging`; every other field needs `whatsapp_business_management`.

**F11 — Revocation is a first-class event, not an error.** An agency can remove our app from
Business Manager at any moment. Tokens die, sends start failing with an auth error, and the correct
response is to mark the integration `ERROR`, stop retrying, and put a re-connect banner in the
Inbox — never a retry loop against a dead token.

**F12 — Pricing is per-message, not per-conversation, since 1 July 2025.** You are charged when a
**template** is delivered, priced by the template's category and the recipient's country calling
code. Non-template messages are free inside the 24-hour customer service window, which opens when
the customer messages first. A *free entry point* conversation (from a Click-to-WhatsApp ad or a
page CTA) is free for 72 hours. **Volume tiers** cut the utility and authentication rate as monthly
volume rises; tiers aggregate across a business portfolio and reset monthly.

**F13 — Dated pricing changes are already scheduled and land inside this project's lifetime.**
1 July 2026 and 1 October 2026 move several markets onto standalone rate cards with adjusted utility
and authentication pricing; 1 August 2026 localises Brazil billing to BRL. **Any hardcoded rate card
is wrong on a known date.** See D11.

**F14 — Meta exposes cost through three WABA analytics fields**, all requiring
`whatsapp_business_management`:
- `analytics` — message volume sent/delivered. Params `start`, `end`, `granularity`
  (`HALF_HOUR`|`DAY`|`MONTH`), optional `phone_numbers`, `product_types`, `country_codes`.
- `conversation_analytics` — legacy conversation-based cost and counts. `metric_types`
  `COST`|`CONVERSATION`, dimensions by category, direction, type, country, phone.
- `pricing_analytics` — **the one that matters now.** `metric_types` `COST`|`VOLUME`;
  `pricing_categories` (authentication, marketing, service, utility, referral conversion);
  `pricing_types` (`REGULAR`, `FREE_CUSTOMER_SERVICE`, `FREE_ENTRY_POINT`); `dimensions` by country,
  phone number, pricing category, pricing type and **tier**.

Three constraints govern the whole design: costs are **approximate and may differ from the invoice**;
the lookback window is **one year** (10 years before 1 December 2025), and template analytics only
90 days; and **cost is withheld from businesses billed through a partner** — which, because we are a
Tech Provider (F5), is *not* our tenants. Direct billing is what makes this feature possible at all.

**F15 — Every delivered message reports its own billability on the webhook.** The `statuses` entry
carries a `pricing` object: `billable` (bool), `pricing_model` (`PMP` per-message / `CBP` legacy),
`category` (marketing | utility | authentication | service), and `type` (`regular`,
`free_customer_service`, `free_entry_point`). It gives category and billability per message id, but
**no price**. `account_update` additionally reports volume-tier changes (`tier_update_time`,
`pricing_category`, `tier`, `effective_month`, `region`) — and Meta may send several webhooks for
one tier switch, in which case the one with the **smallest `tier_update_time`** is authoritative.

**F16 — `debug_token` only introspects a token belonging to the SAME app (or one related to it via
Business Manager) as whoever calls it.** This was discovered the hard way, not from documentation
review: the original draft of D4 below assumed `debug_token` could resolve a Mode A token's WABA and
scopes the same way it resolves a Mode B one. It cannot. Mode A's entire premise is an agency's own,
unrelated Meta app — calling `debug_token` from OUR platform app against one of those tokens fails
outright with "Failed to debug_token the WhatsApp access token" **every single time**, not
intermittently. This is Meta's documented behaviour, not a bug to retry around.

**Consequence:** `debug_token` is correct and used for Mode B (where the token is issued by our own
app via Embedded Signup), and is **not called at all** for Mode A. Mode A instead verifies a token by
making the real, permission-gated Graph calls the connection flow needs anyway (`getWaba`,
`subscribeApp`, `registerPhoneNumber`) WITH the agency's own token, and infers what the token can do
from which calls actually succeeded — see `connectWhatsAppOwnApp()`'s doc comment in
`whatsapp-actions.ts`. Two follow-on effects: the WABA id can no longer be auto-detected for Mode A
(there is no `granular_scopes` to read without `debug_token`) and is a **required** field in that
wizard, not optional; and Mode A integrations carry no `token_expires_at` — classic system-user
tokens are usually permanent, and revocation is instead caught reactively, the same way a dead token
is always caught: a failed send (`classifyWhatsAppError`'s `TOKEN_DEAD`) or a failed
`listSubscribedApps` ping from the health cron (§5 E6).

---

## 3. Decisions

**D1 — One data model, two connection modes.** Add `connection_mode text` to
`whatsapp_integrations` with values `OWN_APP_TOKEN` (Mode A / Basic Setup) and `EMBEDDED_SIGNUP`
(Mode B). Nothing downstream of the integration row may branch on it except the connect UI, the
token-health job, and the disconnect path. If a third piece of code needs to know the mode, that is
a design smell to fix, not a branch to add.

**D2 — Mode A is a first-class product feature, not a stopgap.** It ships, it is documented, and it
stays after Tech Provider approval. Reasons: agencies who already run their own Meta app keep it;
larger tenants sometimes require their own app for billing and compliance; and it is the fallback
when Embedded Signup is broken by a Meta platform change, which does happen.

**D3 — In Mode A, the app secret and verify token are per-tenant.** This is the sharpest consequence
of Mode A and the current code gets it wrong. In Mode A the agency owns the Meta app, so Meta signs
the webhook with **their** app secret — `META_APP_SECRET` will never validate it. Therefore:

- the webhook endpoint becomes `POST|GET /api/webhooks/whatsapp/[connectionKey]`, where
  `connectionKey` is an opaque, unguessable per-integration slug we generate and the agency pastes
  into their app's webhook configuration;
- the per-tenant app secret and verify token are stored **in Vault**, resolved by `connectionKey`;
- the existing unkeyed `/api/webhooks/whatsapp` route stays, verifying against `META_APP_SECRET`,
  and serves every Mode B tenant on our own app. Two routes, one shared handler body.

**D4 — Resolve the WABA server-side, never trust `postMessage` alone.** For Mode B, `debug_token` is
the source of truth (F7); `postMessage` fills the UI in faster but never decides what we write.
~~For Mode A too~~ — **corrected by F16**: `debug_token` cannot introspect a token issued by the
agency's own, unrelated Meta app, so Mode A resolves the WABA from a field the agency types directly
(required, not inferred) and verifies the token by exercising it against real Graph calls instead.

**D5 — Registration and the two-step PIN are ours to own.** We generate a random 6-digit PIN per
integration, store it in Vault alongside the token, call `POST /{phone-number-id}/register`, and
surface it in the UI as a "recovery PIN" the agency can copy. Never `000000`. Never absent — a number
without a known PIN cannot be re-registered later without Meta support.

**D6 — Token expiry is a scheduled concern, not a discovery.** Embedded Signup with the standard
60-day configuration yields a token that expires; business/system-user tokens can be permanent. A
daily health job calls `debug_token`, writes `token_expires_at`, and raises a re-connect banner at
T-7 days. A dead token found by a failed customer message is a support ticket; found by the job it
is a notification.

**D7 — Template management gets built now, not later.** It is required evidence for App Review
(video 2), it is required for any message outside the 24-hour service window, and the agent already
needs it. Building it for the review is not throwaway work.

**D8 — Feature-flag the connect UI, don't fork it.** `WHATSAPP_CONNECT_MODE = own_app | embedded |
both` (default `own_app` until the gate opens). One card, two entry points, one status display.

**D9 — No money moves through us.** Meta bills each agency directly (F5). We never proxy, front,
invoice, or settle. Revisit only if you ever pursue Solution Partner. D10 is the deliberate
complement to this, not a contradiction of it: we don't touch the money, we make it *visible*.

**D10 — The billing tracker is attribution and reconciliation, never an invoice.** Two sources,
kept distinct and never silently merged:

- **Meta's numbers** (`pricing_analytics`, pulled nightly) are the closest thing to truth about
  *cost*, and are labelled in the UI as approximate, in the WABA's own currency, and Meta's to
  correct.
- **The CRM's numbers** (per-message rows built from the `statuses.pricing` webhook, F15) are the
  only place that knows *why* a message was sent — which lead, which conversation, which departure
  group, which staff member, agent or human.

Meta answers "what did this cost". Only the CRM can answer "what did chasing the October Umrah group
cost, and did it convert". **Never present a CRM-attributed figure as the amount owed**; show both,
show the variance, and name Meta's as the billing figure.

**D11 — Derive unit rates from Meta's own data; never hardcode a rate card.** Dated rate changes are
already scheduled (F13) and vary by country, category and volume tier. So: pull `pricing_analytics`
with `metric_types=[COST, VOLUME]` and `dimensions=[COUNTRY, PRICING_CATEGORY, PRICING_TYPE, TIER]`,
and compute the effective unit rate as **cost ÷ volume per bucket per day**. Store those observed
rates in `whatsapp_rate_observations`, and price attributed messages against the rate observed for
their own bucket on their own day. The rate card then updates itself on 1 July, 1 August and
1 October 2026 with no code change, and historical figures stay correct rather than being
retroactively repriced.

**D12 — Cost per conversation includes the AI, not just Meta.** `agent_runs` already records
`input_tokens`, `output_tokens`, `cache_read_tokens` and `cache_creation_tokens` per run, joined to
`conversation_id`. Add a model price table and the tracker can show the true all-in cost of an
automated conversation — Meta messaging **plus** Anthropic tokens — against the bookings it
produced. That comparison is the number that justifies the whole AI agent, and it is nearly free to
compute because the token columns already exist. Keep the two cost sources as separate columns and
separate legend entries; a tenant querying their Meta bill must never find AI spend folded into it.

---

## 4. Track M — the Meta path (calendar time, starts today)

This is mostly not code. It is the long pole; start it before E1.

### M1 — Basic Setup, live, on your own number

1. In the Meta App Dashboard, add your real business number under **WhatsApp → API Setup** (not the
   test number). Complete display-name review.
2. Create a **System User** in Business Settings with admin access to the app and the WABA; generate
   a **permanent** access token carrying both `whatsapp_business_management` and
   `whatsapp_business_messaging`.
3. Attach a **payment method** to the WABA. Nothing sends without it.
4. Configure the webhook callback to the production `https://` URL of this CRM with
   `WHATSAPP_VERIFY_TOKEN`; subscribe to `messages`, `account_update`,
   `message_template_status_update`, `phone_number_quality_update`, `account_review_update`.
5. Connect it into the CRM through **Mode A** (E2) — your own agency becomes tenant zero.

**Done when:** a real customer message reaches `conversation_messages` in production and a reply
sent from the CRM Inbox arrives on that customer's phone.

### M2 — The evidence pack

- **Video 1:** screen recording — compose a message *in this CRM*, send it, cut to a WhatsApp client
  receiving it. Show the CRM UI, not a terminal, if at all possible; it reads as a real product.
- **Video 2:** screen recording — create a message template *from the CRM's template screen* (E8),
  then show the resulting template in WhatsApp Manager with status `PENDING`/`APPROVED`.
- **App settings:** icon, category (Business), a long description of the actual use case
  (a travel-agency CRM assisting Hajj/Umrah pilgrims), and screenshots.
- **Policy pages, publicly reachable, no login:** Privacy Policy, Terms of Service, and **Data
  Deletion Instructions** (a static page is acceptable; a callback endpoint is better). Each must
  actually describe WhatsApp data: what message content you store, where, for how long, who can read
  it, and how a business or an end user requests deletion.
- **Written use-case description** for each permission, naming why a *travel CRM* needs to read and
  send on behalf of its agency customers.

*Engineering dependency:* M2 needs E2 and E8 shipped. That is the only place Track E blocks Track M.

### M3 — App Review submission

Submit both permissions for **Advanced Access** together. Expect one rejection cycle; the usual
causes are a video that shows a Postman call instead of the product, a privacy policy that never
mentions WhatsApp, and a use-case description written at the reviewer rather than about the product.

### M4 — Tech Provider enrolment + Access Verification

1. Confirm 2FA on the business portfolio.
2. Complete Tech Provider enrolment in the App Dashboard.
3. Complete **Access Verification** to lift onboarding from ~10 to ~200 businesses/week (F4).
4. Build the **Embedded Signup configuration** (App Dashboard → WhatsApp → Embedded Signup Builder →
   Facebook Login for Business configuration). Request only the assets you actually use — WhatsApp
   Business Account and phone number. Every extra asset (Pages, Catalogs, Ad Accounts) measurably
   increases abandonment. Record the `config_id` → `META_CONFIG_ID`.
5. Add the production domain to **Allowed Domains** and **Valid OAuth Redirect URIs**; enable Web
   OAuth login, enforce HTTPS, Strict Mode, and JavaScript SDK login.

**Gate opens.** Flip `WHATSAPP_CONNECT_MODE=both`.

---

## 5. Track E — the engineering path

### E1 — Schema: `supabase/migrations/2026XXXX_whatsapp_connection_modes.sql`

Extend `whatsapp_integrations` (all nullable or defaulted; existing rows must survive):

```text
connection_mode        text not null default 'OWN_APP_TOKEN'
                         check (connection_mode in ('OWN_APP_TOKEN','EMBEDDED_SIGNUP'))
connection_key         text unique              -- opaque slug for the Mode A webhook path (D3)
meta_business_id       text                     -- the customer's business portfolio id
app_secret_ref         text                     -- Vault ref, Mode A only  (D3)
verify_token_ref       text                     -- Vault ref, Mode A only  (D3)
two_step_pin_ref       text                     -- Vault ref                (D5)
token_expires_at       timestamptz              -- from debug_token         (D6)
token_scopes           text[]                   -- granular scopes observed
registered_at          timestamptz              -- /register succeeded      (F8)
webhook_verified_at    timestamptz              -- first signed event seen
funding_status         text default 'UNKNOWN'
                         check (funding_status in ('UNKNOWN','FUNDED','UNFUNDED'))
onboarding_step        text default 'NOT_STARTED'
                         check (onboarding_step in ('NOT_STARTED','TOKEN_STORED','SUBSCRIBED',
                                                    'REGISTERED','WEBHOOK_VERIFIED','COMPLETE'))
platform_state         jsonb not null default '{}'::jsonb  -- last account_update payload
```

Widen the `status` check with `PENDING_REVIEW` and `RESTRICTED` — Meta can restrict a WABA without
disconnecting it, and collapsing that into `ERROR` loses the only information the agency needs.

New table `whatsapp_connection_events` — append-only audit of every onboarding and platform-state
transition (`agency_id`, `integration_id`, `kind`, `detail jsonb`, `created_at`). This is what you
show a tenant when they ask why their number stopped working, and what you show Meta if asked.

New table `whatsapp_templates` (E8): `agency_id`, `name`, `language`, `category`, `status`,
`components jsonb`, `external_template_id`, `rejected_reason`, timestamps. Unique on
`(agency_id, name, language)`.

RLS: the same agency-scoped pattern as the rest of `20260825090000`. Vault refs are readable only by
`service_role`; **no Vault ref may ever be selected into a client component**.

**Billing tables** (E10) — a second migration, `2026XXXX_whatsapp_billing.sql`, so the connection
work can ship without waiting on it:

```text
whatsapp_message_charges          -- one row per delivered message (F15). The attribution layer.
  agency_id, conversation_id, message_id → conversation_messages(id)
  external_message_id             -- Meta's wamid; unique per agency
  direction                       -- OUTBOUND | INBOUND (inbound is always free; still counted)
  billable boolean, pricing_model text, pricing_category text, pricing_type text
  recipient_country text          -- derived from the wa_id, for the rate lookup
  template_name text, template_id text
  actor_kind text                 -- AI | STAFF | SYSTEM  (who caused the spend)
  actor_id uuid, lead_id uuid, departure_group_id uuid
  estimated_cost numeric(12,6), estimated_currency text, rate_observation_id uuid
  charged_on date                 -- Meta's billing day, for reconciliation
  created_at timestamptz
  unique (agency_id, external_message_id)

whatsapp_rate_observations        -- derived unit rates, D11. Never hand-maintained.
  agency_id, observed_on date, country_code, pricing_category, pricing_type, tier text
  cost numeric, volume integer, unit_rate numeric(12,6), currency text
  unique (agency_id, observed_on, country_code, pricing_category, pricing_type, tier)

whatsapp_billing_daily            -- Meta's own daily rollup, verbatim. The billing figure.
  agency_id, day date, phone_number_id, country_code, pricing_category, pricing_type, tier
  cost numeric, volume integer, currency text, source text  -- PRICING_ANALYTICS | CONVERSATION_ANALYTICS
  synced_at timestamptz
  unique (agency_id, day, phone_number_id, country_code, pricing_category, pricing_type, tier)

whatsapp_volume_tiers             -- from account_update (F15)
  agency_id, pricing_category, region, tier_lower integer, tier_upper integer,
  effective_month date, tier_update_time timestamptz, created_at
  -- on conflict keep the row with the SMALLEST tier_update_time (F15)

whatsapp_billing_budgets          -- per-agency alerting
  agency_id primary key, monthly_budget numeric, currency text,
  alert_at_percent integer[] default '{50,80,100}', notify_role text, last_alerted_percent integer

ai_model_rates                    -- D12. Cost per million tokens, per model, dated.
  model text, effective_from date, input_rate, output_rate,
  cache_read_rate, cache_write_rate, currency text
  primary key (model, effective_from)
```

RLS agency-scoped throughout; `whatsapp_rate_observations` and `whatsapp_billing_daily` are written
only by `service_role` (the sync job) and read by the tenant. `ai_model_rates` is platform-global,
readable by all, writable by `service_role` only.

### E2 — Mode A: "Connect with your own Meta app" (the Basic Setup path)

A guided four-step wizard, replacing the current single "paste a token" dialog. It must teach as it
collects — this is the step agencies get stuck on.

1. **Prerequisites checklist** (no input): a Meta business portfolio, business verification, an app
   with the WhatsApp use case, a payment method on the WABA. With the F9 warning about migrating a
   number off the WhatsApp Business app, shown *before* they start.
2. **Credentials**: permanent system-user access token, phone number id, **WABA id (required — see
   F16, not auto-detected)**, app secret. Server action `connectWhatsAppOwnApp()` — deliberately
   **no `debug_token` call** (F16: it cannot introspect a token from the agency's own, unrelated
   app); verification is the real calls below succeeding at all:
   - `GET /{waba_id}` with the agency's own token → confirms `whatsapp_business_management` and that
     the WABA id is right, in one call; a classified failure (`describeTokenFailure()`) says which;
   - `GET /{phone_number_id}?fields=display_phone_number,verified_name,quality_rating,platform_type,
     code_verification_status`;
   - Vault-store the token, the app secret, a generated verify token, and a generated 6-digit PIN;
   - `POST /{waba_id}/subscribed_apps`, then read it back to confirm — the first call that actually
     needs `whatsapp_business_messaging`, so its success is recorded into `token_scopes` too;
   - `POST /{phone_number_id}/register` with the PIN — **skip when `platform_type` indicates the
     number is already registered or came from the Business app** (F9);
   - upsert the integration at `onboarding_step = 'REGISTERED'`, `status = 'CONNECTED'`,
     **`token_expires_at = null`** (F16 — no expiry signal available for this mode);
   - mirror onto `integration_connections` exactly as today.
3. **Webhook wiring** (output, not input): display the tenant's unique callback URL
   `https://<origin>/api/webhooks/whatsapp/<connection_key>` and the generated verify token, each
   with a copy button, plus the exact list of fields to subscribe (F10). The instructions name the
   dashboard path, not just the concept.
4. **Verify**: a "Send test message" control (to a number the user types) and a live indicator that
   flips when the first signed webhook arrives — which sets `webhook_verified_at` and moves
   `onboarding_step` to `COMPLETE`. **An integration is not "connected" until a webhook has been
   received.** Anything less is a claim, not a fact.

### E3 — Graph client additions (`lib/whatsapp/client.ts`)

Pure additions; no existing signature changes. Bump the `META_GRAPH_VERSION` default to a v25+ line
(required by Embedded Signup v4) and re-confirm every existing call against that version.

```text
debugToken(inputToken, appAccessToken)        → { appId, isValid, expiresAt, scopes, granularScopes }
listSharedWabas(token)                        → from granular_scopes / GET /{business-id}/client_whatsapp_business_accounts
getWaba(wabaId, token)                        → name, timezone, currency, account_review_status,
                                                 business_verification_status, message_template_namespace
listPhoneNumbers(wabaId, token)               → id, display_phone_number, verified_name, quality_rating,
                                                 code_verification_status, platform_type, throughput
setTwoStepPin(phoneNumberId, token, pin)      → POST /{phone-number-id} { pin }
listSubscribedApps(wabaId, token)             → readback confirmation for E2/E4
getBusinessProfile / updateBusinessProfile    → /{phone-number-id}/whatsapp_business_profile
listTemplates / createTemplate / deleteTemplate → /{waba-id}/message_templates   (E8)

getPricingAnalytics(wabaId, token, { start, end, granularity, metricTypes,     (E10 / F14)
                                     pricingCategories, pricingTypes,
                                     dimensions, phoneNumbers, countryCodes })
getMessagingAnalytics(wabaId, token, { start, end, granularity, productTypes, countryCodes })
getConversationAnalytics(wabaId, token, { … })   -- legacy CBP tenants only
```

All three analytics calls are `GET /{waba-id}?fields=<field>.start(…).end(…)…` — a **field
expansion on the WABA node**, not separate edges. Timestamps are UNIX seconds. Clamp `start` to one
year ago and fail loudly rather than silently returning an empty window (F14).

Extend error handling to classify Meta error codes: `190`/`102` → token dead (→ `ERROR` +
re-connect banner, **no retry**); `131047` → outside the service window (→ a template is required);
`133010` → not registered (→ back to `onboarding_step = 'SUBSCRIBED'`); `4`/`80007` → rate limited
(→ backoff, already partially handled). A retry loop against a dead token is the one failure mode
most likely to get the app flagged by Meta.

### E4 — Mode B: Embedded Signup, hardened (gated on M4)

Rework `whatsapp-connect-card.tsx` and `connectWhatsApp()`:

- **Origin check** `event.origin.endsWith(".facebook.com")` — the current strict equality against
  `https://www.facebook.com` silently drops events from other Meta origins.
- **Handle all three events**: `FINISH`, `FINISH_ONLY_WABA` (a WABA exists but no number — a real,
  resumable state, not a failure), and `CANCEL` (record `current_step` so support can see where the
  user dropped: business selection, phone entry, OTP…).
- **Exchange the code within 30 seconds** (F6): fire the server action from the `FB.login` callback
  immediately, before any UI work; show the spinner after the request is already in flight.
- **Never require postMessage data** (F7): `connectWhatsApp({ code, hint? })` resolves the WABA from
  `debug_token` and uses `hint` only to disambiguate when a business has several.
- **Complete the onboarding sequence** (F8): subscribe → readback → register with PIN → readback
  phone numbers → funding check → `COMPLETE`. Each step writes a `whatsapp_connection_events` row,
  so a stalled onboarding is diagnosable rather than mysterious.
- **Business-app numbers** (F9): when the flow reports the number came from the WhatsApp Business
  app, skip registration, subscribe additionally to `history`, `smb_app_state_sync` and
  `smb_message_echoes`, and start the SMB history sync inside the 24-hour window. If we choose *not*
  to build history sync in v1 — a defensible scope cut, see §9 — then say so in the UI, and still
  skip registration.
- Extras: `extras: { setup: {}, sessionInfoVersion: 3 }`, SDK `version: 'v25.0'`.

### E5 — Webhooks: per-tenant identity and account state

- New route `app/api/webhooks/whatsapp/[connectionKey]/route.ts`. Resolves the integration by
  `connection_key`, reads that tenant's app secret and verify token from Vault, and delegates to the
  shared handler. An unknown key returns 404 on GET and 200 + an audit row on POST — never leak
  which keys exist.
- Refactor the existing handler body into `lib/whatsapp/webhook-handler.ts` taking
  `{ appSecret, verifyToken, integration? }`. The unkeyed route passes the platform values; the
  keyed route passes the tenant's. **One code path, two identity sources.**
- Handle the account-state fields (F10), each writing `platform_state` plus a
  `whatsapp_connection_events` row and, where relevant, a CRM notification:
  - `account_update` → `DISABLED_UPDATE`, `ACCOUNT_VIOLATION`, `ACCOUNT_RESTRICTION`,
    `PARTNER_APP_UNINSTALLED` (this is revocation — F11), and verification events;
  - `phone_number_quality_update` → write `quality_rating` and `messaging_limit_tier`;
  - `message_template_status_update` → sync `whatsapp_templates.status`;
  - `account_review_update` → `status = PENDING_REVIEW`, and back to `CONNECTED` on approval;
  - `account_update` of the **volume-tier** shape → upsert `whatsapp_volume_tiers`, keeping the
    smallest `tier_update_time` when Meta sends duplicates for one switch (F15).
- **Capture `statuses[].pricing` (F15).** The existing loop already walks `statuses` to patch
  delivery state; extend that same pass to upsert `whatsapp_message_charges` on the first status
  carrying a `pricing` object, joining to the `conversation_messages` row by `external_message_id`
  and copying `lead_id`, `actor_kind`, `actor_id` and `departure_group_id` off the conversation.
  Costing is **not** done here — the row is written with `estimated_cost` null and priced later by
  the nightly job (E10), so the webhook stays pure fast I/O as §6.1 of the agent plan requires.
- Keep the existing idempotency and the "unknown `phone_number_id` → 200 and drop" tenant gate.

### E6 — Token lifecycle and health (`app/api/cron/whatsapp-health/route.ts`)

Daily, `CRON_SECRET`-guarded, the same shape as the existing cron routes. Branches on
`connection_mode` (F16): Mode B (`EMBEDDED_SIGNUP`) uses `debug_token` → `token_expires_at` /
`token_scopes`, since the token is ours to introspect. Mode A (`OWN_APP_TOKEN`) skips `debug_token`
entirely — health is `listSubscribedApps` succeeding at all, with a `TOKEN_DEAD`-classified failure
read the same way a send failure is (§5 E3/E9); no expiry to track for this mode. Both modes then run
`listPhoneNumbers` → refresh quality and throughput, and `listSubscribedApps` → confirm still
subscribed (catches silent revocation). On failure: `status = 'ERROR'`, `last_error`, a connection
event, and a notification to the agency owner. At T-7 days from expiry (Mode B only): a re-connect
banner in the Inbox and on Integrations.

### E7 — Connection UI, unified

One `WhatsAppConnectCard` with:

- **Not connected** → a primary button per `WHATSAPP_CONNECT_MODE`: "Connect with Meta" (Mode B),
  "Connect your own Meta app" (Mode A), or both, with Mode B primary and Mode A as a secondary link.
- **Connected** → display number, verified name, quality rating (colour-coded), messaging tier,
  funding state, connection mode, token expiry, last webhook received, the recovery PIN
  (reveal-on-click), and — Mode A only — the callback URL and verify token for re-configuration.
- **Degraded states as distinct, actionable panels**, never a generic red toast: `UNFUNDED`
  ("add a payment method in WhatsApp Manager" plus a deep link), `ERROR`/revoked ("reconnect"),
  `PENDING_REVIEW`, `RESTRICTED`, and token-expiring.
- Reuse the existing Integrations card vocabulary, and keep `integration_connections` mirrored so
  the generic card and this one can never disagree.

### E8 — Message templates (`app/(main)/management/settings/communications`)

The screen already exists for CRM-side templates; extend it to sync with Meta.

- List Meta templates for the agency's WABA with live status.
- Create: name, language, category (`MARKETING` | `UTILITY` | `AUTHENTICATION`), header/body/footer,
  variable placeholders with sample values, buttons.
- Delete; show rejection reasons; re-sync on `message_template_status_update`.
- **This is App Review video 2.** Build it before M2.

### E9 — Funding and sending guardrails

Detect `UNFUNDED` both from the send-error taxonomy and from `account_update`; block outbound sends
with a clear in-Inbox explanation rather than a silent failure; surface it on the connect card. Pair
with the existing 24-hour service-window guard in `lib/agent/whatsapp/guardrails.ts`.

### E10 — Billing and usage tracker

The agency pays Meta directly (F5/D9), so the CRM's job is to make that bill predictable, explained,
and attributable. Three layers.

**Layer 1 — nightly sync (`app/api/cron/whatsapp-billing-sync/route.ts`).** `CRON_SECRET`-guarded,
same shape as the other cron routes. Per connected, funded integration:

1. `getPricingAnalytics(waba, { granularity: 'DAILY', metricTypes: ['COST','VOLUME'],
   dimensions: ['COUNTRY','PHONE','PRICING_CATEGORY','PRICING_TYPE','TIER'] })` for the last 7 days
   (a rolling re-sync, because Meta restates recent days) → upsert `whatsapp_billing_daily`.
2. Derive `unit_rate = cost / volume` per bucket → upsert `whatsapp_rate_observations` (D11).
3. Price every unpriced `whatsapp_message_charges` row against the observation matching its
   country + category + type + tier **on its own day**; leave it null and retry tomorrow if no
   observation exists yet, rather than guessing.
4. Compute month-to-date spend, compare with `whatsapp_billing_budgets`, and fire a notification at
   each unpassed threshold.
5. Write an `whatsapp_connection_events` row on any sync failure; never let a silent 400 turn into a
   dashboard that quietly shows last week's numbers as this week's.

Backfill on first connect: one pass over the last 90 days so the screen is useful on day one.
Legacy `CBP` tenants (F15) fall back to `conversation_analytics`; the tables and UI are shaped for
both, with `source` recording which produced a row.

**Layer 2 — the Billing screen, `app/(main)/management/settings/billing/` (WhatsApp tab).**

- **Header:** month-to-date cost in the WABA's currency, versus last month, versus budget, with the
  standing caveat that Meta's figures are approximate and Meta's invoice governs (D10).
- **Trend:** daily cost and message volume, stacked by pricing category (marketing / utility /
  authentication / service), using the existing `recharts` conventions from the dashboard module.
- **Breakdown tables:** by category, by country, by phone number, by pricing type — free
  (`free_customer_service`, `free_entry_point`) shown *alongside* paid, because the most useful
  number on this screen is how much the 24-hour window is saving them.
- **Volume tier panel:** current tier per category and region from `whatsapp_volume_tiers`, plus
  distance to the next tier and what it would save. Utility and authentication only (F14).
- **Attribution** — the part no other tool can show: cost by lead source, by departure group, by
  template, and by actor (AI vs each staff member). "This campaign cost LKR X and produced Y
  bookings" is the view that earns the feature.
- **All-in cost of the AI (D12):** Meta message cost + Anthropic token cost from `agent_runs` ×
  `ai_model_rates`, per conversation and in aggregate, next to bookings created. Two colours, two
  legend entries, never one summed number.
- **Reconciliation strip:** Meta's `whatsapp_billing_daily` total against the CRM's attributed
  total, with the variance stated as a number. A drift beyond a few percent means messages are being
  sent outside the CRM (WhatsApp Manager, another tool) — which is itself worth knowing.
- **Export:** CSV per month, reusing the export helper the Team and Reports modules already use.

**Layer 3 — spend controls, wired into the send path.** `whatsapp_billing_budgets` thresholds raise
in-app notifications at 50/80/100%. At 100%, *optionally* (per-agency setting, default off) block
**marketing** template sends only — never utility, authentication, or a human staff reply, and never
a reply inside the service window, which is free anyway. A budget guard that silences a customer
conversation is worse than the overspend it prevents.

Access: gated by the existing settings capability model (`capabilitiesForSettings`), owner/admin
only, agency-scoped by RLS like everything else.

### E11 — Hardening

- Multi-tenant test: two agencies, two integrations, a webhook for each — assert neither sees the
  other's rows, and that an event signed with agency A's secret posted to agency B's key is rejected.
- Assert no Vault ref, token, app secret or PIN is ever serialised into a client component payload.
- Rate-limit the keyed webhook route per `connection_key`.
- Load test: a 100-message burst across two tenants drains with no duplicate replies.
- Billing: a replayed `statuses` webhook creates no second charge row (the `(agency_id,
  external_message_id)` unique index is the guard); a re-run of the nightly sync over the same day
  is idempotent and does not double a single cent; and no agency's `whatsapp_billing_daily` row is
  visible to another under a direct PostgREST query.

---

## 6. Configuration

Additions to `.env.example`, in the existing commentary style:

```bash
# Which connect paths the Integrations screen offers.
#   own_app  — Mode A only (the default until Tech Provider approval lands)
#   embedded — Meta Embedded Signup only
#   both     — Embedded Signup primary, own-app as the fallback link
WHATSAPP_CONNECT_MODE=own_app

META_GRAPH_VERSION=v25.0        # Embedded Signup v4 requires v25.0 or newer

# Reused by whatsapp-health (E6) and whatsapp-billing-sync (E10) — one secret, three cron routes.
CRON_SECRET=

# Billing sync (E10). Days of history to re-pull each night: Meta restates recent days, so a
# rolling window is required — a single-day sync silently under-reports. 90 on first connect.
WHATSAPP_BILLING_SYNC_WINDOW_DAYS=7
```

No per-agency pricing configuration exists, and none should. Rates are observed from Meta's own
cost/volume data (D11); currency comes from the WABA. The only rate table we maintain by hand is
`ai_model_rates`, which is ours and not Meta's.

`META_APP_ID` / `META_APP_SECRET` / `META_CONFIG_ID` keep their current meaning: **our** platform
app, used only by Mode B and by the unkeyed webhook route. Mode A tenants never touch them.

---

## 7. Sequencing

The full engineering track (E1–E11) is implemented as of this writing. `Status` below reflects the
code, not the plan's original ordering — E4 and E7 shipped alongside the rest rather than waiting on
M4, since hardening Embedded Signup and unifying the UI needed no live Tech Provider approval to
write, only to *use*.

| # | Work | Depends on | Done when | Status |
|---|---|---|---|---|
| E1 | Schema migration | — | Migration applies clean; existing integration rows keep working | ✅ |
| E3 | Graph client additions | E1 | `debugToken` returns granular scopes for the real system-user token | ✅ |
| E2 | Mode A connect wizard | E1, E3 | A second agency connects its own app end-to-end and `webhook_verified_at` is set | ✅ |
| E5 | Keyed webhook + account-state fields | E1, E2 | A signed event on the keyed route creates a message; a wrong-secret event is rejected | ✅ |
| M1 | Basic Setup live on your number | E2, E5 | A real customer message in production, a real reply delivered | Meta-side — not code |
| E8 | Template management | E3 | A template created in the CRM appears in WhatsApp Manager | ✅ |
| M2 | Evidence pack | E2, E8, M1 | Both videos recorded; policy pages live and reachable without login | Meta-side — not code |
| M3 | App Review | M2 | Advanced Access granted on both permissions | Meta-side — not code |
| E6 | Token health cron | E3 | An expiring token raises a banner before it expires | ✅ (scheduling: §7.1) |
| E9 | Funding + send guardrails | E5 | An unfunded WABA blocks sends with an explanation, not a stack trace | ✅ — `classifyWhatsAppError`'s `UNFUNDED` (Meta code 131042), `account_update` billing-event heuristic, auto-recovery on next successful send |
| E10 | Billing and usage tracker | E1, E3, E5 | Month-to-date spend on the Billing screen matches Meta's WhatsApp Manager figure for the same window, within Meta's own stated approximation | ✅ layers 1–2 (§ E10 note below). Layer 3's guard (`checkMarketingSendAllowed`) exists and is correct but **uncalled** — no marketing-blast feature exists yet to invoke it from |
| M4 | Tech Provider + Access Verification + ES config | M3 | `config_id` exists; domains allowlisted | Meta-side — not code |
| E4 | Embedded Signup hardening | M4, E3, E5 | **A third agency connects with one click, typing nothing but their phone number, and receives a message** | ✅ code-complete; gated on M4 to actually exercise |
| E7 | Unified connect UI | E2, E4 | Every state listed in §5 E7 renders from real rows | ✅ |
| E11 | Hardening | all | Cross-tenant suite green; burst test clean; billing sync idempotent | Rate limiting (`check_webhook_rate_limit`) and a secret-leak audit done in code; the rest needs a live database — see `docs/whatsapp-connection-verification-runbook.md` |

### 7.1 Scheduling

`supabase/migrations/20260927090000_cron_jobs.sql` and `…20260928090000_whatsapp_webhook_rate_limit.sql`
schedule every cron route (`agent-jobs`, `whatsapp-health`, `whatsapp-billing-sync`,
`departure-ops-jobs`, `release-seat-holds`) via `pg_cron` + `pg_net`, and rate-limit the keyed
webhook route — **not** Vercel Cron, despite earlier drafts of this plan assuming it (§9 open
question 5 was resolved this way). Run `public.set_cron_http_config(base_url, cron_secret)` once per
environment before any of it does anything.

The critical path to revenue is **E1 → E3 → E2 → E5 → M1**. Everything else can trail it.

E10 splits cleanly in two and should be shipped that way: **E10a** (webhook charge capture + nightly
sync + the header and trend chart) is a week's work and immediately useful; **E10b** (attribution,
volume tiers, AI cost, reconciliation, budgets) follows once real data has accumulated. Shipping
E10a early also means the tracker has months of history by the time the first agency asks for it.

---

## 8. Risks

1. **App Review rejection cycles** — a schedule risk, not a technical one. Mitigate by recording the
   videos against the actual CRM UI and by writing policy pages that name WhatsApp message data
   explicitly. Budget two cycles.
2. **Mode A support load.** Asking an agency owner to create a system user and copy an app secret is
   real friction; expect to do it *with* them on a call for the first several tenants. The wizard's
   job (E2) is to make that call short. This is temporary by design — Mode B removes it.
3. **Business-app number migration (F9)** is one-way and disables features on the customer's own
   phone. Most stalled onboardings in the first months will be this. Warn before, not after.
4. **Embedded Signup drift.** Meta changes the popup's `postMessage` shape without notice; D4/F7
   (server-side resolution) is what keeps that from being an outage.
5. **Unfunded WABAs** look connected and send nothing. E9 exists solely to make that legible.
6. **Per-tenant app secrets are new secret material** in the system. They live in Vault, never in a
   column, never in a client payload — assert it in E11, don't assume it.
7. **A billing screen that disagrees with Meta's invoice becomes a support burden**, and the numbers
   *will* differ — Meta states its analytics are approximate, and restates recent days. Mitigation is
   framing, not engineering: label Meta's figure as the billing figure, show the CRM's attributed
   figure beside it as attribution, and put the variance on screen rather than hoping nobody
   computes it. Never round the difference away.
8. **The 1 October 2026 pricing change will move real money.** Utility and authentication pricing
   shifts in several markets (F13). Because rates are derived nightly (D11), the tracker follows it
   automatically — but *forecasts* built on pre-October rates will read low. Label any projection
   with the rate date it used.
9. **Attribution decays for messages not sent from the CRM.** Anything sent from WhatsApp Manager or
   a second tool appears in Meta's totals with no CRM row behind it. That is exactly what the
   reconciliation strip is for; treat a persistent gap as a finding, not a bug.

---

## 9. Open questions

1. **Do we build SMB history sync (F9) in v1?** It is meaningful work — contacts sync, message
   history sync, `smb_message_echoes` mirroring, all inside 24 hours. Recommendation: **no** for v1;
   skip registration, don't sync, and state the limitation in the UI. Revisit when a tenant asks.
2. **Where do the policy pages live?** Public routes in this app, or on the marketing site? They must
   be reachable without login and stable — Meta re-checks them.
3. **Whose product is the reviewer looking at?** If the CRM is sold as a product, the App Review
   video should show the product's branding, not "Royal Al-Fathima Travels" internal screens. This
   affects app naming and icon now, and is hard to change after approval.
4. **Solution Partner later?** Only if you want to front messaging costs and bill agencies yourself
   (F5/D9). That is a different commercial posture and a different Meta programme — decide before
   pricing, not after.
5. ~~**Deployment target for the health and billing crons**~~ Resolved: Supabase `pg_cron` + `pg_net`
   — see `supabase/migrations/20260927090000_cron_jobs.sql`. Run `public.set_cron_http_config()`
   once per environment (SQL editor, `service_role`) before the scheduled jobs do anything.
6. **Which currency does the Billing screen display?** Meta reports in the WABA's currency (LKR, USD,
   INR — set per account and not ours to change). Recommendation: **display Meta's currency
   verbatim, convert nothing.** A converted figure that doesn't match the invoice is worse than a
   figure in an unfamiliar currency. Revisit only if an agency runs multiple WABAs in different
   currencies, which today's one-integration-per-agency constraint makes impossible.
7. **Who inside an agency may see billing?** Owner and admin is the assumption above. If a sales
   manager should see cost-per-lead without seeing the total bill, that is a second capability
   (`viewMessagingCosts` separate from `viewBilling`) and worth deciding before the screen is built,
   not after roles are in the wild.
8. **Do we ever charge a margin on messaging?** D9 says no money moves through us, so no. But if the
   commercial model later adds a per-message markup, this tracker becomes the meter that bills it —
   which is a Solution Partner conversation (F5), and a different plan.

---

## 10. Definition of done

- An agency with its own Meta app connects in under fifteen minutes, unassisted, and the CRM proves
  it by showing a received webhook — **not** by trusting a token check.
- A second agency clicks **Connect with Meta**, completes Meta's popup, types no identifier at any
  point, and its first customer message appears in the Inbox.
- Both agencies' rows are invisible to each other under a direct PostgREST query as the other's user.
- Killing a token from Meta's UI turns the CRM's status to `ERROR` within a day, with a re-connect
  prompt — and produces zero retry traffic against Meta.
- An agency opens **Billing**, sees its month-to-date WhatsApp spend in its own currency without
  logging into WhatsApp Manager, and the figure reconciles with Meta's within Meta's own stated
  approximation.
- That agency can answer, from the CRM alone: which template cost the most this month, what
  proportion of messages were free because they landed inside the service window, how much the AI
  agent cost against the bookings it produced, and how far they are from the next volume tier.

---

## 11. References

Meta Business Messaging documentation, read while writing this plan:

- Embedded Signup — overview, implementation (v4), onboarding business-app users:
  `developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/…`
- Become a Tech Provider:
  `developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/get-started-for-tech-providers`
- Solution Providers overview (Tech Provider vs Solution Partner):
  `developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/overview`
- Webhooks setup and subscribable fields:
  `developers.facebook.com/docs/whatsapp/cloud-api/guides/set-up-webhooks`
- Pricing on the WhatsApp Business Platform (per-message model, categories, free windows, volume
  tiers, and the 2026 dated changes):
  `developers.facebook.com/documentation/business-messaging/whatsapp/pricing`
- Business Management API — analytics (`analytics`, `conversation_analytics`, `pricing_analytics`):
  `developers.facebook.com/docs/whatsapp/business-management-api/analytics`

Internal: `docs/whatsapp-ai-agent-implementation-plan.md` (§6 channel layer, §15 configuration,
§16 phases — this plan supersedes its Phase 4 and expands its §6.0).
