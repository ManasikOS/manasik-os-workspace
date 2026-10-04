# Visa Module — Implementation Plan

Build **Visa Operations** at `/visa` on the same data, access and action architecture already used by
**Packages**, **Departure Groups**, **Leads**, **Pilgrims** and **Documents**.

Status: **plan only. Nothing in here is implemented.**

The product rule the whole plan enforces:

> **Documents answers "is the file valid?". Visa answers "can this pilgrim legally travel, and what
> must the Visa team do next?". The Visa team works in batches by group, never one profile at a
> time. Staff record every decision and its evidence — the system never asserts a visa is valid on
> its own.**

And the chain it sits in:

```text
Package Template (declares the requirement)
  → Departure Group (freezes it into a snapshot)
    → Pilgrim enrolment (expands one document row per requirement)
      → Documents Operations (verifies each file)
        → Visa Operations (batches verified files into applications, tracks them to issue)
          → Departure Group readiness (whether the group may legally travel)
```

---

## 1. What exists today

### 1.1 The route

| File | State |
|---|---|
| `app/(main)/visa/` | **Does not exist.** |
| [components/app-sidebar.tsx:71](components/app-sidebar.tsx:71) | Nav entry `Visa → /visa`, already inside the sidebar's **Operations** group (`adminBar[2]`, beside Documents and Operations). **It currently 404s.** |
| [lib/data/admin-dashboard-data.ts:156](lib/data/admin-dashboard-data.ts:156) | Dashboard tiles already deep-link to `/visas?filter=action_required`, `/visas?filter=ready_submit`, `/visas?filter=rejected`, `/visas/group/AUG-UMR-04` — note the **plural**, which does not match the sidebar. Both must converge on one route. |

### 1.2 What already exists elsewhere and is the real starting point

This is emphatically **not** a greenfield module. The visa *state machine*, its *transitions*, its
*readiness derivation* and its *per-group and per-pilgrim UI* are all built and working. What is
missing is the **cross-group, batch-oriented operational surface** on top of them, and the
application-level facts (owner, reference, batch, issue details) the spec requires.

| Concern | Where it already lives | Notes |
|---|---|---|
| Visa status enum | `departure_group_pilgrims.visa_status` ([20260809090000:348](supabase/migrations/20260809090000_create_departure_groups.sql:348)) | `NOT_STARTED · DOCUMENTS_PENDING · READY_TO_SUBMIT · SUBMITTED · UNDER_REVIEW · APPROVED · REJECTED · REWORK_REQUIRED` — **the spec's lifecycle, already in the database, already indexed** (`departure_group_pilgrims_visa_idx`) |
| Visa decision columns | same table + [20260811090000:130](supabase/migrations/20260811090000_departure_groups_documents_lifecycle.sql:130) | `visa_submitted_at`, `visa_reviewed_at`, `visa_rejected_at`, `visa_rejection_reason`, `visa_id`, `visa_issue_note`, `visa_file_path`, `visa_expiry_date` |
| **Readiness derivation** | `derivePreSubmissionVisaStatus()` + `syncPilgrimDerivedState()` ([lib/data/departure-groups-documents.ts:246](lib/data/departure-groups-documents.ts:246), `:291`) | Auto-computes `NOT_STARTED → DOCUMENTS_PENDING → READY_TO_SUBMIT` from the pilgrim's document rows (gating stages `ON_BOOKING` + `BEFORE_VISA_SUBMISSION`) **plus the passport six-month rule**. Auto-sets `REWORK_REQUIRED` when a required document is rejected on a lodged file. This *is* the spec's "Application Readiness" engine |
| Passport validity rule | `checkPassportValidity()` (`…-documents.ts:78`), `PASSPORT_VALIDITY_MONTHS = 6` | Measured against the group's **return** date, not departure |
| "Why isn't this submittable?" | `outstandingSummary()` (`…-documents.ts:1034`) | Returns the passport reason, or the first two outstanding requirement names. Feeds the spec's blocker text directly |
| Bulk submit | `markApplicationsSubmittedInStore()` (`…-documents.ts:931`) | Already returns `{ submittedCount, skipped: { fullName, reason }[] }` — the exact shape the batch screen needs |
| Under review | `markVisaUnderReviewInStore()` (`…-documents.ts:1076`) | Guards: only `SUBMITTED` may move |
| Record issued visa | `uploadPilgrimVisaInStore()` (`…-documents.ts:1134`) | Takes visa number, file path, expiry, note. Guards: not already `APPROVED`, must be `SUBMITTED`/`UNDER_REVIEW`/`REJECTED`, expiry must not precede the group's return date |
| Record refusal | `rejectPilgrimVisaInStore()` (`…-documents.ts:1233`) | Reason mandatory; `canReapply` splits `REWORK_REQUIRED` from terminal `REJECTED` |
| Server wrappers | [lib/data/departure-groups.ts](lib/data/departure-groups.ts) `:2243`–`:2283` | `markGroupApplicationsSubmitted`, `markGroupVisasUnderReview`, `uploadGroupPilgrimVisa`, `rejectGroupPilgrimVisa` |
| Server Actions | [app/(main)/departure-groups/actions.ts:1676](app/(main)/departure-groups/actions.ts:1676)–`1795` | All four, gated on `manageDocumentsAndVisa`, validated by `lib/validations/departure-groups.ts` |
| Group-scoped visa queue | [documents-visa-tab.tsx](app/(main)/departure-groups/[groupId]/components/tabs/documents-visa-tab.tsx) (615 lines) | Subtabs incl. **Visa Queue**, plus export. One group only |
| Per-pilgrim visa UI | [visa-tab.tsx](app/(main)/pilgrims/[pilgrimId]/components/tabs/visa-tab.tsx) (263 lines) | Status card + Record Submission / Mark Under Review / Mark Approved / Request Rework dialogs |
| Group visa readiness | `VISAS_ALL_APPROVED` auto-rule ([lib/data/departure-groups-readiness.ts:199](lib/data/departure-groups-readiness.ts:199)) | `BLOCKED` on any `REJECTED`, `AT_RISK` on any `REWORK_REQUIRED`, `COMPLETE` when all `APPROVED` |
| Labels + tones | `VISA_STATUS_LABELS`, `visaTone()` ([app/(main)/departure-groups/utils.ts:108](app/(main)/departure-groups/utils.ts:108), `:341`) | Already mapped onto the shared `Tone` scale |
| Secure storage | [app/(main)/departure-groups/document-storage.ts](app/(main)/departure-groups/document-storage.ts) | Private `pilgrim-documents` bucket, one-shot signed upload URL, 120-second signed download, 10 MB cap, MIME allowlist, server-composed object key. `visa_file_path` already points into it |
| Cross-group read shape precedent | `document_queue_rows` ([20260814090000:157](supabase/migrations/20260814090000_documents_operations.sql:157)), `pilgrim_journey_rows` ([20260813090000:266](supabase/migrations/20260813090000_create_pilgrims.sql:266)) | The two views this module's own view is modelled on |
| Group visa owner | `departure_groups.visa_owner_id` / `visa_owner_name` ([20260809090000:63](supabase/migrations/20260809090000_create_departure_groups.sql:63)) | A **group**-level owner, editable in `edit-group-details-sheet.tsx` |

### 1.3 The UI vocabulary to reuse — no new components

Everything the spec draws already has a component. **This plan adds zero files under
`components/`.** New work is composition only.

