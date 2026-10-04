# Documents Module — Implementation Plan

Bring **Documents** up to the agency-wide document-operations specification, on the same data,
access and action architecture already used by **Packages**, **Departure Groups**, **Leads** and
**Pilgrims**.

Status: **plan only. Nothing in here is implemented.**

The product rule the whole plan enforces:

> **Pilgrim profiles store the document. The Documents Operations page controls the agency-wide
> document workflow. The AI Document Agent finds risk early, but staff approve the final decision.**

And the chain it sits in:

```text
Package Template (defines the requirement)
  → Departure Group (freezes it into a snapshot)
    → Pilgrim enrolment (expands one row per requirement)
      → Documents Operations page (works the queue across every group)
```

---

## 1. What exists today

### 1.1 The route

| File | Lines | State |
|---|---|---|
| `app/(main)/documents/page.tsx` | 7 | `<div>DocumentsPage</div>`. Placeholder only, untracked in git. |
| `components/app-sidebar.tsx:66`–`70` | — | Nav entry `Documents → /documents`, already grouped under the sidebar's **Operations** section (`adminBar[2]`, alongside Visa and Operations). |

Nothing else in `app/(main)/documents/` exists.

### 1.2 What already exists elsewhere and is the real starting point

This is **not** a greenfield module. The document *record*, its *lifecycle*, its *storage* and its
*per-pilgrim UI* are all built. What is missing is the **cross-group operational surface** on top of
them.

| Concern | Where it already lives | Notes |
|---|---|---|
| Per-document record | `public.departure_group_pilgrim_documents` (migration `20260811090000`, lines 49–102) | One row per requirement per pilgrim. Carries `name`, `category`, `required`, `required_by_stage`, `verified_by_role`, `status`, `file_path`, `file_name`, `file_size_bytes`, `rejection_reason`, `submitted_at`, `verified_at`, `verified_by`, `verified_by_name`, `notes`, plus `visible_in_portal` and `due_at` added by `20260813090000` |
| Status lifecycle | `status` check constraint | `NOT_SUBMITTED · SUBMITTED · VERIFIED · REJECTED · NOT_APPLICABLE` |
| Lifecycle rules | `lib/data/departure-groups-documents.ts` (1,325 lines) | `submitPilgrimDocumentInStore` / `verifyPilgrimDocumentInStore` / `rejectPilgrimDocumentInStore` / `waivePilgrimDocumentInStore`, plus `syncPilgrimDerivedState()` which recomputes counters, percent and the visa gate |
| Passport expiry rule | `checkPassportValidity()` (`…-documents.ts:78`) | Six-month rule measured against the group's **return** date, not departure |
| Self-clearing requirements | `evaluateDerivableDocuments()` (`…-documents.ts:146`) | Three requirements are facts the CRM already holds: `PASSPORT_VALIDITY`, `EMERGENCY_CONTACT`, `DEPOSIT_THRESHOLD` — matched by regex against the requirement `name` |
| Role gate on sign-off | `canRoleVerify()` (`…-documents.ts:1306`) | Admin signs anything; everyone else only what the template assigned them |
| Secure storage | `app/(main)/departure-groups/document-storage.ts` | Private `pilgrim-documents` bucket, one-shot signed upload URL, 120-second signed download, 10 MB cap, MIME allowlist (`jpeg/png/webp/heic/pdf`), server-composed object key `<groupId>/<pilgrimId>/<documentId>.<ext>` |
| Requirement catalogue | `app/(main)/packages/create-package/types.ts:369` — `DEFAULT_DOCUMENT_REQUIREMENTS` | The eight shipped requirements: passport bio-page, passport validity, white-background photo, meningitis/vaccination certificate, NIC copy, travel & medical insurance, emergency-contact form, deposit threshold |
| Snapshot copy | `lib/data/departure-groups-copy.ts:622`–`630` | Maps the template's requirements into `traveller_requirements_snapshot` |
| Checklist expansion | `lib/data/departure-groups-bookings.ts` | Expands one document row per traveller per requirement at booking time |
| Group-scoped queue | `app/(main)/departure-groups/[groupId]/components/tabs/documents-visa-tab.tsx` (615 lines) | Five subtabs — All Requirements / Missing Documents / Under Review / Visa Queue / Rejected — over one group's manifest |
| Per-pilgrim checklist | `…/components/pilgrim-documents-drawer.tsx` (625 lines) | Upload, open, verify, reject, waive, plus the traveller-record fields the derivable requirements read |
| Per-person view | `app/(main)/pilgrims/[pilgrimId]/components/tabs/documents-tab.tsx` (331 lines) | Card list with a status filter bar and the request/receive/verify/send-back actions |
| Cross-module read shape | `public.pilgrim_journey_rows` view (`20260813090000:266`) | Person + enrolment + booking + group in one row. Read by `loadPilgrimJourneys()` |
| Role model | `lib/access/departure-groups-access.ts` (`manageDocumentsAndVisa`, `viewSensitiveTravellerData`) and `lib/access/pilgrims-access.ts` (`viewDocuments`, `uploadDocuments`, `verifyDocuments`) | Both already model the seven `STAFF_ROLES` |
| Group readiness | `lib/data/departure-groups-readiness.ts` | `auto_source = 'DOCUMENTS_ALL_VERIFIED'` already derives a readiness item from document rows |

### 1.3 The UI vocabulary to reuse — no new components

Everything the spec draws already has a component. **The plan adds zero new files under
`components/`.**

| Spec element | Existing component |
|---|---|
| Breadcrumb + title + subtitle + actions | `components/page-header.tsx` |
| KPI cards row | `components/data-table/kpi-card.tsx` — `KpiCard`, `KpiRow` |
| Work-queue tabs / saved views | `components/data-table/saved-view-bar.tsx` — `SavedViewBar` |
| Filter chips | `components/data-table/filter-select.tsx` — `FilterSelect`, `ALL_FILTER_VALUE` |
| Table shell + search + pagination | `components/data-table/data-table.tsx` — `DataTable` |
| Sortable headers | `components/data-table/sortable-header.tsx` |
| Status badges, progress bars, reviewer chips | `components/ui/tone-badge.tsx` — `ToneBadge`, `ProgressBar`, `PersonChip`, `EmptyState`, `PermissionDenied` |
| Colour vocabulary | `lib/ui/tone.ts` — `Tone`, `TONE_CLASS`, `TONE_BAR`, `percentTone` |
| Review drawer | `components/ui/sheet.tsx` (wide right-side Sheet) |
| Rework / reason dialogs | `components/ui/dialog.tsx`, `dialog-footer.tsx`, `textarea.tsx` |
| Section headers inside cards | `components/section-heading.tsx` |
| Bulk-action menus | `components/ui/dropdown-menu.tsx`, `button-group.tsx` |
| Feedback | `components/ui/toast.tsx` — `toast.add(...)` |
| Form reset on open | `hooks/use-reset-on-open.ts` |

