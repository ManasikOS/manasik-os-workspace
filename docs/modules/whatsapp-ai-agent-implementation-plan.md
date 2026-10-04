# WhatsApp AI Agent — Implementation Plan

Build the **WhatsApp channel** and the **AI Agent** that answers on it, on the same data, access
and action architecture already used by **Packages**, **Departure Groups**, **Leads**, **Pilgrims**,
**Documents**, **Visa**, **Operations**, **Suppliers**, **Finance**, **Reports**, **Team** and
**Settings**.

Status: **Not started.** The branch `whatsapp-agent` contains seven empty directories that name the
intended shape and nothing else — see §1.2. This plan fills them.

The product rule the whole plan enforces:

```text
WhatsApp          →  a transport. It carries text, nothing more.
Conversation      →  the durable record of what was said, and who owns the reply.
AI Agent          →  reasoning and language. It decides what to say, never what is true.
CRM Tools         →  the only way the agent touches the business. Every one is authorised.
CRM               →  the source of truth. Seats, prices, dates, balances.
Knowledge Base    →  what the agency says about itself. Static, not transactional.
```

And the boundary it must not cross:

```text
The model may compose a sentence.
The model may not decide a price, a seat count, a booking status, or who it is talking to.
```

Three rules carried into every section:

- **The LLM is never a source of authority.** `agencyId`, `conversationId`, `leadId`, the role of
  the caller, and every number that appears in a message come from server-side code. The model
  supplies arguments *inside* a tool schema; it never supplies the identity the tool runs as.
- **Every tool wraps an existing repository function.** This module adds no second way to read a
  departure group or write a booking. If a tool needs behaviour `lib/data/*` does not have, the
  change goes into `lib/data/*` and the existing UI gets it too.
- **Nothing autonomous ships before its guardrail does.** Outbound sending is gated (§7.4),
  booking creation stops at `HELD` (§9), and handoff is one-way until a human releases it (§10).

---

## 1. What exists today

### 1.1 The stack, as actually configured

| Concern | Reality | Consequence for this module |
|---|---|---|
| Framework | Next.js **16.2.12**, App Router, Server Components + Server Actions ([package.json:26](package.json:26)) | Route Handlers under `app/api/` are the webhook surface. `after()` is available for post-response work |
| Database | Supabase Postgres, RLS enforced ([20260822090000_rls_hardening.sql](supabase/migrations/20260822090000_rls_hardening.sql)) | Every new table needs a policy. A webhook has no session — see D3 |
| Auth | Supabase SSR cookies, session refreshed in [proxy.ts](proxy.ts) | **The proxy matcher covers `/api/*`. An unauthenticated POST is 302'd to `/login`** — F1 |
| Service role | `createAdminClient()` — [utils/supabase/admin.ts](utils/supabase/admin.ts), `server-only`, gated on `SUPABASE_SECRET_KEY` | The only way a webhook or worker reads the database. Already exists, already documented |
| LLM | `@anthropic-ai/sdk` ^0.116.0, already a dependency; one call site — [lib/data/documents-ai.ts](lib/data/documents-ai.ts) | Model id, lazy client, and the `isAiConfigured()` gate are established patterns to copy verbatim |
| Validation | `zod` ^4.4.3, per-module files in `lib/validations/` | Tool input schemas live here, same as form schemas |
| Roles | 7 roles on `staff_profiles`; `capabilitiesFor*(role)` in `lib/access/*-access.ts`; `current_staff_role()` in SQL | The Inbox and AI Agent screens need their own capability matrix — §11 |
| Queue / worker | **None.** No Redis, no job table, no cron | Built here as a Postgres job table + a cron route — D5 |
| Vector search | **None.** `pgvector` not enabled in any migration | Phase 8 enables it; the plan does not assume it exists — D11 |
| Multi-tenancy | **None.** Zero occurrences of `tenant` in the entire codebase | The single largest gap between the spec and the repo — §2 |

### 1.2 The scaffolding already on this branch

Seven directories exist and are **empty**. They are a statement of intent, and this plan honours it:

```text
lib/agent/                              →  §8   agent runtime
lib/agent/tools/                        →  §7   the CRM tool layer
app/api/webhooks/whatsapp/              →  §6   Meta webhook (verify + receive)
app/api/cron/agent-jobs/                →  §6.3 queue drain
app/inbox/                       →  §10  WhatsApp Inbox
app/inbox/components/            →  §10
app/(main)/management/ai-agent/         →  §12  AI Agent settings, KB, analytics
```

### 1.3 What already exists and is the real starting point

This is **not** greenfield. Two files were written specifically for an AI agent that did not exist yet:

| Concern | Where it lives today | Fitness |
|---|---|---|
| Customer-safe availability read model | [lib/data/departure-groups-ai.ts](lib/data/departure-groups-ai.ts) — `listSellableGroupsForAi()`, `getSellableGroupForAi()`, `isGroupEligible()`, `canHoldSeats()`. Its header comment: *"the **only** surface the agent should read"*; it strips supplier cost, margin, visa state, PII, and hides unconfirmed hotel names | **Purpose-built for this module and already correct.** §7.1 wraps it; it is not rewritten |
| An Anthropic call site to copy | [lib/data/documents-ai.ts](lib/data/documents-ai.ts) — `MODEL_ID = "claude-opus-5"`, lazy `getClient()`, `isAiConfigured()` gating every call site, JSON-schema structured output | The exact posture §8 needs. Model id and gate are lifted unchanged |
| Booking creation | `createGroupBookingInStore()` — [lib/data/departure-groups-bookings.ts:120](lib/data/departure-groups-bookings.ts:120), inside the `mutate(store, actor)` unit of work in [lib/data/departure-groups.ts:385](lib/data/departure-groups.ts:385) | **A `HELD` status and `seat_hold_expires_at` already exist**, plus `releaseExpiredSeatHoldsInStore()` and `promoteWaitlistBookingInStore()`. The agent's booking flow is a *caller* of this, not a parallel path — D8 |
| Leads | `leads` table — [20260812100000_create_leads.sql](supabase/migrations/20260812100000_create_leads.sql). `source` CHECK already includes `'WHATSAPP'`; `preferred_channel` defaults `'WHATSAPP'`; `mobile` is a normalised 9-digit subscriber number; `booking_id` FK to `departure_group_bookings` | The "customer" entity the spec describes **is** `leads` + `pilgrims` here. No new customer table — D6 |
| WhatsApp integration row | `integration_connections` seeded with `('WHATSAPP_BUSINESS', 'NOT_CONNECTED', …)` — [20260821090000_agency_settings.sql:271](supabase/migrations/20260821090000_agency_settings.sql:271). Table comment: *"Never stores a usable secret — real credentials stay in environment variables"* | **The status card the connect flow flips.** Its no-secrets contract is kept — D4 |
| Outbound copy | `message_templates` — channel `WHATSAPP`, `requires_approval` default `true`. Table comment: *"there is deliberately no scheduler or autonomous-send path in V1"* | **Directly in tension with an AI that replies on its own.** Resolved in §7.4 / D9 |
| Agency identity & languages | `agency_settings` singleton — `supported_languages` default `{en,si,ta}`, `timezone` `Asia/Colombo`, `default_currency` `LKR`, `primary_whatsapp` | The system prompt reads these instead of hardcoding. `ai_settings` extends this row rather than starting a second singleton — D10 |
| Role resolution | `getCurrentStaffRole()` — [lib/data/departure-groups.ts:318](lib/data/departure-groups.ts:318); `current_staff_role()` / `staff_role_in()` in SQL | Real and shipped. The Inbox can rely on it from day one. The *webhook* cannot — it has no user |
| Reserved multi-tenant column | `departure_groups.agency_id uuid` with no FK — [20260809090000:17](supabase/migrations/20260809090000_create_departure_groups.sql:17) | One dangling column, on one table. Not a multi-tenant schema — §2 |