| Spec element | Existing component |
|---|---|
| Breadcrumb + title + subtitle + actions | `components/page-header.tsx` |
| KPI cards row | `components/data-table/kpi-card.tsx` — `KpiCard`, `KpiRow` |
| Queue tabs / saved views | `components/data-table/saved-view-bar.tsx` — `SavedViewBar` |
| Filter chips | `components/data-table/filter-select.tsx` — `FilterSelect`, `ALL_FILTER_VALUE` |
| Table shell + search + pagination + **row selection and bulk bar** | copy `app/(main)/documents/documents-table/documents-data-table.tsx` → `visa-table/visa-data-table.tsx`. The shared `components/data-table/data-table.tsx` deliberately has **no** selection support; Documents forked it for exactly this reason |
| Sortable headers | `components/data-table/sortable-header.tsx` |
| Status badges, progress bars, officer chips, empty/denied states | `components/ui/tone-badge.tsx` — `ToneBadge`, `ProgressBar`, `PersonChip`, `EmptyState`, `PermissionDenied` |
| Colour vocabulary | `lib/ui/tone.ts` + the existing `visaTone()` |
| Application drawer | `components/ui/sheet.tsx` (wide right-side Sheet, `sm:max-w-4xl`) |
| Batch creation, decision and reason dialogs | `components/ui/dialog.tsx`, `dialog-footer.tsx`, `input.tsx`, `textarea.tsx`, `checkbox.tsx`, `calendar.tsx`/`popover.tsx` for dates |
| Section headers inside cards | `components/section-heading.tsx` |
| Batch/bulk menus | `components/ui/dropdown-menu.tsx`, `button-group.tsx` |
| Feedback | `components/ui/toast.tsx` — `toast.add(...)` |
| Form reset on open | `hooks/use-reset-on-open.ts` |

The spec's status colours map one-to-one onto `visaTone()` as it already stands — **no new palette,
and no re-declaration of the mapping**:

```text
neutral   Not Started
warning   Documents Pending · Expiring Soon · pending near deadline
info      Ready to Submit · Submitted · Under Review
danger    Rejected · Rework Required · Expired
success   Approved / Issued (staff-verified)
```

Two existing screens are close enough to **lift and generalise** rather than rewrite:

- `documents-visa-tab.tsx` already slices one group's manifest into named visa queues with export.
  Its subtab predicates are the seed of the work-queue tabs, widened from one group to all groups.
- `pilgrims/.../visa-tab.tsx` already contains the four decision flows and their dialogs. Its
  approve/reject dialogs become the drawer's Issue and Resolution sections, extended with the
  fields §2/F6 adds.

---

## 2. Findings — the gap between today and the specification

### F1 — The route does not exist, and two callers disagree on its name

The sidebar links `/visa`; the dashboard links `/visas?filter=…` and `/visas/group/:code`. Neither
resolves. Whatever is built must satisfy both, or the dashboard links must be updated in the same
change. **This is a one-line-per-caller fix that will be forgotten if it is not written down now.**

### F2 — There is no cross-group visa query. This is the blocking defect.

Every visa read in the codebase is scoped to one group (`documents-visa-tab`, via the group manifest)
or one person (`visa-tab`, via `pilgrim_journey_rows` filtered to a pilgrim). There is **no query
that answers "every open visa application across every active group"**. Every KPI, every queue tab,
the batch builder and the group board need exactly that. This is the first thing the plan lands.

`pilgrim_journey_rows` is close but insufficient: it carries `visa_status` and `visa_submitted_at`
only — not `visa_id`, `visa_expiry_date`, `visa_rejection_reason`, `visa_file_path` or
`visa_reviewed_at` — and it is read by the Pilgrims module, so widening it changes another module's
payload. A dedicated view is the right call (D2).

### F3 — A visa application has no owner

`departure_groups.visa_owner_name` names an owner for the **whole group**. The spec's **Assigned
Officer** column, the *My Visa Queue* saved view, the batch **Submission owner** field and
*Assign/reassign officer* all address one application. Nothing today can express "S. Rizna owns
these 27 applications; N. Farhan owns the other 5."

### F4 — There is no application reference

The spec shows `Application: UM-2026-38219` — the reference the file was lodged under, entered
manually because there is no portal integration. `visa_id` is the **issued visa number**, written at
approval time; using it for both loses the ability to search for a lodged-but-undecided application,
which is the single most common Visa-team lookup.

### F5 — There is no submission batch. The spec's most important Visa-only capability has no schema.

No table, no column, no grouping concept. "Create Visa Batch", "Batch 02", batch counts, batch
deadline, "Export Submission Pack", "Mark all selected as submitted", "Send batch reminder" and the
**Submission Batch** filter are all unrepresentable. `markApplicationsSubmittedInStore` already takes
`pilgrimIds[]`, so the *action* exists — what is missing is the durable object that remembers which
pilgrims went out together, under whose name, against which deadline.

### F6 — The issued-visa record is thinner than the spec, and asserts validity it has not verified

| Spec field | Today |
|---|---|
| Visa Number | ✓ `visa_id` |
| Issue Date | ✗ |
| Expiry Date | ✓ `visa_expiry_date` |
| Entry Type (single/multiple) | ✗ |
| Valid Until | ✗ (distinct from expiry: last date of entry vs end of stay) |
| Visa PDF | ✓ `visa_file_path` |
| **Staff Verification** ("Mark Issued & Verified") | ✗ |

Worse, `uploadPilgrimVisaInStore()` sets `visa_status = 'APPROVED'` the instant a number is typed.
The spec is explicit: *"Do not automatically claim that uploaded visa details are valid. Let staff
record the source, upload evidence, and mark verification."* Recording and verifying must be two
steps.

### F7 — Visa type does not exist as a concept

`journey_type` (`UMRAH · HAJJ · EARLY_REGISTRATION`) lives on the **group** and describes the
journey, not the visa. The spec wants a **Visa Type** filter and column, configurable by season and
agency, explicitly warning against hardcoding one permanent checklist. A group can also carry
applications of more than one visa type (e.g. a family on a different nationality route).

### F8 — Nothing records when a status was last checked

The spec asks for a "Status checked on" timestamp, a *Submitted but Unresolved* saved view, and an AI
rule "applications with no status update for X days". There is no column for either the check or the
last movement, and `visa_submitted_at` alone cannot distinguish "lodged yesterday" from "lodged three
weeks ago and chased twice".

### F9 — There is no expiry or validity-risk state