The **status colour mapping** the spec asks for maps one-to-one onto the existing `Tone` scale — no
new palette:

```text
Gray    → neutral   Missing / Not started / Not required
Blue    → info      Submitted / Awaiting review / AI processing
Amber   → warning   AI warning / Due soon / Rework required / Expiring soon
Red     → danger    Rejected / Expired / Blocked
Green   → success   Verified
```

Two existing pieces are close enough to **lift and generalise** rather than rewrite:

- `pilgrim-documents-drawer.tsx` already contains the whole upload → signed-URL → record flow and
  the verify/reject/waive button cluster. Its `DocumentRow` and `upload()`/`openFile()` functions
  become the review drawer's left column and file actions.
- `documents-visa-tab.tsx` already slices a manifest into named queues. Its subtab pattern is the
  seed of the work-queue tabs, widened from one group to all groups.

---

## 2. Findings — the gap between today and the specification

### F1 — There is no cross-group document query. This is the blocking defect.

Every read of `departure_group_pilgrim_documents` in the codebase is scoped:

- `loadJourneyDocuments()` (`lib/data/pilgrims-repository.ts:335`) filters `.eq("pilgrim_id", …)`
- the group manifest loads documents `.eq("departure_group_id", …)`

There is **no query that answers "every outstanding document across every active group"**, and no
view that joins a document row to the person and the group it blocks. Every KPI, every queue tab and
every alert on the spec's page needs exactly that join. This is the first thing the plan lands.

### F2 — A document has no owner

There is no `assigned_to` column. The spec's **Assigned To** column, the *My Review Queue* saved
view, *Unassigned Documents*, **Bulk Assign Reviewer** and the "which staff member must act next?"
question are all unanswerable today. `verified_by_role` names a *role*, not a person, and it is only
written after the fact — it cannot express "S. Rizna is reviewing this now".

### F3 — Only the passport has an expiry; nothing else does

`checkPassportValidity()` reads `departure_group_pilgrims.passport_expiry`. But insurance, visa
copies and vaccination certificates all expire too, and the document row has **no `expires_at`
column** — the Pilgrims plan proposed one, and the migration that landed
(`20260813090000:254`–`256`) added only `visible_in_portal` and `due_at`. The spec's **Expiring
Soon** queue and the "Expiry / Deadline" column therefore cover exactly one of the seven document
types.

### F4 — `due_at` exists but nothing writes it

The column was added and is never set. Every "Due: Today", "Due Date ▾" filter, *Departing in 7
Days* view and overdue tone depends on it. The template defines `requiredByStage`, not a date; the
date has to be **derived** from the stage against the group's departure date, and then materialised.

### F5 — There is no document type — only a free-text name

`name` is `"Passport Copy (Clear Bio-page Scan)"`, a string copied from whatever the package author
typed. The AI cannot be asked "does this file match its requirement" without a stable machine key,
and `evaluateDerivableDocuments()` already shows the cost of not having one: it **regex-matches the
name** (`…-documents.ts:120`) to decide which rule applies, so renaming a requirement in the package
builder silently changes system behaviour. A `document_type` enum on both the template requirement
and the document row fixes the AI's input and that latent bug at once.

### F6 — `visibleInPortal` is defined on the template and dropped on the way in

`DocumentRequirement.visibleInPortal` exists (`create-package/types.ts:377`) and
`departure_group_pilgrim_documents.visible_in_portal` exists — but the snapshot mapping in
`departure-groups-copy.ts:622`–`630` copies only `id`, `name`, `category`, `required`,
`required_by_stage`, `verified_by_role`. The flag never travels, so every document defaults to
portal-visible regardless of what the package said.

### F7 — There is no AI anything

No LLM dependency in `package.json`, no findings table, no confidence field, no extraction store, no
override log. `lib/data/departure-groups-ai.ts` is a *sales* read model (customer-safe availability
for a quoting agent) and shares nothing with document verification beyond the name.

### F8 — There is no bulk anything

Every mutator in `departure-groups-documents.ts` takes one `documentId`. The two bulk functions that
exist (`markApplicationsSubmittedInStore`, `markVisaUnderReviewInStore`) are visa-stage, not
document-stage. Groups run 30–50 pilgrims × 8 requirements ≈ 400 rows, and the spec's operations are
all set-based.

### F9 — Group document readiness is a single boolean

`auto_source = 'DOCUMENTS_ALL_VERIFIED'` collapses the entire document position of a group into one
checkbox. The spec's **By Group** board needs per-requirement completion (`Passport 31/32`,
`Photo 27/32`) and a document-readiness percentage, neither of which is derivable from a boolean.

### F10 — The private bucket has no server-side read path

`createDocumentDownloadUrl()` mints a 120-second signed URL **for a browser**. The AI pipeline needs
to read bytes **on the server**, and the bucket's storage policies (`20260811090000:230`–`248`) are
`to authenticated` — a background job has no user session. Either the pipeline runs inside a request
that has one, or a service-role client is introduced. This is a security decision, not a detail.

### F11 — `getCurrentStaffRole()` defaults everyone to ADMIN

Carried over from the Pilgrims plan (R2). Every capability check in this module routes through
`lib/data/departure-groups.ts:256`, which reads `user_metadata.staff_role` and falls back to
`ADMIN`. This module is where passports and medical certificates are read in bulk and exported, so
it is the module where that default is most dangerous.

---

## 3. Target architecture

### 3.1 Route

**Decision: keep `/documents`.** The spec names `/operations/documents`, but there is no
`app/(main)/operations/` route group, the sidebar entry already points at `/documents` and already
sits inside the sidebar's **Operations** section. Renaming means touching the sidebar, creating a
route group for one page, and breaking any existing link — for zero user-visible gain, since the
breadcrumb is what communicates the hierarchy.

```text
app/(main)/documents/                        →  Home > Operations > Documents
```

