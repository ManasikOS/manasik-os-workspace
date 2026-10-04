# Multi-Tenancy Implementation Plan

**Status:** proposed · **Owner:** unassigned · **Prepared:** 2026-08-19
**Scope:** turn this repository from *"a schema that has an `agency_id` column"* into
*"a system that can safely run N agencies, onboard them, isolate them, and operate them."*

---

## 0. Read this first — what is already done

This is **not** a greenfield tenancy retrofit. A previous body of work
([20260824090000_tenancy.sql](supabase/migrations/20260824090000_tenancy.sql)) already landed the
hardest single piece: the data model.

| Already shipped | Where |
|---|---|
| `agencies` table as the tenant root | [20260824090000_tenancy.sql:26](supabase/migrations/20260824090000_tenancy.sql:26) |
| `current_agency_id()` — `stable security definer` resolver over `staff_profiles.agency_id` | [20260824090000_tenancy.sql:75](supabase/migrations/20260824090000_tenancy.sql:75) |
| `agency_id not null` + FK + index + `default current_agency_id()` on **54 tables** | §C of that migration |
| Every RLS policy on those tables rewritten to `agency_id = current_agency_id() and <original role check>` | §E — done by reading `pg_policies` and rewriting, not by hand-transcribing 100+ policies |
| `agency_settings` de-singleton'd — one row per agency, `unique (agency_id)` | §D |
| 7 uniqueness constraints re-scoped per agency | §F |
| Every table added *after* tenancy (`whatsapp_integrations`, `conversations`, `conversation_messages`, `agent_jobs`, `whatsapp_webhook_events`, `ai_settings`, `agent_runs`, `agent_tool_calls`, `booking_sessions`) born tenant-aware | [20260825090000](supabase/migrations/20260825090000_whatsapp_channel.sql), [20260826090000](supabase/migrations/20260826090000_ai_agent.sql) |
| A service-role path that carries `agencyId` explicitly instead of relying on RLS | [lib/agent/context.ts](lib/agent/context.ts), [app/api/webhooks/whatsapp/route.ts:84](app/api/webhooks/whatsapp/route.ts:84) |
| `claim_agent_jobs()` `revoke`d from `authenticated` so it cannot be used to claim other agencies' jobs | [20260825090000_whatsapp_channel.sql:237](supabase/migrations/20260825090000_whatsapp_channel.sql:237) |

**The application layer never had to learn about tenancy** and mostly still hasn't — by design.
`agency_id` appears in only 19 source files, nearly all WhatsApp/agent code. Every Server Action and
every `lib/data/*-repository.ts` function goes through the cookie-scoped Supabase client, so RLS
filters reads and the column default stamps writes. That is a good architecture and this plan does
not change it.

**What is left is everything tenancy *isn't*:** the residual isolation holes RLS does not cover
(storage, views, uniqueness), and the entire *business* of being multi-tenant — how an agency comes
into existence, gets provisioned, suspended, supported and billed. The prior plan said so explicitly
and deferred it:

> *"Making the data multi-tenant is not the same as being a SaaS business… If agencies are meant to
> sign themselves up and pay you, that is a second body of work that should be planned separately."*
> — [whatsapp-ai-agent-implementation-plan.md §2.1](docs/whatsapp-ai-agent-implementation-plan.md)

**This is that second body of work, plus the isolation gaps §2.1 did not know about.**

---

## 1. Current architecture

```
Browser
  │
  ├─ proxy.ts ................ session refresh + optimistic route gate
  │                            MACHINE_ROUTES bypass for /api/webhooks, /api/cron
  │
  ├─ app/(auth)/ ............. sign-in, magic link, reset. NO signup path.
  │
  └─ app/(main)/<module>/
       page.tsx (RSC)   ─┐
       actions.ts       ─┤──> lib/access/*-access.ts   capabilitiesFor(role) — 7 roles, 14 files
       components/      ─┘         │
                                   └──> lib/data/*-repository.ts
                                             │
                              ┌──────────────┴──────────────┐
                              │                             │
                    utils/supabase/server.ts      utils/supabase/admin.ts
                    (cookie session, RLS ON)      (service role, RLS BYPASSED)
                              │                             │
                              │                    agency_id passed BY HAND
                              │                    (lib/agent/context.ts)
                              ▼                             ▼
                    ┌───────────────────────────────────────────────┐
                    │  Postgres — 65 tables, 23 views, 4 buckets     │
                    │  RLS: agency_id = current_agency_id()          │
                    │       AND staff_role_in(...)                   │
                    └───────────────────────────────────────────────┘
```

**Tenancy is enforced in exactly one place: the RLS predicate.** Anything that does not pass through
a Postgres RLS check on a `public` table is *not* tenant-isolated today. That single sentence
predicts every finding below.

---

## 2. Findings

Ordered by severity. Each was verified against the source, not inferred.

### F1 — Storage buckets are not tenant-isolated · **CRITICAL — live data leak**

Four buckets exist: `pilgrim-documents`, `supplier-evidence`, `payment-proofs`, `agency-assets`.
Their `storage.objects` policies key on **bucket + role only**
([20260822090000_rls_hardening.sql:452-535](supabase/migrations/20260822090000_rls_hardening.sql:452)):