### 1.4 The UI vocabulary to reuse

This plan adds **zero** files under `components/`. The Inbox is built from existing primitives
(`components/ui/*`, the sidebar item pattern in [components/app-sidebar.tsx](components/app-sidebar.tsx),
the drawer/sheet pattern used by `lead-drawer.tsx`). No new colours, no new spacing scale.

---

## 2. Multi-tenancy — read this before anything else

The product is a **multi-tenant SaaS**: many agencies, each connecting its own WhatsApp Business
account through Meta's Embedded Signup in one click, each seeing only its own data. This repository
is today a **single-agency deployment**:

- `tenant` appears **zero** times in `.ts`, `.tsx` and `.sql` across the project.
- `agency_settings` is a hard singleton: `unique (singleton)` with a seeded row.
- `integration_connections.provider` is `unique` — one WhatsApp connection is representable, not N.
- `message_templates` is `unique (category, channel, language)` — one template set, not one per agency.
- Every RLS policy keys on `staff_role_in(...)` — the caller's *role*, never their *agency*.
- `branches` (Colombo, Kandy) are **branches of one agency**, not tenants.

So the gap is real and it is the first thing this plan closes. It is also, honestly, the largest
piece of work here — larger than the WhatsApp channel and larger than the agent. One-click connect
does not reduce it: Embedded Signup solves *how an agency attaches its WhatsApp number*, not *how the
CRM keeps two agencies' bookings apart*.

> **D1 — Tenancy lands first, in Phase 1, across the whole schema.**
>
> A real `agencies` table becomes the tenant root. `agency_settings` stops being a singleton and
> becomes one row per agency (its `singleton` column and unique index are dropped; the existing row is
> backfilled to the first agency). Every tenant-owned table — the ~60 that already exist plus every
> table this plan adds — gets `agency_id uuid not null references agencies(id)`, backfilled to that
> first agency, and every RLS policy is rewritten from `staff_role_in(...)` to
> `agency_id = current_agency_id() and staff_role_in(...)`.
>
> `current_agency_id()` is a `stable security definer` function reading the signed-in user's
> `staff_profiles.agency_id`. In a webhook or worker there is no signed-in user, so the agent path
> never relies on it — it passes `agencyId` explicitly through `AgentContext` (D3, §7.1). Both paths
> converge on the same column; only the source of the value differs.
>
> This is a schema-wide change touching every shipped module. It is sequenced first because every
> phase after it would otherwise have to be redone, and because a tenancy bug found after real
> agencies are on the system is a data-leak incident, not a bug.

> **D2 — The resolver is a gate, not a lookup.** `resolveAgencyForPhoneNumberId(phoneNumberId)`
> returns `null` when the inbound `phone_number_id` matches no connected integration, and the webhook
> answers `200` and drops the event. As a Tech Provider, **one webhook endpoint receives events for
> every customer WABA**, so this resolver is the only thing standing between Agency A's messages and
> Agency B's conversation history. It is the highest-consequence function in the module.

> **D2b — Uniqueness constraints become per-agency.** `whatsapp_integrations.phone_number_id` stays
> globally unique (a phone number belongs to exactly one WABA, and a second agency claiming it is a
> takeover attempt that must fail loudly). Everything else — `message_templates`, `lead_sources`,
> branch codes, booking and lead reference sequences — is scoped `unique (agency_id, …)`. **Reference
> generators are the easy thing to miss**: `nextReferenceNumber()` ([finance-repository.ts:90](lib/data/finance-repository.ts:90))
> and the `LD-YYYY-NNNN` / group-code generators currently compute a global max and will collide or
> leak row counts across agencies until they are scoped.

### 2.1 The scope question this plan does not answer

Making the data multi-tenant is not the same as being a SaaS business. Tenancy gives you isolation;
a product additionally needs self-serve signup, plans and limits, per-tenant billing, an onboarding
flow, and a support path into a tenant's data. This plan delivers **isolation and one-click WhatsApp
connect**. If agencies are meant to sign themselves up and pay you, that is a second body of work
that should be planned separately — it is not hidden inside these phases.

---

## 3. Decisions