If `/operations/*` is later built out as a real section, add
`app/(main)/operations/documents/page.tsx` as a `redirect("/documents")` rather than moving the
module.

### 3.2 Schema

New migration: `supabase/migrations/20260814090000_documents_operations.sql`

**A. Give the document row an identity, an owner, a deadline and an expiry** (fixes F2, F3, F4, F5):

```sql
alter table public.departure_group_pilgrim_documents
  -- F5: a stable machine key. Free-text `name` stays for display.
  add column if not exists document_type text not null default 'OTHER'
    check (document_type in ('PASSPORT_BIO','PASSPORT_ADDITIONAL','PASSPORT_PHOTO','NATIONAL_ID',
                             'VISA_COPY','INSURANCE','VACCINATION','MEDICAL','EMERGENCY_CONTACT',
                             'PAYMENT_PROOF','FLIGHT_TICKET','HOTEL_VOUCHER','OTHER')),
  -- F2: the person, not the role. `verified_by_role` still gates who *may* sign off.
  add column if not exists assigned_to        uuid references auth.users (id) on delete set null,
  add column if not exists assigned_to_name   text,
  add column if not exists assigned_at        timestamptz,
  -- F3: every document can expire, not only the passport.
  add column if not exists expires_at         date,
  -- Latest activity, so "Updated 18 min ago" is one column rather than a coalesce of five.
  add column if not exists last_activity_at   timestamptz not null default now(),
  -- Queue ordering. Derived by the prioritiser, persisted so the list can sort on it.
  add column if not exists priority_score     integer not null default 0;

create index if not exists dgpd_assigned_idx on public.departure_group_pilgrim_documents (assigned_to)
  where status in ('NOT_SUBMITTED','SUBMITTED','REJECTED');
create index if not exists dgpd_due_idx      on public.departure_group_pilgrim_documents (due_at)
  where status <> 'VERIFIED' and status <> 'NOT_APPLICABLE';
create index if not exists dgpd_expiry_idx   on public.departure_group_pilgrim_documents (expires_at)
  where expires_at is not null;
```

**B. AI findings — one row per analysis run, never overwritten** (fixes F7):

```sql
create table if not exists public.document_ai_analyses (
  id                 uuid primary key default gen_random_uuid(),
  document_id        uuid not null
                       references public.departure_group_pilgrim_documents (id) on delete cascade,
  -- Which file was analysed. A re-upload must not inherit the old verdict.
  file_path          text not null,
  file_checksum      text,                        -- sha-256; powers duplicate detection
  model_id           text not null,               -- e.g. 'claude-opus-5'
  pipeline_version   text not null default 'v1',

  status             text not null default 'QUEUED'
                       check (status in ('QUEUED','RUNNING','COMPLETE','FAILED','SKIPPED')),

  -- Classification
  detected_type      text,                        -- same vocabulary as document_type
  type_confidence    numeric(5,2) check (type_confidence between 0 and 100),

  -- Overall verdict
  verdict            text not null default 'PENDING'
                       check (verdict in ('PENDING','PASS','WARNING','BLOCKED','ERROR')),
  confidence         numeric(5,2) check (confidence between 0 and 100),
  recommended_action text
                       check (recommended_action is null or recommended_action in
                         ('VERIFY','REQUEST_BETTER_COPY','REJECT','MANUAL_REVIEW','NOT_APPLICABLE')),
  recommendation_reason text,

  -- Structured extraction, as returned by the model's JSON schema.
  extracted          jsonb not null default '{}'::jsonb,
  -- One entry per rule: { code, label, outcome: PASS|WARN|FAIL, detail }
  checks             jsonb not null default '[]'::jsonb,
  -- Staff-reviewed draft follow-up. Never sent automatically.
  drafted_message    text,

  input_tokens       integer,
  output_tokens      integer,
  error_message      text,
  created_at         timestamptz not null default now(),
  completed_at       timestamptz
);

create index if not exists document_ai_analyses_doc_idx
  on public.document_ai_analyses (document_id, created_at desc);
-- The AI Flagged queue.
create index if not exists document_ai_analyses_open_idx
  on public.document_ai_analyses (verdict, confidence)
  where status = 'COMPLETE' and verdict in ('WARNING','BLOCKED');
-- Duplicate / reused-file detection.
create index if not exists document_ai_analyses_checksum_idx
  on public.document_ai_analyses (file_checksum) where file_checksum is not null;
```

Plus a **latest-analysis cache** on the document row, so the list can filter and sort without a
lateral join per row — written by the same function that completes an analysis:

```sql
alter table public.departure_group_pilgrim_documents
  add column if not exists ai_analysis_id uuid references public.document_ai_analyses (id) on delete set null,
  add column if not exists ai_verdict     text
    check (ai_verdict is null or ai_verdict in ('PASS','WARNING','BLOCKED','ERROR')),
  add column if not exists ai_confidence  numeric(5,2);

create index if not exists dgpd_ai_idx on public.departure_group_pilgrim_documents (ai_verdict)
  where ai_verdict in ('WARNING','BLOCKED');
```

**C. Reviews, overrides and rework — the audit trail the spec demands**:

```sql
create table if not exists public.document_review_events (
  id              uuid primary key default gen_random_uuid(),
  document_id     uuid not null
                    references public.departure_group_pilgrim_documents (id) on delete cascade,
  actor_id        uuid references auth.users (id) on delete set null,
  actor_name      text not null default 'System',
  actor_role      text,
  action          text not null
                    check (action in ('REQUESTED','UPLOADED','AI_ANALYSED','ASSIGNED','DRAFT_SAVED',
                                      'VERIFIED','REJECTED','REWORK_REQUESTED','WAIVED',
                                      'REMINDER_SENT','AI_OVERRIDDEN','EXPIRY_FLAGGED')),
  from_status     text,
  to_status       text,
  reason_code     text,                 -- BLURRED | EXPIRY_INSUFFICIENT | MISSING_PAGE | NAME_MISMATCH | OTHER
  note            text,
  -- Set when staff verified against an AI WARNING/BLOCKED. Spec: log every override.
  overrode_ai_analysis_id uuid references public.document_ai_analyses (id) on delete set null,
  override_reason text,
  created_at      timestamptz not null default now()
);
create index if not exists document_review_events_doc_idx
  on public.document_review_events (document_id, created_at desc);
```

Append-only, enforced the same way `pilgrim_activity_logs` is: **grant insert and select policies
only, never update or delete.**