```sql
create policy "staff read pilgrim documents" on storage.objects
  for select to authenticated
  using (bucket_id = 'pilgrim-documents' and public.staff_role_in('ADMIN','CEO','OPERATIONS','VISA'));
```

And the object keys carry no tenant segment:

| Builder | Path composed |
|---|---|
| [document-storage.ts:94](app/(main)/departure-groups/document-storage.ts:94) | `{departureGroupId}/{pilgrimId}/{file}` |
| [payment-proof-storage.ts:91](app/(main)/finance/payments/payment-proof-storage.ts:91) | `{bookingId}/{file}` |
| [supplier-storage.ts:68](app/(main)/suppliers/supplier-storage.ts:68) | `{supplierId}/{commitmentId}/{file}` |
| [logo-storage.ts:56](app/(main)/management/settings/branding/logo-storage.ts:56) | `logo/{uuid}.{ext}` |

**Consequence:** an `OPERATIONS` user at Agency B can list `pilgrim-documents` and mint a signed URL
for **every passport scan in the system**, across every agency. The tenancy migration's own §H flags
this as a known follow-up. It is the highest-consequence gap in the codebase.

`agency-assets` is additionally a **public** bucket — a public bucket cannot be tenant-isolated at
all, because `getPublicUrl()` bypasses policies by construction.

### F2 — Eleven global uniqueness constraints survived the retrofit · **HIGH — breaks tenant #2**

§F re-scoped 7 constraints. These are still globally unique:

| Constraint | Table · column | Failure mode for agency #2 |
|---|---|---|
| `departure_groups_code_unique` | `departure_groups(group_code)` | Cannot create group `HAJ-2026-01` if any other agency has it |
| `pilgrims_reference_key` | `pilgrims(reference)` — `PL-YYYY-NNNN` | Reference generator collides across tenants |
| `pilgrims_passport_idx` | `pilgrims(upper(passport_number))` | Two agencies cannot both serve the same traveller; also an **existence oracle** for passport numbers |
| `suppliers_code_unique` | `suppliers(supplier_code)` | Agencies compete for one supplier-code space |
| `supplier_commitments_reference_unique` | `supplier_commitments(reference_code)` | " |
| `payments_reference_unique` | `payments(payment_reference)` | see below |
| `payments_receipt_unique` | `payments(receipt_number)` | " |
| `invoices_number_unique` | `invoices(invoice_number)` | " |
| `refund_requests_reference_unique` | `refund_requests(reference)` | " |
| `finance_adjustments_reference_unique` | `finance_adjustments(reference)` | " |
| `agency_service_addons_code_unique` | `agency_service_addons(code)` | Agency #2 cannot be seeded with the standard add-on catalogue at all |

The finance case is the nastiest. `nextReferenceNumber()`
([finance-repository.ts:90](lib/data/finance-repository.ts:90)) computes the next number **through
RLS** — correctly seeing only its own agency's rows — produces `PMT-2026-0001`, and the *globally*
unique index rejects it because agency A already holds that number. The user gets an opaque
duplicate-key error and the payment is lost.

It is also an information leak: a unique violation confirms another tenant holds a given passport
number, invoice number or group code.

### F3 — Two views bypass RLS entirely · **HIGH**

21 of 23 views carry `security_invoker = true`
([20260822090000_rls_hardening.sql:420-443](supabase/migrations/20260822090000_rls_hardening.sql:420)).
`pilgrim_price_rows` and `booking_price_rows` were created **after** that migration
([20260823090000_pilgrim_customisation.sql:248](supabase/migrations/20260823090000_pilgrim_customisation.sql:248))
and never got it. A view without `security_invoker` runs as its owner and **does not apply RLS to the
underlying tables**. Both are auto-exposed over PostgREST.

Mitigating: no application code reads them yet (`grep` finds no references outside migrations). Still
a one-request cross-tenant dump of every traveller's pricing for any authenticated user.

### F4 — A new agency cannot be created at all · **BLOCKING for the product**

A complete chicken-and-egg:

- `agencies` has **no insert policy** for `authenticated` — deliberate, per §G of the tenancy migration.
- `staff_profiles.agency_id` is `not null default current_agency_id()`, and that function returns
  `null` on a service-role connection → an admin-client insert of the *first* staff member of a *new*
  agency violates `not null` unless `agency_id` is supplied explicitly.
- The only code that creates a `staff_profiles` row is `inviteStaff()`
  ([team-repository.ts:236](lib/data/team-repository.ts:236)), which requires an already-signed-in
  actor **inside an existing agency**.
- `sendMagicLinkAction` sets `shouldCreateUser: false`, and the README instructs disabling public
  sign-ups ([app/(auth)/README.md](app/(auth)/README.md) §4).

Agency #2 can therefore only be born by hand in the SQL editor. Tenancy without an onboarding path is
a schema feature, not a product.

### F5 — Nothing provisions a new agency's baseline data · **HIGH**

Every default row was seeded once, unconditionally, for the single pre-existing agency:

| Seed | Migration |
|---|---|
| `agency_settings` (60 columns of defaults) | [20260821090000:193](supabase/migrations/20260821090000_agency_settings.sql:193) — uses `on conflict (singleton)`, a constraint the tenancy migration **has since dropped**; that statement can no longer even be re-run |
| `lead_sources` (WALK_IN, REFERRAL, …) | [20260812100000:22](supabase/migrations/20260812100000_create_leads.sql:22) |
| `branches` (Colombo, Kandy) | [20260821090000:454](supabase/migrations/20260821090000_agency_settings.sql:454) |
| `integration_connections` (WHATSAPP_BUSINESS = NOT_CONNECTED, …) | [20260821090000:269](supabase/migrations/20260821090000_agency_settings.sql:269) |
| `agency_service_addons` (10-row catalogue) | [20260826090000_pilgrim_service_customisation.sql:33](supabase/migrations/20260826090000_pilgrim_service_customisation.sql:33) |
| `ai_settings` | [20260826090000_ai_agent.sql:50](supabase/migrations/20260826090000_ai_agent.sql:50) — per-agency, but only for agencies that existed when it ran |

Agency #2 lands in the app with **no settings row**, and `getAgencySettings()`
([settings-repository.ts:94](lib/data/settings-repository.ts:94)) *throws* when it is missing, which
cascades into most of Settings and anything reading agency defaults.

### F6 — Identity is global, membership is a scalar · **MEDIUM — needs a decision**

- `auth.users.email` is unique across the whole Supabase project.
- `staff_profiles_email_unique` on `lower(email)` is deliberately left **global**
  ([20260824090000:288](supabase/migrations/20260824090000_tenancy.sql:288)).
- `staff_profiles.agency_id` is one column — a person belongs to exactly one agency, forever.

Concrete bug today: `inviteStaff()` checks for an existing profile with `.ilike("email", email)`
**through RLS**, so it only sees its own agency. It reports "not on the team", then
`admin.auth.admin.inviteUserByEmail()` fails with Supabase's raw duplicate-user message. The admin
sees a confusing error, and the failure discloses that the address exists somewhere on the platform.

There is also no concept of a consultant, accountant or support engineer working with two agencies —
and no agency switcher anywhere in the UI.

### F7 — `agencies.status` is enforced nowhere · **MEDIUM**

The column exists with `ACTIVE | SUSPENDED | CANCELLED`
([20260824090000:31](supabase/migrations/20260824090000_tenancy.sql:31)). `grep` finds **zero**
readers in `.ts`/`.tsx` and zero references in any RLS policy. A suspended agency's staff sign in and
work normally. There is no lever to stop a non-paying or abusive tenant.

### F8 — No platform/operator surface · **MEDIUM**

`agencies` has exactly one policy: `select … using (id = current_agency_id())`. There is no role
above `ADMIN`, no `platform_admins` table, no way to list tenants, create one, suspend one, or answer
"how many agencies are on the system". Every operator action today is a manual SQL-editor session
with the service-role key.

### F9 — No plans, limits, quotas or billing · **MEDIUM — product scope**

Nothing caps seats, groups, storage, WhatsApp conversations or AI tokens per agency. `agent_runs` and
`agent_tool_calls` already record per-agency usage
([20260826090000_ai_agent.sql:60](supabase/migrations/20260826090000_ai_agent.sql:60)) — the metering
substrate exists and nothing consumes it. Meta bills each agency directly for WhatsApp (F12 of the
prior plan), so messaging spend is not a platform cost; Anthropic tokens are.

### F10 — Index shape is single-column `agency_id` · **MEDIUM — performance**

§C created `<table>_agency_id_idx` on `agency_id` alone, 54 times. Real queries are
`agency_id = ? AND status = ? ORDER BY departure_date`. With one agency the planner ignores these
indexes entirely (one distinct value, no selectivity), so the cost is invisible today and shows up
exactly when the second large tenant lands.

Related: RLS predicates call `public.current_agency_id()` bare. Supabase's documented pattern is
`(select public.current_agency_id())`, which lets Postgres evaluate it once as an InitPlan rather
than per row. On a 50k-row scan that is a measurable difference.

### F11 — No cross-tenant referential integrity · **MEDIUM**

`departure_group_bookings.agency_id` and `.departure_group_id` are independent columns. Nothing at
the database level stops a row from pointing at a parent in another agency. RLS makes that unreachable
from a session client — but **the service-role paths bypass RLS by definition**
(`lib/agent/*`, the webhook, `team-repository.ts`). One missing `agencyId` filter in agent code
writes a cross-tenant row that no constraint rejects.

### F12 — Tenant-agnostic surfaces still hardcode one tenant · **LOW**

- [app/layout.tsx:45](app/layout.tsx:45) — `title.template: "%s · Royal Al-Fathima Travels"`.
- [team-repository.ts:296](lib/data/team-repository.ts:296) — invite WhatsApp copy hardcodes the
  agency name.
- Auth emails come from Supabase's project-level templates: every agency's staff receive the same
  branded invite regardless of `agency_settings.agency_name` / logo.

