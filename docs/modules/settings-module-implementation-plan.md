# Settings Module — Implementation Plan

Build the **Settings** area at `/management/settings` on the same data, access and action
architecture already used by **Packages**, **Departure Groups**, **Leads**, **Pilgrims**,
**Documents**, **Visa**, **Operations**, **Suppliers**, **Finance**, **Reports** and **Team**.

Status: **Phases 0–11 implemented** (migration, access/types/validations/copy/repository, shell, and
all ten sections — Organisation, Branches, Branding & Pilgrim Portal, Operational Defaults,
Communication Templates, Finance Defaults, Integrations, Security & Access, Data & Audit, Danger
Zone). Finance numbering (§9.1) is wired to `nextReferenceNumber()`. Still open: readiness-band
wiring into `departure-groups-readiness.ts` / Reports (§9.3), departure-group/Team invite defaults
wiring (§9.2, §9.4), branch-scoped query filtering (§9.5, blocked on real booking/lead branch
columns), the `?? "LKR"` sweep (§9.6), and CSV import (§7 Phase 10b, deliberately deferred per F7).
Not exercised against a live Supabase instance in this pass — no local DB/session was available;
verified by full `tsc`, `eslint` and `next build`.

The product rule the whole plan enforces:

```text
If it is changed daily for one lead, booking, pilgrim or group  →  it does NOT belong in Settings.
If it defines a reusable agency-wide rule, template, identity,
security policy or integration                                   →  it belongs here.
```

And the boundary it must not cross:

```text
Settings   →  agency identity, branches, reusable rules, templates, integrations, policy, audit
Team       →  who the people are, what role they hold, what they own
Packages   →  the sellable product and its per-package rules
Departure Groups / Operations / Finance  →  the live work
```

Three supporting rules carried into every section below:

- **A setting that nothing reads is decoration.** Every field added in §5 names the exact call
  site in `lib/` that will consume it (§9). A section is not "done" when it saves — it is done
  when a consumer reads it.
- **Settings define defaults, not retro-active truth.** Changing "Default Group Capacity" must
  never rewrite an existing group. Frozen snapshots (`buildPackageSnapshot()`) stay frozen.
- **Settings is a low-frequency screen.** No KPI row, no saved views, no filter chips, no
  DataTable on a configuration form. The only table-shaped surface in the whole module is the
  Audit Log (§5.9).

---

## 1. What exists today

### 1.1 The route

| File | State |
|---|---|
| `app/(main)/management/settings/` | **Does not exist.** No route, no folder, no page, no layout. |
| `app/(main)/management/page.tsx` | Exists. Redirects `/management` → `/management/team`. Breadcrumb-only node. |
| [components/app-sidebar.tsx:134](components/app-sidebar.tsx:134) | The `Management` sidebar group holds exactly one entry — `Team`. The `Settings` entry was **deliberately removed** ([app-sidebar.tsx:50](components/app-sidebar.tsx:50): *"Only routes that actually exist are listed — Tasks, Settings, Help… had no page behind them"*). This module is what puts it back. |
| [app/(main)/dashboard/components/system-health.tsx:67](app/\(main\)/dashboard/components/system-health.tsx:67) | `<Link href="/settings/integrations">` — **a live dead link, 404s today.** Fixed in Phase 8. |

### 1.2 What already exists and is the real starting point

Unlike Team, this is **not** greenfield. Every value the Settings page is supposed to control
already exists somewhere in the codebase — as a hardcoded constant, a `CHECK` constraint, a
per-entity column default, or a `*-copy.ts` export. The module's job is to give those a home,
a writer and a reader; it is a **centralisation** exercise, not a new-domain exercise.

| Concern | Where it lives today | Fitness |
|---|---|---|
| Agency identity (name, address, registration, email, WhatsApp) | **Nowhere.** Hardcoded strings in invoice/voucher/portal copy | **Missing.** Blocking for Organisation, Branding, Finance |
| Branches | `staff_profiles.branch text check (branch in ('COLOMBO','KANDY','ALL'))` — [20260820090000:25](supabase/migrations/20260820090000_team_access.sql:25); `departure_groups.branch text` + an unused reserved `branch_id uuid` — [20260809090000:27](supabase/migrations/20260809090000_create_departure_groups.sql:27); `packages.branch text default ''` — [20260808090000:32](supabase/migrations/20260808090000_create_packages.sql:32) | **Three incompatible representations, one of them a hard `CHECK`.** "Add Branch" is impossible without a migration (F1) |
| Reserved multi-tenant columns | `agency_id` / `branch_id` uuid on `departure_groups`, no FK — the migration's own comment says *"the agencies/branches tables do not exist in this schema"* ([20260809090000:17](supabase/migrations/20260809090000_create_departure_groups.sql:17)) | **The hook is already cut.** This module supplies the table it was reserved for |
| Currency | `"LKR"` fallback in ~12 places — [departure-groups.ts:1207](lib/data/departure-groups.ts:1207), [finance.ts:167](lib/data/finance.ts:167), [validations/finance.ts:65](lib/validations/finance.ts:65), [departure-groups-ai.ts:141](lib/data/departure-groups-ai.ts:141) | **Hardcoded default, consistently.** One `defaultCurrency` setting replaces every `?? "LKR"` |
| Supported currencies | `["SAR","LKR","USD","AED","OTHER"]` — [validations/suppliers.ts:24](lib/validations/suppliers.ts:24), [types/suppliers.ts:29](lib/types/suppliers.ts:29) | Static union type. Settings can drive the *picker*; the type stays (D6) |
| Invoice / receipt numbering | `nextReferenceNumber(db, table, column, prefix)` — [finance-repository.ts:90](lib/data/finance-repository.ts:90), called with literal `"INV"` ([:511](lib/data/finance-repository.ts:511), [:688](lib/data/finance-repository.ts:688)) and `"RCT"` ([:333](lib/data/finance-repository.ts:333)) | **Already a single choke point.** Prefix becomes an argument from settings — a 3-line change (§9.1) |
| Payment methods | `check (method in ('CASH','BANK_TRANSFER','CARD','ONLINE','CHEQUE','OTHER'))` — [20260818090000:193](supabase/migrations/20260818090000_finance_payments.sql:193) | The six the spec lists, exactly. Settings toggles which are **offered**, never widens the CHECK (D5) |
| Group capacity / min size / seat hold | Per-group columns with defaults: `seat_hold_expiry_hours default 24` ([20260809090000:56](supabase/migrations/20260809090000_create_departure_groups.sql:56)), `capacity`, `minimum_group_size` with a cross-check constraint ([:86](supabase/migrations/20260809090000_create_departure_groups.sql:86)) | **Per-group storage is right.** Settings supplies the *create-form default*, never rewrites a group (D2) |
| Readiness | `lib/data/departure-groups-readiness.ts` — per-item `NOT_STARTED / COMPLETE` states, no percentage banding | **No 90 / 70 threshold exists yet.** `percentTone()` in [lib/ui/tone.ts:31](lib/ui/tone.ts:31) bands at 90/60/30 for *colour only* (F4) |
| Operational windows | `UPCOMING_DEPARTURE_WINDOW_DAYS = 30`, `CRITICAL_DEPARTURE_WINDOW_DAYS = 14`, `TICKETING_DEADLINE_RISK_DAYS = 7`, `TRANSPORT_PICKUP_REQUIRED_HOURS = 48` — [operations-copy.ts:9](lib/data/operations-copy.ts:9) | **Exactly the shape Settings should own.** Module-level `*-copy.ts` constants are the migration target (§9.3) |
| Passport validity threshold | [reports-copy.ts:18](lib/data/reports-copy.ts:18); "Passport expiring within 6 months" — [admin-dashboard-data.ts:369](lib/data/admin-dashboard-data.ts:369) | Hardcoded 6 months in two places that already disagree in *phrasing* |
| Communication templates | **No template store.** `whatsappLink` / `guide_whatsapp_link` build `wa.me` deep links; [request-rework-dialog.tsx:55](app/\(main\)/documents/components/request-rework-dialog.tsx:55) hardcodes its message | **Missing entirely.** The largest single build in this module (§5.5) |
| Portal visibility flags | `visibleInPortal` per document requirement — [step-5-traveller-requirements.tsx:90](app/\(main\)/packages/create-package/components/step-5-traveller-requirements.tsx:90); `packages.visibility in ('Internal Only','Pilgrim Portal','Website & Portal')` | **Per-package flags exist. There is no pilgrim portal app** and no agency-wide portal switch (F5) |
| Margin visibility | `capabilitiesForSuppliers(role).viewCosts`, `capabilitiesFor(role).viewSupplierCosts`, `stripReceivable(row, can)` — [finance-repository.ts:107](lib/data/finance-repository.ts:107) | **Enforced in code, per role, correctly.** Settings makes the matrix *editable*, and must not weaken the server-side strip (D4) |
| Audit trail | Three append-only tables: `departure_group_activity_logs` ([20260809090000:451](supabase/migrations/20260809090000_create_departure_groups.sql:451)), `pilgrim_activity_logs` ([20260813090000:119](supabase/migrations/20260813090000_create_pilgrims.sql:119)), `staff_activity_logs` ([20260820090000:117](supabase/migrations/20260820090000_team_access.sql:117)). All carry `actor_id`, `actor_name_snapshot`, `before_value` / `after_value` | **The data the spec's Audit Log wants already exists, in three shapes.** One `union all` view, no data migration (§5.9) |
| Integrations | **Nothing.** No provider table, no OAuth, no secret storage | Missing. Ships as honest status cards, not fake connectors (D9) |
| Security policy | `auth.users` / `auth.sessions` via `createAdminClient()` — [utils/supabase/admin.ts](utils/supabase/admin.ts). Team already ships `revokeSessions`, `sendPasswordReset` ([team-repository.ts](lib/data/team-repository.ts)) | **The admin client and both mutators exist.** Password policy and 2FA enforcement are Supabase project config, not app config (F6) |
| Import / export | `toCsv` / `parseCsv` — [lib/csv.ts](lib/csv.ts), plus per-module `csv.ts` | **Export is solved.** Import has parsing but no importer (F7) |
| Role resolution | `getCurrentStaffRole()` — [departure-groups.ts:286](lib/data/departure-groups.ts:286). Reads `staff_profiles`, denies on non-`ACTIVE` or expired access window | **Real, and shipped.** Unlike every plan before Team, this module can rely on it from day one |
| Singleton-config precedent | **None.** Every table in the schema is per-entity | New pattern; §4 defines it once |