**D. The read shape the module consumes** (fixes F1) — the single most important object in this
plan:

```sql
create or replace view public.document_queue_rows as
select
  d.id                    as document_id,
  d.requirement_id, d.name, d.category, d.document_type,
  d.required, d.required_by_stage, d.verified_by_role,
  d.status, d.file_path, d.file_name, d.rejection_reason, d.notes,
  d.submitted_at, d.verified_at, d.verified_by_name,
  d.due_at, d.expires_at, d.visible_in_portal, d.last_activity_at, d.priority_score,
  d.assigned_to, d.assigned_to_name,
  d.ai_verdict, d.ai_confidence, d.ai_analysis_id,

  p.id                    as pilgrim_id,
  p.reference             as pilgrim_reference,
  p.full_name, p.whatsapp_number, p.passport_number, p.passport_expiry,

  e.id                    as journey_id,
  e.seat_status, e.visa_status, e.journey_status,
  e.documents_completed, e.documents_required, e.document_completion_percent,

  g.id                    as departure_group_id,
  g.group_name, g.group_code, g.journey_type, g.departure_date, g.return_date,
  g.branch, g.group_status
from public.departure_group_pilgrim_documents d
join public.departure_group_pilgrims e on e.id = d.pilgrim_id
join public.pilgrims               p on p.id = e.pilgrim_id
join public.departure_groups       g on g.id = d.departure_group_id
where e.seat_status <> 'CANCELLED';

comment on view public.document_queue_rows is
  'One row per document requirement per pilgrim, joined to the person and the group it blocks. The Documents Operations page reads this instead of joining four tables itself.';
```

> Note the join: `departure_group_pilgrim_documents.pilgrim_id` references
> `departure_group_pilgrims.id` — the **enrolment**, not the person (see `20260811090000:53`). The
> person is one hop further. Getting this backwards is the single easiest mistake to make in this
> module.

**E. Backfills**, in this order:

1. `document_type` from the requirement name, using the same keyword table
   `derivableRuleFor()` uses — then **replace the regex matching in
   `evaluateDerivableDocuments()` with a `document_type` switch**, which is the real fix for F5.
2. `due_at` from `required_by_stage` against the group's `departure_date` (§3.4).
3. `expires_at` for passport-linked rows from `departure_group_pilgrims.passport_expiry`.
4. `last_activity_at = coalesce(verified_at, submitted_at, created_at)`.
5. `visible_in_portal` from the snapshot once F6 is fixed in `departure-groups-copy.ts`.

**RLS.** Same posture as every existing table — `enable row level security`, authenticated read and
write — except `document_review_events`, which gets **insert + select only**. Whether a role may see
a given passport stays an application-layer decision, exactly as
`departure-groups-access.ts` documents.

### 3.3 Data layer — mirror the existing shape exactly

```text
lib/types/documents.ts                snake_case row types (mirrors lib/types/pilgrims.ts)
lib/data/documents.ts                 view models + PURE mutators returning { ok, error }
lib/data/documents-repository.ts      load / persist by diff (mirrors pilgrims-repository.ts)
lib/data/documents-queue.ts           queue derivation: status axis, due/expiry, priority score
lib/data/documents-readiness.ts       per-group, per-requirement completion + readiness percent
lib/data/documents-ai.ts              pipeline orchestration (see §5) — server only
lib/data/documents-copy.ts            reason codes, message templates, WhatsApp/portal drafts
lib/access/documents-access.ts        DocumentCapabilities per StaffRole
lib/validations/documents.ts          zod schemas for every action input
```

Non-negotiable conventions carried over from Pilgrims and Leads:

- **Pure mutators over a loaded store**, so they lift into Server Actions unchanged and the
  repository writes back only the diff.
- **Derived, never stored**, for anything time-relative: "days remaining", "due soon", "overdue",
  "expiring within 6 months". Computed from the `nowIso` the Server Component serialises down, so
  server render and hydration agree.
- **Capabilities decide what is fetched, not just rendered.** Passport numbers and file paths are
  nulled in the repository for roles without the capability — they never reach a Client Component.
- **`newId()` in the application**, so a document mutation and its review event flush in one write.
- **Reuse, do not re-implement, `departure-groups-documents.ts`.** `verifyPilgrimDocumentInStore`
  and friends already encode the role gate, the derivable-requirement guard, the "nothing received
  yet" guard and the counter/visa resync. The Documents module's actions call the existing wrappers
  in `lib/data/departure-groups.ts` and add only the review-event write and the assignment/AI
  fields on top. Two verify paths that can drift is the failure mode to avoid.

**Two derived values are persisted deliberately**, for the same reason `journey_status` is:

| Value | Why persisted | Recomputed by |
|---|---|---|
| `due_at` | The list filters and sorts on it; a pure function cannot be indexed | `syncDocumentSchedule()`, called from the same place `syncPilgrimDerivedState()` is |
| `priority_score` | "Update queue priority" is an explicit AI responsibility, and the default sort | `scoreDocument()`, on every status/AI/assignment change |

### 3.4 Due dates and expiry

`due_at` is derived once, from the stage the template already declares, against the group's
departure date:

| `required_by_stage` | `due_at` |
|---|---|
| `ON_BOOKING` | booking `created_at` + 3 days |
| `BEFORE_VISA_SUBMISSION` | departure − 21 days (matches readiness item `gr-11`) |
| `BEFORE_FINAL_PAYMENT` | departure − 14 days (matches `gr-10`) |
| `BEFORE_DEPARTURE` | departure − 7 days |

These offsets are a **configuration table in `documents-copy.ts`, not literals in the mutator** — an
agency that submits visas 30 days out must be able to change one place.

`expires_at` is populated per type: passport rows mirror `passport_expiry`; insurance, visa and
vaccination rows are populated by AI extraction (§5) and are editable in the review drawer.
**Expiring Soon** = `expires_at` earlier than the group's `return_date` plus the configured
threshold — reusing `PASSPORT_VALIDITY_MONTHS = 6` from `…-documents.ts:72` as the default so the
Documents page and the visa gate never disagree.

### 3.5 Capability matrix (`lib/access/documents-access.ts`)