### F13 — No tenant-aware observability or data lifecycle · **LOW**

No `agency_id` on log lines, no per-tenant error attribution, no portable tenant export (the Settings
"Export all" action is RLS-scoped but produces no archive), and no defined deletion path for
`CANCELLED` — `agencies` is referenced by 55 `not null` FKs, so a delete is a 55-table cascade nobody
has designed.

---

## 3. Decisions

| # | Decision | Rationale |
|---|---|---|
| **D1** | **Keep shared-schema, RLS-per-row.** No schema-per-tenant, no database-per-tenant. | 65 tables × N schemas is unmanageable for migrations, and RLS is already correct across the board. The cost of shared-schema is discipline on the service-role paths — which D11 and F11's constraints address directly. |
| **D2** | **Fix isolation before building the business.** Phases 1–2 ship before any onboarding work. | These are live defects on a system that already has a tenancy schema. A leak found after tenant #2 signs up is an incident, not a bug. |
| **D3** | **Storage isolation = agency-prefixed object keys + policies that parse the prefix.** Paths become `{agency_id}/…`; policies gain `(storage.foldername(name))[1] = (select public.current_agency_id())::text`. | Supabase's own recommended pattern. Needs no new tables and no change to the signed-URL flow already in use — only the server-side key composition, which the client never controls. |
| **D4** | **`agency-assets` becomes private**, served through short-lived signed URLs like every other bucket. | A public bucket cannot be tenant-isolated: `getPublicUrl()` bypasses policies by construction. Logos are small and already fetched server-side, so signing them is cheap. |
| **D5** | **Membership becomes a table: `agency_members (user_id, agency_id, role, status)`**, with `staff_profiles.agency_id` retained for compatibility and `current_agency_id()` rewritten to resolve the *active* membership. | Solves F6 (one person, N agencies) **without rewriting 100+ RLS policies** — they all call `current_agency_id()` and keep working unchanged. The active-agency choice moves to a cookie resolved in `proxy.ts` and re-validated server-side on every request. |
| **D6** | **Onboarding is invite-first, not open signup.** A new agency is created by a platform operator, or by a self-serve form behind email verification and a `SIGNUP_MODE` flag; the creator becomes its first `ADMIN`. | The product sells to travel agencies, not anonymous signups. Open signup on a system holding passport scans is a liability. Build the mechanism so the policy can be loosened with one flag. |
| **D7** | **Provisioning is one `provision_agency()` SQL function**, called in the same transaction that creates the agency. | Idempotent, transactional, and callable from both the operator console and a future self-serve flow. Keeping it in SQL rather than TypeScript means the seed cannot drift between call sites. |
| **D8** | **A platform operator is a `platform_admins` row, not an eighth `StaffRole`.** | `StaffRole` is an *agency* concept feeding 14 `capabilitiesFor*()` matrices. Adding `SUPERADMIN` there would grant agency capabilities by accident in every matrix with a default branch. Platform admin is a separate axis with its own `is_platform_admin()` helper and its own route group. |
| **D9** | **Suspension is enforced inside `current_agency_id()`**, which returns `null` when the agency is not `ACTIVE`. | One function, and all ~110 policies inherit the check for free. A suspended tenant's staff can still sign in — they get a "workspace suspended" screen rather than an empty, broken app. |
| **D10** | **Plans and limits ship as a table plus a checked helper; payment-provider integration is out of scope.** | Metering and enforcement are engineering; choosing Stripe vs. invoice-by-hand is a business decision that should not block isolation work. The schema is built so a provider bolts on without a migration. |
| **D11** | **Every service-role call site goes through a `createTenantAdminClient(agencyId)` wrapper** that stamps `agency_id` on writes and asserts it on reads. | F11's root cause is that `createAdminClient()` returns a raw, unscoped client. Making the scoped wrapper the ergonomic default is cheaper than auditing every future call site. |
| **D12** | **No custom domains or per-tenant subdomains.** One origin; tenant resolved from the session. | Subdomains multiply the auth-cookie, CSP and certificate surface for zero isolation benefit. Revisit when a customer asks and pays for white-labelling. |

---

## 4. Phases

Phases 1–2 are defect fixes and are independently shippable. Phases 3–6 build the product. Phase 7
hardens it. **Phases 1 and 2 depend on no product decision and should start immediately.**

---

### Phase 1 — Close the isolation holes · *~3–4 days* · fixes **F1, F3**

**Migration:** `supabase/migrations/20260827090000_tenant_storage_isolation.sql`

1. Make `agency-assets` private (D4), keeping the MIME allow-list from
   [20260822090000 §L](supabase/migrations/20260822090000_rls_hardening.sql:537).
2. Replace all 16 `storage.objects` policies with agency-prefix-aware versions:

   ```sql
   create policy "staff read pilgrim documents" on storage.objects
     for select to authenticated
     using (
       bucket_id = 'pilgrim-documents'
       and (storage.foldername(name))[1] = (select public.current_agency_id())::text
       and public.staff_role_in('ADMIN','CEO','OPERATIONS','VISA')
     );
   ```