| # | Decision | Why |
|---|---|---|
| **D3** | The webhook and the job worker use `createAdminClient()` and never a user session. Every write they make records `actor_kind = 'AI'` or `'SYSTEM'` with a null `actor_id`. | There is no signed-in user behind an inbound WhatsApp message. RLS cannot express "the AI agent"; the service-role client plus an explicit actor column can. Same posture `documents-ai.ts` already documents for *why it doesn't* use one. |
| **D4** | Two credential tiers. **Yours** (`META_APP_ID`, `META_APP_SECRET`, `META_CONFIG_ID`, `WHATSAPP_VERIFY_TOKEN`) stay in environment variables — one app, one webhook, one secret, not per-tenant. **Theirs** (the per-WABA business system-user access token returned by Embedded Signup) is encrypted at rest in **Supabase Vault** and referenced from `whatsapp_integrations.credential_ref`; the table itself stores only identifiers and a masked hint. | Per-tenant tokens cannot live in env vars — there is one per agency and they arrive at runtime. Vault keeps them out of reach of `select *` by an ADMIN, which preserves the no-usable-secrets promise `integration_connections`' comment already makes, while making the token retrievable by the service-role sender. |
| **D5** | The queue is a Postgres table (`agent_jobs`) drained by `GET /api/cron/agent-jobs`, protected by a `CRON_SECRET` bearer token, plus an opportunistic `after()` kick from the webhook. | No Redis, no worker process, no queue service exists. Postgres is already the only stateful dependency. `after()` gives sub-second latency in the happy path; cron guarantees eventual drain when the request dies. The directory `app/api/cron/agent-jobs/` already names this design. |
| **D6** | The spec's "customer" maps to the existing **`leads`** row, matched on normalised mobile. No `customers` table is introduced. | `leads.mobile` is already the agency's phone-keyed contact record, `leads.source` already has `'WHATSAPP'`, and `leads.booking_id` already links to a booking. A parallel customer table would fork the sales pipeline in two. |
| **D7** | The agent may **read** freely (within the AI-safe read models) and **write only**: create/update a lead, add a note, create a `HELD` booking, and request handoff. It may never confirm a booking, record a payment, cancel, move, change a price, or touch documents/visa/finance. | Reads are recoverable; writes are not. This is the smallest write set that makes the agent useful, and every excluded operation has a human owner in an existing module. |
| **D8** | Booking creation goes through `createGroupBookingInStore()` inside the existing `mutate()` unit of work and always lands on `booking_status = 'HELD'` with `seat_hold_expires_at`. | The seat-hold machinery already exists, including expiry release and waitlist promotion. Confirmation stays a human act in Departure Groups. The agent can therefore never oversell or over-promise. |
| **D9** | Agent replies are **live conversational messages**, not `message_templates`. Templates keep their `requires_approval` contract and their no-scheduler promise, unchanged. Only Meta-approved *template* sends (needed after the 24-hour service window) touch `message_templates`, and those are staff-initiated. | The Settings plan's D7 forbids an autonomous *scheduled broadcast* path. A reply inside an open conversation the customer started is a different act with a different risk profile. Keeping them in separate tables keeps that distinction honest. |
| **D10** | `ai_settings` is a **new singleton table** keyed by `agency_id`, not new columns on `agency_settings`. | `agency_settings` is already a 60-column singleton. AI configuration changes on a different cadence, is edited by a different screen, and would otherwise be re-saved by every unrelated Settings form. |
| **D11** | Phase 8 (Knowledge Base) enables `pgvector` in its own migration and falls back to Postgres full-text search if the extension is unavailable on the target instance. Phases 1–7 do not depend on it. | `pgvector` availability on the deployment target is unverified. Making the first six phases depend on an unconfirmed extension would block the whole module on an infrastructure question. |
| **D12** | Voice (Phase 10) transcribes to text and re-enters the **same** conversation engine and agent runtime. No second agent, no second prompt, no second tool set. | Explicit in the spec, and the only design that keeps the tool layer's guardrails applicable to voice. |
| **D13** | The Inbox is a **read + take-over** surface in V1: staff can read every message, take control, send a free-text reply, and release back to the AI. Staff cannot edit or delete history. | Conversation history is evidence. It backs the booking the agent created. |
| **D14** | Model: **superseded 2026-09-19.** All AI goes through OpenRouter (no Anthropic key) and the assistant runs on a cheap model, `openai/gpt-5.6-luna` by default, overridable with `AI_AGENT_MODEL`. See [ai-model-selection.md](../architecture/ai-model-selection.md). Originally `claude-opus-5`, with adaptive thinking and `effort` tuned per surface (§8.3), which is still how the call is made. | One place to change the model (`lib/ai/provider.ts`), about 30-100x cheaper per turn. |

---

## 4. Findings

| # | Finding | Impact | Fix |
|---|---|---|---|
| **F1** | **`proxy.ts` will break the webhook.** The matcher `"/((?!_next/static|_next/image|favicon.ico|logos|.*\\.(?:svg\|png\|…)$).*)"` matches `/api/webhooks/whatsapp`. `PUBLIC_ROUTES` is `["/login"]`, so an unauthenticated POST is redirected `302 → /login`. Meta sees a non-200 and retries, then disables the subscription. | **Blocking.** Nothing works until this is fixed. | Phase 0 adds a `MACHINE_ROUTES = ["/api/webhooks", "/api/cron"]` early-return in `proxy()` — placed *before* the `getUser()` call, since these routes carry no cookies and should not pay a session refresh. |
| **F2** | The CSP in [next.config.ts:28](next.config.ts:28) sets `script-src 'self' 'unsafe-inline'` and `connect-src 'self' https://*.supabase.co`. **Embedded Signup runs in the browser** and loads `connect.facebook.net`, posting to `graph.facebook.com`. | **Blocking for the connect flow.** The signup popup silently fails to load. (Server-to-Meta calls from Node are unaffected — CSP does not apply to them.) | `next.config.ts` gains a route-scoped header for the integrations page only: `script-src … https://connect.facebook.net`, `connect-src … https://graph.facebook.com`, `frame-src https://www.facebook.com`. **Scoped to that one route** — the global CSP is not widened. |
| **F3** | `listSellableGroupsForAi()` calls `listDepartureGroups()`, which uses the **session-scoped** Supabase client and therefore RLS. From a webhook there is no session and it returns nothing. | The one AI-ready module in the repo does not work from the one context that needs it. | Phase 5 threads an optional `db` client parameter through `listDepartureGroups()` and `departure-groups-ai.ts` so the caller supplies either the session client (UI) or the admin client (agent). Signature stays backwards-compatible. |
| **F4** | `leads.assigned_to_id text not null` and `assigned_to_name text not null` — a lead cannot be created unassigned. | The agent must pick an owner for every lead it captures. | `ai_settings.default_lead_owner_id` (nullable, falls back to the first ACTIVE MARKETING staff, then the first ACTIVE ADMIN). Recorded on the lead exactly as a human-created lead would be. |
| **F5** | `leads.mobile` is documented as a *normalised 9-digit subscriber number*; WhatsApp delivers full E.164 (`94771234567`). | Every lead the agent creates will fail to match an existing lead, producing duplicates. | `lib/agent/phone.ts` — one normaliser, used by both the resolver and the lead matcher, with the country code from `agency_settings.default_country`. Round-trips both directions. |
| **F6** | `message_templates` is `unique (category, channel, language)` and `requires_approval` defaults `true`; its comment forbids an autonomous send path. | An AI that answers on its own appears to contradict a shipped design decision. | D9 draws the line explicitly and this plan does not weaken `message_templates`. The distinction is documented in the new migration's header comment so the next reader finds it. |
| **F7** | Meta's **24-hour customer service window**: outside it, only approved template messages may be sent. | An agent reply composed 25 hours after the customer's last message is silently dropped by Meta. | `conversations.service_window_expires_at`, refreshed on every inbound. The sender refuses free-text outside it and the Inbox shows the window state. Phase 3. |
| **F8** | Meta redelivers webhook events; `messages[].id` is the only idempotency key. | Double-processing means double replies and, worse, double bookings. | `conversation_messages.external_message_id` is `unique` per agency; the webhook does an idempotent insert and drops duplicates before enqueueing. Phase 2. |
| **F9** | **Embedded Signup has a hard external prerequisite chain**, all of it calendar time outside our control: Tech Provider registration → business verification (name, address, phone, email, website; document upload if Meta cannot match the business) → App Review for `whatsapp_business_management` **and** `whatsapp_business_messaging` at **Advanced Access**, typically several business days. Meta also requires the webhook endpoint to already accept and digest webhooks correctly before approval. | **This, not the code, is the critical path.** Phases 1–3 can be built while it runs; Phase 4 cannot start without it. | Kick off the Meta track on **day one, in parallel with Phase 1**. §6.1's webhook is built early partly because App Review needs to see it working. Track it as a named dependency with its own owner, not as an engineering task. |
| **F11** | **Embedded Signup v2 is deprecated on 15 October 2026** — roughly two months out. Most published tutorials, and most third-party blog write-ups, still demonstrate v2. | Building on v2 means a forced migration within weeks of launch. | Build on **v4** from the first commit. Treat any v2-shaped example (including vendor docs) as out of date, and check the version against Meta's own Implementation page before copying a flow. |
| **F12** | As a **Tech Provider** there is no Meta credit line: each onboarded agency must add its own payment method, and Meta bills that agency directly for conversations. (Solution Partners hold a credit line and re-invoice; that is a different, heavier programme.) | Design consequence, and a favourable one — the platform never fronts messaging spend for its customers. | The onboarding flow must **tell the agency they will add a payment method in WhatsApp Manager**, and the connection status must distinguish "connected" from "connected but unfunded" — an agency that skips this looks connected and silently cannot send. |
| **F10** | No `agent_jobs`-style table exists, so a failed AI turn has nowhere to record itself. | Silent failures. | `agent_jobs` carries `attempts`, `last_error`, `status`, and a `DEAD` terminal state surfaced in the Inbox. Phase 2. |