| Capability | ADMIN | CEO | FINANCE | MARKETING | OPERATIONS | VISA | GUIDE |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| `viewModule` | ✓ | ✓¹ | ✓² | ✓³ | ✓ | ✓ | — |
| `viewDocumentFile` | ✓ | ✓ | ✓² | — | ✓ | ✓ | — |
| `uploadOnBehalf` | ✓ | — | ✓² | — | ✓ | ✓ | — |
| `verifyDocuments` | ✓ | — | ✓² | — | ✓ | ✓ | — |
| `requestRework` / `rejectDocuments` | ✓ | — | ✓² | — | ✓ | ✓ | — |
| `waiveRequirement` | ✓ | — | — | — | ✓ | ✓ | — |
| `assignReviewer` | ✓ | — | — | — | ✓ | ✓⁴ | — |
| `sendReminders` | ✓ | — | ✓² | ✓³ | ✓ | ✓ | — |
| `runAiScan` / `viewAiFindings` | ✓ | ✓¹ | — | — | ✓ | ✓ | — |
| `overrideAiFinding` | ✓ | — | — | — | ✓ | ✓ | — |
| `manageAgentSettings` | ✓ | — | — | — | ✓ | — | — |
| `bulkActions` | ✓ | — | — | — | ✓ | ✓ | — |
| `exportChecklist` | ✓ | ✓ | ✓² | — | ✓ | ✓ | — |
| `exportVisaPack` / `downloadVerifiedFiles` | ✓ | — | — | — | ✓ | ✓ | — |
| `readOnly` | — | ✓ | — | — | — | — | — |

¹ CEO sees the compact read-only KPI strip, group risk and critical alerts. No queue actions, no
bulk, no file downloads beyond what `viewSensitiveTravellerData` already grants.
² Finance is scoped to `document_type = 'PAYMENT_PROOF'` **in the repository's `where` clause**, not
in the UI.
³ Marketing may send approved reminder templates but must never see passport, NIC or medical files.
Enforced by nulling `file_path`, `passport_number` and any `extracted` payload in the repository.
⁴ Visa may assign within the visa-gated stages (`ON_BOOKING`, `BEFORE_VISA_SUBMISSION`).

Two rules the capability layer must enforce beyond a boolean:

- **Scoping is a query filter, not a UI filter.** Finance's payment-proof scope and Guide's
  exclusion are `where` clauses in `documents-repository.ts`, matching how `assignedGroupOnly`
  already works for Pilgrims.
- **`verifyDocuments` does not bypass `canRoleVerify()`.** The template still names the signing
  role; the capability only says the role may act at all.

---

## 4. Screens

### 4.1 Operations list — `/documents`

Files, mirroring `app/(main)/pilgrims/` one-for-one:

```text
app/(main)/documents/page.tsx                        Server Component, force-dynamic, resolves role
app/(main)/documents/documents-store.tsx             Context provider + Server Action callers
app/(main)/documents/types.ts                        Queues, saved views, filters, KPI shape
app/(main)/documents/utils.ts                        Labels, tones, formatters, sort, filter, KPIs
app/(main)/documents/actions.ts                      "use server" — every mutation
app/(main)/documents/csv.ts                          Checklist + visa-pack exports (role-aware)
app/(main)/documents/components/documents-list.tsx   Header + KPIs + alerts + tabs + filters + table
app/(main)/documents/components/documents-metrics.tsx    KpiRow of KpiCard, each a quick filter
app/(main)/documents/components/critical-alerts.tsx      3–5 severe issues, each a precise filter link
app/(main)/documents/components/ai-agent-panel.tsx       Compact right-hand agent panel
app/(main)/documents/components/group-board.tsx          "By Group" secondary view
app/(main)/documents/components/review-document-sheet.tsx  Two-column review drawer
app/(main)/documents/components/request-rework-dialog.tsx  Reason + drafted message + send channel
app/(main)/documents/components/bulk-actions-bar.tsx       Selection-driven action row
app/(main)/documents/components/assign-reviewer-dialog.tsx
app/(main)/documents/components/upload-document-dialog.tsx
app/(main)/documents/components/request-documents-sheet.tsx
app/(main)/documents/components/agent-settings-sheet.tsx
app/(main)/documents/documents-table/documents-columns.tsx
app/(main)/documents/documents-table/documents-data-table.tsx
app/(main)/documents/documents-table/document-table-sorting.tsx
```

- **Header** — `PageHeader` with breadcrumb `Home > Operations > Documents`, the spec's subtitle, and
  actions `[Upload Document] [Request Documents] [AI Agent Settings]`. Upload Document is the
  primary (`variant="secondary"`, matching `pilgrims-list.tsx:169`) because staff upload on behalf
  of pilgrims; the rest collapse into a `⋯` menu below `md`.
- **KPIs** — five `KpiCard`s in a `KpiRow`, each setting a quick filter on click. `KpiRow` is
  `lg:grid-cols-4`, so the fifth wraps — `pilgrims-list.tsx` worked around this by commenting the
  fifth card out. **Do not repeat that.** Pass a `className` override at the call site, or accept the
  2+3 wrap. For `role === "CEO"` render the same five as plain, non-clickable cards.
- **Critical alerts** — directly below the KPIs, capped at five, sorted by severity then departure
  proximity, generated by `deriveCriticalAlerts()` in `documents-queue.ts`. Each alert's button
  writes a **precise filter set** into the page state (queue + group + type + AI verdict), never a
  generic "open list". Rules:

  | Alert | Condition |
  |---|---|
  | 🔴 Group departs in N days, M pilgrims missing a required document | `departure − now ≤ 7d` and required rows `NOT_SUBMITTED` |
  | 🔴 N passports expire within the validity threshold | `expires_at < return_date + 6 months`, type `PASSPORT_BIO` |
  | 🟠 N uploads unreadable or incomplete | `ai_verdict in (WARNING, BLOCKED)` and `ai_confidence < 80` |
  | 🟠 N documents require re-submission | `status = 'REJECTED'` |
  | 🟠 N documents unassigned in a group departing within 14 days | `assigned_to is null` |

- **Work-queue tabs** — `SavedViewBar` with the eight queues. `By Group` swaps the table for
  `group-board.tsx` rather than filtering it.

  | Queue | Predicate |
  |---|---|
  | All Documents | every row on an active, non-cancelled group |
  | Missing | `status = 'NOT_SUBMITTED' and required` |
  | Awaiting Review | `status = 'SUBMITTED'` |
  | AI Flagged | `ai_verdict in ('WARNING','BLOCKED')` and `status <> 'VERIFIED'` |
  | Rework Required | `status = 'REJECTED'` |
  | Verified | `status = 'VERIFIED'` |
  | Expiring Soon | `expires_at` inside the configured threshold |
  | By Group | group board view |