3. Migrate existing objects under the `{agency_id}/` prefix. One agency today, so this is a single
   `update storage.objects set name = <agency>||'/'||name where bucket_id in (…)`, **plus the stored
   path columns in the same transaction**: `departure_group_pilgrim_documents.file_path`, the
   supplier-evidence and payment-proof path columns, and `agency_settings`' logo path. A
   half-migrated bucket is an unreadable bucket.
4. `alter view public.pilgrim_price_rows set (security_invoker = true);` and the same for
   `booking_price_rows` (F3).

**Application changes:**

| File | Change |
|---|---|
| [document-storage.ts:94](app/(main)/departure-groups/document-storage.ts:94) | prefix `${agencyId}/` |
| [payment-proof-storage.ts:91](app/(main)/finance/payments/payment-proof-storage.ts:91) | same |
| [supplier-storage.ts:68](app/(main)/suppliers/supplier-storage.ts:68) | same |
| [logo-storage.ts:56](app/(main)/management/settings/branding/logo-storage.ts:56) | prefix, and replace `getPublicUrl()` with `createSignedUrl()`; `agencyAssetPublicUrl()` → `agencyAssetSignedUrl()` |
| [logo-upload.tsx](app/(main)/management/settings/branding/logo-upload.tsx), [branding-form.tsx](app/(main)/management/settings/branding/branding-form.tsx), header/sidebar logo consumers | consume the signed URL |

> **The agency id must come from `getCurrentStaffRole().agencyId`
> ([departure-groups.ts:337](lib/data/departure-groups.ts:337)) — never from a Server Action
> parameter.** A caller-supplied `agencyId` on a Server Action is a public POST parameter and would
> re-open the hole from the other side. This is the same rule
> [lib/agent/context.ts](lib/agent/context.ts) already documents for the AI tools.

**Acceptance:** with two agencies seeded and one signed-in user each, `storage.list()` on every bucket
returns only own-agency objects, and a signed URL request for agency A's guessed path is refused for
agency B.

---

### Phase 2 — Per-agency uniqueness + referential integrity · *~2–3 days* · fixes **F2, F11, F10**

**Migration:** `supabase/migrations/20260828090000_tenant_uniqueness.sql`

1. Re-scope all 11 constraints from F2 to `(agency_id, …)`, following §F's exact pattern:

   ```sql
   alter table public.departure_groups drop constraint if exists departure_groups_code_unique;
   alter table public.departure_groups
     add constraint departure_groups_code_agency_unique unique (agency_id, group_code);
   ```

   `pilgrims_passport_idx` becomes
   `unique (agency_id, upper(passport_number)) where passport_number is not null`.

2. **Composite FKs on the tenant-critical parents** (F11). For each parent add a
   `unique (id, agency_id)` (redundant, but FK-referenceable), then re-point the child FK:

   ```sql
   alter table public.departure_groups
     add constraint departure_groups_id_agency_unique unique (id, agency_id);

   alter table public.departure_group_bookings
     drop constraint departure_group_bookings_departure_group_id_fkey,
     add  constraint departure_group_bookings_group_fkey
       foreign key (departure_group_id, agency_id)
       references public.departure_groups (id, agency_id) on delete cascade;
   ```

   Apply to the **eight highest-consequence edges only** — `departure_groups`,
   `departure_group_bookings`, `pilgrims`, `leads`, `packages`, `invoices`, `payments`, `suppliers`.
   These are what agent/service-role code writes to. Full 55-table coverage doubles the migration for
   diminishing returns.

   Run a detection query first (`child.agency_id <> parent.agency_id`) as a `raise notice` audit
   before adding each constraint, exactly as 20260823's backfill check does.

3. Composite indexes for the real access patterns (F10), derived from the `ORDER BY` in each
   `*-repository.ts` list query — roughly 12 of them:

   ```sql
   create index if not exists departure_groups_agency_status_date_idx
     on public.departure_groups (agency_id, group_status, departure_date desc);
   create index if not exists leads_agency_stage_idx
     on public.leads (agency_id, stage, created_at desc);
   create index if not exists payments_agency_date_idx
     on public.payments (agency_id, paid_at desc);
   ```

4. Rewrite every policy's `public.current_agency_id()` → `(select public.current_agency_id())` using
   the same `pg_policies`-driven loop §E used, for InitPlan caching.

**Application changes:** none. `nextReferenceNumber()`, `nextBookingReference()` and
`nextLeadReference()` already query through RLS and were correct-but-unenforceable; this migration
makes the database agree with them.

**Acceptance:** a script creates agency B and inserts a group with agency A's exact `group_code`, a
payment with agency A's exact `payment_reference`, and a pilgrim with agency A's exact passport
number — all three succeed. A booking naming agency A's group id under agency B's `agency_id` fails
on the composite FK.

---

### Phase 3 — Membership, lifecycle, provisioning · *~1.5 weeks* · fixes **F4, F5, F6, F7**

**Migration:** `supabase/migrations/20260829090000_agency_membership.sql`

