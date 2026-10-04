# Pilgrims Module — Implementation Plan

Bring **Pilgrims** up to the person-level operational-record specification, on the same data,
access and action architecture already used by **Packages**, **Departure Groups** and **Leads**.

Status: **plan only. Nothing in here is implemented.**

The product rule the whole plan enforces:

> **The Departure Group shows whether the group is ready. The Pilgrim profile shows exactly which
> person is preventing that group from being ready.**

And the chain it sits in:

```text
Lead (interested person) → Booking (commercial reservation)
  → Pilgrim (individual traveller) → Departure Group (actual journey)
```

---

## 1. What exists today

### 1.1 The route

| File | Lines | State |
|---|---|---|
| `app/(main)/pilgrims/page.tsx` | 6 | `<div>PilgrimsPage</div>`. Placeholder only. |
| `components/app-sidebar.tsx` | — | Nav entry for `/pilgrims` already exists under CRM. |

Nothing else in `app/(main)/pilgrims/` exists.

### 1.2 What already exists elsewhere and is the real starting point

This is **not** a greenfield module. Most of the pilgrim's *journey-scoped* data already lives in
the Departure Groups schema and data layer. The gap is that there is no **person**.

| Concern | Where it already lives | Notes |
|---|---|---|
| Enrolment / seat row | `public.departure_group_pilgrims` | Seat, flight, room, visa, payment, document counters, emergency contact, passport expiry/DOB |
| Per-document checklist | `public.departure_group_pilgrim_documents` | One row per requirement per pilgrim, copied from the group's frozen traveller-requirements snapshot |
| Secure file storage | `pilgrim-documents` bucket + `app/(main)/departure-groups/document-storage.ts` | Private bucket, signed one-shot upload/download URLs, MIME allowlist, server-composed object keys |
| Document lifecycle rules | `lib/data/departure-groups-documents.ts` (1,325 lines) | Submit / verify / reject / not-applicable, plus `syncPilgrimDerivedState()` which recomputes counters, percent and visa gating |
| Booking → pilgrim creation | `lib/data/departure-groups-bookings.ts:105`–`305` | Already creates one `departure_group_pilgrims` row **per traveller** and expands the document checklist for each |
| Money | `lib/data/departure-groups-money.ts` | `money()` 2-dp rounding, `derivePaymentStatus()` — the single source of truth for a traveller's payment status |
| Rooming | `departure_group_rooms`, `departure_group_room_assignments` | One bed per pilgrim, enforced by a unique constraint |
| Group activity log | `public.departure_group_activity_logs` | Already has `entity_type = 'PILGRIM' \| 'DOCUMENT' \| 'VISA' \| 'PAYMENT'` and `entity_id` |
| Role model | `lib/access/departure-groups-access.ts` | `STAFF_ROLES` = ADMIN, CEO, FINANCE, MARKETING, OPERATIONS, VISA, GUIDE — exactly the roles the spec's access table names |
| Role resolution | `getCurrentStaffRole()` in `lib/data/departure-groups.ts:256` | Reads `user_metadata.staff_role`, defaults ADMIN. One place to swap when a profiles table lands |

### 1.3 The UI vocabulary to reuse — no new components

Everything the spec draws already has a component. **The plan adds zero new files under
`components/`.**

| Spec element | Existing component |
|---|---|
| Breadcrumb + title + subtitle + actions | `components/page-header.tsx` |
| KPI cards row | `components/data-table/kpi-card.tsx` — `KpiCard`, `KpiRow` |
| Saved views pill bar | `components/data-table/saved-view-bar.tsx` — `SavedViewBar` |
| Filter chips | `components/data-table/filter-select.tsx` — `FilterSelect`, `ALL_FILTER_VALUE` |
| Table shell + search + pagination | `components/data-table/data-table.tsx` — `DataTable` |
| Sortable headers | `components/data-table/sortable-header.tsx` |
| Status badges | `components/ui/tone-badge.tsx` — `ToneBadge`, `ProgressBar`, `PersonChip`, `EmptyState`, `PermissionDenied` |
| Colour vocabulary | `lib/ui/tone.ts` — `Tone`, `TONE_CLASS`, `TONE_BAR`, `percentTone` |
| Profile tabs | `components/animate-ui/components/animate/tabs` (as used by `departure-group-detail.tsx`) |
| Sheets / dialogs / dropdowns / toast | `components/ui/*` |
| Detail-page shell pattern | `app/(main)/departure-groups/[groupId]/components/departure-group-detail.tsx` |

