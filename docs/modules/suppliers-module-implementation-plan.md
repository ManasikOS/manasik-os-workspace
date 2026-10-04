# Suppliers Module — Implementation Plan

Build the **Supplier Directory** at `/suppliers` on the same data, access and action
architecture already used by **Packages**, **Departure Groups**, **Leads**, **Pilgrims**,
**Documents**, **Visa** and **Operations**.

Status: **plan only. Nothing in here is implemented.**

The product rule the whole plan enforces:

```text
Supplier                          = reusable business partner
Supplier Commitment               = one real service promise to one Departure Group
Departure Group Readiness         = whether that commitment is confirmed
```

And the boundary it must not cross:

```text
Departure Group page  →  the services of ONE group (hotels, flights, transport, rooming)
Operations page       →  the agency-wide exception queue across every active group
Suppliers page        →  the reusable partner directory + every commitment that partner owes us
```

The Suppliers page never becomes a second place to manage a group's booking detail. It owns the
**partner** (identity, contacts, capabilities, reliability) and the **commitment record**; the
service detail — hotel name, room allocation, vehicle, PNR — stays where it already lives, and the
commitment links to it.

Two supporting rules from the spec, carried into every section below:

- **Supplier rates are internal planning references only.** Customer pricing stays in Package
  Templates and group price overrides. Nothing in this module may be read by a pricing surface.
- **Costs, payment terms, broker notes and private contacts are permission-gated.** They are
  stripped in the repository before they leave the server, never merely hidden in the UI.

---

## 1. What exists today

### 1.1 The route

| File                                                           | State                                                                                                                                                                  |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [app/(main)/supplier/page.tsx](<app/(main)/supplier/page.tsx>) | **Stub.** Seven lines, returns `<div>SupplierPage</div>`. Untracked in git (`?? app/(main)/supplier/`) — the only uncommitted change on the `Suppliers` branch.        |
| [components/app-sidebar.tsx:72](components/app-sidebar.tsx:72) | Nav entry `Supplier → /supplier`, icon `ContactRound` (duplicated from Pilgrims), inside `adminBar[2]` — the **Operations** group, alongside `Operations` and `Tasks`. |
| [components/app-sidebar.tsx:78](components/app-sidebar.tsx:78) | Nav entry `Tasks → /tasks`. **No route exists.** Out of scope here, but note the Operations group currently has one working link out of three.                         |

So the spec's navigation requirement is _half_ satisfied: the group placement is right, the title,
route and icon are wrong, and the page is a stub every user can already reach.

No other file in the codebase links to `/supplier` or `/suppliers`.

### 1.2 What already exists and is the real starting point

This is closer to greenfield than Operations was — **there is no supplier entity anywhere in the
database.** What already exists is the entire surrounding machinery the module plugs into.

| Concern                       | Where it already lives                                                                                                                                                                                                                     | Fitness for the spec                                                                                                                                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Supplier identity             | Nowhere. `supplier_name text` on `departure_group_accommodations`, `departure_group_transports`, `departure_group_flights`                                                                                                                 | **Missing.** Already flagged as [operations plan F11](docs/operations-module-implementation-plan.md) and deliberately deferred there (D6). This module is where that deferral is paid off                                |
| Service commitment            | Derived, never stored. `buildSupplierRows()` in [lib/data/operations-repository.ts:462](lib/data/operations-repository.ts:462) projects one row per flight / accommodation / transport row                                                 | **Partial.** Covers three service kinds out of the spec's eleven, and cannot represent a commitment that has no service row (catering, ticketing, insurance, ziyarah, welcome kits)                                      |
| Supplier confirmation states  | `status` on accommodations + transports: `NOT_REQUESTED · REQUESTED · CONFIRMED · COMPLETED · CANCELLED` ([20260809090000:205](supabase/migrations/20260809090000_create_departure_groups.sql:205))                                        | Five of the spec's seven. `Draft`, `Supplier Responded` and `Disputed` have no representation                                                                                                                            |
| Supplier cost                 | `internal_cost numeric(14,2)` on accommodations and transports only, already commented _"Exposed only to Admin / CEO / Finance in the application layer"_                                                                                  | The gating intent is established; there is no payable, no payment, no due date, no invoice                                                                                                                               |
| Evidence                      | `voucher_url` (accommodation), `confirmation_url` (transport) — plain text columns                                                                                                                                                         | Weak. The real pattern is the private-bucket signed upload in [document-storage.ts](<app/(main)/departure-groups/document-storage.ts>) — 10 MB cap, MIME allowlist, server-composed object key, short-lived signed reads |
| Readiness engine              | `scoreReadiness()` + `deriveReadinessStatuses()` ([lib/data/departure-groups-readiness.ts:36](lib/data/departure-groups-readiness.ts:36)) with auto-sources `HOTEL_MAKKAH_CONFIRMED`, `TRANSPORT_*_CONFIRMED`, `FLIGHT_OUTBOUND_CONFIRMED` | **Complete, and the reason confirmation must write through to the service row.** An auto-sourced readiness item cannot be ticked by hand — confirming a commitment is the only way it turns green                        |
| Confirmation mutators         | `markGroupAccommodationConfirmed`, `markGroupTransportConfirmed`, `setGroupAccommodationReference`, `setGroupTransportReference` ([lib/data/departure-groups.ts](lib/data/departure-groups.ts))                                            | **Reuse verbatim.** Confirming a commitment calls these rather than writing the service row directly                                                                                                                     |
| Activity trail                | `departure_group_activity_logs`, `entity_type` includes `ACCOMMODATION · TRANSPORT · FLIGHT · TASK` ([20260809090000:451](supabase/migrations/20260809090000_create_departure_groups.sql:451))                                             | Group-scoped and append-only. A commitment event must land here **and** on a supplier-scoped timeline, since a supplier's history spans groups                                                                           |
| Tasks                         | `departure_group_tasks` with `category` including `OPERATIONS`                                                                                                                                                                             | The AI panel's "Create Task" and the follow-up workflow reuse `createGroupTask`                                                                                                                                          |
| Roles                         | `StaffRole` (`ADMIN·CEO·OPERATIONS·VISA·FINANCE·MARKETING·GUIDE`) + per-module capability files                                                                                                                                            | The seven roles the spec's table names, already enumerated                                                                                                                                                               |
| Cross-group read precedent    | `pilgrim_journey_rows` view + [lib/data/pilgrims-repository.ts](lib/data/pilgrims-repository.ts); `visa_application_rows` + [lib/data/visa-repository.ts](lib/data/visa-repository.ts)                                                     | **Copy this shape exactly:** one flattening view, one server-only repository, one client-safe derivation file                                                                                                            |
| List + profile precedent      | [app/(main)/pilgrims/](<app/(main)/pilgrims/>) — `page.tsx` → repository → view models → Provider → List; `[pilgrimId]/page.tsx` → profile → tabbed detail with role-gated tabs                                                            | **The closest structural twin to the Suppliers spec.** Directory list + entity profile with 6–8 tabs                                                                                                                     |
| CSV import/export             | [lib/csv.ts](lib/csv.ts) (`toCsv`, `parseCsv`), per-module `csv.ts`, [import-groups-dialog.tsx](<app/(main)/departure-groups/components/import-groups-dialog.tsx>)                                                                         | Covers the header's **Import Suppliers** / **Export Directory** with no new machinery                                                                                                                                    |
| Duplicate detection on create | [duplicate-check-section.tsx](<app/(main)/leads/add-new-lead/components/duplicate-check-section.tsx>)                                                                                                                                      | Reuse for "Al Noor Travel Services" vs "Al-Noor Travel"                                                                                                                                                                  |
| AI panel posture              | [ai-operations-panel.tsx](<app/(main)/operations/components/ai-operations-panel.tsx>), [ai-visa-panel.tsx](<app/(main)/visa/components/ai-visa-panel.tsx>), `@anthropic-ai/sdk`                                                            | Suggestion-only, staff-approved, already the house pattern                                                                                                                                                               |
| Role resolution               | `getCurrentStaffRole()` ([lib/data/departure-groups.ts:261](lib/data/departure-groups.ts:261))                                                                                                                                             | **Defaults everyone to ADMIN.** Known, shared limitation (visa plan F13, operations plan F19). Not this module's to fix, but it means the role matrix cannot be _tested_ until it is                                     |