---

## 5. Schema

Five migrations. §5.0 is **not** additive — it is the tenancy retrofit and it rewrites policies
across the existing schema. §5.1–5.4 are additive and safe once it has run.

### 5.0 `20260824090000_tenancy.sql` — Phase 1 (D1)

```text
agencies
  id, name, slug (unique), status ('ACTIVE','SUSPENDED','CANCELLED'),
  country default 'LK', timezone default 'Asia/Colombo', created_at, updated_at

-- one row seeded from the existing agency_settings singleton, id captured as :first_agency

public.current_agency_id() → uuid
  stable security definer
  select agency_id from staff_profiles where id = auth.uid()

-- For every tenant-owned table T in the existing schema:
alter table T add column agency_id uuid references agencies(id);
update T set agency_id = :first_agency;
alter table T alter column agency_id set not null;
create index on T (agency_id);
-- and every policy on T is rewritten:
--   using (public.staff_role_in(…))
--     → using (agency_id = public.current_agency_id() and public.staff_role_in(…))

-- agency_settings stops being a singleton
alter table agency_settings drop constraint/index on (singleton);
alter table agency_settings add column agency_id … unique;

-- per-agency uniqueness (D2b)
message_templates : unique (category, channel, language) → unique (agency_id, category, channel, language)
lead_sources      : unique (code)                        → unique (agency_id, code)
branches          : unique (upper(code))                 → unique (agency_id, upper(code))
integration_connections : unique (provider)              → unique (agency_id, provider)
leads             : unique (reference)                   → unique (agency_id, reference)
departure_group_bookings : unique (booking_reference)    → unique (agency_id, booking_reference)
```

`departure_groups.agency_id` already exists as a dangling `uuid` with no FK
([20260809090000:17](supabase/migrations/20260809090000_create_departure_groups.sql:17)) — this
migration gives it the FK it was reserved for rather than adding a second column.

Application-side, the same migration's phase covers: `nextReferenceNumber()` and the
`LD-YYYY-NNNN` / group-code generators taking an `agencyId` and scoping their `max()` (D2b);
`staff_profiles.agency_id` populated on invite; and `getCurrentStaffRole()` returning `agencyId`
alongside `role` so callers get both from one query.

### 5.1 `20260825090000_whatsapp_channel.sql` — Phase 2/3

```text
whatsapp_integrations
  id, agency_id, provider ('META'),
  business_account_id (waba_id), phone_number_id (globally unique — D2b),
  display_phone_number, business_name, quality_rating, messaging_limit_tier,
  credential_ref,                          -- Supabase Vault secret id, never the token — D4
  credential_hint,                         -- masked tail only, for the UI
  status ('NOT_CONNECTED','CONNECTED','UNFUNDED','ERROR','DISCONNECTED'),   -- F12
  verified_at, last_error, connected_by, connected_by_name, created_at, updated_at

whatsapp_webhook_events                    -- raw, append-only, the audit floor
  id, agency_id, external_event_id (unique), payload jsonb, signature_valid boolean,
  received_at, processed_at, error

conversations
  id, agency_id, channel ('WHATSAPP'), external_conversation_id (the wa_id),
  lead_id → leads, contact_name, contact_phone,
  state ('AI_ACTIVE','HUMAN_REQUESTED','HUMAN_ACTIVE','AI_RESUMED','CLOSED'),
  ai_enabled boolean not null default true,
  assigned_to_id → staff_profiles, assigned_to_name,
  service_window_expires_at,                          -- F7
  last_inbound_at, last_outbound_at, unread_count,
  created_at, updated_at
  unique (agency_id, channel, external_conversation_id)

conversation_messages
  id, agency_id, conversation_id → conversations,
  external_message_id,                                -- F8
  role ('user','assistant','staff','system','tool'),
  actor_kind ('CUSTOMER','AI','STAFF','SYSTEM'), actor_id, actor_name_snapshot,
  content text, message_type ('TEXT','AUDIO','IMAGE','DOCUMENT','TEMPLATE','SYSTEM'),
  media_path,                                          -- Supabase Storage, Phase 10
  delivery_status ('PENDING','SENT','DELIVERED','READ','FAILED'), delivery_error,
  metadata jsonb, created_at
  unique (agency_id, external_message_id) where external_message_id is not null

agent_jobs                                             -- D5, F10
  id, agency_id, kind ('PROCESS_INBOUND','TRANSCRIBE_AUDIO','EMBED_DOCUMENT'),
  payload jsonb, status ('QUEUED','RUNNING','DONE','FAILED','DEAD'),
  attempts int, max_attempts int default 3, last_error, run_after, locked_at, locked_by,
  created_at, updated_at
  index (status, run_after)
```

`whatsapp_integrations` is seeded with one `NOT_CONNECTED` row, mirroring
`integration_connections`' seeding style. Both rows exist; the `integration_connections` card stays
the Settings-page status surface and is updated in lockstep so the existing Integrations screen does
not lie.

### 5.2 `20260826090000_ai_agent.sql` — Phase 5

```text
ai_settings                                            -- D10; singleton per agency
  agency_id (pk), enabled, agent_name, persona_instructions,
  languages text[] default (agency_settings.supported_languages),
  tone ('FRIENDLY_PROFESSIONAL','FORMAL','CONCISE'),
  lead_capture_enabled, booking_enabled, handoff_enabled, voice_enabled,
  working_hours jsonb, out_of_hours_message,
  default_lead_owner_id → staff_profiles,               -- F4
  seat_hold_hours int default (agency_settings.default_seat_hold_hours),
  max_turns_per_conversation int, escalate_after_failed_turns int,
  created_at, updated_at

agent_runs
  id, agency_id, conversation_id, job_id, model, effort,
  input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
  latency_ms, status ('OK','TOOL_ERROR','MODEL_ERROR','GUARDRAIL_BLOCKED','REFUSAL'),
  stop_reason, error, created_at

agent_tool_calls
  id, agency_id, agent_run_id → agent_runs, tool_name,
  arguments jsonb, result_summary text, is_error boolean,
  latency_ms, created_at

booking_sessions                                       -- §9
  id, agency_id, conversation_id, lead_id, departure_group_id,
  current_step ('START','SELECT_DEPARTURE','CHECK_AVAILABILITY','COLLECT_LEAD',
                'COLLECT_TRAVELLERS','REVIEW','AWAIT_CONFIRMATION','CREATED','ABANDONED'),
  travellers int, room_preference, collected jsonb,
  booking_id → departure_group_bookings, status, created_at, updated_at
  unique (conversation_id) where status = 'ACTIVE'
```