- **Saved views** — the spec's eight, as a second `SavedViewBar` row or a `FilterSelect` labelled
  *Saved View*: My Review Queue, Departing in 7 Days, Visa Submission Ready, Missing Passport
  Copies, Passport Expiry Risk, AI Low Confidence, Rework Required, Unassigned Documents.
  *My Review Queue* matches on `assigned_to_name === currentStaffName`, the same shape
  `applySavedView(…, currentStaffName)` already uses in Pilgrims.
- **Filters** — `FilterSelect` chips: Departure Group, Document Type, Document Status, AI Finding,
  Journey Type, Due Date, Assigned Reviewer, Branch, plus the `showMoreFilters` toggle from
  `leads-list.tsx` / `pilgrims-list.tsx` for the rest.
- **Search** — one box over pilgrim name, passport number, document id, booking reference and group
  name, wrapped in `useDeferredValue`.
- **Columns** — the spec's nine, built from `ToneBadge` + `ProgressBar` + `PersonChip`, plus a
  leading `Checkbox` column for bulk selection. The AI Result cell is a `ToneBadge` toned by verdict
  with the confidence and the single top finding beneath it in `text-[11px] text-muted-foreground`,
  matching the existing row density.
- **Row click** opens the review drawer. It does **not** navigate — the queue position is the
  operator's place in a work session and must survive a review.

### 4.2 Review drawer

A wide right-side `Sheet` (`sm:max-w-4xl`), two columns on `lg`, stacked below.

```text
LEFT   preview (iframe for PDF, img for images) · zoom / rotate / download · page thumbnails · replace file
RIGHT  requirement details · AI analysis · extracted data · decision · internal note · history
```

- **Preview** uses `createDocumentDownloadUrl()` verbatim. The link is 120 seconds; the drawer
  re-mints on demand rather than holding one, and never persists it in state that survives a close.
- **Requirement details** — name, `required_by_stage` label, status, due date, portal visibility,
  and the group + departure countdown.
- **AI analysis card** — classification and confidence, image-quality verdict, the extracted field
  list, and the `checks` array rendered as ✓ / ⚠ / ✗ lines. When no analysis exists the card shows
  `EmptyState` plus a **Run AI scan** button (capability-gated).
- **Extracted data** is **editable and staff-owned**: accepting an extracted passport expiry writes
  it to `expires_at` and, for passports, to `departure_group_pilgrims.passport_expiry` through the
  existing `updatePilgrimRecordInStore()` — which is what makes the six-month rule and the visa gate
  recompute. The AI never writes those fields directly.
- **Decision actions** — `[Verify Document] [Request Better Copy] [Reject] [Save as Draft Review]`.
  Verify is disabled when `canRoleVerify()` says another role owns the requirement, with the reason
  in the tooltip rather than a silent disable.
- **Override** — when `ai_verdict` is `WARNING` or `BLOCKED` and staff choose Verify, the button
  becomes **Verify anyway** and a required *Reason for override* textarea appears. The action writes
  `document_review_events` with `action = 'AI_OVERRIDDEN'`, the `overrode_ai_analysis_id` and the
  reason. Not optional, not skippable.
- **Rework dialog** — reason code select (Blurred / Expiry insufficient / Missing page / Name
  mismatch / Other), an editable message pre-filled from `drafted_message` (or a template from
  `documents-copy.ts` when the AI has not drafted one), and `[Send via WhatsApp] [Send via Portal]
  [Save]`. WhatsApp opens `whatsappLink()` — the same "compose, don't send silently" posture
  `requestDocumentAction` already takes in the Pilgrims tab.

### 4.3 AI agent panel

`ai-agent-panel.tsx`, a `Card` in the right rail on `xl`, a collapsible section above the table
below that. Reads counters from `document_ai_analyses` for the current day: processed, auto-
classified, needs human review, high-risk findings, top issue. Actions: `[Review AI Queue]`
(switches to the AI Flagged tab), `[Run Scan on Pending Files]`, `[Agent Settings]`.

**Not a chatbot.** The agent's entire output surface is the findings on rows, the drawer card and
these counters.

### 4.4 Group board — `By Group`

One `Card` per active group: name, pilgrim count, departure countdown, a `ProgressBar` per
requirement type (`Passport 31/32 verified`) toned by `percentTone()`, the critical blockers as a
short list, the document-readiness percentage, and `[Open Group Document Queue]` which filters the
main table to that group. Fed by `computeGroupDocumentReadiness()` in `documents-readiness.ts`.

Readiness percentage weights blockers rather than counting rows equally — a missing passport photo
21 days out is not equivalent to an unsubmitted hotel voucher:

```text
readiness = 100 × Σ(verified × weight) / Σ(applicable × weight)
weight: BEFORE_VISA_SUBMISSION 3 · ON_BOOKING 2 · BEFORE_FINAL_PAYMENT 2 · BEFORE_DEPARTURE 1
```

The weights live in `documents-copy.ts` alongside the due-date offsets.

### 4.5 Bulk operations

A `bulk-actions-bar.tsx` appears above the table when the selection is non-empty:
Assign Reviewer · Send Reminder · Request Rework · Mark as Not Required · Export Document Checklist ·
Export Visa Submission Pack · Download Verified Files.

**There is deliberately no bulk Verify.** The spec forbids it and so does the mutator: a bulk verify
action does not exist in `actions.ts`, so no client can call one. The controlled batch-review
alternative is a *review queue mode* — the drawer gains `[Verify & Next]`, which advances through
the selection one document at a time with each file actually opened. That satisfies the throughput
need without a blind mass-approve.

Every bulk action is one Server Action taking `documentIds: string[]`, running the existing
per-document mutator in a loop over one loaded store, and returning
`{ ok, applied, skipped: { name, reason }[] }` — the shape `markApplicationsSubmittedInStore`
already returns, because "8 of 12 updated" with no names is not actionable.

### 4.6 Portal projection

Deferred to the Pilgrims module's phase 9 `(portal)` route group. This module's obligation is to
make the projection *possible*: honour `visible_in_portal` (F6), keep `rejection_reason` customer-
safe, and ensure the customer projection is built in the repository — `ai_confidence`,
`document_ai_analyses`, `document_review_events`, internal notes and any other pilgrim's row are
never in the payload.

---

## 5. AI Document Agent

### 5.1 Posture