### 1.3 The UI vocabulary to reuse — no new components

**This plan adds zero files under `components/`, introduces no new colours, spacing or
typography, and defines no new theme tokens.** New work is composition only, inside
`app/(main)/management/settings/`.

| Spec element | Existing component |
|---|---|
| Breadcrumb + title + subtitle + header action | [components/page-header.tsx](components/page-header.tsx) — `breadcrumb`, `title`, `subTitle`, `action` |
| Left settings sub-navigation | **Compose**: `<nav>` + `Link` + `usePathname()` + `cn()`, reusing the exact active/hover classes from [app-sidebar.tsx:251](components/app-sidebar.tsx:251) (`bg-primary/20` active, `hover:bg-primary/10`). **Do not add a component under `components/`** (D10) |
| Section card / form grouping | [components/ui/card.tsx](components/ui/card.tsx) + [components/section-heading.tsx](components/section-heading.tsx); [components/ui/input-form-card.tsx](components/ui/input-form-card.tsx) for titled form blocks with an icon |
| Text / number fields | [components/ui/input.tsx](components/ui/input.tsx), [components/ui/textarea.tsx](components/ui/textarea.tsx), [components/ui/input-group.tsx](components/ui/input-group.tsx) (prefix affixes, e.g. `INV-`) |
| Currency amounts | [components/ui/currency-input.tsx](components/ui/currency-input.tsx) |
| Dropdowns (country, timezone, currency, role, retention period) | [components/ui/combobox.tsx](components/ui/combobox.tsx) |
| Every `[✓]` in the spec | [components/ui/checkbox.tsx](components/ui/checkbox.tsx) for list-item toggles; [components/ui/switch.tsx](components/ui/switch.tsx) for a row-level on/off with a label + description |
| Branch list rows, integration cards, session rows | [components/ui/card.tsx](components/ui/card.tsx) + [components/ui/tone-badge.tsx](components/ui/tone-badge.tsx) (`ToneBadge`, `PersonChip`) |
| Status badges (Active / Inactive / Archived / Connected / Not Connected / Manual) | `ToneBadge` + [lib/ui/tone.ts](lib/ui/tone.ts). Mapping with **no new palette**: Active·Connected→`success`, Inactive·Not Connected→`neutral`, Manual Workflow→`info`, Archived→`neutral`, Needs Reconnect→`warning`, Danger Zone→`danger` |
| Add / Edit Branch, Connect Integration, Template editor | [components/ui/sheet.tsx](components/ui/sheet.tsx) (right-side, as [edit-group-details-sheet.tsx](app/\(main\)/departure-groups/\[groupId\]/components/edit-group-details-sheet.tsx)) |
| Danger Zone confirmations, Revoke Session, Archive Branch | [components/ui/dialog.tsx](components/ui/dialog.tsx) + [dialog-footer.tsx](components/ui/dialog-footer.tsx), confirm pattern from [confirm-action-dialog.tsx](app/\(main\)/departure-groups/components/confirm-action-dialog.tsx) |
| Template category grouping | [components/ui/accordion.tsx](components/ui/accordion.tsx) |
| Template channel switch (WhatsApp / Email / Portal / SMS) | [components/animate-ui/components/animate/tabs.tsx](components/animate-ui/components/animate/tabs.tsx) or [components/ui/button-group.tsx](components/ui/button-group.tsx) |
| Audit Log table + search + pagination | [components/data-table/data-table.tsx](components/data-table/data-table.tsx) + [sortable-header.tsx](components/data-table/sortable-header.tsx) + [filter-select.tsx](components/data-table/filter-select.tsx) — **the only DataTable in this module** |
| Retention date pickers | [components/ui/calendar.tsx](components/ui/calendar.tsx) + [popover.tsx](components/ui/popover.tsx) |
| Empty / denied states | `EmptyState`, `PermissionDenied` — [tone-badge.tsx:105](components/ui/tone-badge.tsx:105) |
| Feedback | [components/ui/toast.tsx](components/ui/toast.tsx) — `toast.add(...)` |
| Form reset on open | [hooks/use-reset-on-open.ts](hooks/use-reset-on-open.ts) |
| Logo upload preview | `next/image` + Supabase Storage (§F8). **No new uploader component** — reuse the `<input type="file">` + `Button` composition, no dropzone |