### 1.3 The UI vocabulary to reuse — no new components

Everything the spec draws already has a component. **This plan adds zero files under
`components/`, introduces no new colours, spacing or typography, and defines no new theme tokens.**
New work is composition only.

| Spec element                                                        | Existing component                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Breadcrumb + title + subtitle + header actions                      | [components/page-header.tsx](components/page-header.tsx)                                                                                                                                                                                                                                                                                |
| KPI cards (5, clickable → quick filter)                             | [components/data-table/kpi-card.tsx](components/data-table/kpi-card.tsx) — `KpiCard`, `KpiRow`. Clickable variant: wrap in `<button className="text-left">`, exactly as [pilgrims-list.tsx:205](<app/(main)/pilgrims/components/pilgrims-list.tsx:205>). **`KpiRow` is a 4-column grid — the fifth card wraps; do not change the grid** |
| Saved views (11 pills)                                              | [components/data-table/saved-view-bar.tsx](components/data-table/saved-view-bar.tsx) — `SavedViewBar`                                                                                                                                                                                                                                   |
| Filter chips (7 + More Filters)                                     | [components/data-table/filter-select.tsx](components/data-table/filter-select.tsx) — `FilterSelect`, with the `More Filters` toggle pattern from [pilgrims-list.tsx:318](<app/(main)/pilgrims/components/pilgrims-list.tsx:318>)                                                                                                        |
| Directory table + search + pagination                               | [components/data-table/data-table.tsx](components/data-table/data-table.tsx)                                                                                                                                                                                                                                                            |
| Commitments table (needs row selection for bulk follow-up)          | [operations-table/operations-data-table.tsx](<app/(main)/operations/operations-table/operations-data-table.tsx>) — already forked for selection; reuse, do not fork again                                                                                                                                                               |
| Sortable headers                                                    | [components/data-table/sortable-header.tsx](components/data-table/sortable-header.tsx) — `header()`                                                                                                                                                                                                                                     |
| Profile tabs (6)                                                    | [components/animate-ui/components/animate/tabs.tsx](components/animate-ui/components/animate/tabs.tsx) with `className="flex-wrap h-auto"`, as [pilgrim-detail.tsx:320](<app/(main)/pilgrims/[pilgrimId]/components/pilgrim-detail.tsx:320>)                                                                                            |
| Status badges, health chips, owner chips, empty / denied states     | [components/ui/tone-badge.tsx](components/ui/tone-badge.tsx) — `ToneBadge`, `ProgressBar`, `PersonChip`, `EmptyState`, `PermissionDenied`                                                                                                                                                                                               |
| Colour vocabulary                                                   | [lib/ui/tone.ts](lib/ui/tone.ts) — `Tone`, `TONE_CLASS`, `TONE_BAR`. Reliability maps onto existing tones with **no new palette**: Reliable→`success`, Needs Attention→`warning`, On Hold→`danger`, Inactive→`neutral`                                                                                                                  |
| Add Supplier (right-side sheet)                                     | [components/ui/sheet.tsx](components/ui/sheet.tsx), as [create-departure-group-sheet.tsx](<app/(main)/departure-groups/components/create-departure-group-sheet.tsx>)                                                                                                                                                                    |
| Create Commitment / Confirm / Set Reliability / Add Contact dialogs | [components/ui/dialog.tsx](components/ui/dialog.tsx) + `dialog-footer.tsx`, `input.tsx`, `textarea.tsx`, `checkbox.tsx` (multi-select service categories), `combobox.tsx`, `switch.tsx` (Primary / Emergency toggles), `calendar.tsx` + `popover.tsx` (service dates), `currency-input.tsx` (supplier cost)                             |
| Profile header stat cards                                           | [components/ui/card.tsx](components/ui/card.tsx) + [components/section-heading.tsx](components/section-heading.tsx)                                                                                                                                                                                                                     |
| Header overflow menus                                               | [components/ui/dropdown-menu.tsx](components/ui/dropdown-menu.tsx), `button-group.tsx`                                                                                                                                                                                                                                                  |
| Feedback                                                            | [components/ui/toast.tsx](components/ui/toast.tsx) — `toast.add(...)`                                                                                                                                                                                                                                                                   |
| Evidence upload                                                     | [document-storage.ts](<app/(main)/departure-groups/document-storage.ts>) — copy the signed one-shot upload flow against a **new private bucket**                                                                                                                                                                                        |
| Form reset on open                                                  | [hooks/use-reset-on-open.ts](hooks/use-reset-on-open.ts)                                                                                                                                                                                                                                                                                |

---

## 2. Findings — the gap between today and the specification

### F1 — The route name, the folder and the sidebar all disagree with the spec

Spec says `/suppliers`. The stub is at `app/(main)/supplier/` (singular, top-level) and
the sidebar links `/supplier` with the Pilgrims icon. Because the folder is untracked and nothing
links to it, the cheapest correct move is to **delete it** rather than redirect from it.

### F2 — There is no supplier entity. This is the blocking defect.

`supplier_name` is free text on three tables. Consequences the spec cannot tolerate:

- duplicates are inevitable and unmergeable;
- the **Supplier / Broker** column in the Operations queue cannot be a link;
- the AI agent's _"draft a WhatsApp follow-up to Ahmed Al Noor"_ has no contact to address;
- "3 active groups" for a supplier is unanswerable without a string match.

### F3 — There is no commitment record, only a projection