The agent is a **workflow engine that produces findings**, not an approver. Three invariants, each
enforced in code rather than in a prompt:

1. **The AI can never set `VERIFIED`.** `verifyPilgrimDocumentInStore()` requires a `GroupActor`
   with a real `actor.id`; the pipeline has no actor and calls no verify path. There is no code path
   from an analysis to a verified status.
2. **Every AI-contradicting decision is logged.** `document_review_events.overrode_ai_analysis_id`.
3. **Analyses are immutable and file-scoped.** A new upload writes a new analysis row; the old one
   stays as history. `file_checksum` on the row is what makes "this exact file was already submitted
   for someone else" answerable.

### 5.2 Pipeline

```text
Document uploaded (existing signed-URL flow, unchanged)
        ↓  submitDocumentAction records file_path
File safety scan      MIME + magic bytes + size; PDF page count
        ↓
Checksum + duplicate  sha-256; match against document_ai_analyses.file_checksum
        ↓
Classify              document_type + confidence
        ↓
Extract               structured fields per type (JSON schema)
        ↓
Quality validation    blur / crop / glare / MRZ legibility / face + framing for photos
        ↓
Rule checks           expiry vs threshold, required pages present, name/DOB vs pilgrim profile
        ↓
Verdict + confidence  PASS | WARNING | BLOCKED, recommended action, drafted follow-up
        ↓
Persist               document_ai_analyses row + cache on the document + priority_score
        ↓
Human reviewer        verifies / rejects / requests rework  ← the only path to VERIFIED
        ↓
Readiness recalculated (syncPilgrimDerivedState + group readiness)
```

Classification, extraction, quality and the drafted message are **one model call per document**, not
four. The rule checks and the profile comparison run in TypeScript afterwards, against the extracted
JSON — dates, name matching and threshold arithmetic are deterministic and do not belong in a model.

### 5.3 Implementation

`lib/data/documents-ai.ts`, server-only, using the official SDK:

- **Dependency:** `@anthropic-ai/sdk`. `ANTHROPIC_API_KEY` in `.env.local` (currently only the two
  Supabase vars are set) — **server-side only, never `NEXT_PUBLIC_`**.
- **Model:** `claude-opus-5` for extraction and verdicts. A cheaper `claude-haiku-4-5` pass is worth
  measuring for pure classification once volumes are known, but do not split the pipeline for it up
  front.
- **Input:** images as base64 `image` blocks; PDFs as `document` blocks (base64, ≤ 32 MB). Both are
  already inside the bucket's 10 MB cap. Bytes are read **server-side** — see F10 below.
- **Output:** structured outputs (`output_config: { format: { type: "json_schema", schema } }`) with
  one schema per `document_type`, so `extracted` and `checks` are parseable without regex. The
  schemas live in `lib/validations/documents.ts` beside the zod schemas that re-validate the model's
  output before it is persisted — **the API guarantees shape, not truth.**
- **Adaptive thinking** (`thinking: { type: "adaptive" }`) with `output_config.effort` at `medium`
  for classification-only re-scans and `high` for full extraction.
- **Prompt caching** on the shared system prompt and the per-type instruction block, which is stable
  across every document of a type.
- **Refusals:** check `stop_reason === "refusal"` before reading `content`, and record the analysis
  as `status = 'FAILED'` with the reason. A refusal is never a `PASS`.
- **Bulk re-scans** ("Run Scan on Pending Files") go through the **Message Batches API** at half
  price, polled by a Server Action, with each request's `custom_id` set to the document id.

### 5.4 Where the pipeline runs, and the storage problem (F10)

The bucket's storage policies are `to authenticated`, and `createDocumentDownloadUrl()` mints a
browser-facing signed URL after checking the caller's role. A background job has no session.

**Decision: run the analysis inside the request that already has a session.** `submitDocumentAction`
kicks off `analyseDocument()` after recording the file; the Server Action returns as soon as the
`QUEUED` row is written, and the analysis completes in the same server process. This needs no new
credential and no new trust boundary.

The cost is that a batch re-scan of 400 documents cannot be driven this way. When that is needed,
introduce a **service-role Supabase client confined to `lib/data/documents-ai.ts`**, never exported,
never imported by a component — and document it as the one place the module bypasses RLS. Prefer
deferring this until batch volume actually justifies it.

### 5.5 Checks by document type

| Type | Extracted | Checks |
|---|---|---|
| `PASSPORT_BIO` | full name, passport no., nationality, DOB, sex, issue/expiry, MRZ lines | bio-page detected · text legible · MRZ present and parseable · expiry ≥ return + 6 months · name matches profile · DOB matches profile |
| `PASSPORT_PHOTO` | — | face present · single face · framing/crop ratio · background lightness · min dimensions · blur/low-resolution |
| `NATIONAL_ID` | NIC number, name, DOB, front/back | side classified · number legible · name matches · NIC-derived DOB agrees with profile |
| `INSURANCE` | provider, policy no., insured name, coverage start/end | insured name matches · coverage spans departure→return · not expired |
| `PAYMENT_PROOF` | amount, currency, date, reference, bank/channel | receipt or slip classified · amount and date extracted · reference not seen on another pilgrim (duplicate risk) |
| `VISA_COPY` | visa number, type, validity, holder name, passport no. | passport number matches profile · validity covers the journey · not expired |
| `VACCINATION` / `MEDICAL` | document title, named individual, issue date, expiry | document present · names the pilgrim · dated · not expired. **No eligibility judgement, ever** |

Day-one scope is **passport bio-page, passport photo, NIC, insurance and payment proof**. The
remaining types are classified and quality-checked only; their extraction schemas ship later. The
UI must say so — an un-extracted type shows "Classification only" in the AI card rather than an
empty extraction table that reads as a failure.

### 5.6 Confidence bands and priority

```text
90–100  PASS      high confidence — recommend verify, still requires a human click
70–89   WARNING   needs staff review
< 70    BLOCKED   strong warning, rework likely
```

Thresholds are configurable in the Agent Settings sheet and stored in `documents-copy.ts` defaults
until an agency-settings table exists. `scoreDocument()` combines: departure proximity (dominant),
stage weight, AI verdict, days overdue, and whether the document gates visa submission.

---

## 6. Build phases

Following the spec's own build order.