1. **`agency_members`** — the join table (D5):

   ```sql
   create table public.agency_members (
     id          uuid primary key default gen_random_uuid(),
     user_id     uuid not null references auth.users (id) on delete cascade,
     agency_id   uuid not null references public.agencies (id) on delete cascade,
     role        text not null,                       -- same 7-value domain as staff_profiles.role
     status      text not null default 'ACTIVE'
                   check (status in ('INVITED','ACTIVE','SUSPENDED','REMOVED')),
     is_default  boolean not null default false,
     created_at  timestamptz not null default now(),
     unique (user_id, agency_id)
   );
   create unique index agency_members_one_default
     on public.agency_members (user_id) where is_default;
   ```
   Backfill one row per existing `staff_profiles` row with `is_default = true`.

2. **`current_agency_id()` v2** — resolves the *active* membership and enforces agency status (D9):

   ```sql
   create or replace function public.current_agency_id() returns uuid
     language sql stable security definer set search_path = public as $$
     select m.agency_id
     from public.agency_members m
     join public.agencies a on a.id = m.agency_id
     where m.user_id = auth.uid()
       and m.status = 'ACTIVE'
       and a.status = 'ACTIVE'
       and m.agency_id = coalesce(
             nullif(current_setting('request.jwt.claims', true)::json ->> 'active_agency_id','')::uuid,
             (select agency_id from public.agency_members
               where user_id = auth.uid() and is_default and status = 'ACTIVE')
           )
     limit 1
   $$;
   ```

   Every existing policy inherits both the membership model and suspension enforcement with **zero
   policy edits** — the entire reason D5 keeps the function signature stable.

   > **Sequencing:** ship the `coalesce(…, default membership)` form first (behaviour identical to
   > today), then add the custom-access-token claim, then enable the switcher. Do not land all three
   > in one deploy — a wrong `current_agency_id()` is a total outage or, worse, a cross-tenant read.

3. **`provision_agency(p_name, p_slug, p_owner_user_id)`** (D7) — `security definer`, `revoke`d from
   `authenticated`. In one transaction: insert `agencies`; seed `agency_settings` (every default from
   [20260821090000](supabase/migrations/20260821090000_agency_settings.sql)), `branches` (one primary
   "Head Office"), `lead_sources`, `integration_connections` placeholders, `agency_service_addons`
   (the 10-row catalogue), a starter `message_templates` set, and `ai_settings`; then
   `staff_profiles` + `agency_members` for the owner as `ADMIN`. Returns the new `agency_id`.

   Also **backfill the gap**: run the same seed for any existing agency missing rows, so F5's
   partially-provisioned state cannot persist anywhere.

4. **Suspension surfaces** — `app/(main)/suspended/page.tsx`, plus a check in
   [app/(main)/layout.tsx:15](app/(main)/layout.tsx:15): when `getCurrentStaffRole()` returns a null
   `agencyId` *and* the user has a membership row, render the suspended screen instead of an empty
   dashboard.

**Application changes:**

| File | Change |
|---|---|
| [lib/data/departure-groups.ts:337](lib/data/departure-groups.ts:337) | `getCurrentStaffRole()` additionally returns `memberships: {agencyId, agencyName, role}[]` |
| `lib/tenancy.ts` **(new)** | `getActiveAgency()`, `listMemberships()`, `switchAgencyAction()` — sets the active-agency cookie only after verifying membership server-side |
| [proxy.ts](proxy.ts) | read the active-agency cookie; drop it when it names an agency the user is not an ACTIVE member of |
| `components/agency-switcher.tsx` **(new)** | rendered from [components/app-sidebar.tsx](components/app-sidebar.tsx); hidden entirely when `memberships.length === 1` |
| [team-repository.ts:236](lib/data/team-repository.ts:236) | `inviteStaff()` — scope the duplicate check to the agency, and handle "user already exists on the platform" by adding an `agency_members` row and sending an *add-to-workspace* invite instead of failing (F6) |
| [lib/dal.ts:41](lib/dal.ts:41) | `touchLastActive()` also flips `agency_members.status` from `INVITED` to `ACTIVE` |

**Acceptance:** one user with memberships in two agencies switches between them and sees two disjoint
dashboards; setting `agencies.status = 'SUSPENDED'` makes every query in that agency return zero rows
and lands its staff on the suspended screen within one request.

---

### Phase 4 — Platform operator console · *~1 week* · fixes **F8**

**Migration:** `supabase/migrations/20260830090000_platform_admin.sql`

```sql
create table public.platform_admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.platform_admins enable row level security;   -- no policies: service-role only

create or replace function public.is_platform_admin() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid())
$$;
```

Grant `agencies` insert/update to platform admins only. **Do not widen any tenant-table policy** —
operator access to tenant data goes through an explicit, audited impersonation path, never an ambient
`or is_platform_admin()` clause bolted onto ~110 policies.

**New route group** `app/(platform)/`, sibling to `(main)`, gated in [proxy.ts](proxy.ts) and again
in its own layout:

```
app/(platform)/
  layout.tsx                      is_platform_admin() or notFound()
  agencies/page.tsx               list: name, slug, status, staff, groups, last activity
  agencies/new/page.tsx           create → provision_agency()
  agencies/[agencyId]/page.tsx    detail: usage, plan, integrations, suspend/resume
  agencies/[agencyId]/actions.ts  suspendAgencyAction, resumeAgencyAction, impersonateAction
  support/page.tsx                impersonation audit log
```