---

## 2. Findings — the gap between today and the specification

### F1 — Branch is a `CHECK` constraint, not an entity. This is the blocking defect.

`staff_profiles.branch` is `text not null default 'ALL' check (branch in ('COLOMBO','KANDY','ALL'))`.
`departure_groups.branch` and `packages.branch` are free text with a `branch_id uuid` reserved but
never populated. Consequences the spec cannot tolerate:

- **"[ + Add Branch ]" is a schema migration**, not a row insert. Adding "Galle Branch" today
  requires `alter table … drop constraint … add constraint …` and a redeploy.
- "Staff: 8 · Active Groups: 4" per branch is a join on a **string** that three tables spell
  independently — `'COLOMBO'` in `staff_profiles`, `'Colombo'` in the departure-groups seed
  ([departure-groups-seed.ts:183](lib/data/departure-groups-seed.ts:183)), `''` in most packages.
- Branch code, address, phone, email, manager, default currency and status **have nowhere to live**.
- "Restrict staff to their assigned branch" cannot be enforced: there is no branch on a booking,
  and the group's branch is an unvalidated string.
- Ten report views (`reports.sql`) already `select g.branch` — every one of them inherits the
  string's ambiguity.

**Creating `public.branches` and giving all three tables a real `branch_id` is the highest-value
deliverable in this module**, and the reason Phase 2 ships immediately after Phase 1.

### F2 — There is no agency identity anywhere

Agency name, legal name, registration number, address, primary email and primary WhatsApp do not
exist as data. Invoices, receipts, vouchers and confirmations render agency text either hardcoded
or not at all. Every downstream consumer the spec names — invoice header, receipt header, email
sender name, WhatsApp templates, portal, PDF reports — is currently either literal copy or absent.

### F3 — No singleton-config precedent exists in the schema

Every table is per-entity with a uuid PK. A one-row settings table needs a deliberate shape
(single-row constraint, upsert-on-write, seeded on migration), a deliberate cache strategy
(`React.cache` — it will be read on nearly every request once §9 wiring lands), and a deliberate
concurrency answer (two admins on two sections must not clobber each other). §4 and D3 settle all
three; none of it can be copied from an existing module.

### F4 — Readiness has states, not thresholds

`departure-groups-readiness.ts` computes per-item `NOT_STARTED / IN_PROGRESS / COMPLETE`. The
spec's `Ready 90%+ / At Risk 70–89% / Blocked <70%` banding **does not exist** — and
`percentTone()` bands at 90/60/30 for *colour*, which is close enough to be mistaken for it and
must not be reused as the business rule. The "treat X as critical" toggles have no counterpart at
all: criticality is currently implied by which readiness item is incomplete.

This means Operational Defaults is not a "wire up an existing number" section — the banding
function has to be **written**, then read by Operations and Reports (§9.3).

### F5 — There is no pilgrim portal

`visibleInPortal` flags, `packages.visibility = 'Pilgrim Portal'`, `sent_channel = 'PORTAL'` and
`portal_link` template variables all exist, but **no route, app or auth flow serves a pilgrim.**
The Branding & Pilgrim Portal section therefore configures a consumer that does not exist yet.

That is acceptable and worth building — the settings are read by invoice/document surfaces that
*do* exist (logo, colours, footer, support contacts), and the portal toggles are stored as the
contract the portal will be built against. It must be stated in the UI, not implied (D8).

### F6 — Password policy, 2FA and session listing are Supabase project config, not app config

`Require strong passwords`, `Require password reset every X days`, `Enable 2FA` and
`Require 2FA for Admin and Finance` are enforced by **Supabase Auth project settings** and the
`auth.mfa_factors` table, none of which are writable through PostgREST or the anon key, and
several of which are not writable through the service-role key either.

Session *revocation* already works (`revokeSessions` in `team-repository.ts` uses
`admin.signOut(jwt,'global')`), but **listing** active sessions requires reading `auth.sessions`,
which is not exposed. The spec's session table (`Afras · Chrome · Colombo · Last active: Now`)
cannot be built from `auth.sessions` today — the closest honest surface is
`staff_profiles.last_active_at`, which Team already maintains ([lib/dal.ts:39](lib/dal.ts:39)),
and which has **no device, no browser and no location**.

### F7 — Import has a parser but no importer

`parseCsv()` exists and is correct. There is no column mapper, no validator, no dry-run preview,
no partial-failure report and no idempotency key for any entity. "Import Leads CSV" is a
substantial feature in its own right, not a button.

### F8 — There is no file storage integration

Agency logo upload needs a Supabase Storage bucket. No bucket, no upload helper and no signed-URL
reader exists anywhere in the codebase. `next.config.ts` allows remote images from
`img.icons8.com` only — the Supabase storage hostname must be added to `images.remotePatterns`.

### F9 — Route and spec disagree; and a live dead link exists

The spec's header says `/management/settings`; its section list says `/settings/organisation`.
Meanwhile [system-health.tsx:67](app/\(main\)/dashboard/components/system-health.tsx:67) links to
`/settings/integrations`, which 404s. Settled in D1.

### F10 — `agency_id` is reserved but unused

`departure_groups.agency_id uuid` has no FK and is never written. This module deliberately does
**not** introduce an `agencies` table: the product is single-agency, and a singleton
`agency_settings` row answers every requirement in the spec. The column stays reserved.
Multi-tenancy is out of scope (§13).

---

## 3. Decisions