| Phase | Scope | Depends on |
|---|---|---|
| **0. Foundation** | Migration §3.2, backfills, `document_queue_rows` view, `lib/types/documents.ts`, repository, access layer, validations. Fix F5 (`document_type` switch replaces the name regex) and F6 (`visibleInPortal` in the snapshot copy) | — |
| **1. Operations list** | `/documents` to spec: KPIs, alerts, queue tabs, saved views, filters, columns, review drawer opening read-only | 0 |
| **2. Requirement records** | Due-date derivation, expiry population, `last_activity_at`, `syncDocumentSchedule()` wired into the existing sync path | 0 |
| **3. Upload & preview** | Upload-on-behalf dialog and the drawer's preview column, reusing `document-storage.ts` verbatim | 1 |
| **4. Review workflow** | Verify / reject / rework / waive from the drawer, reason codes, drafted messages, `document_review_events` | 3 |
| **5. Group readiness** | `documents-readiness.ts`, the By Group board, weighted readiness, group-risk KPI | 1, 2 |
| **6. Bulk operations** | Selection, bulk bar, bulk assign / remind / rework / not-required / exports. `Verify & Next` review mode | 4 |
| **7. AI classification & quality** | `documents-ai.ts`, `document_ai_analyses`, one model call per document, findings on rows and in the drawer, agent panel | 4 |
| **8. Passport OCR & expiry matching** | Extraction schemas, staff-accepted field writeback into the traveller record, Expiring Soon queue fed by real expiry data | 7 |
| **9. Mismatch, duplicate & prioritisation** | Checksum duplicates, profile mismatch checks, `priority_score`, override logging surfaced in history | 8 |
| **10. Portal** | Honour `visible_in_portal` in the customer projection; deferred to the Pilgrims `(portal)` route group | 4 |

Phases 5 and 6 are independent of each other once 4 lands and can be parallelised. Phase 7 must not
start before 4 — an AI finding with no human review workflow to feed is a demo, not a feature.

---

## 7. Decisions and risks

| # | Decision | Rationale / risk |
|---|---|---|
| D1 | Keep `/documents`; do not create `/operations/documents` | The sidebar already places it under Operations and points at `/documents`. The breadcrumb carries the hierarchy. Risk: the spec's URL is not honoured literally — add a redirect if `/operations/*` is ever built |
| D2 | `document_queue_rows` view rather than a client-side join | One read shape, indexable, mirrors `pilgrim_journey_rows`. Risk: views are not automatically indexed — the `where` clauses must hit the base-table indexes listed in §3.2 |
| D3 | Reuse `departure-groups-documents.ts` mutators; add only review events and assignment on top | Two verify paths that can drift is the failure mode. Risk: those mutators take a `departureGroupId`, so the Documents actions must resolve it per document — cheap, since the view carries it |
| D4 | `document_type` enum, and `evaluateDerivableDocuments()` switches on it | Fixes a latent bug where renaming a package requirement changes system behaviour. Risk: the backfill must map every existing free-text name; unmapped rows land on `OTHER` and lose their derivable behaviour — **the backfill needs a verification query, not just an UPDATE** |
| D5 | `due_at` and `priority_score` derived **and** persisted | Pure derivation cannot be indexed or sorted at the database. Risk: drift — mitigated by computing each in exactly one function called from the existing sync path |
| D6 | AI analyses are append-only rows, with a cache on the document | History survives re-uploads; the list stays a single-table scan. Risk: the cache and the latest row can disagree if a write fails halfway — write both in one mutator, never separately |
| D7 | No bulk Verify, at any layer | The spec forbids it and the action simply does not exist. The `Verify & Next` mode covers the throughput need with each file actually opened |
| D8 | Pipeline runs in the request that has a session; service-role client deferred | Avoids introducing an RLS-bypassing credential before it is needed. Risk: batch re-scan of a whole group is not possible until that lands — the Agent panel's "Run Scan on Pending Files" must be capped (e.g. 25 documents) until then |
| D9 | Structured outputs + zod re-validation | The API guarantees the shape; only zod and the rule checks guarantee it is sane. Never persist a model's field straight into `passport_expiry` |
| D10 | Day-one extraction limited to passport, photo, NIC, insurance, payment proof | The spec explicitly warns against claiming every type works. The UI must label classification-only types |
| D11 | No new shared components | Everything the spec draws exists in `components/`. New work is composition only |
| R1 | **`getCurrentStaffRole()` defaults everyone to ADMIN** (`lib/data/departure-groups.ts:256`) | Every capability check in this module routes through it. This module reads passports and medical certificates in bulk and exports them. **Recommend landing a staff-roles table before phase 6 (bulk exports), not after** |
| R2 | **AI cost is unbounded by default** | 400 documents per group × re-uploads × re-scans. Mitigations: cache the system prompt, skip re-analysis when `file_checksum` is unchanged, use the Batches API for anything bulk, cap the manual scan button, and record `input_tokens`/`output_tokens` per analysis so cost is measurable from day one |
| R3 | **Extraction is PII leaving the building** | Passport numbers, DOBs and NIC numbers go to an external API. This needs an explicit decision from the agency, a note in the AI card that analysis is performed by a third-party model, and a per-agency kill switch in Agent Settings. Do not ship phase 8 without it |
| R4 | **Signed URLs are 120 seconds** | Long PDFs and slow connections will fail mid-preview. The drawer must re-mint on demand rather than treating a failed load as a missing document |
| R5 | **`departure_group_pilgrim_documents.pilgrim_id` points at the enrolment, not the person** | The easiest mistake in this module. The view in §3.2 is the only place the join is written; nothing else should join these tables by hand |
| R6 | Duplicate detection by checksum catches identical files, not re-photographed ones | A pilgrim re-photographing the same receipt defeats it. Phase 9's mismatch checks (amount + date + reference across pilgrims) are the real control; checksum is the cheap first pass |

---

## 8. Suggested sequencing

1. **Phase 0 + 2 together.** The migration and the due-date/expiry derivation are one coherent
   change: the columns are useless unsized and the derivation has nowhere to write without them.
2. **Phase 1.** The list is immediately useful on its own — it is the first time anyone can see
   every outstanding document in the agency — and it validates the view shape before anything is
   built on top of it.
3. **Phase 3 + 4.** Upload and review turn the page from a report into a workspace.
4. **Phases 5 and 6 in parallel** if more than one person is working.
5. **Staff-roles table** (R1) before phase 6 ships bulk exports.
6. **The PII decision** (R3) before phase 7 sends the first file to an external model.
7. **Phases 7, 8, 9**, then 10 alongside the Pilgrims portal work.