Two existing pieces are close enough to **lift and generalise** rather than rewrite:

- `app/(main)/departure-groups/[groupId]/components/pilgrim-documents-drawer.tsx` (625 lines) is
  already a full per-pilgrim document checklist. It becomes the Documents tab body.
- `app/(main)/departure-groups/[groupId]/components/tabs/pilgrims-bookings-tab.tsx` (913 lines)
  already renders per-pilgrim rows with visa/room/seat/payment badges. Its cell renderers are the
  seed of the Pilgrims list columns.

---

## 2. Findings — the gap between today and the specification

### F1 — There is no person. This is the blocking defect.

`departure_group_pilgrims` is an **enrolment**, not a person: it is `on delete cascade` from the
group, it carries `full_name_snapshot` / `phone_snapshot` / `passport_number_snapshot`, and its
`pilgrim_id` column is nullable and unconstrained. Today a family of four who travel twice are
**eight unrelated rows** with no link between them.

Consequences that break named requirements in the spec:

- "Move to another group" and "Replace pilgrim" cannot retain history — the row cascades away.
- "Future rebooking" is impossible; there is no repeat-traveller identity.
- Route `/pilgrims/[pilgrimId]` has no stable id to address.
- Passport, NIC, medical notes and emergency contacts are re-entered per journey.