| # | Decision | Rationale |
|---|---|---|
| **D1** | **Route is `/management/settings/<section>`.** `/settings/*` is not created; the section names in the spec are treated as section *slugs*, not top-level routes. `/management/settings` redirects to `/management/settings/organisation`. [system-health.tsx:67](app/\(main\)/dashboard/components/system-health.tsx:67) is repointed to `/management/settings/integrations`. | The spec's own page shell says `Home > Management > Settings`. `/management/team` already establishes the parent. Two competing prefixes for one feature is the worse outcome; the breadcrumb decides it. |
| **D2** | **Every route is a real route, not a tab.** `layout.tsx` + one folder per section, each with its own `page.tsx` and `loading.tsx`. | The spec explicitly says "Avoid one huge long page… each setting category should have its own route or tab". Routes give deep links (`system-health` links straight to Integrations), per-section role gating at the server, per-section streaming, and per-section `revalidatePath`. Tabs give none of that. |
| **D3** | **Save is per-section, not per-page.** Each section renders its own `[Save Changes]` in its own footer, submitting only its own fields. The layout shell renders breadcrumb, title, subtitle and sub-nav — **no global Save button**. | A Save in `layout.tsx` cannot observe a child section's dirty state without lifting all form state into a client context spanning ten unrelated forms. Per-section save also makes the concurrency answer trivial: two admins editing Organisation and Finance never touch the same columns. Deliberate, documented deviation from the mock's page shell. |
| **D4** | **Margin visibility settings are an input to the capability matrix, never a replacement for it.** `capabilitiesForFinance(role).viewCosts` stays the gate; the setting can only *remove* access from a role that has it, never grant it. Server-side stripping (`stripReceivable`) is unchanged. | Making a settings row grant `viewCosts` to Marketing would let an Admin widen access past what ten reviewed capability files intend. Intersect, never union. |
| **D5** | **Settings never widens a database `CHECK`.** Payment methods, currencies, roles and statuses keep their constraints; settings toggles which values are *offered in the UI* and which is *pre-selected*. | A settings row that inserts `'CRYPTO'` into `payments.method` fails at the database, at write time, in front of a user. The CHECK is the schema contract. |
| **D6** | **Supported currencies drive pickers, not types.** `SupplierCurrency` stays a static union. | Type-level currency safety is worth more than agency-editable currency codes; the agency's real need is "stop offering AED", which a picker filter satisfies. |
| **D7** | **Templates are drafted and approved by staff. No autonomous send in V1.** `message_templates` carries `requires_approval boolean not null default true`; no scheduler, no queue, no AI send path. | Directly required by the spec. Enforced in the schema so a later feature cannot quietly opt out. |
| **D8** | **The portal section states its own status.** Portal toggles are stored and shown, with a visible, non-dismissable note that the pilgrim portal is not yet live and the toggles define the contract it will be built against. | F5. A settings screen that silently configures nothing is worse than one that says so. |
| **D9** | **Integrations ship as status cards over a real `integration_connections` table, with no live connectors in V1.** Google Drive shows `Not Connected` until F8 lands, then `Connected`. Nusuk ships as `Manual Workflow` with a notes field — the honest state. | The spec says "Do not build every integration immediately. Show only integrations the agency can actually use." Fake `[Connect]` buttons that open nothing are the failure mode to avoid. |
| **D10** | **No new files under `components/`.** The settings sub-nav, section shell and toggle-row are composed inside `app/(main)/management/settings/components/` from existing primitives. | Same constraint the Team plan held to. A left nav used by exactly one route is not a design-system component. |
| **D11** | **Secrets are never stored in `integration_connections` and never returned to the client.** Only a provider id, status, account label, scope list, `last_sync_at` and a masked hint (`sk_live_…4f2a`) are persisted. Actual credentials live in environment variables. | The spec's "Never show API keys in full after saving" is a floor, not a ceiling. A settings table readable by any Admin session is the wrong place for a live payment-gateway secret. |
| **D12** | **The Audit Log is a read-only `union all` view over the three existing log tables plus one new `settings_activity_logs`. No log data is migrated or duplicated.** | Three append-only tables with compatible actor/before/after shapes already exist. Copying them into a fourth would double-write every mutation in the app and immediately drift. |
| **D13** | **Danger Zone lives on its own route with its own confirmation dialogs, never beside a Save button.** No one-click full-data deletion is offered at all — `Delete Test Data` is gated on `NODE_ENV !== "production"`, and `Export All Agency Data` is a request, not an immediate download. | Directly required by the spec ("Never place live-data deletion beside normal Save buttons"). |
| **D14** | **Settings changes are audited with before/after values, always.** Every mutator in `settings-repository.ts` writes a `settings_activity_logs` row inside the same action. | The spec puts Data & Audit in Settings; a settings module that mutates agency-wide policy without an audit trail is the one thing that must not ship. |
| **D15** | **Fields whose enforcement is not available are rendered read-only with a stated reason, never as a working toggle.** Password policy, 2FA enforcement and the session device/location table (F6) fall here. | A switch that flips, saves, and enforces nothing is a security misrepresentation. |

---

## 4. Data model

One migration: `supabase/migrations/20260821090000_agency_settings.sql`. Additive; safe on a
database with `20260808…20260820` applied. Every table follows the existing conventions —
`set_updated_at` trigger, `create table if not exists`, RLS enabled, `current_staff_role()` in
policies, `comment on table` explaining intent.

### A. `agency_settings` — the singleton

```text
id                        uuid primary key default gen_random_uuid()
singleton                 boolean not null default true
                            constraint agency_settings_one_row unique (singleton)
                            check (singleton is true)

-- Organisation (§5.1)
agency_name               text not null default ''
legal_name                text
registration_number       text
default_country           text not null default 'LK'
default_currency          text not null default 'LKR'
timezone                  text not null default 'Asia/Colombo'
default_language          text not null default 'en'
supported_languages       text[] not null default '{en,si,ta}'
primary_email             text
primary_whatsapp          text
office_address            text

-- Branding & portal (§5.3)
logo_path                 text                    -- Supabase Storage object path, not a URL
portal_primary_colour     text not null default '#0EA5E9'
portal_secondary_colour   text
portal_welcome_message    text
portal_support_whatsapp   text
portal_support_email      text
website_url               text
terms_url                 text
invoice_footer            text
portal_flags              jsonb not null default '{...}'   -- the seven [✓] toggles

-- Operational defaults (§5.4)
default_group_capacity        integer not null default 40  check (default_group_capacity > 0)
minimum_group_size            integer not null default 15  check (minimum_group_size > 0)
default_seat_hold_hours       integer not null default 24  check (default_seat_hold_hours > 0)
default_guide_ratio           integer not null default 40  check (default_guide_ratio > 0)
default_group_status          text not null default 'PLANNING'
default_sales_status          text not null default 'SELLING'
waitlists_enabled_by_default  boolean not null default true
readiness_ready_threshold     integer not null default 90 check (… between 0 and 100)
readiness_at_risk_threshold   integer not null default 70 check (… between 0 and 100)
critical_flags                jsonb not null default '{...}'  -- the four "treat X as critical"
passport_validity_months      integer not null default 6
passport_photo_requirement    text    not null default 'WHITE_BACKGROUND'
document_reminder_days        integer not null default 3
document_rework_deadline_hrs  integer not null default 48
visa_escalation_days          integer not null default 7
require_document_verification boolean not null default true
require_visa_verification     boolean not null default true

-- Finance defaults (§5.6)
supported_currencies      text[] not null default '{LKR,SAR,USD}'
invoice_prefix            text not null default 'INV'
receipt_prefix            text not null default 'RCT'
payment_prefix            text not null default 'PAY'
supplier_bill_prefix      text not null default 'SUP'
default_payment_terms     text
enabled_payment_methods   text[] not null default '{CASH,BANK_TRANSFER,CARD,ONLINE,CHEQUE,OTHER}'
tax_config                jsonb
auto_generate_receipt     boolean not null default true
require_bank_proof        boolean not null default true
margin_visible_roles      text[] not null default '{ADMIN,CEO,FINANCE}'

-- Security & access defaults (§5.8)
default_staff_role            text not null default 'MARKETING'
require_account_approval      boolean not null default true
seasonal_auto_expiry_enabled  boolean not null default true
seasonal_expiry_days          integer not null default 30
session_idle_timeout_minutes  integer not null default 60
access_restriction_flags      jsonb not null default '{...}'  -- the four "restrict X" toggles

-- Data retention (§5.9)
document_retention_years        integer not null default 7
archived_group_retention_years  integer not null default 7
deactivated_user_retention_years integer not null default 1
immutable_finance_history       boolean not null default true
keep_document_verification_hist boolean not null default true

-- Danger zone state (§5.10)
portal_active             boolean not null default true

created_at / updated_at   timestamptz not null default now()
```

Seeded with one row in the migration. `singleton` + its unique index is what makes
`upsert(..., { onConflict: 'singleton' })` safe and makes a second row impossible.

`jsonb` is used **only** for fixed-key boolean bags (`portal_flags`, `critical_flags`,
`access_restriction_flags`) whose keys are declared in `lib/data/settings-copy.ts` and validated
by Zod on write. Anything the app filters, sorts or joins on is a real column.

### B. `branches` — the entity F1 requires