**Impersonation** (`support_sessions`: operator, agency, reason, expires_at, ended_at) issues a
time-boxed active-agency grant, requires a typed reason, and writes a `settings_activity_logs` row
**inside the tenant** so the agency can see it. An operator who can silently read customer data is a
compliance problem; an operator whose every session is visible to the customer is a support feature.

**Acceptance:** an operator creates an agency, invites its first admin, suspends, resumes and
impersonates it — every action visible in both the platform audit log and the tenant's own activity
log. A non-operator hitting `/platform` gets a 404, not a 403.

---

### Phase 5 — Onboarding & first-run · *~1 week* · fixes **F4 end-to-end, F12**

1. **Agency signup** `app/(auth)/signup/` — agency name, admin name, email, password. Gated by
   `SIGNUP_MODE = 'invite_only' | 'open'` (default `invite_only`, D6). Calls `provision_agency()`
   from a service-role Server Action **after** email verification, never before — an unverified
   signup must not be able to create a tenant.
2. **Accept-invite flow** at `/invitations/[token]` for a user who already has a platform account
   being added to a second agency — distinct from Supabase's `inviteUserByEmail` first-account flow.
3. **First-run checklist** on the dashboard for a fresh agency: branding, branches, invite the team,
   connect WhatsApp, create the first package. Derived from `agency_settings` completeness; no new
   table.
4. **De-hardcode the brand (F12):**
   - [app/layout.tsx:45](app/layout.tsx:45) → a generic platform name; the per-agency title moves to
     `app/(main)/layout.tsx` via `generateMetadata()` reading `agency_settings.agency_name`.
   - [team-repository.ts:296](lib/data/team-repository.ts:296) → interpolate the agency name.
   - Auth emails: move invite/reset delivery off Supabase's project-level templates onto an app-owned
     sender so the agency's own name and logo appear. *If that is too large for this phase, at
     minimum make the templates agency-neutral* — a Royal Al-Fathima–branded email arriving at
     another agency's staff is a visible tenancy leak.

---

### Phase 6 — Plans, limits, metering · *~1 week* · fixes **F9**

**Migration:** `supabase/migrations/20260831090000_agency_plans.sql`

```sql
create table public.plans (
  code text primary key,                 -- STARTER, GROWTH, ENTERPRISE
  name text not null,
  max_staff int, max_active_groups int, max_pilgrims int,
  storage_mb int, ai_tokens_monthly bigint,
  features jsonb not null default '{}'   -- { "whatsapp_agent": true, "reports_advanced": false }
);

alter table public.agencies
  add column plan_code text not null default 'STARTER' references public.plans (code),
  add column trial_ends_on date;

create table public.agency_usage_daily (
  agency_id uuid not null references public.agencies (id) on delete cascade,
  day date not null,
  staff_count int, active_groups int, pilgrims int,
  storage_bytes bigint, ai_input_tokens bigint, ai_output_tokens bigint,
  whatsapp_messages int,
  primary key (agency_id, day)
);
```

- `enforce_limit(p_agency_id, p_metric)` — `security definer`, called from `inviteStaff()`, group
  creation and the AI runtime. Returns a typed refusal the UI renders as an upgrade prompt, never a
  raw constraint error.
- Feature flags resolve through `lib/access/*-access.ts`, which already centralises capability
  logic: `capabilitiesFor(role)` becomes `capabilitiesFor(role, planFeatures)`. **This is the one
  change that touches all 14 access files** — do it mechanically, in one commit, and let
  `tsc --noEmit` find every call site.
- Nightly rollup into `agency_usage_daily` from `agent_runs`, `agent_tool_calls`, `storage.objects`
  and row counts, via `app/api/cron/usage-rollup/route.ts` reusing the existing `CRON_SECRET`
  pattern and the `MACHINE_ROUTES` bypass.
- **Billing integration is out of scope** (D10). The schema carries `plan_code` and usage; wiring a
  payment provider is a separate, smaller piece once pricing is decided.

---

### Phase 7 — Hardening, tests, operations · *~1 week* · fixes **F13**, locks in everything above

1. **`createTenantAdminClient(agencyId)`** in [utils/supabase/admin.ts](utils/supabase/admin.ts)
   (D11), stamping `agency_id` on writes and asserting it on reads. Migrate every service-role call
   site: [lib/agent/context.ts:34](lib/agent/context.ts:34),
   [lib/agent/drain.ts:39](lib/agent/drain.ts:39),
   [app/api/webhooks/whatsapp/route.ts:84](app/api/webhooks/whatsapp/route.ts:84),
   [app/inbox/actions.ts:104](app/inbox/actions.ts:104),
   [whatsapp-actions.ts](app/(main)/management/settings/integrations/whatsapp-actions.ts) (5 sites).
   The 4 sites in [team-repository.ts](lib/data/team-repository.ts) are `auth.admin.*` only and may
   keep the raw client — but annotate them so the exception is deliberate rather than accidental.