`agent_tool_calls.arguments` stores the model's arguments as sent. `result_summary` stores a
**redacted** summary, never a full result payload — tool results contain pilgrim data and there is no
reason to duplicate it into an observability table.

### 5.3 `20260827090000_knowledge_base.sql` — Phase 8

```text
create extension if not exists vector;                 -- D11; guarded

knowledge_documents
  id, agency_id, name, source_path, mime_type, status
  ('UPLOADED','CHUNKING','EMBEDDING','READY','FAILED'),
  chunk_count, error, uploaded_by, uploaded_by_name, created_at, updated_at

knowledge_chunks
  id, agency_id, document_id → knowledge_documents,
  chunk_index, content text, token_count,
  embedding vector(1024),                              -- null when pgvector is unavailable
  content_tsv tsvector generated always as (to_tsvector('simple', content)) stored,
  created_at
  ivfflat index on embedding
  gin index on content_tsv                             -- the D11 fallback path
```

### 5.4 `20260828090000_whatsapp_rls.sql` — Phase 2, applied with each table

Policies follow `20260822090000_rls_hardening.sql` exactly:

- `conversations`, `conversation_messages` — read: `staff_role_in('ADMIN','CEO','MARKETING','OPERATIONS','FINANCE','VISA')`; write: `staff_role_in('ADMIN','MARKETING','OPERATIONS')`. GUIDE has no Inbox access.
- `ai_settings`, `whatsapp_integrations`, `knowledge_documents` — read: `staff_role_in('ADMIN','CEO','MARKETING')`; write: `staff_role_in('ADMIN')`.
- `agent_runs`, `agent_tool_calls`, `whatsapp_webhook_events`, `agent_jobs` — read: `staff_role_in('ADMIN','CEO')`; **no** write policy for `authenticated`. Only the service-role client writes them, and it bypasses RLS.

---

## 6. The channel layer

### 6.0 One-click connect — Embedded Signup **v4** (F11)

The agency owner clicks **Connect WhatsApp** on the Integrations screen and never sees an
identifier. The flow, end to end:

```text
browser: FB.login({ config_id: META_CONFIG_ID,
                    response_type: 'code',
                    override_default_response_type: true,
                    extras: { feature: 'whatsapp_embedded_signup', version: 'v4', … } })
   ↓  the agency picks/creates its Business Portfolio, WABA and phone number inside Meta's popup
   ↓  Meta returns an authorization CODE to the browser
   ↓  and separately posts waba_id + phone_number_id to our webhook
        (the message-event webhook — subscribe to the account_update field)
   ↓
POST /api/integrations/whatsapp/connect   { code }        ← server action / route handler
   1. exchange code → business system-user access token   (server-side, app secret never leaves)
   2. GET /{waba_id} and /{phone_number_id}               → business name, display number, quality
   3. store the token in Supabase Vault → credential_ref  (D4)
   4. POST /{waba_id}/subscribed_apps                     → our app receives that WABA's events
   5. POST /{phone_number_id}/register                    → activate on Cloud API
   6. upsert whatsapp_integrations (status CONNECTED)
      + mirror onto integration_connections for the Settings card
   7. verifyConnection() → surface UNFUNDED if no payment method is attached  (F12)
```

Only steps rendered in the browser touch Facebook's SDK; the code exchange, the token, and every
Graph call happen server-side. The owner types nothing.

**Disconnect** deletes the Vault secret, calls `DELETE /{waba_id}/subscribed_apps`, and sets
`DISCONNECTED` — it does not delete conversations, which are business records.

**Revocation is not optional to handle.** An agency can revoke our app from Meta's UI at any time.
Subscribe to the `account_update` webhook field, and on a send failing with an auth error mark the
integration `ERROR` and surface it in the Inbox rather than retrying a dead token.

### 6.1 `POST|GET /api/webhooks/whatsapp` — `app/api/webhooks/whatsapp/route.ts`

```text
GET   →  hub.mode=subscribe & hub.verify_token === WHATSAPP_VERIFY_TOKEN
         →  200 text/plain hub.challenge     (constant-time compare)
         →  403 otherwise

POST  →  1. read the raw body (never the parsed body)
         2. verify X-Hub-Signature-256 = HMAC-SHA256(raw, WHATSAPP_APP_SECRET), timing-safe
            → 401 on mismatch, and record signature_valid=false in whatsapp_webhook_events
         3. insert whatsapp_webhook_events (idempotent on external_event_id)
         4. extract value.metadata.phone_number_id
         5. resolveAgencyForPhoneNumberId() → null ⇒ 200 and stop            (D2)
         6. per message: upsert conversation, insert conversation_message
            (idempotent on external_message_id)                              (F8)
            refresh service_window_expires_at = inbound + 24h                (F7)
         7. per status update: patch delivery_status on the matching message
         8. skip enqueue when conversation.state is HUMAN_ACTIVE or ai_enabled = false
         9. enqueue agent_jobs('PROCESS_INBOUND')
        10. return 200 — always, within ~2s
        11. after(() => drainAgentJobs({ budgetMs: 25_000 }))
```

Rule: **the webhook never calls the model.** Meta's timeout is short and its retry behaviour on
non-200 is aggressive. Steps 1–10 are pure I/O against Postgres.

### 6.2 Sending — `lib/whatsapp/client.ts`

```typescript
sendText(context, { to, body }): Promise<{ externalMessageId: string }>
sendTemplate(context, { to, templateName, language, components })
downloadMedia(context, mediaId): Promise<{ bytes, mimeType }>      // Phase 10
markRead(context, externalMessageId)
verifyConnection(context): Promise<{ ok, displayPhoneNumber, businessName }>
```

Every send: checks `service_window_expires_at` and refuses free text outside it (F7); writes a
`conversation_messages` row with `delivery_status = 'PENDING'` **before** the HTTP call, patching it
after; retries `429`/`5xx` with capped exponential backoff; never logs the access token.

### 6.3 `GET /api/cron/agent-jobs` — `app/api/cron/agent-jobs/route.ts`

`Authorization: Bearer ${CRON_SECRET}`, else `401`. Claims jobs with
`update … set status='RUNNING', locked_at=now(), locked_by=$1 where id in (select id … order by run_after
for update skip locked limit N) returning *`. Runs within a wall-clock budget, releases stale locks
older than 5 minutes, increments `attempts`, and moves a job to `DEAD` at `max_attempts`. Scheduled
every minute (Vercel Cron or `pg_cron` calling the route — either works; the route is the contract).