```text
id                uuid primary key default gen_random_uuid()
name              text not null
code              text not null                -- unique on upper(code)
address           text
phone             text
email             text
manager_id        uuid references public.staff_profiles (id) on delete set null
manager_name      text                          -- denormalised snapshot, same posture as *_owner_name
default_currency  text not null default 'LKR'
status            text not null default 'ACTIVE' check (status in ('ACTIVE','INACTIVE','ARCHIVED'))
is_primary        boolean not null default false
                    -- partial unique index: only one primary branch
created_at / updated_at
```

Migration also:

- adds `branch_id uuid references public.branches (id) on delete set null` to `staff_profiles`,
  `packages` and (as a real FK on the already-reserved column) `departure_groups`;
- **drops** `staff_profiles_branch_check` and keeps `branch text` as a denormalised display
  snapshot, matching how `*_owner_name` already shadows `*_owner_id`;
- seeds `Colombo Head Office` (`COL`, primary) and `Kandy Branch` (`KDY`) and backfills
  `branch_id` by case-insensitive match on the existing strings, leaving unmatched rows null.

`branch_rules` (the four `[✓]` toggles) live in `agency_settings.branch_rules jsonb`, not on
`branches` — they are agency-wide policy, not per-branch data.

### C. `message_templates` — §5.5

```text
id                uuid primary key default gen_random_uuid()
category          text not null   -- the 15 spec categories, CHECK-constrained
name              text not null
channel           text not null check (channel in ('WHATSAPP','EMAIL','PORTAL','SMS'))
audience          text not null check (audience in ('LEAD','BOOKING_CONTACT','PILGRIM','GROUP','STAFF'))
subject           text            -- email only
body              text not null
language          text not null default 'en'
is_active         boolean not null default true
requires_approval boolean not null default true    -- D7
assigned_roles    text[] not null default '{}'     -- role-visibility table, §6
created_by / created_by_name / created_at / updated_at
unique (category, channel, language)
```

Seeded with one starter template per spec category on the WhatsApp channel, using the
`{{variable}}` vocabulary. Variable *definitions* are code, not data —
`TEMPLATE_VARIABLES` in `lib/data/settings-copy.ts` — so an unknown `{{foo}}` is a validation
error at save time, not a broken message at send time.

### D. `integration_connections` — §5.7

```text
id              uuid primary key default gen_random_uuid()
provider        text not null unique
                  check (provider in ('WHATSAPP_BUSINESS','EMAIL','SMS','PAYMENT_GATEWAY',
                                      'FILE_STORAGE','ACCOUNTING','NUSUK'))
status          text not null default 'NOT_CONNECTED'
                  check (status in ('NOT_CONNECTED','CONNECTED','MANUAL_WORKFLOW','ERROR','DISCONNECTED'))
connected_account text
scopes          text[] not null default '{}'
credential_hint text                    -- masked tail only, e.g. '…4f2a'. Never the secret. D11
notes           text                    -- Nusuk manual-workflow notes
last_sync_at / connected_at / connected_by / connected_by_name / created_at / updated_at
```

Seeded with one row per provider in its honest starting state.

### E. `settings_activity_logs` — §5.9 / D14

Same shape as `staff_activity_logs`: `actor_id`, `actor_name_snapshot`, `section`, `event_type`,
`entity_type`, `entity_id`, `before_value jsonb`, `after_value jsonb`, `message`, `created_at`.
Append-only: insert policy for authenticated, **no update and no delete policy**, matching
`pilgrim_activity_logs`.

### F. `audit_log_rows` — the unified read view (D12)

```sql
create or replace view public.audit_log_rows as
  select 'GROUP'    as source, actor_id, actor_name_snapshot, … from departure_group_activity_logs
  union all
  select 'PILGRIM'  as source, …                                from pilgrim_activity_logs
  union all
  select 'STAFF'    as source, …                                from staff_activity_logs
  union all
  select 'SETTINGS' as source, …                                from settings_activity_logs;
```

Normalised to one column set: `source · actor_id · actor_name · action · entity_type ·
entity_label · before_value · after_value · branch · created_at`. Sorted and paginated at the
database. Same flattening posture as `team_directory_rows`, `supplier_directory_rows` and
`pilgrim_journey_rows`.

### G. RLS

`current_staff_role()` already exists ([20260820090000:172](supabase/migrations/20260820090000_team_access.sql:172)). Policies:

| Table | Select | Insert / Update / Delete |
|---|---|---|
| `agency_settings` | **any authenticated** — currency, timezone, logo and invoice footer are read on nearly every render | `ADMIN` only |
| `branches` | any authenticated — branch names appear on group and package screens for everyone | `ADMIN` only |
| `message_templates` | any authenticated | `ADMIN`; non-admins never write |
| `integration_connections` | `ADMIN`, `CEO` | `ADMIN` only |
| `settings_activity_logs` | `ADMIN`, `CEO` | insert: authenticated. **No update, no delete** |

RLS is defence in depth, not the product gate. The product gate is
`capabilitiesForSettings(role)` checked in the Server Action **before** the write, exactly as
every other module does.

---

## 5. The sections

Route map (D1, D2):

```text
/management/settings                    → redirect → /management/settings/organisation
/management/settings/organisation       §5.1
/management/settings/branches           §5.2
/management/settings/branding           §5.3
/management/settings/operations         §5.4
/management/settings/communications     §5.5
/management/settings/finance            §5.6
/management/settings/integrations       §5.7
/management/settings/security           §5.8
/management/settings/data               §5.9
/management/settings/danger             §5.10
```

Every section page is a **Server Component** that resolves the role, checks its own capability,
renders `<PermissionDenied>` if it fails, loads only its own slice, and hands a plain view model
to one client form.

### 5.1 Organisation — `/organisation`

All fields from the spec, in three `InputFormCard` blocks: *Identity* (agency name\*, legal name,
registration number), *Locale* (country, currency, timezone, default language, supported staff
languages as a multi-select of `si · ta · en · ar`), *Contact* (primary email, primary WhatsApp,
office address).

`Agency Name` is the only required field. Country / timezone / currency options come from
`settings-copy.ts` (a curated shortlist, not the full IANA database — the agency operates in one
country).

### 5.2 Branches — `/branches`

Card list, one card per branch: name, code, status `ToneBadge`, `Primary branch: Yes` chip,
and two live counts — **Staff** (`count(staff_profiles where branch_id = …and status = 'ACTIVE')`)
and **Active Groups** (`count(departure_groups where branch_id = … and group_status not in
('COMPLETED','CANCELLED'))`), both computed in a `branch_directory_rows` view so the page is one
query. `[Edit]` opens a Sheet; `[ + Add Branch ]` opens the same Sheet in create mode.

Branch rules (the four `[✓]`) sit in their own card below the list and save independently.

**`Allow cross-branch booking management` ships unchecked and read-only in V1** with a stated
reason (D15): nothing in `bookings`, `departure_groups` or `leads` filters by branch today, so the
toggle has no enforcement point until Phase 2b (§9.5). Building it as a live switch would be F6's
mistake in a different section.

### 5.3 Branding & Pilgrim Portal — `/branding`

Logo upload (F8: Supabase Storage bucket `agency-assets`, admin-write / public-read, path stored
not URL), primary + secondary colour (`<input type="color">` beside a hex `Input` — a native
input, no new component), welcome message, support WhatsApp, support email, website URL, invoice
footer, terms URL.

The seven portal toggles render in one card, under the D8 status note.