2. **A tenant-isolation test suite** — the deliverable that stops all of this regressing:
   - seed two agencies with deliberately overlapping codes, references and passport numbers;
   - for **every** table in `information_schema`, assert a session as agency B reads zero agency-A
     rows (one loop, not 65 hand-written tests);
   - for every bucket, assert agency B can neither list nor sign agency A's objects;
   - assert every view has `security_invoker = true` — *this is what would have caught F3*;
   - assert no `public` table lacks `agency_id`, an FK, and RLS — *this is what catches the next F3*.

   > **This is the single most valuable artifact in the plan.** Write it in Phase 1, against the
   > holes it is meant to prove, and grow it with each phase.

3. **Observability** — `agency_id` on every structured log line and error report; per-tenant error
   rates in the platform console.

4. **Data lifecycle (F13)** — `export_agency(agency_id)` producing a JSON-per-table bundle plus a
   manifest of storage objects, and `delete_agency(agency_id)` walking the 55 FK edges in dependency
   order. Both service-role only; deletion requires the agency to have been `CANCELLED` for N days.

5. **Docs** — update [app/(auth)/README.md](app/(auth)/README.md) (sign-ups are no longer universally
   disabled), [.env.example](.env.example) (`SIGNUP_MODE`, `PLATFORM_ADMIN_EMAILS`), and
   [AGENTS.md](AGENTS.md) with the standing rule: *every new table gets `agency_id not null default
   current_agency_id()`, an RLS policy, and a row in the isolation test.*

---

## 5. Migration sequence

| # | File | Phase | Notes |
|---|---|---|---|
| 1 | `20260827090000_tenant_storage_isolation.sql` | 1 | Object renames + path columns in one transaction |
| 2 | `20260828090000_tenant_uniqueness.sql` | 2 | Constraints and indexes only — fully reversible |
| 3 | `20260829090000_agency_membership.sql` | 3 | Additive; `current_agency_id()` is a function swap |
| 4 | `20260830090000_platform_admin.sql` | 4 | Additive |
| 5 | `20260831090000_agency_plans.sql` | 6 | Additive |
| 6 | `20260901090000_tenant_lifecycle.sql` | 7 | Additive (export/delete routines) |

Each is independently deployable and safe on a database with everything before it applied — the
convention every migration in this repository already follows.

---

## 6. Risk register

| Risk | Severity | Mitigation |
|---|---|---|
| Storage path migration half-applies, orphaning uploaded documents | **High** | One transaction covering objects *and* path columns; dry-run against a restored snapshot; keep the pre-migration object list as a manifest |
| `current_agency_id()` v2 is wrong → everyone sees nothing, or sees the wrong agency | **High** | Ship in the three steps of D5's sequencing note; run the isolation suite against each step; the first step is behaviour-identical to today |
| Re-scoping uniqueness silently permits duplicates *within* an agency | Medium | Every replacement is `unique (agency_id, <original columns>)` — strictly narrower per tenant; drop and add stay paired in one statement block |
| Composite FKs fail to apply because pre-existing rows are already inconsistent | Medium | Run the `child.agency_id <> parent.agency_id` audit as a `raise notice` before each constraint, as 20260823's backfill check does |
| Plan-feature threading misses one of the 14 `*-access.ts` files | Medium | Change the `capabilitiesFor*()` signatures so the compiler finds every call site; `tsc --noEmit` is the enforcement, not review |
| Per-tenant WhatsApp tokens leak across agencies | Medium | Already handled — the Vault secret is named `whatsapp_token_{agency_id}` ([20260825090000:316](supabase/migrations/20260825090000_whatsapp_channel.sql:316)). Add a test asserting agency B cannot read agency A's `credential_ref` |
| Effort underestimated because 65 tables "already have `agency_id`" | Medium | The estimates assume **no policy rewrites** — D5's entire purpose. If `current_agency_id()` cannot stay signature-compatible, Phase 3 roughly doubles |

---

## 7. What this plan deliberately does not do

- **Custom domains / per-tenant subdomains** (D12).
- **Payment-provider integration** — the schema is ready; the integration is a separate piece (D10).
- **Schema-per-tenant or per-tenant databases** (D1).
- **Rework the 7-role model.** Agency roles stay exactly as they are; platform admin is a separate
  axis (D8).
- **Data residency or regional sharding.** One Supabase project, one region.

---

## 8. Recommended sequencing

```
Week 1        Phase 1  storage + views          ──┐
                                                  ├─ isolation test suite, written first
Week 1–2      Phase 2  uniqueness + FKs         ──┘

Week 2–3.5    Phase 3  membership, provisioning, suspension   ← the keystone
Week 3.5–4.5  Phase 4  platform console     ─┐  can run in parallel
Week 4–5      Phase 5  onboarding, branding ─┘  with two engineers
Week 5–6      Phase 6  plans & metering
Week 6–7      Phase 7  hardening, lifecycle, docs
```

**≈6–7 weeks for one engineer, ≈4–5 for two.** Phases 1 and 2 are about 1.5 weeks of that and fix
live defects — **ship them independently of any decision about the rest of this plan.**