The spec's alternative path `Approved → Expiring Soon → Expired` has no representation.
`visa_expiry_date` exists and is validated once at issue (must not precede the group's return date),
but nothing derives an ongoing risk from it, and the **Expiring / Validity Risk** tab has no source.

### F10 — There is no visa audit trail queryable per application

Visa transitions push into `departure_group_activity` with `entity_type = 'VISA'` — group-scoped,
mixed in with flights, rooms and payments, and only `uploadPilgrimVisaInStore` /
`rejectPilgrimVisaInStore` set `entity_id` to the pilgrim at all (the two bulk mutators leave it
`null`). The drawer's **Visa Timeline** cannot be built from it. Documents solved the identical
problem with the append-only `document_review_events` table; Visa needs its counterpart.

### F11 — Every threshold the spec insists be configurable is currently a literal

`PASSPORT_VALIDITY_MONTHS = 6` sits in `departure-groups-documents.ts`; the 21/14/7-day document
offsets sit in `documents-copy.ts`. There is no place at all for the visa-specific thresholds the
spec calls out — submission lead time, "departing soon" window, validity-risk window, no-update
chase interval — and the spec explicitly forbids a rigid "issued exactly seven days before
departure" rule.

### F12 — The role model does not match the spec's Visa matrix

`capabilitiesFor()` grants `manageDocumentsAndVisa` to ADMIN, OPERATIONS and VISA, which is close.
But the spec is finer-grained and, in two places, **more restrictive than what the code allows
today**:

- **Finance** — "View payment-related blockers only; no passport/visa details by default." Today
  Finance has `viewSensitiveTravellerData: false` but would still see visa numbers if a Visa page
  simply rendered the row.
- **Marketing** — high-level "visa pending" only.
- **Guide** — approved travel readiness for their assigned group, no visa file access.
- **Pilgrim** — is not a `StaffRole` at all. The customer-facing row of the spec's table belongs to
  the deferred `(portal)` route group, exactly as the Documents plan deferred its portal projection.

### F13 — `getCurrentStaffRole()` defaults everyone to ADMIN

[lib/data/departure-groups.ts:256](lib/data/departure-groups.ts:256) reads
`user_metadata.staff_role` and falls back to `ADMIN`. Carried over as R1 from the Pilgrims and
Documents plans. **This module is where visa numbers and passport numbers are exported together in a
submission pack**, so it is the module where that default costs the most.

### F14 — The issued visa PDF is not a document record

`visa_file_path` is a raw bucket path on the enrolment row. The Documents module has a `VISA_COPY`
`document_type` and nothing writes it. So the issued visa is invisible to the Documents queue, has no
AI check, no verification event and no expiry tracking of the kind every other document now gets.

### F15 — An issued visa cannot be corrected

`uploadPilgrimVisaInStore()` refuses when `visa_status === 'APPROVED'` ("already has an issued visa
on file"). A typo in a visa number, a re-issued visa, or a corrected expiry date is unrecordable
without a database edit.

### F16 — Cancelled seats and cancelled groups must be excluded at the query

`cancelGroupBooking` resets `visa_status` to `NOT_STARTED` for anyone not yet `APPROVED`
([departure-groups-bookings.ts:1104](lib/data/departure-groups-bookings.ts:1104)) — but an
**approved** visa on a cancelled seat stays `APPROVED` by design. Without a `where` clause it would
inflate the Issued KPI and every group readiness percentage. Both `document_queue_rows` and this
module's view must filter `seat_status <> 'CANCELLED'` and `group_status <> 'CANCELLED'`.

---

## 3. Target architecture

### 3.1 Route

**Decision: `/visa`.** The spec names `/operations/visa`, but there is no `app/(main)/operations/`
route group, the sidebar already points at `/visa`, and the breadcrumb is what communicates the
hierarchy. Same call the Documents plan made (D1).

```text
app/(main)/visa/                             →  Home > Operations > Visa
```

Two consequences to land in the same change:

- Update the three dashboard deep links from `/visas?filter=…` to `/visa?view=…` (or add
  `app/(main)/visas/page.tsx` as a `redirect("/visa")`). Support the `view` and `group` search
  params on the page so those links open a pre-filtered queue rather than the default view.
- If `/operations/*` is ever built out, add `app/(main)/operations/visa/page.tsx` as a redirect
  rather than moving the module.

### 3.2 Schema

New migration: `supabase/migrations/20260815090000_visa_operations.sql`

**A. Give the application an identity, an owner, a reference, a batch and real issue details**
(fixes F3, F4, F6, F7, F8):

```sql
alter table public.departure_group_pilgrims
  -- F7: the visa being applied for, distinct from the group's journey_type.
  -- Free text against a configured catalogue, not a check constraint — the
  -- spec requires this to change by season and agency without a migration.
  add column if not exists visa_type                  text,
  -- F4: the reference the file was lodged under. Manual entry; no portal
  -- integration is claimed anywhere in this module.
  add column if not exists visa_application_reference text,
  -- F3: the officer who owns this application, not the group.
  add column if not exists visa_assigned_to           uuid references auth.users (id) on delete set null,
  add column if not exists visa_assigned_to_name      text,
  add column if not exists visa_assigned_at           timestamptz,
  -- F5: the batch this application went out in.
  add column if not exists visa_batch_id              uuid,
  -- F6: the issue record the spec asks for.
  add column if not exists visa_issue_date            date,
  add column if not exists visa_entry_type            text
    check (visa_entry_type is null or visa_entry_type in ('SINGLE','MULTIPLE')),
  add column if not exists visa_valid_until           date,
  -- F6: recording is not verifying.
  add column if not exists visa_verified_at           timestamptz,
  add column if not exists visa_verified_by           uuid references auth.users (id) on delete set null,
  add column if not exists visa_verified_by_name      text,
  add column if not exists visa_evidence_source       text,   -- 'PORTAL_SCREENSHOT' | 'AGENT_EMAIL' | 'PDF' | 'OTHER'
  -- F8: chase tracking.
  add column if not exists visa_status_checked_at     timestamptz,
  add column if not exists visa_last_update_at        timestamptz,
  -- Queue ordering, same rationale as documents.priority_score.
  add column if not exists visa_priority_score        integer not null default 0;

create index if not exists dgp_visa_assigned_idx on public.departure_group_pilgrims (visa_assigned_to)
  where visa_status not in ('APPROVED');
create index if not exists dgp_visa_batch_idx    on public.departure_group_pilgrims (visa_batch_id)
  where visa_batch_id is not null;
create index if not exists dgp_visa_ref_idx      on public.departure_group_pilgrims (visa_application_reference)
  where visa_application_reference is not null;
create index if not exists dgp_visa_expiry_idx   on public.departure_group_pilgrims (visa_expiry_date)
  where visa_expiry_date is not null;
```

**Note: `visa_status` itself is not touched.** The eight states already in the check constraint are
exactly the spec's lifecycle. `EXPIRING_SOON` and `EXPIRED` are **derived**, never stored (D4).

**B. The submission batch** (fixes F5):

```sql
create table if not exists public.visa_submission_batches (
  id                  uuid primary key default gen_random_uuid(),
  departure_group_id  uuid not null references public.departure_groups (id) on delete cascade,
  -- Agency-chosen, human-facing: 'AUG-UMR-04-B02'. Unique per group.
  batch_reference     text not null,
  visa_type           text,
  sequence_number     integer not null default 1,          -- "Batch 02"
  status              text not null default 'DRAFT'
                        check (status in ('DRAFT','SUBMITTED','PARTIALLY_RESOLVED','CLOSED','CANCELLED')),
  owner_id            uuid references auth.users (id) on delete set null,
  owner_name          text,
  submission_deadline timestamptz,
  submitted_at        timestamptz,
  closed_at           timestamptz,
  notes               text,
  created_by          uuid references auth.users (id) on delete set null,
  created_by_name     text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (departure_group_id, batch_reference)
);

create index if not exists visa_batches_group_idx on public.visa_submission_batches (departure_group_id, status);
create index if not exists visa_batches_open_idx  on public.visa_submission_batches (submission_deadline)
  where status in ('DRAFT','SUBMITTED','PARTIALLY_RESOLVED');

alter table public.departure_group_pilgrims
  add constraint departure_group_pilgrims_visa_batch_fkey
  foreign key (visa_batch_id) references public.visa_submission_batches (id) on delete set null;
```

Membership is the FK on the enrolment row, not a join table: an application belongs to **at most one
open batch at a time**, and a resubmission moves it to a new batch. History of which batches an
application passed through lives in the event log (C), which is where history belongs.

**C. The visa audit trail — append-only** (fixes F10):

```sql
create table if not exists public.visa_application_events (
  id                 uuid primary key default gen_random_uuid(),
  -- The enrolment, i.e. the application. See R5.
  journey_id         uuid not null references public.departure_group_pilgrims (id) on delete cascade,
  departure_group_id uuid not null references public.departure_groups (id) on delete cascade,
  batch_id           uuid references public.visa_submission_batches (id) on delete set null,
  actor_id           uuid references auth.users (id) on delete set null,
  actor_name         text not null default 'System',
  actor_role         text,
  action             text not null
                       check (action in ('READINESS_CHANGED','ASSIGNED','BATCH_ADDED','BATCH_REMOVED',
                                         'REFERENCE_RECORDED','SUBMITTED','STATUS_CHECKED','MOVED_UNDER_REVIEW',
                                         'REWORK_REQUESTED','RESUBMITTED','ISSUE_RECORDED','ISSUE_VERIFIED',
                                         'ISSUE_AMENDED','REJECTED','EXPIRY_FLAGGED','REMINDER_DRAFTED',
                                         'ESCALATED','NOTE_ADDED')),
  from_status        text,
  to_status          text,
  issue_type         text,      -- DOCUMENT_BLOCKER | PHOTO_REJECTED | NAME_MISMATCH | DOB_MISMATCH
                                -- | PASSPORT_VALIDITY | PORTAL_ERROR | REFUSED | OTHER
  note               text,
  evidence_path      text,      -- object key in `pilgrim-documents`
  created_at         timestamptz not null default now()
);

create index if not exists visa_events_journey_idx on public.visa_application_events (journey_id, created_at desc);
create index if not exists visa_events_group_idx   on public.visa_application_events (departure_group_id, created_at desc);
```

Append-only, enforced the way `document_review_events` and `pilgrim_activity_logs` are: **grant
insert and select policies only; never update, never delete.**

**D. The read shape the module consumes** (fixes F2) — the most important object in this plan:

```sql
create or replace view public.visa_application_rows as
select
  e.id                    as journey_id,          -- the application's identity
  e.departure_group_id,
  e.booking_id,
  e.seat_status,
  e.journey_status,
  e.visa_status,
  e.visa_type,
  e.visa_application_reference,
  e.visa_submitted_at, e.visa_reviewed_at, e.visa_rejected_at, e.visa_rejection_reason,
  e.visa_id, e.visa_issue_note, e.visa_file_path,
  e.visa_issue_date, e.visa_expiry_date, e.visa_valid_until, e.visa_entry_type,
  e.visa_verified_at, e.visa_verified_by_name, e.visa_evidence_source,
  e.visa_assigned_to, e.visa_assigned_to_name, e.visa_assigned_at,
  e.visa_batch_id, e.visa_status_checked_at, e.visa_last_update_at, e.visa_priority_score,
  e.documents_completed, e.documents_required, e.document_completion_percent,
  e.emergency_contact_status,
  e.passport_expiry       as enrolment_passport_expiry,

  p.id                    as pilgrim_id,
  p.reference             as pilgrim_reference,
  p.full_name, p.whatsapp_number, p.passport_number, p.date_of_birth, p.nationality,

  b.booking_reference,
  b.outstanding_balance,

  bt.batch_reference, bt.sequence_number as batch_sequence,
  bt.status as batch_status, bt.submission_deadline, bt.owner_name as batch_owner_name,

  g.id                    as group_id,
  g.group_name, g.group_code, g.journey_type, g.departure_date, g.return_date,
  g.branch, g.group_status, g.visa_owner_name as group_visa_owner_name,

  -- The blocker the readiness engine already knows about, surfaced without a
  -- second round trip: how many *gating* requirements are still unverified.
  (select count(*) from public.departure_group_pilgrim_documents d
    where d.pilgrim_id = e.id
      and d.required
      and d.status <> 'VERIFIED' and d.status <> 'NOT_APPLICABLE'
      and d.required_by_stage in ('ON_BOOKING','BEFORE_VISA_SUBMISSION'))    as gating_outstanding,
  (select count(*) from public.departure_group_pilgrim_documents d
    where d.pilgrim_id = e.id and d.required and d.status = 'REJECTED')      as rejected_documents

from public.departure_group_pilgrims e
join public.pilgrims                 p  on p.id  = e.pilgrim_id
join public.departure_group_bookings b  on b.id  = e.booking_id
join public.departure_groups         g  on g.id  = e.departure_group_id
left join public.visa_submission_batches bt on bt.id = e.visa_batch_id
where e.seat_status <> 'CANCELLED'
  and g.group_status <> 'CANCELLED';

comment on view public.visa_application_rows is
  'One row per visa application (= one enrolment), joined to the person, booking, batch and group. The Visa Operations page reads this instead of joining five tables itself.';
```

> **The unit of this module is the enrolment (`departure_group_pilgrims.id`), not the person.** One
> person travelling twice has two applications. `departure_group_pilgrim_documents.pilgrim_id` also
> references the *enrolment*, which is why the two correlated subqueries above join on `e.id`. This
> view is the only place these joins are written (R5).

**E. Backfills**, in this order:

1. `visa_type` from the group's `journey_type` (`UMRAH → 'Umrah Visa'`, `HAJJ → 'Hajj Visa'`,
   `EARLY_REGISTRATION → null`), against the catalogue in `visa-copy.ts`.
2. `visa_last_update_at = coalesce(visa_rejected_at, visa_reviewed_at, visa_submitted_at, created_at)`.
3. `visa_verified_at = visa_reviewed_at` **only** where `visa_status = 'APPROVED'` and `visa_id is
   not null` — every existing approval was recorded by a human under the old one-step flow, so
   treating it as verified is accurate; leaving it null would show the entire back catalogue as
   unverified on day one. **This needs a verification query, not just an UPDATE.**
4. `visa_issue_date` is left null. It was never captured and must not be guessed.

**RLS.** Same posture as every existing table: `enable row level security`, authenticated read and
write — except `visa_application_events`, which gets **insert + select only**. Whether a role may see
a given visa number stays an application-layer decision, exactly as `departure-groups-access.ts`
documents.

### 3.3 Data layer — mirror the Documents shape exactly

```text
lib/types/visa.ts                 snake_case row types (mirrors lib/types/documents.ts)
lib/data/visa.ts                  view models + client-safe derivations (KPIs, alerts, risk, boards)
lib/data/visa-repository.ts       load / persist the fields this module owns
lib/data/visa-batches.ts          PURE batch mutators returning { ok, error } over a loaded store
lib/data/visa-queue.ts            queue predicates, derived expiry states, priority score
lib/data/visa-readiness.ts        per-group visa readiness %, risk band, blocker list
lib/data/visa-ai.ts               AI Visa Assistant — server only (see §5)
lib/data/visa-copy.ts             thresholds, visa-type catalogue, issue-type labels, message templates
lib/access/visa-access.ts         VisaCapabilities per StaffRole
lib/validations/visa.ts           zod schemas for every action input
```

Non-negotiable conventions carried over from Documents and Pilgrims:

- **Reuse, do not re-implement, the visa mutators in `departure-groups-documents.ts`.**
  `markApplicationsSubmittedInStore`, `markVisaUnderReviewInStore`, `uploadPilgrimVisaInStore` and
  `rejectPilgrimVisaInStore` already encode the guards, the ordering rules and the activity log.
  The Visa actions call the existing wrappers in `lib/data/departure-groups.ts` and add only the
  batch/assignment/reference/verification fields and the event write on top. Two transition paths
  that can drift is the failure mode to avoid — the same call the Documents plan made (D3).
- **Never re-derive readiness.** `READY_TO_SUBMIT` is produced by `syncPilgrimDerivedState()`. This
  module *reads* that state and *explains* it via `gating_outstanding` / `rejected_documents` and
  `outstandingSummary()`. It must not compute its own answer to "is this ready?".
- **Derived, never stored**, for anything time-relative: days to departure, days since submission,
  expiring soon, expired, overdue-to-chase. Computed from the `nowIso` the Server Component
  serialises down, so server render and hydration agree.
- **Capabilities decide what is fetched, not just rendered.** Passport numbers, visa numbers and
  `visa_file_path` are nulled **in the repository** for roles without the capability — they never
  reach a Client Component.
- **Pure mutators over a loaded store**, so they lift into Server Actions unchanged and the
  repository writes back only the diff.
- `newId()` in the application, so an application mutation and its event flush in one write.

**One derived value is persisted deliberately**: `visa_priority_score`, for the same reason
`documents.priority_score` is — it is the default sort and a pure function cannot be indexed.
Recomputed by `scoreApplication()` on every status/assignment/batch change.

### 3.4 Lifecycle — the existing state machine, with the spec's labels

No new database states. The mapping is one-to-one, and `EXPIRING_SOON` / `EXPIRED` are derived from
`visa_expiry_date` and `visa_valid_until` on read:

| Spec status | Stored value | Set by | Main action |
|---|---|---|---|
| Not Started | `NOT_STARTED` | derived — no document progress | Review requirements |
| Documents Pending | `DOCUMENTS_PENDING` | derived — gating docs unverified **or** passport validity fails | Open Documents queue (filtered to this pilgrim) |
| Ready to Submit | `READY_TO_SUBMIT` | derived — all gating docs verified, passport clear | Add to submission batch |
| Submitted | `SUBMITTED` | `markApplicationsSubmittedInStore` (batch or single) | Track response |
| Under Review | `UNDER_REVIEW` | `markVisaUnderReviewInStore` | Monitor, record status check |
| Rework Required | `REWORK_REQUIRED` | `rejectPilgrimVisaInStore(canReapply: true)`, **or** auto when a required document is rejected on a lodged file | Request the required change in Documents |
| Approved / Issued | `APPROVED` | `uploadPilgrimVisaInStore` — now **two steps**, record then verify (F6) | Capture visa details, upload evidence, verify |
| Rejected | `REJECTED` | `rejectPilgrimVisaInStore(canReapply: false)` | Record reason, escalate, release or move the seat |
| Expiring Soon | *derived* — `APPROVED` and expiry inside the configured window | `deriveValidityState()` | Escalate before departure |
| Expired | *derived* — `APPROVED` and expiry/valid-until already past | `deriveValidityState()` | Escalate immediately |

Rework → **Resubmitted** is the same `markApplicationsSubmittedInStore` call: a `REWORK_REQUIRED`
application returns to `READY_TO_SUBMIT` automatically once its documents are fixed (the derivation
already does this), and is then added to a new batch. The event log records `RESUBMITTED` rather than
`SUBMITTED` when the application has a prior `SUBMITTED` event — the only place resubmission is
distinguished, and the right place for it.

**Two changes to existing mutators are required and must be made carefully:**

1. `uploadPilgrimVisaInStore()` gains an `amend` path (F15): when `visa_status === 'APPROVED'`, allow
   an update of the number/dates/entry type **only** for a caller with `amendIssuedVisa`, writing an
   `ISSUE_AMENDED` event with the before/after values. Without it, a typo is uncorrectable.
2. Recording an issue no longer implies verification (F6). `visa_status` still becomes `APPROVED` on
   record — the group readiness rule and the seat's travel eligibility already key off it, and
   splitting that would ripple into `VISAS_ALL_APPROVED`, the Pilgrims profile and the dashboard.
   What changes is that `visa_verified_at` stays null until a human clicks **Mark Issued & Verified**,
   and every surface renders an unverified issue as `Issued · Unverified` in `warning` tone. Group
   readiness counts only **verified** issues as green (§4.5).

### 3.5 Configuration (`lib/data/visa-copy.ts`)

Everything the spec insists must be tunable, in one table — mirroring `documents-copy.ts`:

```ts
export const VISA_SUBMISSION_LEAD_DAYS = 21;      // when an application *should* be lodged
export const VISA_DEPARTURE_RISK_DAYS  = 14;      // "departing soon" for the risk board
export const VISA_VALIDITY_RISK_DAYS   = 14;      // expiry inside this window → Expiring Soon
export const VISA_NO_UPDATE_CHASE_DAYS = 3;       // "no status update for X days"
export const VISA_BATCH_DEFAULT_HOURS  = 8;       // default submission deadline from creation
```

Plus the **visa-type catalogue** (`Umrah Visa`, `Hajj Visa`, `Family Visit`, …) keyed by journey type
with an "other" escape hatch, the **issue-type** labels, the **evidence-source** labels, and the
rework/escalation message templates. The spec's warning is explicit: *"Avoid a rigid rule such as
'visa must be issued exactly seven days before departure'"* — so none of these may appear as a
literal inside a mutator or a component. When an agency-settings table lands, this file becomes its
defaults.

### 3.6 Capability matrix (`lib/access/visa-access.ts`)

| Capability | ADMIN | CEO | FINANCE | MARKETING | OPERATIONS | VISA | GUIDE |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| `viewModule` | ✓ | ✓¹ | ✓² | ✓³ | ✓ | ✓ | ✓⁴ |
| `viewApplicationDetail` | ✓ | ✓¹ | — | — | ✓ | ✓ | — |
| `viewVisaNumberAndFile` | ✓ | ✓ | — | — | ✓ | ✓ | — |
| `viewFullPassportNumber` | ✓ | ✓ | — | — | ✓ | ✓ | — |
| `createBatch` / `manageBatch` | ✓ | — | — | — | ✓ | ✓ | — |
| `markSubmitted` | ✓ | — | — | — | ✓ | ✓ | — |
| `recordStatusCheck` | ✓ | — | — | — | ✓ | ✓ | — |
| `recordIssuedVisa` | ✓ | — | — | — | ✓⁵ | ✓ | — |
| `verifyIssuedVisa` | ✓ | — | — | — | — | ✓ | — |
| `amendIssuedVisa` | ✓ | — | — | — | — | ✓ | — |
| `recordRejection` / `requestRework` | ✓ | — | — | — | ✓ | ✓ | — |
| `assignOfficer` | ✓ | — | — | — | ✓ | ✓ | — |
| `uploadVisaEvidence` | ✓ | — | — | — | ✓ | ✓ | — |
| `sendReminders` | ✓ | — | — | ✓³ | ✓ | ✓ | — |
| `runAiAssistant` | ✓ | ✓¹ | — | — | ✓ | ✓ | — |
| `exportSubmissionPack` | ✓ | — | — | — | ✓ | ✓ | — |
| `exportRiskReport` | ✓ | ✓ | — | — | ✓ | ✓ | — |
| `viewGroupRiskBoard` | ✓ | ✓ | — | — | ✓ | ✓ | ✓⁴ |
| `viewPaymentBlockersOnly` | — | — | ✓² | — | — | — | — |
| `readOnly` | — | ✓ | ✓ | ✓ | — | — | ✓ |
| `configureThresholds` | ✓ | — | — | — | ✓ | — | — |

¹ CEO: read-only risk overview — KPI strip, group board, escalations. No queue actions, no batches.
² Finance sees **only** the payment-related blocker projection: pilgrim, group, outstanding balance,
and whether a payment threshold blocks readiness. `passport_number`, `visa_id`, `visa_file_path`,
`date_of_birth` and `nationality` are **nulled in the repository**, and the queue is restricted to
applications whose blocker is financial. Not a UI conditional — a `select` list and a `where` clause.
³ Marketing sees an aggregate "visa pending" count per group only; no row-level access, no PII.
Approved reminder templates only.
⁴ Guide sees the read-only readiness board for **their assigned group only**
(`assignedGroupOnly`, matching the existing Departure Groups behaviour) — counts and a travel-ready
flag per pilgrim, never a visa number, file or rejection reason.
⁵ Operations may *record* an issue but not *verify* it; verification is the Visa team's signature.
This is the one place the matrix deliberately separates two adjacent capabilities, because
verification is what the readiness board treats as green.

Two rules the capability layer must enforce beyond a boolean:

- **Scoping is a query filter, not a UI filter** — Finance's projection and Guide's group restriction
  are `where` clauses in `visa-repository.ts`.
- **Passport numbers are masked by default for every role.** `maskPassport("N1234567") → "N123****67"`
  lives in `app/(main)/visa/utils.ts`; the unmasked value is rendered only behind an explicit reveal
  control, only for `viewFullPassportNumber`, and every reveal writes a `NOTE_ADDED`-class access
  event. The spec's own mock shows the masked form.

---

## 4. Screens

### 4.1 Operations list — `/visa`

Files, mirroring `app/(main)/documents/` one-for-one:

```text
app/(main)/visa/page.tsx                          Server Component, force-dynamic, resolves role, reads ?view= / ?group=
app/(main)/visa/visa-store.tsx                    Context provider + Server Action callers
app/(main)/visa/types.ts                          Queues, saved views, filters, KPI shape (re-exports view models)
app/(main)/visa/utils.ts                          Labels, tones, masking, formatters, sort, filter, queue predicates
app/(main)/visa/actions.ts                        "use server" — every mutation
app/(main)/visa/csv.ts                            Submission pack, applicant manifest, risk report (role-aware)
app/(main)/visa/components/visa-list.tsx          Header + KPIs + alerts + tabs + filters + table + AI panel
app/(main)/visa/components/visa-metrics.tsx       KpiRow of five KpiCard, each a quick filter
app/(main)/visa/components/visa-alerts.tsx        3–5 severe issues, each a precise filter link
app/(main)/visa/components/ai-visa-panel.tsx      Compact right-rail assistant panel
app/(main)/visa/components/group-visa-board.tsx   "By Group" view
app/(main)/visa/components/application-sheet.tsx  Wide application drawer
app/(main)/visa/components/create-batch-sheet.tsx Batch builder
app/(main)/visa/components/batch-detail-sheet.tsx Batch counters + controls
app/(main)/visa/components/record-issue-dialog.tsx     Visa number / dates / entry type / evidence
app/(main)/visa/components/record-decision-dialog.tsx  Rejection / rework, reason + issue type
app/(main)/visa/components/status-check-dialog.tsx     "Status checked on" + note
app/(main)/visa/components/assign-officer-dialog.tsx
app/(main)/visa/components/visa-bulk-actions-bar.tsx
app/(main)/visa/visa-table/visa-columns.tsx
app/(main)/visa/visa-table/visa-data-table.tsx    Forked from documents-data-table.tsx (row selection)
```

- **Header** — `PageHeader`, breadcrumb `Home > Operations > Visa`, subtitle *"Prepare, submit,
  track, and resolve pilgrim visa applications across active groups."*, actions
  `[+ Create Visa Batch] [Check Status] [Export Submission Pack]`. Create Visa Batch is the primary
  (`variant="secondary"`, matching `documents-list.tsx:169`); the rest collapse into a `⋯`
  `DropdownMenu` below `md`, same as Documents.
  **"Check Status" opens the bulk status-check dialog** — it records that staff checked, against
  which reference, with an optional note. It does **not** call any government portal (D6).
- **KPIs** — five `KpiCard`s in a `KpiRow`, each setting a queue on click; `KpiRow` is
  `lg:grid-cols-4`, so the fifth wraps. Accept the 4+1 wrap as Documents did — do not delete a card
  to make it fit, and do not invent a new grid component.

  | Card | Value | Sub-label | Queue |
  |---|---|---|---|
  | Ready to Submit | `READY_TO_SUBMIT` | All required files verified | Ready to Submit |
  | Submitted / Pending | `SUBMITTED` + `UNDER_REVIEW` | Awaiting decision or update | Submitted |
  | Visa Issues | `REJECTED` + `REWORK_REQUIRED` + `DOCUMENTS_PENDING` with a rejected document | Rejected, rework, mismatch, or blocked | Rework Required |
  | Issued | `APPROVED` on active groups | Approved for active groups | Issued |
  | Groups at Visa Risk | distinct groups whose risk band is Red or Amber | Departing soon with incomplete visas | By Group |

  For `readOnly` roles, render the same five as plain, non-clickable cards.

- **Critical alerts** — below the KPIs, capped at five, sorted severity then departure proximity,
  from `deriveVisaAlerts()` in `visa-queue.ts`. Each alert writes a **precise filter set** (queue +
  group + issue type), never a generic "open list":

  | Alert | Condition |
  |---|---|
  | 🔴 Group departs in N days with M unissued visas | `daysToDeparture ≤ VISA_DEPARTURE_RISK_DAYS` and `visa_status <> 'APPROVED'` |
  | 🔴 N applications rejected | `visa_status = 'REJECTED'` |
  | 🔴 N passports fail the validity rule | gating blocked by `checkPassportValidity` |
  | 🟠 N applications with no update for X days | `visa_last_update_at` older than `VISA_NO_UPDATE_CHASE_DAYS` and status in `SUBMITTED`/`UNDER_REVIEW` |
  | 🟠 N issued visas unverified | `visa_status = 'APPROVED'` and `visa_verified_at is null` |
  | 🟠 Batch deadline today | open batch with `submission_deadline` inside 12 hours |

- **Work-queue tabs** — one `SavedViewBar` with the spec's nine. `By Group` swaps the table for the
  board rather than filtering it.

  | Queue | Predicate |
  |---|---|
  | All Applications | every row on an active, non-cancelled group |
  | Ready to Submit | `visa_status = 'READY_TO_SUBMIT'` |
  | Submitted | `visa_status = 'SUBMITTED'` |
  | Under Review | `visa_status = 'UNDER_REVIEW'` |
  | Issued | `visa_status = 'APPROVED'` |
  | Rework Required | `visa_status = 'REWORK_REQUIRED'` |
  | Rejected | `visa_status = 'REJECTED'` |
  | Expiring / Validity Risk | derived `EXPIRING_SOON` or `EXPIRED`, **or** passport validity failing |
  | By Group | group board view |

- **Saved views** — second `SavedViewBar` row: `All`, `My Visa Queue`
  (`visaAssignedToName === currentStaffName`, the shape `applySavedView(…, currentStaffName)`
  already uses in Documents and Pilgrims), `Ready to Submit Today`, `Departing in 7 Days`,
  `Submitted but Unresolved`, `Visa Rework Required`, `Rejected Applications`, `Visa Validity Risk`.
  The spec's eighth example — *"August Umrah Group 04"* — is **a group filter, not a hardcoded
  view**: it is reachable through the Departure Group `FilterSelect` and from the group board's
  `[Open Group Visa Queue]`. Do not hardcode a group name into a saved-view list.
- **Filters** — `FilterSelect` chips: Departure Group, Visa Status, Journey Type, Visa Type,
  Submission Batch, Assigned Visa Officer, Departure Window (`≤7d / ≤14d / ≤30d / >30d`, derived),
  Issue Type, Branch — with the `showMoreFilters` toggle from `documents-list.tsx` splitting the
  first four from the rest.
- **Search** — one box over pilgrim name, **passport number (matched against the unmasked value
  server-side-loaded row, never against the mask)**, visa number, application reference, batch
  reference and group, wrapped in `useDeferredValue`.
- **Columns** — the spec's ten, built from `ToneBadge` + `ProgressBar` + `PersonChip`, plus a
  leading `Checkbox` for batch selection:

  | Column | Content |
  |---|---|
  | Pilgrim | Name, `pilgrimReference`, masked passport |
  | Departure Group | Group name, departure date, `Departs in N days` |
  | Visa Type | `visa_type` or the journey-type default |
  | Application Status | `ToneBadge` via `visaTone()`, with `Unverified` sub-label where applicable |
  | Document Readiness | `8 / 8 verified` via `ProgressBar`, or the first blocker from `gating_outstanding` |
  | Application Reference | `visa_application_reference`, `—` when not yet lodged |
  | Submitted | `visa_submitted_at`, with "checked N days ago" beneath |
  | Visa Validity | issue → expiry, or `Awaiting issue`; toned by derived validity state |
  | Assigned Officer | `PersonChip` on `visa_assigned_to_name`, falling back to the group's `visa_owner_name` as muted text |
  | Actions | `[Review]` + `⋯` menu (Assign, Add to batch, Record status check, Open Documents) |

- **Row click opens the drawer.** It does **not** navigate — queue position is the operator's place
  in a work session and must survive a review.

### 4.2 Visa Application drawer

A wide right-side `Sheet` (`sm:max-w-4xl`), two columns on `lg`, stacked below. Sections in the
spec's order.

```text
HEADER   Pilgrim · reference · masked passport · group · departs in N days
         [Status badge] [Risk badge] · Assigned to: …
LEFT     Application Summary · Eligibility & Document Checklist
RIGHT    Visa Submission Details · Visa Timeline · Issue / Rework Resolution · Actions
```

- **Application summary** — visa type, status, application reference (inline-editable for
  `manageBatch`), submission batch (`August Umrah Group 04 · Batch 02`, linking to the batch sheet),
  submitted date, assigned officer, last status check.
- **Eligibility & document checklist** — rendered from the pilgrim's document rows, **read-only
  here**. Each line is `✓ / ⚠ / ✗` + requirement name + status. The list is generated from the same
  gating set `derivePreSubmissionVisaStatus()` uses, plus the passport-validity check and the
  agency's configured extras, so the checklist and the status can never disagree:

  ```text
  ✓ Passport bio page verified
  ✓ Passport validity threshold met
  ⚠ White-background photo rejected — background not compliant
    [Open Document] [Request Rework]
  ```

  **Clicking a requirement navigates to `/documents` filtered to that exact record.** Visa never
  duplicates document review — no verify button, no upload, no preview in this drawer. That rule is
  the entire reason the two modules are separate, and it is enforced by the drawer simply not
  importing anything from `app/(main)/documents/components/`.
  When the application is ready, the section renders the spec's confirmation line:
  *"Application is ready for submission."*
- **Visa submission details** — reference, batch, lodged date, `[Record Status Check]` (writes
  `visa_status_checked_at` + a `STATUS_CHECKED` event with an optional note), `[Mark Under Review]`.
- **Visa timeline** — the `visa_application_events` for this `journey_id`, newest first, actor and
  role on every entry. This is the module's audit surface and the spec's "individual pilgrim visa
  timeline".
- **Issue / rework resolution** — the spec's issue form, opened by `[Record Issued Visa]`:
  visa number · issue date · expiry date · entry type (Single/Multiple) · valid until · evidence
  source · `[Upload Visa Copy]` (reusing `document-storage.ts` verbatim) · then a **separate**
  `[Mark Issued & Verified]` button, enabled only for `verifyIssuedVisa` and only once a number and
  at least one evidence item exist. Until then the badge reads `Issued · Unverified` in `warning`
  tone. `[Record Rejection]` opens the decision dialog: issue type, reason (required), and the
  `canReapply` toggle that decides `REWORK_REQUIRED` vs terminal `REJECTED` — worded as its
  consequence ("The file can be corrected and lodged again" / "This seat cannot travel"), not as a
  checkbox label.
- **Actions** — `[Add to Batch] [Assign Officer] [Draft Rework Message] [Escalate]`, each
  capability-gated with the reason in a tooltip rather than a silent disable.

### 4.3 Batch submission workflow

**Create batch** (`create-batch-sheet.tsx`) — the spec's form:

```text
Departure Group *      (required first; everything below filters by it)
Visa Type *            (from the catalogue, defaulted from the group's journey type)
Eligible Pilgrims      N ready to submit
Selected               checkbox list, pre-checked for READY_TO_SUBMIT
                       ineligible rows shown, disabled, with the blocker text
                       ("Rishad Bathiudeen — Missing photo") from outstandingSummary()
Submission owner *
Internal batch reference   (defaulted `<GROUP_CODE>-B<NN>` from sequence_number, editable)
Submission deadline        (defaults to now + VISA_BATCH_DEFAULT_HOURS)
[Create Batch]
```

Showing ineligible pilgrims greyed with their reason — rather than hiding them — is what turns the
batch builder into the team's work list. Hidden rows produce "why isn't he in the batch?" phone calls.

**Batch detail** (`batch-detail-sheet.tsx`) — counters (`27 selected · 25 submitted · 1 rework
required · 1 pending submission`), the deadline with a countdown, and the spec's controls:

```text
[Export Submission Pack]        applicant manifest CSV + verified-document bundle
[Mark All Selected Submitted]   → markGroupApplicationsSubmitted, reporting named skips
[Send Missing Document Reminders]
Export applicant manifest · Download passport/photo pack · Assign/reassign officer
· Send batch reminder · Add agency/internal submission reference
```

Every batch action is one Server Action taking `journeyIds: string[]`, running the existing
per-application mutator over one loaded store, and returning `{ ok, applied, skipped: { fullName,
reason }[] }` — the shape `markApplicationsSubmittedInStore` already returns, because "25 of 27
updated" with no names is not actionable.

**No government-portal integration is fabricated anywhere.** What is supported (per the spec):
manual reference entry, evidence upload, a "status checked on" timestamp, and a clearly-labelled
placeholder in the batch sheet for a future integration. Any copy implying the system talks to an
official portal is a defect.

### 4.4 Group visa board — `By Group`

One `Card` per active group, mirroring `documents/components/group-board.tsx`: name, departure
countdown, total pilgrims, the per-status counts the spec lists, a `ProgressBar` for visa readiness
toned by `percentTone()`, the risk band, the blocker list, and `[Open Group Visa Queue]` which
filters the main table to that group.

```text
Visa readiness = 100 × (verified issued visas) / (applications requiring a visa)
```

Only **verified** issues count (§3.4). Unverified issues sit in the Amber band — recording a number
is not evidence a pilgrim can travel.

### 4.5 Risk rules (`visa-readiness.ts`)

Configurable, per §3.5 — never a hardcoded day count in a component:

```text
Red    visa rejected
       · required visa unissued inside VISA_DEPARTURE_RISK_DAYS
       · passport validity fails checkPassportValidity()
       · application blocked by a rejected/missing gating document
       · required correction not completed and departure inside the window
Amber  submitted but unresolved
       · rework required
       · expiry/validity concern (EXPIRING_SOON)
       · pending review inside the batch deadline
       · issued but not staff-verified
Green  issued and staff-verified
```

The group's band is the worst band of any application on it. This feeds the existing
`VISAS_ALL_APPROVED` readiness item rather than replacing it: that rule stays the source of truth for
the group's readiness *checklist*, while `computeGroupVisaBoard()` produces the *percentage and
blocker list* the board renders. Phase 5 extends the readiness item's tooltip to point at `/visa`
instead of the group's Documents & Visa tab.

### 4.6 Portal projection

Deferred to the Pilgrims module's `(portal)` route group, exactly as the Documents plan deferred
its own. This module's obligation is to make the projection *possible*: keep `visa_rejection_reason`
customer-safe, build the customer projection in the repository, and never let
`visa_application_events`, internal notes, officer names or another pilgrim's row into that payload.

---

## 5. AI Visa Assistant

### 5.1 Posture

An **operations copilot**, not a decision-maker. Unlike the Document Agent, it makes no assessment of
a *file*; it reasons over data the CRM already holds and produces a prioritised work list. Three
invariants, enforced in code rather than in a prompt:

1. **No AI code path reaches any visa transition.** `visa-ai.ts` imports no mutator and no Server
   Action. Its only writes are its own suggestion rows; every action it proposes is a button a human
   presses.
2. **No external message is ever sent.** Drafts open in the existing `whatsappLink()` compose flow —
   the same "compose, don't send silently" posture the Documents and Pilgrims modules already take.
3. **No legal or eligibility judgement.** The prompt forbids it, the output schema has no field for
   it, and the UI labels every output as a suggestion with the underlying rule shown.

### 5.2 What it may do

```text
Identify applications ready to submit
Detect blocked applications from document status
Suggest a batch composition for a group
Prioritise by departure date and risk
Summarise visa risk per group
Detect passport / name / DOB mismatches between verified extractions and the profile
Draft WhatsApp or portal rework requests (staff sends)
Detect applications with no status update for X days
Prepare a submission checklist
Draft internal escalation notes
```

### 5.3 What it must never do

```text
Submit an official visa application
Make a legal eligibility decision
Approve or reject a visa
Promise an approval date to a pilgrim
Modify passport or identity data
Mark a visa issued without staff evidence
Send an external message without staff approval
```

### 5.4 Implementation

`lib/data/visa-ai.ts`, server-only, mirroring `documents-ai.ts`:

- **Most of the panel is deterministic TypeScript, not a model call.** "5 unresolved", "2 need
  corrected photographs", "1 passport expires inside the threshold", "2 have no update for 3 days"
  are all queries over `visa_application_rows`. Computing them in `visa-queue.ts` makes them exact,
  free and testable. **Do not send a model a list of counts and ask it to count.**
- The model is used for the two things that genuinely need language: the **summary narrative** and
  the **drafted rework / escalation messages**. One call per group summary, one per drafted message.
- `@anthropic-ai/sdk`, `claude-opus-5`, `ANTHROPIC_API_KEY` server-side only. `isAiConfigured()`
  gates every call site so the module is fully functional — with the panel simply absent — in an
  environment without the key, exactly as `documents-ai.ts` does.
- Structured outputs + zod re-validation in `lib/validations/visa.ts`. Check
  `stop_reason === "refusal"` before reading content.
- Prompt caching on the shared system prompt.
- **PII posture (R3, carried from Documents):** group summaries are sent with names and references
  but **never passport numbers, visa numbers, DOB or nationality** — the summary does not need them,
  and the difference is one field list in the prompt builder.

### 5.5 Panel

`ai-visa-panel.tsx`, a `Card` in the right rail on `xl`, collapsible above the table below that —
same placement as `ai-agent-panel.tsx`. Renders the spec's example verbatim in shape: group name,
the four counts, a recommended action, and `[Open Recommended Queue]` which applies a precise filter
set. **Not a chatbot.**

---

## 6. Build phases

| Phase | Scope | Depends on |
|---|---|---|
| **0. Foundation** | Migration §3.2 (columns, batches, events, view), backfills, `lib/types/visa.ts`, repository, `visa-access.ts`, `visa-copy.ts`, validations. Fix F1 (route exists, dashboard links converge) | — |
| **1. Operations list** | `/visa` to spec: KPIs, alerts, nine queue tabs, saved views, nine filters, ten columns, masked passports, drawer opening read-only | 0 |
| **2. Application drawer** | Summary, checklist linking into `/documents`, timeline from `visa_application_events`, status-check recording, officer assignment | 1 |
| **3. Submission batches** | `visa_submission_batches`, create-batch sheet, batch detail, bulk mark-submitted over the existing mutator, batch filter and column | 2 |
| **4. Decisions & issue capture** | Record issued visa (number, issue date, expiry, entry type, valid until, evidence upload), separate **Mark Issued & Verified**, amend path (F15), rejection/rework with issue types | 2 |
| **5. Group risk board** | `visa-readiness.ts`, By Group tab, readiness %, risk bands, feed into the existing `VISAS_ALL_APPROVED` item and repoint its tooltip | 1, 4 |
| **6. Exports & reminders** | Submission pack, applicant manifest, passport/photo bundle, risk report — all role-aware; batch reminders via the compose flow | 3, 4 |
| **7. AI Visa Assistant** | `visa-ai.ts`: deterministic counters first, then summary narrative and drafted messages; panel | 4, 5 |
| **8. Mismatch & prioritisation** | Name/DOB/passport mismatch detection against verified document extractions, `visa_priority_score`, no-update chase detection | 7 |
| **9. Visa copy as a document** | Optionally mirror `visa_file_path` into a `VISA_COPY` document row so the issued visa gets expiry tracking and AI checks (F14) | 4 |
| **10. Portal** | Pilgrim-facing visa status and rework request; deferred to the Pilgrims `(portal)` route group | 4 |

Phase 3 is the module's reason for existing — if scope has to be cut, cut 8 and 9, not 3.
Phase 7 must not start before 4: an assistant with no decision workflow to feed is a demo.

---

## 7. Decisions and risks

| # | Decision | Rationale / risk |
|---|---|---|
| D1 | Route is `/visa`, not `/operations/visa` | The sidebar already points there; the breadcrumb carries the hierarchy. **Risk: the dashboard's `/visas` links break silently unless fixed in the same change (F1)** |
| D2 | New `visa_application_rows` view rather than extending `pilgrim_journey_rows` | Widening a view another module reads changes that module's payload. One read shape per module, mirroring how Documents got its own |
| D3 | Reuse the four existing visa mutators; add only batch/assignment/reference/verification on top | Two transition paths that can drift is the failure mode. **Risk: those mutators take `departureGroupId`, so Visa actions must resolve it per application — cheap, the view carries it** |
| D4 | `EXPIRING_SOON` / `EXPIRED` are derived, never stored | A stored state needs a scheduled job to flip it, and there is no scheduler. Derivation from `nowIso` is exact at every render. **Risk: they cannot be indexed — acceptable at agency row counts** |
| D5 | Recording an issued visa still sets `APPROVED`; verification is a second, separate field | Splitting `APPROVED` would ripple into `VISAS_ALL_APPROVED`, the Pilgrims profile, the dashboard and the readiness engine. **Risk: an unverified issue counts as approved for the readiness *item* while sitting Amber on the *board* — the two must be explained in the UI, not left to be discovered** |
| D6 | No government-portal integration; manual reference + evidence + "checked on" only | The spec is explicit, and portal availability varies by season, nationality and agency. Any copy implying automation is a defect |
| D7 | Batch membership is an FK on the enrolment (one open batch at a time), not a join table | A resubmission moves the application to a new batch; passage through batches is history, and history lives in the event log |
| D8 | Ineligible pilgrims are shown disabled with their blocker in the batch builder | Hiding them generates support calls. `outstandingSummary()` already produces the text |
| D9 | Visa never renders document review UI; requirement rows deep-link into `/documents` | The whole justification for two modules. Enforced by not importing from the Documents components directory |
| D10 | Passport numbers masked by default for every role, revealed only behind an explicit control | Matches the spec's own mock. Cheap to add now, expensive to retrofit once the column is everywhere |
| D11 | Most AI panel content is deterministic TypeScript; the model writes narrative and drafts only | Counting with an LLM is slow, costly and wrong sometimes. **Risk: the panel must not *look* more intelligent than it is — label the rules** |
| D12 | No new shared components | Everything the spec draws exists. New work is composition only. The one fork — `visa-data-table.tsx` — copies Documents' fork because the shared `DataTable` has no row selection |
| R1 | **`getCurrentStaffRole()` defaults everyone to ADMIN** ([lib/data/departure-groups.ts:256](lib/data/departure-groups.ts:256)) | Every capability check routes through it. This module exports passport **and** visa numbers together in a submission pack. **Land a staff-roles table before phase 6 ships exports** |
| R2 | **The Finance and Guide projections are the easiest thing in this plan to get wrong** | Both are `select`-list and `where`-clause restrictions in the repository. If they are implemented as UI conditionals, the data still reaches the browser. Write them as query filters, and test them by inspecting the serialised payload, not the screen |
| R3 | **Visa data leaving the building** | Even the summary path sends names and group data to an external model. Restrict the prompt's field list (§5.4), add a per-agency kill switch alongside the Documents agent's, and do not ship phase 7 without an explicit decision from the agency |
| R4 | **Signed URLs are 120 seconds** | The drawer's visa-copy preview must re-mint on demand rather than treating a failed load as a missing file. Same as Documents R4 |
| R5 | **The application is the enrolment, not the person** | `departure_group_pilgrims.id` is the unit; `departure_group_pilgrim_documents.pilgrim_id` points at it too. A person on two journeys has two applications. Getting this backwards is the easiest mistake in the module — the view in §3.2 is the only place the joins are written |
| R6 | **`visa_status` is partly derived and partly explicit** | `syncPilgrimDerivedState()` overwrites pre-submission states on every document mutation but stops at `IN_FLIGHT_VISA_STATES`. Any new writer of `visa_status` in this module must respect that boundary or a lodged application will silently reset to `DOCUMENTS_PENDING` |
| R7 | **Cancelled seats and groups must be filtered at the view** (F16) | An approved visa on a cancelled seat stays `APPROVED` by design and would otherwise inflate the Issued KPI and every readiness percentage |
| R8 | **Backfilling `visa_verified_at` for historic approvals is a judgement call** | Every existing approval was entered by a human, so treating them as verified is defensible — but it must be a deliberate, documented UPDATE with a verification query, not an accident |

---

## 8. Suggested sequencing

1. **Phase 0 alone, first.** The migration and the view are the whole foundation, and F1's route fix
   stops the sidebar 404ing on day one.
2. **Phase 1.** The list is immediately useful by itself — the first time anyone can see every open
   visa application in the agency — and it validates the view shape before anything is built on it.
3. **Phase 2, then 3.** The drawer makes the queue reviewable; batches make it the team's actual
   workflow. Phase 3 is the module's reason for existing.
4. **Phase 4.** Decisions and issue capture close the loop from batch to issued visa.
5. **Phases 5 and 6 in parallel** if more than one person is working.
6. **Staff-roles table** (R1) before phase 6 ships submission-pack exports.
7. **The PII decision** (R3) before phase 7 sends the first group summary to an external model.
8. **Phases 7, 8, 9**, then 10 alongside the Pilgrims portal work.