The **"Do not expose"** list from the spec is not a UI section — it is a **test obligation**
(§11): supplier details, margin/cost, other pilgrims' details, internal notes, readiness score and
staff task information must never appear in any portal-facing payload. Encoded as a documented
constant `PORTAL_FORBIDDEN_FIELDS` in `settings-copy.ts` that the future portal's serialiser
asserts against.

### 5.4 Operational Defaults — `/operations`

Three cards: *Departure group defaults*, *Readiness thresholds*, *Document & visa defaults*, each
exactly as specified.

Readiness thresholds validate `ready > atRisk`, both 0–100 — a cross-field Zod refinement, not two
independent number inputs. Blocked is **derived** (`< atRisk`) and rendered read-only, so the
three bands can never overlap or leave a gap.

This section's fields are the ones with the most consumer wiring (§9.3) and the most careful
non-retroactivity requirement (D2).

### 5.5 Communication Templates — `/communications`

Accordion by the 15 spec categories. Each row: name, channel badge, audience badge, active toggle,
`[Edit]`. The editor Sheet carries name, channel, audience, subject (email only), body textarea, a
click-to-insert variable palette, and `[Preview with sample data]` — which renders the body with a
`SAMPLE_TEMPLATE_CONTEXT` from `settings-copy.ts`, purely client-side.

Save validates that every `{{token}}` in the body is in `TEMPLATE_VARIABLES` and that every
required token for that category is present. Unknown token = field error, not a warning.

D7 is enforced here: the editor has no "send" and no "schedule". `requires_approval` renders as a
disabled, checked switch with the reason inline.

### 5.6 Finance Defaults — `/finance`

Currency (default + supported multi-select), the four numbering prefixes (`InputGroup` with a live
preview — `INV-2026-00001`), default payment terms, enabled payment methods (six checkboxes,
D5 — the checkbox list is fixed, the CHECK is untouched), invoice logo (`[Use Agency Logo]`
toggle), invoice footer, optional tax/VAT config, cancellation and refund policy template
selectors (pointing at `message_templates`), and the two `[✓]` behaviours.

**Margin visibility** renders the six-role matrix, but per D4 a role whose capability file says
`viewCosts: false` renders as an unchecked, disabled row with the reason inline — Marketing,
Operations and Guide can never be granted margin access from Settings.

Changing a prefix affects **future numbers only**; existing `INV-2026-…` records keep their
numbers. Stated in the UI, enforced by `nextReferenceNumber` scoping its uniqueness scan to the
current prefix (§9.1).

### 5.7 Integrations — `/integrations`

Seven cards (D9). Each shows connection status, last sync, connected account, permission scope,
and role-appropriate actions. `Reconnect` / `Disconnect` appear only when `status = 'CONNECTED'`.
`credential_hint` renders as `…4f2a`, never expandable (D11).

V1 states: Google Drive / File Storage → `Connected` once F8's bucket exists; Nusuk →
`Manual Workflow` with an editable notes field; every other provider → `Not Connected` with a
`[Connect]` that opens a Sheet explaining what is required and captures nothing but notes.

### 5.8 Security & Access — `/security` — Admin only

Three cards.

*Account security* — per D15/F6, `Require strong passwords`, `Require password reset every X days`,
`Enable 2FA` and `Require 2FA for Admin and Finance` render **read-only** with an inline note that
they are configured in the Supabase Auth project settings, and a link target left as a TODO for
whoever owns that console. `Notify Admin on unusual login` ships read-only for the same reason
(no webhook exists). `Auto-log out inactive sessions after X minutes` **is** writable — it is
enforced client-side plus by a server check against `staff_profiles.last_active_at`, which Team
already maintains.

*Access defaults* — default staff role, new-account approval, seasonal expiry toggle and window
are all live: they are read by the Team module's invite flow (§9.4). The four `Restrict …` toggles
are live but, per D4, intersect with the capability files rather than replace them.

*Session control* — lists staff from `staff_profiles` ordered by `last_active_at`, with `[Revoke]`
calling the **existing** `revokeSessions` mutator. **Device and location columns are omitted**, not
faked (F6): the mock's `Chrome · Colombo` is not derivable. The card states that it lists people,
not sessions.

### 5.9 Data & Audit — `/data`

*Audit log* — the module's one `DataTable`, over `audit_log_rows` (§4F). Columns: User, Action,
Entity, Before → After, Date. Filters: user, action type, entity type, date range, branch —
`FilterSelect`, same as every other module. Server-side pagination; the union view will outgrow a
client-side table quickly.

*Import & export* — Export ships complete in V1 (`toCsv` + a server action per entity: pilgrims,
bookings, payments, invoices, reports, audit log), each respecting the caller's capability matrix
so a CEO export cannot contain columns the CEO cannot see on screen. **Import ships as a
disabled, labelled surface in V1** (F7) and is scheduled as its own phase (§8, Phase 9b) — a CSV
importer without dry-run preview and partial-failure reporting is how a CRM gets 400 duplicate
pilgrims.

*Data retention* — the three period selectors and two `[✓]` flags. Stored only; **no deletion job
is built**, and the card says so. Retention that silently deletes nothing is safe; retention that
silently deletes something nobody scheduled is not.

### 5.10 Danger Zone — `/danger` — Admin only (D13)

Its own route, last in the nav, visually separated by a `danger`-toned card. Four actions, each
behind a typed-confirmation dialog:

- **Archive Branch** — branch picker → sets `status = 'ARCHIVED'`. Blocked with a clear message if
  the branch has active departure groups.
- **Deactivate Agency Portal** — flips `agency_settings.portal_active`. Reversible; labelled as
  such.
- **Export All Agency Data** — writes a `settings_activity_logs` request row and toasts that an
  Admin will be notified. Not an immediate download.
- **Delete Test Data** — rendered only when `process.env.NODE_ENV !== "production"`, gated again
  on the server.

No full-data deletion flow exists anywhere in this module.

---

## 6. Access control

New file `lib/access/settings-access.ts`, same posture as the other eleven — pure functions over
`StaffRole`, safe in Server and Client Components, no I/O.

```ts
export interface SettingsCapabilities {
  viewModule: boolean;
  viewOrganisation: boolean;   editOrganisation: boolean;
  viewBranches: boolean;       editBranches: boolean;
  viewBranding: boolean;       editBranding: boolean;
  viewOperations: boolean;     editOperations: boolean;
  viewCommunications: boolean; editCommunications: boolean;
  editOwnRoleTemplatesOnly: boolean;   // Marketing / Visa — their assigned categories only
  viewFinance: boolean;        editFinance: boolean;
  viewIntegrations: boolean;   editIntegrations: boolean;
  viewSecurity: boolean;       editSecurity: boolean;
  viewAuditLog: boolean;       exportData: boolean;  importData: boolean;
  viewDangerZone: boolean;
}
```

Matching the spec's role table exactly:

| Role | Sections visible |
|---|---|
| **ADMIN** | All ten, all editable |
| **CEO** | Organisation, Branches, Branding (read-only); Audit Log (read-only). No security, no finance edit, no danger zone |
| **FINANCE** | Finance Defaults only, editable |
| **OPERATIONS** | Operational Defaults, editable |
| **MARKETING** | Communications, restricted to categories where `assigned_roles @> '{MARKETING}'` |
| **VISA** | Communications, restricted to the document/visa categories |
| **GUIDE** | Nothing. `viewModule: false` |

Plus, mirroring `visibleTabsForTeamMember()`:

```ts
export function visibleSettingsSections(role: StaffRole): SettingsSectionId[]
export function defaultSettingsSection(role: StaffRole): SettingsSectionId  // for the redirect
```

`/management/settings` redirects to `defaultSettingsSection(role)` — Finance lands on
`/finance`, Operations on `/operations`, Admin on `/organisation` — so no role ever lands on a
`PermissionDenied` by default.

**Personal preferences.** The spec gives every non-admin role "personal preferences only". Those
already exist and are **not** duplicated here: theme lives in
[components/ui/theme-switch.tsx](components/ui/theme-switch.tsx), and personal profile fields live
on `/management/team/[userId]`. A Guide opening `/management/settings` is redirected to their own
Team profile, exactly as `/management/team` already does for them
([team/page.tsx:33](app/\(main\)/management/team/page.tsx:33)). One personal-settings surface,
not two.

**Sidebar.** `Settings → /management/settings` returns to the `Management` group in
[app-sidebar.tsx:156](components/app-sidebar.tsx:156), with
`visible: capabilitiesForSettings(role).viewModule`, following the file's stated rule that
visibility is the real capability check and that only live routes are listed.

**`describeRoleAccess()`.** [team-access.ts:189](lib/access/team-access.ts:189) currently hardcodes
`push("Agency settings", role === "ADMIN")`. Replace with
`push("Agency settings", capabilitiesForSettings(role).viewModule)` so the Team module's
permission panel keeps rendering from the real gate rather than a literal.

---

## 7. File map

Following the established module layout exactly. **Zero files under `components/`** (D10).

```text
supabase/migrations/
  20260821090000_agency_settings.sql         §4 — all six objects, RLS, seeds, backfill

lib/access/
  settings-access.ts                         §6

lib/types/
  settings.ts                                Row types for the five tables + the audit view

lib/validations/
  settings.ts                                Zod schema per section + toSettingsFieldErrors()

lib/data/
  settings-copy.ts                           Labels, taxonomies, option lists, TEMPLATE_VARIABLES,
                                             SAMPLE_TEMPLATE_CONTEXT, PORTAL_FORBIDDEN_FIELDS,
                                             and every DEFAULT_* constant (the migration's
                                             defaults, mirrored for the client)
  settings-repository.ts                     "server-only". Reads + mutators. Every mutator writes
                                             a settings_activity_logs row (D14)
  settings.ts                                Client-safe derivations: row → view model, threshold
                                             banding, prefix preview, template rendering

app/(main)/management/settings/
  layout.tsx                                 Server. Role gate + PageHeader + <SettingsNav> + children
  page.tsx                                   redirect(defaultSettingsSection(role))
  actions.ts                                 One "use server" action per section, all returning
                                             SettingsActionResult { ok, error?, fieldErrors? }
  types.ts                                   View models shared by the section clients
  loading.tsx  error.tsx
  csv.ts                                     Export column definitions (§5.9)
  components/
    settings-nav.tsx                         "use client". usePathname() + Link. D10
    section-shell.tsx                        Section title + description + Save footer. D3
    setting-toggle-row.tsx                   Switch + label + description + optional disabled reason
    unavailable-note.tsx                     The D15 "not enforceable yet" inline note
  organisation/page.tsx    + organisation-form.tsx
  branches/page.tsx        + branch-list.tsx, branch-sheet.tsx, branch-rules-card.tsx
  branding/page.tsx        + branding-form.tsx, logo-upload.tsx, portal-flags-card.tsx
  operations/page.tsx      + group-defaults-card.tsx, readiness-thresholds-card.tsx,
                             document-defaults-card.tsx
  communications/page.tsx  + template-list.tsx, template-editor-sheet.tsx, template-preview.tsx
  finance/page.tsx         + finance-defaults-form.tsx, invoice-settings-card.tsx,
                             margin-visibility-card.tsx
  integrations/page.tsx    + integration-card.tsx, connect-integration-sheet.tsx
  security/page.tsx        + account-security-card.tsx, access-defaults-card.tsx, sessions-card.tsx
  data/page.tsx            + audit-log-table.tsx, audit-columns.tsx, export-card.tsx,
                             import-card.tsx, retention-card.tsx
  danger/page.tsx          + danger-actions.tsx, confirm-danger-dialog.tsx

utils/supabase/
  storage.ts                                 F8 — bucket name, upload helper, public URL resolver

Modified:
  components/app-sidebar.tsx                 Re-add the Settings nav entry (§6)
  lib/access/team-access.ts:189              describeRoleAccess() reads the real gate (§6)
  app/(main)/dashboard/components/system-health.tsx:67   Fix the dead link (F9)
  next.config.ts                             Add the Supabase storage host to images.remotePatterns (F8)
  lib/data/finance-repository.ts             nextReferenceNumber takes the prefix from settings (§9.1)
```

`layout.tsx` uses async `params`-free props; no `params` or `searchParams` are read in the layout,
so the Next.js 16 async-request-API change (`node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md`)
affects only the audit-log page, which reads `searchParams` for its filters and **must await it**.
`forbidden()` / `unauthorized()` are **not** used — they are `version: experimental` in this build
and `authInterrupts` is not enabled in `next.config.ts`; role gating stays `PermissionDenied` +
`notFound()`, consistent with the other eleven modules.

---

## 8. Build order

Following the spec's own V1 order, with the two blocking defects pulled to the front.

| Phase | Deliverable | Ships |
|---|---|---|
| **0** | Migration §4 (all six objects, RLS, seeds, backfill) + `settings-access.ts` + types + validations + `settings-copy.ts` + `settings-repository.ts` reads | No UI. `getAgencySettings()` callable and cached |
| **1** | Shell: `layout.tsx`, `settings-nav.tsx`, `section-shell.tsx`, `page.tsx` redirect, sidebar entry, dead-link fix | Navigable, empty sections |
| **2** | **Organisation** (§5.1) — read + write + audit | First working section |
| **3** | **Branches** (§5.2) — list, add, edit, rules card, `branch_directory_rows` | F1 closed |
| **3b** | **Branch wiring** — `branch_id` populated on create/edit across Team, Packages, Departure Groups; `branch` string demoted to a snapshot | The migration's backfill becomes self-sustaining |
| **4** | **Finance Defaults** (§5.6) + `nextReferenceNumber` wiring (§9.1) | First setting an operator can *observe* changing behaviour |
| **5** | **Operational Defaults** (§5.4) + create-group defaults wiring (§9.2) | |
| **5b** | Readiness banding function + Operations/Reports wiring (§9.3) | F4 closed |
| **6** | **Communication Templates** (§5.5) — store, editor, preview, seeds | |
| **7** | **Branding & Portal** (§5.3) + storage bucket (F8) + invoice/receipt header wiring | |
| **8** | **Security & Access** (§5.8) + Team invite-default wiring (§9.4) | |
| **9** | **Integrations** (§5.7) status cards | |
| **10** | **Data & Audit** (§5.9) — `audit_log_rows`, audit table, exports | |
| **10b** | CSV **import** — mapper, validator, dry-run preview, partial-failure report | F7 closed. Its own phase, deliberately |
| **11** | **Danger Zone** (§5.10) | Last, on purpose |

Phases 0–4 are the minimum coherent release: an agency can set its identity, its branches and its
finance numbering, and see all three take effect.

---

## 9. Consumer wiring — the part that makes settings real

A setting nobody reads is decoration. Each item names the exact call site.