---

## 7. The tool layer — `lib/agent/tools/`

### 7.1 Signature and inventory

Every tool has the same shape, and `AgentContext` is always first:

```typescript
export interface AgentContext {
  agencyId: string;
  conversationId: string;
  leadId: string | null;
  channel: "whatsapp" | "web" | "voice";
  locale: string;
  db: Db;                    // the admin client, supplied by the runtime
}
```

| File | Tools | Wraps |
|---|---|---|
| `departures.ts` | `get_upcoming_departures`, `search_departures`, `get_departure_details`, `check_departure_availability` | `listSellableGroupsForAi`, `getSellableGroupForAi`, `canHoldSeats` — [departure-groups-ai.ts](lib/data/departure-groups-ai.ts) |
| `packages.ts` | `get_package_details`, `search_packages` | `lib/data/packages-repository.ts`, filtered to `visibility in ('Pilgrim Portal','Website & Portal')` |
| `leads.ts` | `find_or_create_lead`, `update_lead`, `add_lead_note` | `lib/data/leads-repository.ts`. Never sets `stage` past `QUALIFIED`; never sets `estimated_value_lkr` |
| `booking.ts` | `start_booking`, `record_traveller`, `review_booking`, `confirm_and_hold_booking`, `get_booking_status` | §9 + `createGroupBookingInStore` |
| `knowledge.ts` | `search_knowledge_base` | §13 |
| `handoff.ts` | `transfer_to_staff` | §10 |

There is **no** `get_customer`, `create_customer`, `update_customer` (D6 — those are `leads`), no
`add_pilgrim`/`update_pilgrim` (pilgrim records are created by staff after a booking is confirmed;
the agent records traveller details onto `booking_sessions.collected`), and no `cancel_booking` or
`update_booking` (D7).

### 7.2 Execution pipeline — `lib/agent/tools/registry.ts`

```text
model emits tool_use
        ↓
name is in the registry?              → no  → tool_result { is_error: true }
        ↓
arguments parse against the zod schema? → no → tool_result { is_error: true, issues }
        ↓
tool is enabled by ai_settings?        → no  → tool_result { is_error: true, "not available" }
        ↓
run(context, args)                     — context is injected, never model-supplied
        ↓
strip: internal_cost, margin, supplier ids, passport numbers, medical notes,
       payment schedules, other leads' data, staff PII
        ↓
record agent_tool_calls
        ↓
tool_result
```

The strip step is a second line of defence. `departure-groups-ai.ts` already omits these fields; the
registry re-asserts it with an allowlist so a future tool cannot leak them by omission.

### 7.3 Tool descriptions

Descriptions are written prescriptively — *when to call*, not just what the tool does — and carry no
worked examples or dialogue. Trigger conditions live in the tool's `description`; behaviour lives in
the system prompt. Nothing in a description shouts.

### 7.4 The outbound gate — `lib/agent/guardrails.ts`

Before any reply reaches `sendText()`:

1. `ai_settings.enabled` and `conversation.ai_enabled` are both true.
2. `conversation.state` is `AI_ACTIVE` or `AI_RESUMED` — never `HUMAN_ACTIVE`.
3. Inside the service window (F7).
4. Under `max_turns_per_conversation`.
5. Reply length is capped (WhatsApp truncates at 4096; the cap is lower and enforced in the prompt).
6. The reply contains no digit sequence that looks like a price or seat count unless the turn made a
   tool call that returned it. A violation is logged as `GUARDRAIL_BLOCKED` and replaced with a
   handoff message. This is the cheapest possible defence against a hallucinated number reaching a
   customer, and it is checkable without a second model call.

---

## 8. The agent runtime — `lib/agent/`

### 8.1 Files

```text
lib/agent/
├── runtime.ts        the loop; MODEL_ID; isAiConfigured()
├── context.ts        AgentContext construction from a conversation id
├── prompt.ts         system prompt assembly (§8.2)
├── memory.ts         conversation history → messages[]
├── guardrails.ts     §7.4
├── handoff.ts        §10
├── phone.ts          F5
└── tools/            §7
```

### 8.2 The system prompt, and where it comes from

Assembled in this order — **stable first, volatile last**, because the order is the cache key:

```text
1. Frozen preamble          — the agent's job, the honesty rules, the never-invent-a-number rule
2. ai_settings              — agent_name, persona_instructions, tone, languages
3. agency_settings          — agency_name, timezone, default_currency, primary_whatsapp
4. Capability flags         — which of booking / lead capture / handoff are on
5. Working hours + today's date in the agency timezone
─────────────────────────── cache_control breakpoint here ───────────────────────
6. Conversation history     — the volatile tail
```

Nothing in 1–5 changes between turns of the same conversation, and nothing in 1–4 changes between
conversations. Steps 1–5 render once per turn from cached rows; there is no `new Date()` inside
steps 1–4.

The preamble states the rules the guardrails also enforce, because a rule enforced only in code
produces a confused agent, and a rule stated only in the prompt is not a guarantee:

> Never state a price, a seat count, a date, or a booking status that did not come from a tool result
> in this conversation. If you do not have it, say you will check, and call the tool.

### 8.3 The loop

`lib/agent/runtime.ts` uses the SDK's tool runner (`client.beta.messages.toolRunner`) rather than a
hand-written `while (stop_reason === "tool_use")` loop — the per-turn hooks give the guardrail and
`agent_tool_calls` recording their natural home, and there is no control flow here the runner does
not cover.

```typescript
const MODEL_ID = "claude-opus-5";      // matches lib/data/documents-ai.ts

const runner = client.beta.messages.toolRunner({
  model: MODEL_ID,
  max_tokens: 4096,
  thinking: { type: "adaptive" },
  output_config: { effort: "low" },     // §8.4
  system: systemBlocks,                 // last block carries cache_control
  tools: enabledTools,
  messages: history,
  max_iterations: 8,
});
```

- **Thinking** is adaptive. It is on by default on `claude-opus-5`; it is set explicitly so the
  intent is legible and so `max_tokens` is sized for thinking *plus* reply.
- **Effort `low`** for conversational turns: replies are short, the reasoning is shallow, and latency
  is what a WhatsApp user feels. `medium` for a `REVIEW`-step booking turn, where getting the summary
  right matters more than 400ms. Set per call site, never globally.
- **`max_iterations: 8`** bounds a runaway loop. Exhausting it records `TOOL_ERROR` and hands off.
- **Prompt caching**: `cache_control: { type: "ephemeral" }` on the last system block. The
  512-token minimum on `claude-opus-5` means even a modest system prompt caches. `agent_runs`
  records `cache_read_tokens`; a sustained zero there means a silent invalidator crept into steps 1–5.
- **`stop_reason === "refusal"`** is checked before reading `content` and recorded as `REFUSAL`, then
  handed off. A refusal is not an error and must not be retried.