`buildSupplierRows()` derives rows from flights, accommodations and transports. A commitment that
is not one of those three has nowhere to live — which is exactly the spec's catering, ticketing,
insurance, ziyarah, guide/mutawwif and welcome-kit categories (operations plan F10). The spec also
requires the _same_ commitment record to appear on the supplier profile, the departure group tab
and the Operations queue; a per-table projection can never satisfy that.

### F4 — The status vocabulary is two states short, in the states that matter

Existing: `NOT_REQUESTED · REQUESTED · CONFIRMED · COMPLETED · CANCELLED`.
Spec: `Draft · Requested · Supplier Responded · Confirmed · Completed · Cancelled · Disputed`.

`Supplier Responded` is the state the whole follow-up queue hangs on ("they replied, we have not
verified the voucher"), and `Disputed` is what the Supplier Issues KPI counts. Neither exists.

### F5 — There is no payable, and no Finance module to link to

The spec's Payments tab says _"link to Finance rather than duplicate it"_. There is no `/finance`
route (the sidebar links one; nothing serves it) and no payments table of any kind — only
`internal_cost` on two service tables and pilgrim-side `pilgrim_payment_milestones`. So the module
cannot link to Finance; it must own a **minimal payable + payment-allocation model** designed to be
handed over when Finance lands. That is a scope call, called out as D4.

### F6 — Suppliers have no contacts

The spec needs many contacts per supplier with role, WhatsApp, phone, email, language, primary /
emergency flags and (for brokers) a preferred contact window. Nothing exists. The nearest
precedent is `local_coordinator_name/phone` on `departure_groups` — a single denormalised pair.

### F7 — There is no reliability or health state, and no review audit

Spec: `Reliable · Needs Attention · On Hold · Inactive`, staff-set, with last-reviewed date,
reviewer and reason. Explicitly **not** computed. Nothing exists.

### F8 — Evidence is a text URL column, while the secure pattern already exists next door

`voucher_url` / `confirmation_url` are unvalidated text. Vouchers and supplier confirmations are
commercially sensitive; they belong in a private bucket behind signed, short-lived URLs, exactly as
pilgrim passports already do. Confirming a commitment without evidence must be impossible for the
AI and gated for staff — the Operations supplier column already enforces
`evidencePresent && supplierName` before offering **Mark Confirmed**
([supplier-columns.tsx:99](<app/(main)/operations/operations-table/supplier-columns.tsx:99>)); that
rule generalises.

### F9 — The supplier-type and service-category taxonomies have no home

Eleven supplier types, and a supplier supports **multiple** service categories. `city` on
accommodations is a five-value check constraint (`MAKKAH·MADINAH·MINA·ARAFAT·OTHER`) — not a
location vocabulary for Jeddah, Colombo, Riyadh or Istanbul.

### F10 — The role matrix does not match the spec

[operations-access.ts](lib/access/operations-access.ts) grants `MARKETING` `viewModule` and gives
`FINANCE` `viewSupplierCosts` — broadly right — but there is no supplier-specific matrix, and the
spec adds constraints Operations does not encode: Marketing sees **no** private contacts or broker
notes, Guide sees **only** assigned-group service details plus emergency supplier contacts, Visa
has no general supplier access. This needs its own capability file, plus **tab-level** gating
(Payments tab hidden entirely for Operations-without-cost roles), as `visibleTabsForPilgrim()`
already does.

### F11 — Rates have nowhere to live, and a real risk of leaking into customer pricing

The spec is emphatic that supplier rates are internal planning references. Package pricing already
lives in `packages` and group overrides. Any rates table must therefore be **write-isolated**: no
pricing surface may import from `lib/data/suppliers*`.

### F12 — There is no directory-level aggregate query

Every column in the spec's main table (active groups, confirmation health, payment status) is an
aggregate across commitments. Deriving it in the client over an unbounded commitment array is the
wrong shape; the house answer is a flattening view (`pilgrim_journey_rows`, `visa_application_rows`).

### F13 — The KPI row mixes currencies

_"Supplier Payments Due — LKR 1.2M"_ while commitments are priced in SAR, LKR or USD, and there is
no FX rate anywhere in the codebase. Silently summing them would be wrong. See D1.

### F14 — Confirming a commitment must move group readiness, and nothing wires that today

The spec's chain — _hotel commitment confirmed → group hotel readiness complete → overall readiness
recalculates → dashboard risk alert updates_ — is real and already implemented **downstream** of
`markGroupAccommodationConfirmed`. The missing link is that a commitment confirmation must call it.

---

## 3. Target architecture

### 3.1 Routes and files

```text
app/(main)/suppliers/
  page.tsx                                   Server Component: role → capabilities → directory rows
  suppliers-store.tsx                        Provider (rows, nowIso, currentStaffName, role, can)
  types.ts                                   Re-exports lib/types/suppliers + saved views & filters
  utils.ts                                   Labels, tones, search/filter/sort predicates
  csv.ts                                     Export Directory / Export Commitments
  actions.ts                                 Server Actions, capability-gated, zod-validated
  components/
    suppliers-list.tsx                       Header + KPIs + saved views + filters + table
    suppliers-metrics.tsx                    5 KPI cards, clickable
    add-supplier-sheet.tsx                   Right-side Sheet: 3 sections (F: Add Supplier flow)
    import-suppliers-dialog.tsx              CSV import, reusing import-groups-dialog shape
    create-commitment-sheet.tsx              Shared by all three launch points
    confirm-commitment-dialog.tsx            Evidence-gated confirmation
    upload-evidence-dialog.tsx
    set-reliability-dialog.tsx               Status + reason + reviewer (staff judgement only)
    add-edit-contact-dialog.tsx
    ai-supplier-panel.tsx                    Suggestion-only
  suppliers-table/
    suppliers-columns.tsx
    commitments-columns.tsx
  [supplierId]/
    page.tsx                                 Profile: role → visible tabs → initial tab from ?tab=
    components/
      supplier-detail.tsx                    Header + badges + stat cards + tabs
      tabs/overview-tab.tsx
      tabs/commitments-tab.tsx
      tabs/services-rates-tab.tsx
      tabs/contacts-tab.tsx
      tabs/payments-tab.tsx                  Capability-gated; PermissionDenied otherwise
      tabs/activity-tab.tsx
```

Deleted: `app/(main)/supplier/` (untracked stub).
Changed: [components/app-sidebar.tsx](components/app-sidebar.tsx) — `Supplier → /supplier` becomes
`Suppliers → /suppliers`, icon `Handshake` or `Building2` (Pilgrims already owns
`ContactRound`), still inside `adminBar[2]`. The group's link array is index-based
(`[sideLinks[5], sideLinks[6], sideLinks[7]]`), so **reorder to Operations · Tasks · Suppliers per
the spec**, or leave the order and accept the mismatch — a two-line change either way.

`NavItem` has no role awareness (`isLoggedIn` is hardcoded `true`, `onLockedClick` throws). Rather
than build a role-aware sidebar here, the page itself `notFound()`s for roles without `viewModule`
— identical to every other module. **Nav-level role hiding is a separate, cross-module change** and
is listed under risks, not delivered here.

New server-only modules:

```text
lib/types/suppliers.ts            Flat, JSON-safe view models
lib/access/suppliers-access.ts    SupplierCapabilities + capabilitiesForSuppliers + visibleTabs
lib/data/suppliers-repository.ts  Server-only reads/writes (the only file touching Supabase)
lib/data/suppliers.ts             Client-safe derivations: KPIs, tones, health, filters
lib/data/suppliers-copy.ts        Every label, threshold and taxonomy — nothing else hardcodes one
lib/validations/suppliers.ts      zod schemas + toSupplierFieldErrors
app/(main)/suppliers/supplier-storage.ts   Signed upload/download for supplier evidence
```

### 3.2 Schema — `supabase/migrations/20260817090000_supplier_directory.sql`

Additive only, safe on a database with `20260809090000 … 20260815090000` applied. Independent of
the (still unbuilt) operations migration the operations plan reserves at `20260816090000`; if that
one lands first, nothing here conflicts.

#### A. The supplier

```sql
create table if not exists public.suppliers (
  id                  uuid primary key default gen_random_uuid(),
  supplier_code       text not null,
  name                text not null,
  supplier_type       text not null
                        check (supplier_type in ('BROKER','HOTEL','TRANSPORT','CATERING','TICKETING',
                                                 'VISA_PARTNER','INSURANCE','GUIDE_PARTNER','ZIYARAH',
                                                 'ANCILLARY','OTHER')),
  status              text not null default 'ACTIVE'
                        check (status in ('ACTIVE','INACTIVE')),
  reliability         text not null default 'RELIABLE'
                        check (reliability in ('RELIABLE','NEEDS_ATTENTION','ON_HOLD','INACTIVE')),
  reliability_reason  text,
  reliability_reviewed_at   timestamptz,
  reliability_reviewed_by   uuid references auth.users (id) on delete set null,
  reliability_reviewed_by_name text,
  city                text,
  country             text,
  currency            text not null default 'SAR' check (currency in ('SAR','LKR','USD','AED','OTHER')),
  payment_terms       text not null default 'PAY_AFTER_CONFIRMATION'
                        check (payment_terms in ('DEPOSIT_REQUIRED','PAY_AFTER_CONFIRMATION','CUSTOM')),
  payment_terms_note  text,
  lead_time_days      integer check (lead_time_days is null or lead_time_days >= 0),
  preferred_channel   text check (preferred_channel is null or preferred_channel in ('WHATSAPP','PHONE','EMAIL')),
  -- Broker notes and commercial context. Stripped in the repository for roles
  -- without viewInternalNotes — same posture as accommodations.internal_cost.
  internal_notes      text,
  created_by          uuid references auth.users (id) on delete set null,
  created_by_name     text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint suppliers_code_unique unique (supplier_code)
);

create index if not exists suppliers_type_idx    on public.suppliers (supplier_type, status);
create index if not exists suppliers_city_idx    on public.suppliers (city) where city is not null;
create index if not exists suppliers_health_idx  on public.suppliers (reliability) where status = 'ACTIVE';
```

`status` is deliberately two-valued and separate from `reliability`; the spec's `Inactive` appears
in both lists, and collapsing them makes "on hold but still active" unrepresentable (F7).

#### B. Service capabilities and rates — one table, two jobs

The Add Supplier flow's **Service Categories** checkboxes and the **Services & Rates** tab are the
same rows at two levels of completeness. One table avoids a taxonomy that can disagree with itself.

```sql
create table if not exists public.supplier_services (
  id             uuid primary key default gen_random_uuid(),
  supplier_id    uuid not null references public.suppliers (id) on delete cascade,
  category       text not null
                   check (category in ('MAKKAH_ACCOMMODATION','MADINAH_ACCOMMODATION','ACCOMMODATION_OTHER',
                                       'AIRPORT_TRANSFER','INTERCITY_TRANSPORT','ZIYARAH_TRANSPORT',
                                       'CATERING','TICKETING','VISA_SERVICE','INSURANCE',
                                       'GUIDE_SERVICE','ANCILLARY','OTHER')),
  typical_service text,                         -- "4-star hotel within 500m of Haram"
  typical_rate    numeric(14,2) check (typical_rate is null or typical_rate >= 0),
  rate_currency   text check (rate_currency is null or rate_currency in ('SAR','LKR','USD','AED')),
  rate_unit       text,                         -- "room / night", "coach / trip"
  season          text check (season is null or season in ('STANDARD','RAMADAN','HAJJ','PEAK','OTHER')),
  notes           text,
  unique (supplier_id, category)
);
create index if not exists supplier_services_category_idx on public.supplier_services (category);
```

`typical_rate` is **internal planning only** (F11). A comment on the column says so, and the
repository nulls it for roles without `viewCosts`.

#### C. Contacts

```sql
create table if not exists public.supplier_contacts (
  id                 uuid primary key default gen_random_uuid(),
  supplier_id        uuid not null references public.suppliers (id) on delete cascade,
  name               text not null,
  role_title         text,
  whatsapp_number    text,
  phone_number       text,
  email              text,
  languages          text,                       -- "Arabic / English"
  is_primary         boolean not null default false,
  is_emergency       boolean not null default false,
  preferred_time_from  time,
  preferred_time_to    time,
  timezone           text,                       -- e.g. 'Asia/Riyadh'
  notes              text,
  created_at         timestamptz not null default now()
);
create unique index if not exists supplier_contacts_one_primary_idx
  on public.supplier_contacts (supplier_id) where is_primary;
create index if not exists supplier_contacts_emergency_idx
  on public.supplier_contacts (supplier_id) where is_emergency;
```

The partial unique index is what makes "Primary Contact toggle" a real constraint rather than a
convention — setting a new primary must clear the old one in the same transaction.

#### D. The commitment — the core of the module (F3, F4)

```sql
create table if not exists public.supplier_commitments (
  id                  uuid primary key default gen_random_uuid(),
  supplier_id         uuid not null references public.suppliers (id) on delete restrict,
  departure_group_id  uuid not null references public.departure_groups (id) on delete cascade,
  reference_code      text not null,                 -- SC-000123, internal
  service_category    text not null,                 -- same vocabulary as supplier_services.category
  service_label       text not null default '',      -- "Makkah Accommodation"
  service_details     text,                          -- "Pullman ZamZam · 10 rooms · Quad/Triple"
  service_start_date  date,
  service_end_date    date,
  booking_reference   text,                          -- HTL-MAK-882 / PNR / voucher no.
  status              text not null default 'DRAFT'
                        check (status in ('DRAFT','REQUESTED','SUPPLIER_RESPONDED','CONFIRMED',
                                          'COMPLETED','CANCELLED','DISPUTED')),
  -- The existing service row this commitment fulfils, when there is one.
  linked_entity_type  text check (linked_entity_type is null or linked_entity_type in
                                   ('ACCOMMODATION','TRANSPORT','FLIGHT')),
  linked_entity_id    uuid,
  owner_id            uuid references auth.users (id) on delete set null,
  owner_name          text,
  amount              numeric(14,2) check (amount is null or amount >= 0),
  currency            text not null default 'SAR' check (currency in ('SAR','LKR','USD','AED')),
  payment_terms_note  text,
  amount_paid         numeric(14,2) not null default 0 check (amount_paid >= 0),
  payment_due_at      date,
  evidence_path       text,                          -- private bucket object path, never a public URL
  evidence_uploaded_at timestamptz,
  confirmed_at        timestamptz,
  confirmed_by_name   text,
  notes               text,
  created_by          uuid references auth.users (id) on delete set null,
  created_by_name     text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint supplier_commitments_reference_unique unique (reference_code),
  constraint supplier_commitments_dates check (service_end_date is null
                                               or service_start_date is null
                                               or service_end_date >= service_start_date)
);

create index if not exists supplier_commitments_supplier_idx on public.supplier_commitments (supplier_id, status);
create index if not exists supplier_commitments_group_idx    on public.supplier_commitments (departure_group_id, status);
create index if not exists supplier_commitments_linked_idx   on public.supplier_commitments (linked_entity_type, linked_entity_id)
  where linked_entity_id is not null;
create index if not exists supplier_commitments_due_idx      on public.supplier_commitments (payment_due_at)
  where status not in ('CANCELLED','COMPLETED');
```

`payment_status` is **derived, not stored** — `amount_paid` vs `amount` vs `payment_due_at` vs now.
Storing it invites the two to disagree, exactly as `outstanding_balance` already risks on bookings.

`on delete restrict` on `supplier_id`: a supplier with commitments is deactivated, never deleted.

#### E. Payments against commitments (F5)

```sql
create table if not exists public.supplier_payments (
  id             uuid primary key default gen_random_uuid(),
  commitment_id  uuid not null references public.supplier_commitments (id) on delete cascade,
  amount         numeric(14,2) not null check (amount > 0),
  currency       text not null check (currency in ('SAR','LKR','USD','AED')),
  paid_at        date not null,
  method         text,
  reference      text,
  document_path  text,                    -- invoice / receipt, private bucket
  recorded_by    uuid references auth.users (id) on delete set null,
  recorded_by_name text,
  created_at     timestamptz not null default now()
);
create index if not exists supplier_payments_commitment_idx on public.supplier_payments (commitment_id, paid_at desc);
```

Deliberately thin (D4): a ledger row, not an accounting system. `amount_paid` on the commitment is
maintained by a trigger summing this table, so the two cannot drift.

#### F. Supplier timeline (append-only)

Mirrors `visa_application_events` exactly.

```sql
create table if not exists public.supplier_activity_events (
  id             uuid primary key default gen_random_uuid(),
  supplier_id    uuid not null references public.suppliers (id) on delete cascade,
  commitment_id  uuid references public.supplier_commitments (id) on delete cascade,
  actor_id       uuid references auth.users (id) on delete set null,
  actor_name     text not null default 'System',
  actor_role     text,
  action         text not null
                   check (action in ('SUPPLIER_CREATED','SUPPLIER_UPDATED','RELIABILITY_CHANGED',
                                     'CONTACT_ADDED','CONTACT_UPDATED','COMMITMENT_CREATED',
                                     'COMMITMENT_REQUESTED','SUPPLIER_RESPONDED','COMMITMENT_CONFIRMED',
                                     'COMMITMENT_COMPLETED','COMMITMENT_CANCELLED','COMMITMENT_DISPUTED',
                                     'EVIDENCE_UPLOADED','PAYMENT_RECORDED','NOTE_ADDED')),
  from_value     text,
  to_value       text,
  note           text,
  is_high_impact boolean not null default false,
  created_at     timestamptz not null default now()
);
create index if not exists supplier_events_supplier_idx   on public.supplier_activity_events (supplier_id, created_at desc);
create index if not exists supplier_events_commitment_idx on public.supplier_activity_events (commitment_id, created_at desc);
```

Commitment confirmations write **here and** to `departure_group_activity_logs` (entity_type
`ACCOMMODATION`/`TRANSPORT`/`FLIGHT`), so the group's Activity tab keeps telling the whole story.

#### G. Resolving the free-text supplier name (F2)

```sql
alter table public.departure_group_accommodations
  add column if not exists supplier_id uuid references public.suppliers (id) on delete set null;
alter table public.departure_group_transports
  add column if not exists supplier_id uuid references public.suppliers (id) on delete set null;
alter table public.departure_group_flights
  add column if not exists supplier_id uuid references public.suppliers (id) on delete set null;
```

`supplier_name` stays and stays authoritative for display in V1 — the FK is additive and nullable.
Backfill is a **later, separate migration** driven by a staff-reviewed match report, never an
automatic fuzzy match.

#### H. Directory read shape (F12)

```sql
create or replace view public.supplier_directory_rows as
select
  s.*,
  (select count(distinct c.departure_group_id) from public.supplier_commitments c
     where c.supplier_id = s.id and c.status in ('REQUESTED','SUPPLIER_RESPONDED','CONFIRMED'))  as active_group_count,
  (select count(*) from public.supplier_commitments c
     where c.supplier_id = s.id and c.status = 'CONFIRMED')                                       as confirmed_count,
  (select count(*) from public.supplier_commitments c
     where c.supplier_id = s.id and c.status in ('REQUESTED','SUPPLIER_RESPONDED'))               as pending_count,
  (select count(*) from public.supplier_commitments c
     where c.supplier_id = s.id and c.status = 'DISPUTED')                                        as issue_count,
  (select coalesce(sum(c.amount - c.amount_paid), 0) from public.supplier_commitments c
     where c.supplier_id = s.id and c.status not in ('CANCELLED') and c.amount is not null)       as outstanding_amount,
  (select min(c.payment_due_at) from public.supplier_commitments c
     where c.supplier_id = s.id and c.amount_paid < coalesce(c.amount, 0)
       and c.status not in ('CANCELLED','COMPLETED'))                                             as next_payment_due_at,
  (select string_agg(distinct sv.category, ',') from public.supplier_services sv
     where sv.supplier_id = s.id)                                                                 as service_categories,
  (select con.name from public.supplier_contacts con
     where con.supplier_id = s.id and con.is_primary limit 1)                                     as primary_contact_name,
  (select con.whatsapp_number from public.supplier_contacts con
     where con.supplier_id = s.id and con.is_primary limit 1)                                     as primary_contact_whatsapp
from public.suppliers s;
```

`outstanding_amount` is summed **within a currency only** where every commitment shares one; the
repository groups by currency and the view's scalar is used solely for sorting. See D1.

RLS on every new table: `enable row level security`, `select` + write policies for `authenticated`
(matching `visa_submission_batches`); real per-role enforcement stays in the application layer
until a staff-roles table exists. `set_updated_at()` triggers on `suppliers` and
`supplier_commitments` (the function already exists from the visa migration).

Storage: a **new private bucket `supplier-evidence`**, 10 MB cap, MIME allowlist
`pdf/jpeg/png/webp`, object key composed server-side as
`{supplierId}/{commitmentId}/{uuid}.{ext}` — copied from `document-storage.ts`, not shared with
`pilgrim-documents` (different sensitivity class, different retention).

### 3.3 Data layer

Mirror the Pilgrims shape exactly.

| File                               | Responsibility                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/data/suppliers-repository.ts` | `"server-only"`. `loadSupplierDirectory(db, { role })`, `loadSupplierProfile(db, supplierId)`, `loadSupplierCommitments(db, { supplierId? , groupId? })`, plus mutators. **Strips `amount`, `amount_paid`, `typical_rate`, `payment_terms*`, `internal_notes` and non-emergency contact numbers before returning, per capability.** |
| `lib/data/suppliers.ts`            | Client-safe. `toSupplierListItems(rows, nowIso)`, `computeSupplierKpis(items)`, `buildSupplierProfile(...)`, `commitmentPaymentStatus(c, nowIso)`, `reliabilityTone()`, `confirmationHealth()`. Pure functions over flat rows — importable from Client Components                                                                   |
| `lib/data/suppliers-copy.ts`       | `SUPPLIER_TYPE_LABELS`, `SERVICE_CATEGORY_LABELS`, `COMMITMENT_STATUS_LABELS`, `RELIABILITY_LABELS`, `PAYMENT_DUE_WINDOW_DAYS = 14`, `PAYMENT_SOON_WINDOW_DAYS = 7`, `CONFIRMATION_FOLLOW_UP_DAYS = 3`, `MAX_AI_SUGGESTIONS`. **Nothing else hardcodes one of these.**                                                              |
| `lib/validations/suppliers.ts`     | `createSupplierSchema`, `updateSupplierSchema`, `createCommitmentSchema`, `updateCommitmentStatusSchema`, `recordSupplierPaymentSchema`, `upsertContactSchema`, `setReliabilitySchema`, `toSupplierFieldErrors`                                                                                                                     |

Server Actions in `app/(main)/suppliers/actions.ts`, each: resolve role → check
capability → zod parse → call repository → `revalidatePath("/suppliers")` (plus
`/operations` and `/departure-groups/[id]` when a commitment changes) → return
`{ ok, error?, fieldErrors? }`. Same signature as `OperationsActionResult`.

### 3.4 Confirmation writes through to the group (F14)

`confirmCommitmentAction` is the only place the chain is wired, and it is ordered:

1. Reject unless `evidence_path` is present **and** `booking_reference` is non-empty **and** the
   caller has `confirmCommitment`. (Generalises the existing rule in `supplier-columns.tsx:99`.)
2. Set `status = CONFIRMED`, `confirmed_at`, `confirmed_by_name`.
3. If `linked_entity_type` is set, call the **existing** mutator —
   `markGroupAccommodationConfirmed` / `markGroupTransportConfirmed` — never write the service row
   directly.
4. `deriveReadinessStatuses()` then recomputes the group's readiness items; `scoreReadiness()`
   recomputes the score. Both already run inside those mutators.
5. Append `supplier_activity_events` **and** `departure_group_activity_logs`.
6. Revalidate `/suppliers`, `/operations`, `/departure-groups/{groupId}`, `/dashboard`.

A commitment with no linked service row (catering, insurance) skips step 3 — it still records
confirmation, it simply has no auto-source readiness item to move. That asymmetry is intentional
and should be stated in the UI ("no linked group service").

### 3.5 Capability matrix — `lib/access/suppliers-access.ts`

```ts
export interface SupplierCapabilities {
  viewModule: boolean;
  createSupplier: boolean;
  editSupplier: boolean;
  deactivateSupplier: boolean;
  setReliability: boolean;
  viewContacts: boolean; // full contact list
  viewEmergencyContactsOnly: boolean;
  manageContacts: boolean;
  viewCommitments: boolean;
  createCommitment: boolean;
  requestCommitment: boolean;
  confirmCommitment: boolean;
  uploadEvidence: boolean;
  disputeCommitment: boolean;
  viewCosts: boolean; // amount, rates, payment terms
  viewPayments: boolean; // Payments tab
  recordPayment: boolean;
  viewInternalNotes: boolean; // broker notes
  importExport: boolean;
  readOnly: boolean;
  assignedGroupOnly: boolean; // Guide
}
```

| Role           | Shape                                                                                                                                                                                                                                 |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ADMIN**      | everything                                                                                                                                                                                                                            |
| **OPERATIONS** | everything except `recordPayment`; `viewCosts` **true** (they negotiate), `viewPayments` false                                                                                                                                        |
| **FINANCE**    | `viewModule`, `viewCommitments`, `viewCosts`, `viewPayments`, `recordPayment`, `viewContacts`; **no** supplier editing except `editSupplier: false`, `readOnly` for directory fields                                                  |
| **CEO**        | full visibility incl. costs, payments, notes; `readOnly: true`                                                                                                                                                                        |
| **MARKETING**  | `viewModule: true` **only** for the public service summary: no costs, no payments, no contacts, no internal notes, no commitments table. Realistically this renders a near-empty page — **consider `viewModule: false` instead** (D7) |
| **GUIDE**      | `viewModule: true`, `assignedGroupOnly: true`, `viewEmergencyContactsOnly: true`, `viewCommitments` limited to their groups' service details, no costs, no payments, no notes                                                         |
| **VISA**       | `viewModule: false` by default; flip to a `VISA_PARTNER`-scoped view only when the visa-partner workflow needs it (spec's own caveat)                                                                                                 |

Plus `visibleTabsForSupplier(role)` returning the subset of
`overview · commitments · services · contacts · payments · activity` — Payments is present only
with `viewPayments`; Contacts renders emergency-only for Guide.

The repository consumes these capabilities to **null fields at the source**, exactly as
[operations-access.ts:8](lib/access/operations-access.ts:8) documents. A tab that a role cannot see
renders `PermissionDenied`, and its data never leaves the server.

---

## 4. Screens

### 4.0 Header

```text
Home > Operations > Suppliers

Suppliers
Manage hotels, brokers, transport providers, catering partners, and service confirmations.

[ + Add Supplier ]  [ ••• → Import Suppliers · Export Directory ]
```

`PageHeader` with a `breadcrumb` of three entries. Following the Pilgrims precedent, only the
primary action is a visible button; Import/Export live in the overflow `DropdownMenu`.
`Add Supplier` renders only with `createSupplier`; Import/Export only with `importExport`.

### 4.1 KPI cards

| Card                  | Value                                                                                                             | Source         |
| --------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------- |
| Active Suppliers      | `count(status = ACTIVE)`                                                                                          | directory rows |
| Active Commitments    | `sum(active_group_count)` distinct commitments in `REQUESTED·SUPPLIER_RESPONDED·CONFIRMED` on non-departed groups | commitments    |
| Confirmations Pending | `count(status in REQUESTED, SUPPLIER_RESPONDED)`                                                                  | commitments    |
| Supplier Payments Due | per-currency, next `PAYMENT_DUE_WINDOW_DAYS` (14)                                                                 | commitments    |
| Supplier Issues       | `count(status = DISPUTED)` + confirmed-but-no-evidence + overdue payment                                          | derived        |

Each card is a clickable quick filter (`<button className="text-left">` wrapping `KpiCard`),
toggling the same `quickFilter` state Pilgrims uses. **Payments Due renders as the largest
currency with a "+2 more" suffix, not a summed total** (D1). Cards requiring `viewCosts` are
omitted, not blanked, for roles without it — `KpiRow`'s grid reflows.

### 4.2 Filters and saved views

Chips (`FilterSelect`): Supplier Type · Service Category · Location · Active Status · Commitment
Status · Reliability · Payment Status, then **More Filters** revealing Currency · Payment Terms ·
Has Pending Confirmations · Created By. Search covers name, supplier code, contact name, contact
number, city and — via commitments — hotel/service label and booking reference.

`SavedViewBar` with the spec's eleven views, each a pure predicate in `utils.ts`:
`All Suppliers · Makkah Suppliers · Madinah Suppliers · Hotels · Transport Providers · Catering ·
Ticketing Agents · Brokers · Active Group Commitments · Confirmations Pending · Inactive Suppliers`.

### 4.3 Directory table

| Column              | Content                                                             | Gating            |
| ------------------- | ------------------------------------------------------------------- | ----------------- |
| Supplier            | name, `supplier_code`, type chip                                    | —                 |
| Type                | `ToneBadge` `brand`                                                 | —                 |
| Location            | city / country                                                      | —                 |
| Services            | up to 3 category chips + "+N"                                       | —                 |
| Active Groups       | `active_group_count`                                                | `viewCommitments` |
| Confirmation Health | `2 confirmed · 1 pending`, tone from worst state                    | `viewCommitments` |
| Payment Status      | `LKR 250,000 due in 5 days` / `Up to date` / `Overdue`              | `viewCosts`       |
| Reliability         | `ToneBadge` (success/warning/danger/neutral)                        | —                 |
| Actions             | Open · Add Commitment · `•••` (Set Reliability, Deactivate, Export) | per capability    |

Row click → `/suppliers/{id}`. Uses the shared `DataTable` (no selection needed here).

### 4.4 Add Supplier — right-side Sheet

Three sections, matching the spec exactly: **Basic information** (name, code, type, service
categories as `Checkbox` group, status) · **Location and contacts** (city, country, contact name,
WhatsApp/phone required, email, preferred channel, Arabic-speaking `Switch`) · **Commercial setup**
(currency, payment terms, lead time, internal notes — the last two gated on `viewCosts` /
`viewInternalNotes`).

- Supplier code is **suggested** (`SUP-{CITY3}-{NNN}`) and editable, uniqueness enforced by the DB
  constraint and surfaced as a field error.
- Name entry runs the duplicate check from `duplicate-check-section.tsx` and warns — never blocks.
- The first contact entered becomes `is_primary`; further contacts are added from the Contacts tab.
- **No contracts, bank details or financial history** — per the spec's V1 exclusion.

### 4.5 Supplier profile — `/suppliers/[supplierId]`

`PageHeader` (name, code) + badge row (type, service chips, location, status, reliability) +
contact line + actions `[WhatsApp] [Call] [Add Commitment] [More ▾]`. WhatsApp/Call are
`window.open` on `wa.me` / `tel:` — the existing `whatsappLink()` helper pattern; no messages are
ever sent from the app.

Four stat cards (`Card`, as `pilgrim-detail.tsx:273`): Active Groups · Services Confirmed (`8 / 10`
with `ProgressBar`) · Pending Confirmations · Payment Due (gated) · Reliability.

Tabs: `Overview · Commitments · Services & Rates · Contacts · Payments · Notes & Activity`, filtered
by `visibleTabsForSupplier(role)`, initial tab from `?tab=`, exactly as the Pilgrim profile does.

**Overview** — the stat block plus _Current commitments_: compact cards showing group, service,
detail, status, due date, `[Open Commitment]`. Capped at `OVERVIEW_LIST_CAP`.

**Commitments** — the core table: Group · Service · Service date · Reference · Status · Amount
(gated) · Payment status (gated) · Owner · Actions (Open, Confirm, Upload Evidence). Uses the
selection-capable `operations-data-table.tsx` so bulk follow-up is possible later.

**Services & Rates** — lightweight list of `supplier_services` rows: category, typical service,
typical rate + unit, season, notes. Header banner: _"Internal planning reference only. Customer
pricing lives in Package Templates."_ Whole tab gated on `viewCosts`.

**Contacts** — cards per contact with role, WhatsApp, phone, language, Primary / Emergency badges,
preferred contact window rendered in both the supplier's timezone and Asia/Colombo. Guide sees only
`is_emergency` contacts.

**Payments** — five totals (Total committed · Paid · Outstanding · Due next 7 days · Overdue), each
**per currency**, then the commitment/payment table with Invoice/Receipt links (signed, 120s TTL).
Banner: _"Recorded here until the Finance module lands."_

**Notes & Activity** — `supplier_activity_events` reverse-chronological with `PersonChip`, plus the
internal-notes editor (gated on `viewInternalNotes`), reusing the inline note `Card` from
`pilgrim-detail.tsx:180`.

### 4.6 Create Commitment — one component, three launch points

`create-commitment-sheet.tsx` is imported by:

1. Supplier profile → `[Add Commitment]` (supplier pre-filled, group chosen);
2. Departure Group → Hotels / Transport / Flights tab (group **and** linked service row pre-filled,
   supplier chosen) — the existing per-tab dialogs
   ([accommodation-reference-dialog.tsx](<app/(main)/departure-groups/[groupId]/components/accommodation-reference-dialog.tsx>),
   [transport-reference-dialog.tsx](<app/(main)/departure-groups/[groupId]/components/transport-reference-dialog.tsx>))
   gain a "Link supplier commitment" entry point rather than being replaced;
3. Operations → Supplier Confirmations tab, replacing today's
   [add-supplier-booking-dialog.tsx](<app/(main)/operations/components/add-supplier-booking-dialog.tsx>),
   which currently only redirects to a group tab.

Fields per the spec: Departure Group\*, Service Type\*, Service Date/Period\*, Service Details,
Booking Reference, Status (`Requested`/`Confirmed`), Operations Owner, Supplier Cost + currency
(gated), Payment Terms, Evidence upload. Choosing `Confirmed` at creation requires evidence — the
same gate as §3.4.

### 4.7 What changes in Operations

The Supplier Confirmations tab's rows become **commitments** where one exists, falling back to the
derived projection where it does not, so the tab keeps working from day one. `OperationsSupplierRow`
gains `commitmentId: string | null` and `supplierId: string | null`; the Supplier/Broker cell
becomes a link to the profile when `supplierId` is set. This is the whole of the Operations-side
change and is the last build phase, not the first.

---

## 5. AI Supplier Agent

Same posture as the existing AI panels: **suggestion-only, staff-approved, no autonomous writes.**

May: list commitments near their service or payment deadline; flag unconfirmed services for groups
departing inside `CRITICAL_DEPARTURE_WINDOW_DAYS`; flag confirmed-without-evidence; detect coach or
room capacity below pilgrim count on a linked commitment; draft a WhatsApp/email follow-up
addressed to the primary contact; suggest a task owner; summarise a supplier's commitment status.

Must never: mark a commitment confirmed; approve or record a payment; commit agency money; cancel
or dispute a commitment; send any message. Every output is a draft with `[Create Task]` /
`[Draft Message]` buttons that open the existing dialogs pre-filled — the write is the staff
member's click, and `createGroupTask` is the existing action.

Implementation mirrors [lib/data/documents-ai.ts](lib/data/documents-ai.ts): a server module that
builds the prompt from the already-loaded snapshot, with the panel rendering
`ai-supplier-panel.tsx`. **Phase 7 — do not start it before real commitment history exists.**

---

## 6. Build phases

Matching the spec's own V1 order.

| Phase | Deliverable                                                                                                                                  | Done when                                                                                      |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **0** | Delete `app/(main)/supplier/`; sidebar → `Suppliers → /suppliers`; real page shell behind `capabilitiesForSuppliers`                         | No user can reach a stub; wrong-role users get 404                                             |
| **1** | Migration A/B/C/H + `suppliers-access` + repository + directory list (KPIs, saved views, filters, table) + Add Supplier sheet + Contacts tab | A supplier can be created, found, edited and contacted                                         |
| **2** | Migration D + commitment model + Commitments tab + Create Commitment sheet from the supplier profile                                         | A commitment exists as a record linked to a Departure Group                                    |
| **3** | Migration F + evidence bucket + confirm/dispute flow + owner assignment + supplier timeline                                                  | Confirmation is impossible without evidence and reference; every state change is on a timeline |
| **4** | Migration E + Payments tab + record payment + per-currency totals                                                                            | Finance can see and record what is owed                                                        |
| **5** | §3.4 write-through + migration G FK + Departure Group tab launch point                                                                       | Confirming a hotel commitment turns the group's hotel readiness green                          |
| **6** | Reliability dialog + review audit + Reliability filter/column                                                                                | Staff can set and justify supplier health                                                      |
| **7** | Operations Supplier Confirmations tab on real commitments; Import/Export; AI panel                                                           | The same record appears on all three surfaces                                                  |

Phases 1–3 are the module. 4–7 each stand alone and can be reordered against business priority.

---

## 7. Decisions and risks

**D1 — No FX conversion.** Commitments keep their native currency. Every total is reported per
currency; the KPI card shows the largest with "+N more". A single blended figure would be wrong,
and there is no rate source in the codebase. Revisit when Finance lands.

**D2 — The commitment links to the service row; it does not replace it.** Hotel name, rooms,
vehicle and PNR stay on `departure_group_accommodations` / `_transports` / `_flights`. The
commitment carries the _promise_ (who, what, reference, status, money, evidence). Two sources of
truth for hotel detail would be a worse outcome than the duplication of a `service_details` string.

**D3 — Reliability is staff-set only.** No score, no algorithm, per the spec. The event table is
designed so the signals (confirmation timeliness, evidence rate, dispute rate) can be computed
later from real history.

**D4 — This module owns a minimal payable model.** There is no Finance module to link to (F5). The
schema is deliberately a ledger — commitment amount, payments against it, derived status — so it
can be superseded rather than migrated when Finance arrives.

**D5 — `supplier_name` stays authoritative in V1.** The new FK is additive and nullable; backfill
is a separate, staff-reviewed migration. Nothing in this module blocks on cleaning historic text.

**D6 — Payment status is derived, never stored.** Prevents the `amount_paid` / status drift that
`outstanding_balance` already risks on bookings.

**D7 — Marketing's access is near-empty.** The spec grants "public package-service summaries only",
which is not a supplier screen. **Recommendation: `viewModule: false` for Marketing**, and surface
service summaries in Packages where they belong. Flagging rather than deciding — it contradicts the
spec's table.

### Risks

| Risk                                                                                                                   | Mitigation                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getCurrentStaffRole()` returns ADMIN for everyone, so **no role gate in this plan is observable in production today** | Unchanged from Visa/Operations. Build the matrix correctly; verify by setting `user_metadata.staff_role`. A staff-roles table is a cross-module prerequisite, not this module's deliverable |
| The sidebar has no role awareness, so Marketing/Guide will see a Suppliers link they may not be able to open           | Page-level `notFound()` as every other module does. Role-aware nav is a separate cross-module change                                                                                        |
| Commitment ↔ service row can drift (commitment confirmed, service row cancelled elsewhere)                             | Confirmation always routes through the existing group mutators (§3.4); add a reconciliation warning on the Commitments tab when `linked_entity_id` points at a `CANCELLED` row              |
| Supplier rates leaking into customer pricing (F11)                                                                     | Column comment + banner + a lint-level convention: no file under `app/(main)/packages/` or the pricing steps may import `lib/data/suppliers*`                                               |
| Evidence bucket sprawl                                                                                                 | Separate `supplier-evidence` bucket, server-composed keys, MIME allowlist, signed reads only — copied from `document-storage.ts`                                                            |
| Eleven supplier types × thirteen service categories is a lot of taxonomy to get wrong once                             | Both live only in `suppliers-copy.ts` + the DB check constraints; adding a value is a one-line migration plus one label                                                                     |

---

## 8. Suggested sequencing

1. Phase 0 (half a day) — the stub is publicly reachable today; close that first.
2. Phase 1 in one migration + one repository + one list screen; do not start commitments until the
   directory is genuinely usable, because commitments without a clean supplier list re-create F2.
3. Phases 2 and 3 together — a commitment without evidence gating is a false confirmation, which is
   precisely the failure mode the spec is written against.
4. Phase 5 immediately after 3 while the confirmation code is fresh; that is the phase that makes
   the module worth building.
5. Phases 4, 6, 7 by business priority.