The original migration anticipated this exactly (`…create_departure_groups.sql:331`: *"FK added
once the shared pilgrims table exists"*). This plan lands that table.

### F2 — Journey-scoped vs person-scoped data is not separated

Some spec fields belong to the **person forever** (name, gender, DOB, nationality, NIC, passport,
languages, emergency contact, medical/accessibility needs, portal account). Others belong to **one
journey** (seat, room, flight, visa, documents, payment position, readiness). Putting all of it on
one row is what forces re-entry and blocks rebooking. The plan splits them.

### F3 — Statuses do not exist

The spec's ten pilgrim statuses (`Pending Details … Completed`) have no column. Today a pilgrim has
`seat_status`, `visa_status`, `payment_status`, `room_assignment_status`, `flight_status` — five
axes and no single lifecycle. The spec is explicit: *do not use one generic "Active" status*.

### F4 — Payments are booking-level, not person-level

`departure_group_bookings` holds `total_booking_value` / `amount_paid` / `outstanding_balance` for
the **whole booking**. The spec's Payments tab shows *this pilgrim's* milestones. There is also **no
payment ledger table at all** — only running totals on the booking and a
`payment_schedule_snapshot` on the group's package snapshot. "Booking Deposit — Paid · 10 July" is
not reconstructable today.

### F5 — Medical / accessibility / support has nowhere to live

No table, no capability, no audit. The spec requires it to be optional, permission-controlled, and
audited on **view** as well as edit.

### F6 — Sensitive-field access is coarse

`viewSensitiveTravellerData` is one boolean covering passports, visa IDs and documents. The spec
needs finer separation: Finance sees money but **not** medical; Marketing sees neither passport nor
medical; Guide sees emergency/support instructions but no finance and no documents.

### F7 — Activity is group-scoped

`departure_group_activity_logs` is keyed on `departure_group_id`. A person's history across two
journeys cannot be assembled. The spec requires an **immutable** person timeline.

### F8 — Nothing for the portal

No portal account, no per-document `visible_in_portal` flag, no magic-link/token model, no
customer-safe projection.

---

## 3. Target architecture

### 3.1 The core split

```text
pilgrims                       ← THE PERSON. Stable id. Never cascade-deleted.
  └─ pilgrim_journeys          ← ONE ROW PER JOURNEY (renamed role of departure_group_pilgrims)
       ├─ documents            ← departure_group_pilgrim_documents (exists)
       ├─ visa record          ← columns on the journey row (exist)
       ├─ payment milestones   ← NEW pilgrim_payment_allocations, from the booking
       └─ room / flight        ← room_assignments + flight columns (exist)
```

**Decision: do not rename or drop `departure_group_pilgrims`.** It is referenced by seven tables, a
view, two RLS blocks and ~5,600 lines of data layer. Instead:

1. Create `public.pilgrims` (the person).
2. Backfill one `pilgrims` row per existing `departure_group_pilgrims` row.
3. Make `departure_group_pilgrims.pilgrim_id` **not null** with a real FK — turning it into the
   journey/enrolment row it always was.
4. Add a database view `public.pilgrim_journeys` that joins the two, so the new module reads one
   shape and the Departure Groups module keeps working untouched.

This is the lowest-risk path: zero changes to Departure Groups behaviour, one new FK, one new table.

### 3.2 Schema sketch

New migration: `supabase/migrations/20260813090000_create_pilgrims.sql`

```sql
-- ── A. The person ───────────────────────────────────────────────────────────
create table public.pilgrims (
  id                     uuid primary key default gen_random_uuid(),
  reference              text not null unique,              -- PL-YYYY-NNNN

  -- Identity
  full_name              text not null,
  preferred_name         text,
  gender                 text not null default 'MALE'
                           check (gender in ('MALE','FEMALE')),
  date_of_birth          date,
  nationality            text not null default 'Sri Lankan',
  national_id            text,                              -- NIC
  country_of_residence   text not null default 'Sri Lanka',
  city                   text not null default '',
  preferred_language     text not null default 'English',
  photo_path             text,                              -- private bucket object key

  -- Contact
  whatsapp_number        text not null,                     -- normalised, same rule as leads
  mobile_number          text,
  email                  text,
  preferred_channel      text not null default 'WHATSAPP'
                           check (preferred_channel in ('WHATSAPP','CALL','EMAIL','SMS','IN_PERSON')),

  -- Passport — the person's, not the journey's
  passport_number        text,
  passport_expiry        date,
  passport_issue_country text,

  -- Emergency contact
  emergency_contact_name         text,
  emergency_contact_relationship text,
  emergency_contact_phone        text,
  emergency_contact_alt_phone    text,

  -- Origin & portal
  origin_lead_id         uuid references public.leads (id) on delete set null,
  portal_user_id         uuid references auth.users (id) on delete set null,
  portal_invited_at      timestamptz,

  is_active              boolean not null default true,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create unique index pilgrims_passport_idx
  on public.pilgrims (upper(passport_number)) where passport_number is not null;
create index pilgrims_whatsapp_idx on public.pilgrims (whatsapp_number);
create index pilgrims_name_idx     on public.pilgrims (lower(full_name));

-- ── B. Medical / accessibility — separate table so it can be RLS'd separately ─
create table public.pilgrim_medical_records (
  pilgrim_id             uuid primary key references public.pilgrims (id) on delete cascade,
  mobility_support       boolean not null default false,
  wheelchair_required    boolean not null default false,
  dietary_requirement    text,
  allergy_information    text,
  medication_note        text,
  accessibility_note     text,
  special_assistance     text,
  updated_at             timestamptz not null default now(),
  updated_by             uuid references auth.users (id) on delete set null
);

-- ── C. Support requests ─────────────────────────────────────────────────────
create table public.pilgrim_support_requests (
  id                 uuid primary key default gen_random_uuid(),
  pilgrim_id         uuid not null references public.pilgrims (id) on delete cascade,
  departure_group_id uuid references public.departure_groups (id) on delete set null,
  title              text not null,
  detail             text,
  category           text not null default 'OTHER'
                       check (category in ('MOBILITY','MEDICAL','DIETARY','FLIGHT','ROOMING',
                                           'DOCUMENT','PAYMENT','OTHER')),
  priority           text not null default 'NORMAL'
                       check (priority in ('LOW','NORMAL','HIGH','URGENT')),
  status             text not null default 'OPEN'
                       check (status in ('OPEN','IN_PROGRESS','RESOLVED','CANCELLED')),
  assigned_role      text not null default 'OPERATIONS',
  raised_by_portal   boolean not null default false,
  created_at         timestamptz not null default now(),
  resolved_at        timestamptz
);

-- ── D. Person-level, append-only activity ───────────────────────────────────
create table public.pilgrim_activity_logs (
  id                  uuid primary key default gen_random_uuid(),
  pilgrim_id          uuid not null references public.pilgrims (id) on delete cascade,
  departure_group_id  uuid references public.departure_groups (id) on delete set null,
  actor_id            uuid references auth.users (id) on delete set null,
  actor_name_snapshot text not null default 'System',
  actor_role          text,
  action_type         text not null default '',
  entity_type         text not null default 'PILGRIM'
                        check (entity_type in ('PILGRIM','DOCUMENT','VISA','PAYMENT','ROOM',
                                               'FLIGHT','SUPPORT','MEDICAL','PORTAL','NOTE','STATUS')),
  entity_id           uuid,
  before_value        jsonb,
  after_value         jsonb,
  message             text not null default '',
  is_system           boolean not null default false,
  is_sensitive_access boolean not null default false,   -- F6: audit *views* of medical/passport
  created_at          timestamptz not null default now()
);
create index pilgrim_activity_idx on public.pilgrim_activity_logs (pilgrim_id, created_at desc);
-- Immutable: no update/delete policy is ever granted (see RLS below).

-- ── E. Per-person payment allocation & milestones (fixes F4) ────────────────
create table public.pilgrim_payment_milestones (
  id             uuid primary key default gen_random_uuid(),
  pilgrim_id     uuid not null references public.pilgrims (id) on delete cascade,
  booking_id     uuid not null references public.departure_group_bookings (id) on delete cascade,
  label          text not null,                       -- 'Booking Deposit', 'First Instalment', …
  sequence       integer not null default 0,
  amount         numeric(14,2) not null default 0 check (amount >= 0),
  due_at         timestamptz,
  paid_amount    numeric(14,2) not null default 0 check (paid_amount >= 0),
  paid_at        timestamptz,
  proof_path     text,                                 -- pilgrim-documents bucket
  recorded_by    uuid references auth.users (id) on delete set null,
  note           text,
  created_at     timestamptz not null default now(),
  constraint pilgrim_payment_milestones_seq unique (pilgrim_id, booking_id, sequence)
);
```

Then the enrolment link and the read view:

```sql
-- ── F. Turn departure_group_pilgrims into a true enrolment row ──────────────
-- Backfill first, then constrain. Ordering matters: the FK must not fire on
-- pre-existing rows before they have a person.
insert into public.pilgrims (reference, full_name, whatsapp_number, passport_number,
                             passport_expiry, passport_issue_country, date_of_birth,
                             emergency_contact_name, emergency_contact_phone,
                             emergency_contact_relationship)
select 'PL-' || to_char(now(),'YYYY') || '-' || lpad(row_number() over (order by p.id)::text, 4, '0'),
       nullif(p.full_name_snapshot,''), coalesce(p.phone_snapshot,''), p.passport_number_snapshot,
       p.passport_expiry, p.passport_issue_country, p.date_of_birth,
       p.emergency_contact_name, p.emergency_contact_phone, p.emergency_contact_relationship
from public.departure_group_pilgrims p
where p.pilgrim_id is null;
-- …then update departure_group_pilgrims.pilgrim_id to match, then:

alter table public.departure_group_pilgrims
  add constraint departure_group_pilgrims_pilgrim_fk
    foreign key (pilgrim_id) references public.pilgrims (id) on delete restrict;
-- `restrict`, not `cascade`: a person is never erased by a group being deleted.

-- Journey-lifecycle status (fixes F3), plus replacement audit trail
alter table public.departure_group_pilgrims
  add column if not exists journey_status text not null default 'PENDING_DETAILS'
    check (journey_status in ('PENDING_DETAILS','ONBOARDING','DOCUMENTS_PENDING','VISA_PROCESSING',
                              'PAYMENT_PENDING','PREPARING','READY_TO_TRAVEL','TRAVELLED',
                              'COMPLETED','CANCELLED')),
  add column if not exists relationship_to_primary text default 'SELF'
    check (relationship_to_primary in ('SELF','SPOUSE','CHILD','PARENT','SIBLING','OTHER')),
  add column if not exists replaced_by_pilgrim_id uuid references public.pilgrims (id) on delete set null,
  add column if not exists replaces_pilgrim_id    uuid references public.pilgrims (id) on delete set null,
  add column if not exists cancellation_reason    text,
  add column if not exists cancelled_at           timestamptz,
  add column if not exists moved_from_group_id    uuid references public.departure_groups (id) on delete set null;

-- Portal visibility per document (F8)
alter table public.departure_group_pilgrim_documents
  add column if not exists visible_in_portal boolean not null default true,
  add column if not exists expires_at        date,
  add column if not exists due_at            timestamptz;

-- ── G. The read shape the Pilgrims module consumes ──────────────────────────
create or replace view public.pilgrim_journey_rows as
select
  p.id  as pilgrim_id, p.reference, p.full_name, p.preferred_name, p.city, p.photo_path,
  p.whatsapp_number, p.passport_number, p.passport_expiry,
  e.id  as journey_id, e.journey_status, e.seat_status, e.flight_status, e.visa_status,
  e.payment_status, e.room_assignment_status, e.room_id,
  e.documents_completed, e.documents_required, e.document_completion_percent,
  e.relationship_to_primary,
  b.id  as booking_id, b.booking_reference, b.primary_contact_name,
  b.total_booking_value, b.amount_paid, b.outstanding_balance, b.next_due_at,
  g.id  as departure_group_id, g.group_name, g.journey_type, g.departure_date,
  g.return_date, g.branch, g.assigned_guide_name
from public.pilgrims p
join public.departure_group_pilgrims e on e.pilgrim_id = p.id
join public.departure_group_bookings  b on b.id = e.booking_id
join public.departure_groups          g on g.id = e.departure_group_id;
```

> Column names on `departure_groups` (`group_name`, `branch`, `assigned_guide_name`) must be
> confirmed against `…create_departure_groups.sql` when writing the migration.

**RLS.** Same posture as every existing table — `enable row level security`, authenticated read and
write — with two deliberate exceptions:

- `pilgrim_activity_logs`: **insert + select only**. No update, no delete policy is created, which
  is what makes the timeline immutable at the database level rather than by convention.
- `pilgrim_medical_records`: reads gated once real role claims exist. Until then, the application
  layer (`lib/access/pilgrims-access.ts`) is the gate, exactly as
  `departure-groups-access.ts` documents for supplier costs today.

### 3.3 Data layer — mirror the existing shape exactly

```text
lib/types/pilgrims.ts               snake_case row types (mirrors lib/types/leads.ts)
lib/data/pilgrims.ts                view models + PURE mutators returning { ok, error }
lib/data/pilgrims-repository.ts     load / persist by diff (mirrors leads-repository.ts)
lib/data/pilgrims-readiness.ts      journey_status derivation + next-actions engine
lib/data/pilgrims-payments.ts       milestone expansion from the booking's payment schedule
lib/data/pilgrims-ids.ts            nextPilgrimReference() → PL-YYYY-NNNN (from max, not random)
lib/access/pilgrims-access.ts       PilgrimCapabilities per StaffRole
lib/validations/pilgrims.ts         zod schemas for every action input
```

The non-negotiable conventions carried over from Leads and Departure Groups:

- **Pure mutators over a loaded store**, so they lift into Server Actions unchanged, and the
  repository writes back only the diff.
- **Derived, never stored**, for anything time-relative: readiness, "days remaining", overdue. Use
  the existing `colomboDayDiff` / `colomboDayKey` helpers so server render and hydration agree.
- **`nowIso` serialised by the Server Component** and threaded down, as `leads/page.tsx` does.
- **Capabilities decide what is fetched, not just rendered.** Medical notes, passport numbers and
  money are nulled in the repository for roles without the capability — they never reach the client.
- **`newId()` in the application**, so a pilgrim and its child rows flush in one write.

**`journey_status` is derived, then persisted** (a hybrid, deliberately). It is computed by
`derivePilgrimJourneyStatus()` from documents / visa / payment / rooming, but written to the column
so the list can filter and index on it. It is recomputed inside the same `syncPilgrimDerivedState()`
call that already recomputes document counters — one place, already called from every mutator.

Precedence (first match wins):

```text
CANCELLED        seat_status = CANCELLED
COMPLETED        return date passed and no open items
TRAVELLED        departure date passed
READY_TO_TRAVEL  documents complete + visa APPROVED + paid in full + room + ticket
PREPARING        visa APPROVED + paid, awaiting room/ticket
PAYMENT_PENDING  visa APPROVED but balance outstanding
VISA_PROCESSING  visa SUBMITTED / UNDER_REVIEW / REWORK_REQUIRED
DOCUMENTS_PENDING required documents outstanding
ONBOARDING       personal details complete, documents not started
PENDING_DETAILS  default — created from a booking, nothing filled in
```

### 3.4 Capability matrix (`lib/access/pilgrims-access.ts`)

Fixes F6 by splitting the one `viewSensitiveTravellerData` boolean.

| Capability | ADMIN | CEO | FINANCE | MARKETING | OPERATIONS | VISA | GUIDE |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| `viewModule` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `createPilgrim` | ✓ | — | — | — | ✓ | — | — |
| `editPersonalDetails` | ✓ | — | — | ✓¹ | ✓ | ✓ | — |
| `viewPassportAndIdentity` | ✓ | ✓ | — | — | ✓ | ✓ | — |
| `viewDocuments` / `uploadDocuments` | ✓ | ✓/— | — | — | ✓ | ✓ | — |
| `verifyDocuments` | ✓ | — | — | — | ✓ | ✓ | — |
| `manageVisa` | ✓ | — | — | — | — | ✓ | — |
| `viewPayments` | ✓ | ✓ | ✓ | — | — | — | — |
| `recordPayments` / `requestRefund` | ✓ | — | ✓ | — | — | — | — |
| `manageTravelAndRooming` | ✓ | — | — | — | ✓ | — | — |
| `viewMedical` | ✓ | — | — | — | ✓ | — | ✓² |
| `editMedical` | ✓ | — | — | — | ✓ | — | — |
| `manageSupportRequests` | ✓ | — | — | — | ✓ | — | ✓² |
| `viewEmergencyContact` | ✓ | ✓ | — | — | ✓ | ✓ | ✓ |
| `sendCommunications` | ✓ | — | ✓³ | ✓ | ✓ | ✓ | ✓² |
| `moveGroup` / `cancelOrReplace` | ✓ | — | — | — | ✓ | — | — |
| `managePortalAccess` | ✓ | — | — | — | ✓ | — | — |
| `exportPilgrims` | ✓ | ✓ | ✓³ | — | ✓ | ✓ | — |
| `assignedGroupOnly` | — | — | — | — | — | — | ✓ |

¹ Marketing edits contact/communication fields only — never passport, medical or payment.
² Guide: assigned group only, and medical is reduced to a **practical instruction string**
(`"Wheelchair at airport"`), never the underlying medication or diagnosis notes.
³ Finance: payment-related only.

Two rules the capability layer must enforce beyond a boolean:

- **`viewMedical` writes an audit row.** Every read of `pilgrim_medical_records` inserts a
  `pilgrim_activity_logs` row with `is_sensitive_access = true`. The spec asks for "who viewed or
  edited"; viewing is the half that is normally forgotten.
- **Guide scoping is a query filter, not a UI filter** — `assignedGroupOnly` restricts the
  repository's `where`, matching how `canRoleOpenGroup()` already works for Departure Groups.

---

## 4. Screens

### 4.1 List — `/pilgrims`

Files, mirroring `app/(main)/leads/` one-for-one:

```text
app/(main)/pilgrims/page.tsx                     Server Component, force-dynamic, resolves role
app/(main)/pilgrims/pilgrims-store.tsx           Context provider + Server Action callers
app/(main)/pilgrims/types.ts                     Saved views, filters, KPI shape, form shapes
app/(main)/pilgrims/utils.ts                     Labels, tones, formatters, sort, filter, KPIs
app/(main)/pilgrims/actions.ts                   "use server" — every mutation
app/(main)/pilgrims/csv.ts                       Export (role-aware column set)
app/(main)/pilgrims/components/pilgrims-list.tsx Header + KPIs + views + filters + table
app/(main)/pilgrims/components/pilgrims-metrics.tsx  KpiRow of KpiCard, each a quick filter
app/(main)/pilgrims/pilgrims-table/pilgrims-columns.tsx
app/(main)/pilgrims/pilgrims-table/pilgrims-data-table.tsx
app/(main)/pilgrims/pilgrims-table/pilgrim-table-sorting.tsx
```

- **Header** — `PageHeader` with breadcrumb `Home > Pilgrims`, subtitle from the spec, and actions
  `[+ Add Pilgrim] [Import Pilgrims] [More ▾]`. Add Pilgrim is capability-gated and carries a
  one-line note that most pilgrims arrive from a Booking.
- **KPIs** — five `KpiCard`s in a `KpiRow`: Active Pilgrims, Documents Pending, Visa Issues,
  Payment Attention, Ready to Travel. Each sets a quick filter on click, exactly as
  `leads-metrics.tsx` does with its `QuickFilter` type. `KpiRow` is `lg:grid-cols-4`; the fifth card
  wraps — acceptable, or pass a `className` override at the call site.
- **Saved views** — `SavedViewBar` with the eleven views from the spec.
- **Filters** — `FilterSelect` chips: Departure Group, Journey Type, Document Status, Visa Status,
  Payment Status, Readiness, Room Assignment, Flight/Ticket, Branch, and a `More Filters` toggle
  revealing the rest (the `showMoreFilters` pattern from `leads-list.tsx`).
- **Search** — one box over name, passport number, WhatsApp, email, pilgrim reference. Wrap the
  input in `useDeferredValue`, as Leads does, so typing stays responsive.
- **Columns** — the ten from the spec, built with `ToneBadge` + `ProgressBar` + `PersonChip`. The
  Documents cell is `6 / 8` plus a `ProgressBar` toned by `percentTone()`.
- **Row click** → navigates to `/pilgrims/[pilgrimId]`, not a drawer. The spec is explicit that a
  drawer alone is insufficient. Keep a lightweight peek drawer behind the ⋯ menu only.

### 4.2 Profile — `/pilgrims/[pilgrimId]`

Shell copied from `departure-group-detail.tsx`: identity header, readiness strip, `Tabs` from
`components/animate-ui`, one file per tab.

```text
app/(main)/pilgrims/[pilgrimId]/page.tsx
app/(main)/pilgrims/[pilgrimId]/components/pilgrim-detail.tsx
app/(main)/pilgrims/[pilgrimId]/components/tabs/{overview,personal,documents,visa,
                                                  payments,travel,support,activity}-tab.tsx
app/(main)/pilgrims/[pilgrimId]/components/*-dialog.tsx   (actions, see §4.3)
```

- The page resolves `?tab=` from `searchParams` (same deep-link pattern as the group page) so KPI
  cards and next-actions can link straight to `?tab=documents`.
- `visibleTabsFor(role)` hides whole tabs a role may not see (Payments for Operations, Support for
  Finance), and `PermissionDenied` covers partial sections inside a visible tab.
- **Readiness strip** — four `Card`s: Documents / Visa / Payments / Travel Setup, each a value line
  plus a `ToneBadge`. Clicking one jumps to its tab.
- **Next actions** (Overview) — generated by `lib/data/pilgrims-readiness.ts`, each with a tone dot,
  due date and a single primary button wired to the matching action. This is the feature that makes
  the module *operational* rather than a form; it deserves its own reviewed rules table.

Tab-by-tab mapping to existing work:

| Tab | Built from |
|---|---|
| Overview | New. Five summary `Card`s + next-actions list + journey info |
| Personal & Contact | New form, using `input-form-card.tsx` / `input-form-header.tsx` from the Add-Lead sheet |
| Documents | Generalise `pilgrim-documents-drawer.tsx`; add status filter bar and the extra metadata columns |
| Visa | New. Status flow, visa fields, timeline from `pilgrim_activity_logs` filtered to `VISA` |
| Payments | New. Reads `pilgrim_payment_milestones` + booking totals. Never duplicates an invoice |
| Travel & Rooming | Reads existing flight/room tables; reuses `assign-room-dialog.tsx` |
| Support & Medical | New. Capability-gated; every render logs a sensitive-access row |
| Activity | New, but structurally identical to `tabs/activity-tab.tsx` |

### 4.3 Actions inventory

Each is a Server Action in `app/(main)/pilgrims/actions.ts`, zod-validated, re-authenticated,
re-role-checked (a Server Action is a public POST endpoint regardless of caller), and each writes a
`pilgrim_activity_logs` row.

| Action | Notes |
|---|---|
| `createPilgrimAction` | Manual creation; duplicate check on passport + WhatsApp |
| `updatePersonalDetailsAction` | Field-level capability check |
| `requestDocumentAction` | Composes the WhatsApp message; does not send silently |
| `uploadDocumentOnBehalfAction` | Reuses `document-storage.ts` signed-URL flow verbatim |
| `verifyDocumentAction` / `rejectDocumentAction` | Rejection requires a reason (DB constraint) |
| `markDocumentNotRequiredAction` | Recomputes counters via `syncPilgrimDerivedState` |
| `updateVisaStatusAction` | Enforces the legal transitions of the visa flow |
| `recordPaymentAction` / `uploadPaymentProofAction` | Uses `money()` + `derivePaymentStatus()` |
| `assignRoomAction` | Delegates to the existing rooming mutators |
| `createSupportRequestAction` / `updateSupportRequestAction` | |
| `updateMedicalRecordAction` | Audited |
| `movePilgrimToGroupAction` | Releases the old seat/room, copies the checklist to the new group's snapshot, records `moved_from_group_id` |
| `cancelPilgrimAction` | The seven-step cascade below |
| `replacePilgrimAction` | New person, links both ways, **never deletes the original** |
| `invitePortalAccessAction` | |

**Cancel / replace cascade** — the spec's ordering, implemented as one pure mutator so it either
fully applies or not at all:

```text
seat → CANCELLED · flight_status → CANCELLED · release room + decrement room count
· visa record → CANCELLED · return seat to group availability · recompute booking money
· log to both pilgrim and group activity · optionally promote a waitlisted pilgrim
```

### 4.4 Portal — `/portal` (phase 9, separate route group)

`app/(portal)/…`, its own layout, its own capability set (`PILGRIM`), reading only a **customer-safe
projection** built server-side: readiness, own documents where `visible_in_portal`, own payment
schedule, itinerary, guide contact. Supplier costs, internal notes, other pilgrims and the full
rooming list are never in the payload — filtered in the repository, not hidden in the UI.

---

## 5. Build phases

Following the spec's own build order.

| Phase | Scope | Depends on |
|---|---|---|
| **0. Foundation** | Migration §3.2, backfill, `lib/types/pilgrims.ts`, repository, access layer, validations, `pilgrims-ids.ts` | — |
| **1. List** | `/pilgrims` list to spec: KPIs, views, filters, columns, CSV export | 0 |
| **2. Auto-creation from Booking** | Extend `createGroupBooking` to upsert a `pilgrims` row per traveller (match on passport/WhatsApp before creating, so repeat travellers reuse their record) | 0 |
| **3. Profile shell + Overview + Personal** | Detail route, tabs, readiness strip, next-actions engine | 1, 2 |
| **4. Documents** | Generalise the existing drawer; add portal visibility, due dates, expiry, history | 3 |
| **5. Payments** | `pilgrim_payment_milestones`, expansion from the booking's payment schedule, record/proof/reminder | 3 |
| **6. Visa** | Status flow, officer assignment, timeline, the eight visa actions | 4 |
| **7. Travel & Rooming** | Flights, PNR, seat, rooming, group logistics — mostly read-through with two write actions | 3 |
| **8. Support & Medical** | Tables, capability gates, sensitive-access audit | 3 |
| **9. Portal** | `(portal)` route group, magic-link access, customer-safe projection | 4, 5, 6, 7 |
| **10. AI Document Agent** | Suggestion-only: never sets `VERIFIED` without a staff approval — enforced in the mutator, not the prompt | 4 |

Phases 4–8 are independent of each other once 3 lands and can be parallelised.

---

## 6. Decisions and risks

| # | Decision | Rationale / risk |
|---|---|---|
| D1 | New `pilgrims` table rather than reshaping `departure_group_pilgrims` | The existing table is referenced by 7 tables and ~5,600 lines. The FK placeholder was designed for this. Risk: the backfill must run before the FK is added, and `full_name_snapshot` may be empty on old rows — those need a manual reconciliation pass |
| D2 | `on delete restrict` on the person FK | A group deletion must never erase a person. Risk: deleting a test group now fails loudly. That is the intent |
| D3 | `journey_status` derived **and** persisted | Pure derivation cannot be indexed or filtered at the database. Risk: drift — mitigated by computing it in exactly one function called from `syncPilgrimDerivedState` |
| D4 | Payment milestones are person-level rows derived from the booking | Fixes F4 without duplicating invoices. **Open question:** how is a booking's total split across a family of four — equally, or by room type? Equal split is the assumed default and must be confirmed |
| D5 | Medical in its own table | Enables separate RLS later without a column-level policy today |
| D6 | Activity log is append-only by omitting update/delete policies | Immutability enforced by the database, not by convention |
| D7 | No new shared components | Everything the spec draws exists in `components/`. New work is composition only |
| D8 | Portal deferred to phase 9 | It needs documents, payments, visa and travel to be real first. Its auth model (magic link vs `auth.users` row) is an open decision |
| R1 | **Duplicate people.** Passport-based dedupe fails for infants and for passports renewed between journeys | Add a soft-match review queue (name + DOB + WhatsApp), reusing the Leads duplicate-review pattern |
| R2 | **`getCurrentStaffRole()` defaults everyone to ADMIN.** Every access decision in this module routes through it, but until a profiles table exists the matrix in §3.4 is unenforced in practice | Not introduced by this module, but this module is the one that makes it dangerous — it is where passports and medical notes live. **Recommend landing a staff-roles table before phase 8** |
| R3 | Guides get their own portal-ish surface | Out of scope here; the `assignedGroupOnly` + reduced-medical rules are specified so it can be added without a schema change |

---

## 7. Suggested sequencing

1. **Phase 0 + 2 together.** The migration and auto-creation from Booking are one coherent change:
   without phase 2 the new table is empty, and without phase 0 there is nothing to fill.
2. **Phase 1.** The list is immediately useful on its own and validates the view shape.
3. **Phase 3.** Profile shell — this is where the module starts replacing WhatsApp and paper.
4. **Phases 4, 5, 6, 7 in parallel** if more than one person is working.
5. **Staff-roles table** (R2) before phase 8.
6. **Phases 8, 9, 10.**