### 9.1 Finance numbering (Phase 4)

[finance-repository.ts:90](lib/data/finance-repository.ts:90) `nextReferenceNumber(db, table, column, prefix)`
is already the single choke point; its three call sites pass literals. Change to read
`invoice_prefix` / `receipt_prefix` from cached settings. The uniqueness scan
(`.like(column, `${prefix}-${year}-%`)`) already scopes by prefix, so changing the prefix starts a
fresh sequence at `00001` without colliding — the desired behaviour, and worth an explicit test.

### 9.2 Departure group creation defaults (Phase 5)

`app/(main)/departure-groups/create-departure-group/` — seed the form with
`default_group_capacity`, `minimum_group_size`, `default_seat_hold_hours`,
`default_group_status`, `default_sales_status`, `waitlists_enabled_by_default`. **Form defaults
only.** `departure_groups.seat_hold_expiry_hours` stays a per-group column and existing groups are
untouched (D2). Guide ratio drives a *warning* on the assign-guide surface, never a hard block.

### 9.3 Readiness and operational windows (Phase 5b)

Write `bandReadiness(percent, settings): 'READY' | 'AT_RISK' | 'BLOCKED'` in `lib/data/settings.ts`
and consume it from `departure-groups-readiness.ts`, Operations and `reports-groups.ts`.
`percentTone()` in [lib/ui/tone.ts:31](lib/ui/tone.ts:31) stays a *colour* function and is
explicitly not repurposed (F4). The four `critical_flags` replace the implicit criticality in
`operations-copy.ts`; `passport_validity_months` replaces the hardcoded 6 in
[reports-copy.ts:18](lib/data/reports-copy.ts:18) and
[admin-dashboard-data.ts:369](lib/data/admin-dashboard-data.ts:369).

### 9.4 Team invite defaults (Phase 8)

`inviteStaff` in `team-repository.ts` reads `default_staff_role`, `require_account_approval`,
`seasonal_auto_expiry_enabled` and `seasonal_expiry_days` instead of its current constants.

### 9.5 Branch scoping (Phase 3b, extending into a later phase)

Once `branch_id` is populated, `restrict_staff_to_branch` becomes enforceable in the repository
layer — a `.eq('branch_id', …)` in the list loaders for Departure Groups, Pilgrims and Leads,
alongside the existing `filterGroupsForRole()`. This is the point at which
`Allow cross-branch booking management` (§5.2) stops being read-only.

### 9.6 Currency and identity (Phase 2 / 7)

Every `?? "LKR"` in §1.2 becomes `?? settings.defaultCurrency`. Agency name, address, registration
number, logo and invoice footer flow into the invoice and receipt surfaces and the voucher
dialogs.

### 9.7 The read path

`getAgencySettings()` in `settings-repository.ts`, wrapped in `React.cache` exactly as
`getCurrentStaffRole()` is ([departure-groups.ts:286](lib/data/departure-groups.ts:286)) — one
round trip per render pass, however many consumers read it. Server Actions call
`revalidatePath('/', 'layout')` after a settings write, since settings reach nearly every route.

---

## 10. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | The `branches` migration touches three tables that ten report views read | Backfill by case-insensitive match, leave unmatched null, keep `branch text` as a snapshot. No view is rewritten in Phase 3; view migration is Phase 3b |
| R2 | `getAgencySettings()` becomes a hot read on every request once §9 lands | `React.cache` per render pass; single-row table, primary-key read. If it ever shows up in traces, it is a candidate for `unstable_cache` with a tag invalidated by the settings actions |
| R3 | Two admins save two sections concurrently | Per-section save (D3) writes disjoint column sets; `upsert` on the singleton row. Overlap is limited to `updated_at` |
| R4 | A settings change silently alters historical records | D2 plus explicit tests (§11): existing groups, invoices and snapshots are byte-identical after every settings write |
| R5 | Margin visibility used to *grant* access | D4 intersection, enforced in the server action and again in `stripReceivable` |
| R6 | The section grows into "everything admin" | The §0 rule is the acceptance criterion for every future field; anything per-lead, per-booking, per-pilgrim or per-group is rejected at review |
| R7 | Read-only security fields read as broken | D15's `unavailable-note.tsx` states the reason inline on every one of them |
| R8 | Template variables drift from the data that fills them | `TEMPLATE_VARIABLES` is code; save-time validation rejects unknown tokens; preview renders from `SAMPLE_TEMPLATE_CONTEXT` in the same file |

---

## 11. Testing obligations

- **Non-retroactivity** — change every operational default, assert existing `departure_groups`,
  `invoices` and package snapshots are unchanged.
- **Prefix change** — change `invoice_prefix`, assert the next number starts at `00001` under the
  new prefix and no existing invoice number changes.
- **Threshold ordering** — `ready > atRisk` rejected when violated; `BLOCKED` band derived, never
  stored independently.
- **Capability intersection** — attempt to grant margin visibility to `MARKETING` via the action;
  assert rejection and assert `stripReceivable` still strips.
- **Role gating** — every one of the ten routes, for all seven roles, asserted against
  `visibleSettingsSections()`.
- **Audit completeness** — every mutator in `settings-repository.ts` writes exactly one
  `settings_activity_logs` row with populated `before_value` and `after_value`.
- **Append-only** — assert `update` and `delete` on `settings_activity_logs` are rejected by RLS.
- **Template validation** — an unknown `{{token}}` is a field error; a missing required token for
  the category is a field error.
- **Portal forbidden fields** — assert `PORTAL_FORBIDDEN_FIELDS` covers supplier details,
  margin/cost, other pilgrims' data, internal notes, readiness score and staff tasks.
- **Branch backfill** — after the migration, every seeded `Colombo` / `Kandy` string resolves to a
  `branch_id`; unmatched rows are null, never wrong.
- **Danger Zone** — `Delete Test Data` is absent in a production build and rejected server-side.

---

## 12. Deliberate deviations from the specification

| Spec | Shipped | Why |
|---|---|---|
| `/settings/organisation` etc. | `/management/settings/organisation` | D1 — the spec's own breadcrumb says `Home > Management > Settings` |
| `[Save Changes]` in the page shell | Per-section Save in each section's footer | D3 — a layout-level button cannot observe ten independent forms' dirty state |
| Session table with device + location | People list ordered by last-active, with device/location omitted and stated | F6 — `auth.sessions` is not readable; the mock's columns are not derivable |
| Password policy / 2FA as toggles | Read-only, with the reason inline | F6, D15 — enforcement is Supabase project config |
| `Allow cross-branch booking management` as a live toggle | Read-only until §9.5 | No enforcement point exists until `branch_id` is populated and read |
| Import Data buttons | Present but disabled, scheduled as Phase 10b | F7 — an importer without dry-run and partial-failure reporting is a data-integrity hazard |
| Portal settings implying a live portal | Same settings, with a visible status note | F5, D8 |

---

## 13. Out of scope for V1

Multi-agency / multi-tenancy (F10 — `agency_id` stays reserved). Custom role creation or a
permission-matrix editor (roles stay the seven in `STAFF_ROLES`). Live OAuth connectors for any
integration (D9). An automated retention/deletion job (§5.9). Webhook or event subscriptions.
Per-user notification preferences. A theme builder beyond the two portal colours. Any
one-click full-data deletion (D13). Localisation of the settings UI itself — `supported_languages`
configures *outbound message* languages, not the admin interface.