- Structured output is **not** used for the reply — the reply is prose. Structured output is used in
  Phase 10 for transcription post-processing and in Phase 11 for conversation summarisation.

### 8.4 Where the turn ends

Each turn appends `response.content` (not just the text) to history, persists the assistant reply as
a `conversation_messages` row, runs the guardrails, and sends. Failures at any point leave the job
`FAILED` with the reason, retryable up to `max_attempts`, and the customer sees nothing — silence is
better than a half-sent reply, and the Inbox shows the failure to a human.

---

## 9. The booking state machine

The model conducts the conversation; `booking_sessions` decides what is permitted. The step is
advanced **only** by a tool call, and each tool asserts its own precondition:

```text
START
  → start_booking(groupId, travellers)
      asserts: booking_enabled, no ACTIVE session on this conversation
      calls  : canHoldSeats()                                    ← live re-check
  → SELECT_DEPARTURE → CHECK_AVAILABILITY
  → find_or_create_lead(...)                                     → COLLECT_LEAD
  → record_traveller(...) × N                                    → COLLECT_TRAVELLERS
  → review_booking()                                             → REVIEW
      returns a rendered summary built from CRM values, not model text
  → the customer replies affirmatively
  → confirm_and_hold_booking(sessionId, confirmationText)        → AWAIT_CONFIRMATION
      asserts: current_step === 'REVIEW'
      asserts: canHoldSeats() still true                         ← re-checked at the last moment
      writes : createGroupBookingInStore(...) with booking_status 'HELD'
               and seat_hold_expires_at = now() + ai_settings.seat_hold_hours
      links  : leads.booking_id, booking_sessions.booking_id
  → CREATED
```

After `CREATED` the agent's role is over: it sends the reference, states the hold expiry plainly, and
tells the customer a staff member will confirm. `booking.created` (§14) notifies the assigned owner.
Confirmation, deposit and cancellation happen in Departure Groups and Finance, by a person (D7).

`confirm_and_hold_booking` requires `confirmationText` — the customer's actual words — and stores it
on the booking session. A booking created without a recorded affirmative reply is not a booking.

---

## 10. Human handoff and the Inbox

### 10.1 States

```text
AI_ACTIVE ──transfer_to_staff()──▶ HUMAN_REQUESTED ──staff opens/claims──▶ HUMAN_ACTIVE
                                          │                                      │
                                          │                              staff releases
                                          ▼                                      ▼
                                       CLOSED ◀────────────────────────────  AI_RESUMED
```

`transfer_to_staff(reason, urgency)` fires on: an explicit request for a person; anything touching
money, refunds, complaints, visa or medical detail; `escalate_after_failed_turns` consecutive turns
where no tool call succeeded; a `REFUSAL`; or a guardrail block. It sets `HUMAN_REQUESTED`, assigns
per `ai_settings.default_lead_owner_id`, and sends one acknowledgement.

**While `HUMAN_ACTIVE`, the webhook does not enqueue a job at all** (§6.1 step 8). The AI cannot
speak over a colleague, because it is never invoked.

### 10.2 `app/inbox/`

```text
page.tsx                       server component; list + detail, two panes
actions.ts                     "use server"; every action re-checks capabilitiesForInbox(role)
types.ts
components/
  conversation-list.tsx        filters: AI Active / Waiting / Human / Closed; unread badge
  conversation-panel.tsx       transcript; role-coloured; tool calls collapsed for ADMIN/CEO only
  message-composer.tsx         disabled unless HUMAN_ACTIVE; shows the F7 window state
  conversation-actions-menu.tsx  Take control / Hand back to AI / Close (dropdown)
  conversation-meta.tsx        linked lead, booking, seat-hold countdown
```

Actions: `takeControl`, `releaseToAi`, `closeConversation`, `sendStaffMessage`, `assignConversation`,
`retryFailedJob`. Server actions only; no client-side Supabase writes.

`capabilitiesForInbox(role)` lands in `lib/access/inbox-access.ts` alongside the other twelve:
ADMIN/MARKETING/OPERATIONS read + take over + send; CEO read-only; FINANCE/VISA read-only; GUIDE none.
The sidebar entry follows the file's own convention — `visible: capabilitiesForInbox(role).viewModule`.

---

## 11. `app/(main)/management/ai-agent/`

```text
page.tsx                    Overview — status, today's conversations, handoff rate, cost
settings/                   ai_settings form (persona, languages, tone, capabilities, hours)
knowledge/                  upload, list, re-index, delete
conversations/              a read-only lens onto the same data the Inbox shows, filtered to AI turns
analytics/                  §14
```

WhatsApp connection lives under the existing
`app/(main)/management/settings/integrations/` — one Integrations screen, one status card per
provider. It gains a **Connect / Test Connection / Disconnect** trio backed by `verifyConnection()`
(F9), and writes both `whatsapp_integrations` and the matching `integration_connections` row.

---

## 12. Knowledge base — Phase 8

```text
upload → Supabase Storage (private bucket `knowledge-base`)
       → knowledge_documents (UPLOADED)
       → agent_jobs('EMBED_DOCUMENT')
       → extract text (pdf/docx/txt/md)
       → chunk ~800 tokens, 100 overlap, on paragraph boundaries
       → embed per chunk
       → knowledge_chunks (embedding + content_tsv)
       → READY
```

`search_knowledge_base(query, limit)` runs a vector search scoped to `agency_id`, falling back to
`content_tsv` ranking when `embedding is null` (D11). It returns chunk text plus the source document
name so the agent can attribute — and returns **nothing** when no chunk clears the similarity floor,
so the agent says it does not know rather than paraphrasing a weak match.

The split the spec draws is enforced by tool availability, not by prompt wording: prices, dates,
seats and balances have **no** knowledge-base path, and policies have **no** CRM path.

---

## 13. Events

`lib/agent/events.ts` — a thin dispatcher, not a bus:

```text
conversation.started        conversation.transferred     conversation.closed
lead.created (via AI)       booking.held                 agent.guardrail_blocked
agent.job_dead              whatsapp.send_failed         whatsapp.window_expired
```

Subscribers in V1: an activity-log write and an Inbox unread bump. `booking.held` additionally
notifies the assigned owner. Nothing here sends email or SMS — those channels are not connected
(`integration_connections` says so), and this module does not connect them.

---

## 14. Observability and analytics

`agent_runs` + `agent_tool_calls` answer, per conversation: which model ran, how long it took, what
it called, what it cost, and why it stopped. The Overview and Analytics screens read them for:

- conversations handled, AI-resolved vs handed off (the resolution rate)
- median and p95 turn latency
- token spend and cost, by day
- tool failure rate by tool name — the single most useful number for debugging the agent
- cache read ratio (a collapse here means §8.2's ordering broke)
- leads captured and bookings held, attributed to the channel

---

## 15. Configuration

Added to `.env.example` with the same commentary style as the existing entries:

```bash
# ── Meta app credentials — OURS, not a tenant's. One app serves every agency. ─
META_APP_ID=                      # public; also used by the browser SDK
META_APP_SECRET=                  # verifies X-Hub-Signature-256; exchanges the signup code
META_CONFIG_ID=                   # Embedded Signup configuration id (v4 — see F11)
META_GRAPH_VERSION=v21.0
WHATSAPP_VERIFY_TOKEN=            # our own random string; echoed back at subscription time

# ── Queue drain ──────────────────────────────────────────────────────────────
CRON_SECRET=                      # bearer token for GET /api/cron/agent-jobs
```

There is deliberately **no** `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` or
`WHATSAPP_BUSINESS_ACCOUNT_ID`. Those are per-agency, arrive at runtime through Embedded Signup, and
live in Supabase Vault (D4). An env var for any of them is a single-tenant assumption in disguise.

`OPENROUTER_API_KEY` and `SUPABASE_SECRET_KEY` already exist and are already documented as optional
feature gates. This module adds two more gates in the same spirit: without the WhatsApp variables the
channel is inert and the Inbox shows "Not connected"; without `OPENROUTER_API_KEY` messages still
arrive, are stored, and land in the Inbox as `HUMAN_REQUESTED` — **the CRM degrades to a shared
WhatsApp inbox rather than failing.** That fallback is worth building deliberately; it is what the
agency uses on day one anyway.

---

## 16. Phases

Each phase is independently shippable and independently useful.

Two tracks run in parallel. The **Meta track** is calendar time and starts on day one (F9); the
**engineering track** is below. Phase 4 is the join point — nothing sends a real message until both
have landed.

```text
Meta track:   Tech Provider registration → business verification → App Review
              (whatsapp_business_management + whatsapp_business_messaging, Advanced Access)
              ──────────────────────────────────────────────────────────────▶ gate on Phase 4
Eng track:    P0 ─ P1 ─ P2 ─ P3 ──────────────────────────────────────────── P4 ─ P5 ─ …
```

| Phase | Scope | Done when |
|---|---|---|
| **0 — Groundwork** | F1 (`proxy.ts` machine routes), F2 (route-scoped CSP), F5 (`lib/agent/phone.ts`), F3 (optional `db` parameter through `listDepartureGroups()` / `departure-groups-ai.ts`) | An unauthenticated `GET /api/webhooks/whatsapp` returns a handler response, not a redirect. `listSellableGroupsForAi()` returns rows when given an admin client |
| **1 — Tenancy** ⚠️ | §5.0. `agencies`, `current_agency_id()`, `agency_id` + backfill + index on every tenant table, **every RLS policy rewritten**, per-agency uniqueness, reference generators scoped, `staff_profiles.agency_id` | Two agencies exist in a test database and **neither can read a single row of the other's** — verified per table, by direct PostgREST query as each agency's user, not through the UI. This is the phase to over-test |
| **2 — Channel in** | §5.1 + §5.4. Webhook (verify, signature, idempotency, **tenant gate**), `whatsapp_webhook_events`, `agent_jobs`, cron route | A message lands in `conversation_messages` against the right agency; a replayed webhook creates no duplicate; a message for an unknown `phone_number_id` is dropped with a 200 |
| **3 — Conversations + Inbox** | `conversations`, service window (F7), `app/inbox/`, `lib/access/inbox-access.ts`, sidebar entry | Staff read a live conversation and reply by hand. **Shippable with no AI at all** — and it is what an agency uses on day one |
| **4 — One-click connect** 🔒 | §6.0 Embedded Signup v4, Vault token storage, subscribe + register, `verifyConnection()`, UNFUNDED state, revocation handling | **Gated on App Review.** A second agency connects its own number through the popup and receives messages, with no operator involvement and no env-var change |
| **5 — Agent runtime** | §5.2, `lib/agent/*`, prompt assembly, caching, `agent_runs`, guardrails, one tool (`search_departures`) | The agent answers "what trips do you have in September?" with real seat counts, and `agent_runs.cache_read_tokens > 0` on turn 2 |
| **6 — Read tools** | departures, packages, availability | Every read tool has a unit test asserting it never returns a stripped field, **and one asserting it returns nothing for another agency's group id** |
| **7 — Leads + handoff** | `find_or_create_lead`, `update_lead`, `add_lead_note`, `transfer_to_staff`, the full state machine | A WhatsApp enquiry becomes a `leads` row with `source = 'WHATSAPP'`, deduplicated on mobile **within the agency** |
| **8 — Knowledge base** | §5.3, upload, chunk, embed, `search_knowledge_base`, KB screen | "What is your cancellation policy?" is answered from that agency's document, with the source named — and never from another agency's |
| **9 — Booking** | `booking_sessions`, the five booking tools, seat holds | A conversation produces a `HELD` booking with a recorded confirmation, and `available_seats` decrements exactly once |
| **10 — Voice in** | media download, transcription, `TRANSCRIBE_AUDIO` job, audio reply | A voice note is answered correctly through the same runtime (D12) |
| **11 — Analytics** | Overview + Analytics screens, per-agency cost attribution | The six metrics in §14 render from real rows, scoped per agency |
| **12 — Hardening** | per-contact rate limits, dead-job alerting, redaction audit, **cross-tenant penetration pass**, load test | A 100-message burst across two agencies drains without duplicate replies or a single cross-tenant row |

---

## 17. Open questions

These need an answer from the business, not from the code. None of them block Phases 0–3.

0. **Is this a product you sell, or your own CRM with tenancy?** (§2.1) Multi-tenant data isolation
   is planned here. Self-serve signup, plans and limits, subscription billing, and a support path
   into a tenant's data are not, and they are a separate body of work. The answer changes what
   Phase 1 needs to leave room for.
1. **Each agency must attach its own payment method** in WhatsApp Manager, and Meta bills them
   directly (F12). This has to appear in the onboarding copy and in your pricing conversation, or
   agencies will connect successfully and then silently fail to send.
2. **Which WhatsApp number does each agency use?** Migrating a number already running the WhatsApp
   Business *app* onto the Cloud API is a one-way move — the app stops working on that number. This
   is the most common place an onboarding stalls, so the connect screen should warn before the popup,
   not after.
3. **Does the agent write in Sinhala and Tamil?** `supported_languages` says `{en,si,ta}`. Quality
   should be spot-checked per language before the agent is enabled for it; the setting is per-language
   for exactly this reason.
4. **Seat-hold duration for AI-created bookings.** `agency_settings.default_seat_hold_hours` is 24.
   An unattended hold created at 2am may deserve a shorter window; `ai_settings.seat_hold_hours` is
   separate so it can be tuned without changing the human default.
5. ~~**Deployment target for cron.**~~ Resolved: Supabase `pg_cron` + `pg_net`, not Vercel Cron —
   see `supabase/migrations/20260927090000_cron_jobs.sql`. The route contract in §6.3 is unchanged;
   only the scheduler differs, and it now lives inside the database rather than the host.
6. **`pgvector` availability** on the production Supabase instance (D11) — determines whether Phase 8
   ships the vector path or the full-text fallback first.
