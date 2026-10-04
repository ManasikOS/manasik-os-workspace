# Operations Module — Implementation Plan

Build the **Operations Control Center** at `/operations` on the same data, access and action
architecture already used by **Packages**, **Departure Groups**, **Leads**, **Pilgrims**,
**Documents** and **Visa**.

Status: **plan only. Nothing in here is implemented.**

The product rule the whole plan enforces:

> **Documents answers "is the file valid?". Visa answers "can this pilgrim get approval to travel?".
> Operations answers "is every real group ready to execute?" — flights, hotels, transport, catering,
> guides, rooming, tasks, supplier confirmations and group-level risk, across every active group at
> once. It is cross-group and exception-first.**

And the boundary it must not cross:

```text
Departure Group page  →  detailed operations for ONE specific group
Operations page       →  agency-wide operational queue ACROSS every active group
```

The Operations page never becomes a second place to edit a group's full detail. It is a queue: it
surfaces the exception, names the owner, and hands off to the group where the detail already lives.

---

## 1. What exists today

### 1.1 The route

| File | State |
|---|---|
| [app/(main)/operations/page.tsx](app/(main)/operations/page.tsx) | **Stub.** Seven lines, returns `<div>OperationsPage</div>`. Untracked in git (`?? app/(main)/operations/`). |
| [components/app-sidebar.tsx:76](components/app-sidebar.tsx:76) | Nav entry `Operations → /operations`, already inside the sidebar's **Operations** group (`adminBar[2]`, beside Documents and Visa). **The spec's navigation requirement is already satisfied — no sidebar change is needed.** |

No other file in the codebase links to `/operations`. There are no stale deep links to reconcile
(unlike Visa's `/visa` vs `/visas` split).

### 1.2 What already exists and is the real starting point

This is **not** a greenfield module. Almost every operational fact the spec asks for is already
modelled, persisted and mutated — but only ever **one group at a time**. What is missing is the
cross-group surface, four workflow concepts (task priority, supplier confirmation evidence, briefing
state, transport risk), and the categories of service that have no schema home.

| Concern | Where it already lives | Fitness for the spec |
|---|---|---|
| Group identity, dates, capacity, guides, owners, emergency phone, WhatsApp links | `departure_groups` ([20260809090000](supabase/migrations/20260809090000_create_departure_groups.sql)) | **Complete.** `primary_guide_name`, `backup_guide_name`, `operations_owner_name`, `visa_owner_name`, `finance_owner_name`, `local_coordinator_name/phone`, `emergency_phone`, `guide_whatsapp_link`, `pilgrim_broadcast_link` all exist |
| Flights | `departure_group_flights` + `…_flight_legs` | **Near-complete** for the cross-group queue: `status` (`DRAFT·HELD·CONFIRMED·TICKETED·CANCELLED`), `airline`, `flight_number`, `pnr`, `seat_capacity`, `seats_held`, `seats_ticketed`, `ticketing_deadline`, `supplier_name` |
| Accommodation | `departure_group_accommodations` | `city`, `hotel_name`, `supplier_name`, `booking_reference`, `status` (`SupplierStatus`), `check_in_date`/`check_out_date`, `room_capacity`, `rooms_reserved`, `rooms_allocated`, `voucher_url`, `internal_cost` |
| Rooming | `departure_group_rooms`, `…_room_assignments`, `departure_group_pilgrims.room_assignment_status` | Room capacity, per-room occupancy, per-pilgrim assignment state. Auto-assign already exists (`autoAssignRoomsInStore`) |
| Transport | `departure_group_transports` | `route_label`, `origin`/`destination`, `status`, `supplier_name`, `booking_reference`, `vehicle_type`, `vehicle_capacity`, `passenger_count`, `pickup_at`, `pickup_location`, `driver_name`, `driver_phone`, `coordinator_name/phone`, `confirmation_url` |
| Tasks | `departure_group_tasks` ([20260809090000:428](supabase/migrations/20260809090000_create_departure_groups.sql:428)) | `title`, `description`, `owner_id`, `owner_name`, `due_at`, `status` (`OPEN·IN_PROGRESS·COMPLETE·OVERDUE`), `category` (`OPERATIONS·VISA·FINANCE·GUIDE·MARKETING·OTHER`), `linked_readiness_item_id`. **Missing priority, BLOCKED, non-readiness links — see F3–F7** |
| Readiness checklist + weighted scoring | `departure_group_readiness_items` + `scoreReadiness()` ([lib/data/departure-groups.ts:424](lib/data/departure-groups.ts:424)) | **This is the spec's readiness engine, already built.** `CATEGORY_WEIGHT` is exactly the spec's Critical(3)/High(2)/Standard(1) severity weighting; `READY·AT_RISK·BLOCKED·NOT_STARTED` are exactly the spec's four labels; `categories[]` already returns per-category `percent` |
| Auto-derived readiness | `deriveReadinessStatuses()` ([lib/data/departure-groups-readiness.ts:36](lib/data/departure-groups-readiness.ts:36)) + `ReadinessAutoSource` | `FLIGHT_OUTBOUND_CONFIRMED`, `HOTEL_MAKKAH_CONFIRMED`, `HOTEL_MADINAH_CONFIRMED`, `TRANSPORT_*_CONFIRMED`, `ROOMING_COMPLETE`, `GUIDE_ASSIGNED`, `MANIFEST_READY`, `PAYMENTS_COLLECTED_IN_FULL`, `DOCUMENTS_ALL_VERIFIED`, `VISAS_ALL_APPROVED`. **A readiness item carrying one of these cannot be ticked by hand** — the "do not allow staff to mark confirmed without evidence" rule already holds for readiness |
| **Blockers** | `buildBlockers()` ([lib/data/departure-groups.ts:869](lib/data/departure-groups.ts:869)) | Produces, per group, exactly the spec's alert sentences: *"Makkah hotel confirmation is missing"*, *"Rooming list is 24 / 40 assigned"*, *"No primary guide has been assigned"*, *"N bookings have overdue balances"*, visa-pending, visa-refused, passport-validity. **Severity-sorted, capped at 5.** This is the Critical Operations Alerts feed, needing only to be run across all groups |
| Supplier status lines | `buildSupplierLines()` ([lib/data/departure-groups.ts:1028](lib/data/departure-groups.ts:1028)) | Flights + each hotel + each transport route, as `{ label, status, tab }` — the seed of the Upcoming Groups card's service rows |
| Activity trail | `departure_group_activity_logs` | Append-only, `is_high_impact` flag, `entity_type` covering `FLIGHT·ACCOMMODATION·ROOM·TRANSPORT·TASK·DOCUMENT·VISA·PAYMENT`. Already written by every mutator, including the visa transitions the Visa module calls through |
| Guide run sheet + briefing UI | [guide-operations-tab.tsx](app/(main)/departure-groups/[groupId]/components/tabs/guide-operations-tab.tsx) (467 lines) | Run-sheet composition and CSV export **already written**, per group. Reuse its row builder verbatim |
| Unit of work | `loadStore` / `snapshotStore` / `persistStore` ([lib/data/departure-groups-repository.ts](lib/data/departure-groups-repository.ts)) | `loadStore(db, { groupIds?, only?, activityLimit?, includeArchived? })` — **already supports loading every group at once** (`groupIds` omitted = all). `listDepartureGroups()` ([:1072](lib/data/departure-groups.ts:1072)) already does exactly this over eight collections |
| Mutators for every service | `departure-groups-flights.ts`, `-rooming.ts`, `-transport.ts`, `-tasks.ts`, `-readiness.ts` | Pure, store-passing, unit-testable. **Every write Operations needs already exists except the four new concepts** |
| Server Actions + validation | [app/(main)/departure-groups/actions.ts](app/(main)/departure-groups/actions.ts), [lib/validations/departure-groups.ts](lib/validations/departure-groups.ts) (908 lines) | Capability-gated, zod-validated, `revalidatePath`-ing. The Operations actions layer wraps these rather than reimplementing them |
| Role model | `StaffRole` + `capabilitiesFor()` ([lib/access/departure-groups-access.ts](lib/access/departure-groups-access.ts)) | The seven roles the spec's table names, already enumerated |
| Cross-group module precedent | [app/(main)/visa/](app/(main)/visa/), [app/(main)/documents/](app/(main)/documents/) | Page (Server Component) → repository → view-model derivation → Provider → List → KPI/Alerts/Table/Drawer/Dialogs/AI panel. **Copy this shape exactly.** |

### 1.3 The UI vocabulary to reuse — no new components

Everything the spec draws already has a component. **This plan adds zero files under
`components/`, and introduces no new colours, spacing or typography.** New work is composition only.

| Spec element | Existing component |
|---|---|
| Breadcrumb + title + subtitle + header actions | [components/page-header.tsx](components/page-header.tsx) |
| KPI cards row (clickable) | [components/data-table/kpi-card.tsx](components/data-table/kpi-card.tsx) — `KpiCard`, `KpiRow`. Clickable variant: wrap in `<button className="text-left">`, exactly as [visa-metrics.tsx:30](app/(main)/visa/components/visa-metrics.tsx:30) does |
| Critical Operations Alerts | [documents/components/critical-alerts.tsx](app/(main)/documents/components/critical-alerts.tsx) — already renders 🔴 `bg-destructive/10` / 🟠 `bg-amber-500/10` rows with title, detail and an action button. Generalise its props, do not rewrite it |
| Primary tabs (9) | [components/animate-ui/components/animate/tabs.tsx](components/animate-ui/components/animate/tabs.tsx) — `Tabs`/`TabsList`/`TabsTrigger` with `className="flex-wrap h-auto"`, as [departure-group-detail.tsx:539](app/(main)/departure-groups/[groupId]/components/departure-group-detail.tsx:539) |
| Saved views / queue pills | [components/data-table/saved-view-bar.tsx](components/data-table/saved-view-bar.tsx) — `SavedViewBar` |
| Filter chips | [components/data-table/filter-select.tsx](components/data-table/filter-select.tsx) — `FilterSelect` |
| Tables + search + pagination | [components/data-table/data-table.tsx](components/data-table/data-table.tsx) |
| Tables **with row selection + bulk bar** (Operational Tasks needs Bulk Assign / Bulk Update) | fork [visa-table/visa-data-table.tsx](app/(main)/visa/visa-table/visa-data-table.tsx) → `operations-table/operations-data-table.tsx`. The shared `data-table.tsx` deliberately has no selection support; Documents and Visa each forked it for this reason |
| Sortable headers | [components/data-table/sortable-header.tsx](components/data-table/sortable-header.tsx) |
| Status badges, progress bars, owner chips, empty / denied states | [components/ui/tone-badge.tsx](components/ui/tone-badge.tsx) — `ToneBadge`, `ProgressBar`, `PersonChip`, `EmptyState`, `PermissionDenied` |
| Colour vocabulary | [lib/ui/tone.ts](lib/ui/tone.ts) — `Tone`, `TONE_CLASS`, `TONE_BAR`, `percentTone()`. The spec's Green/Amber/Red rooming indicators map onto `success`/`warning`/`danger` with **no new palette** |
| Task drawer (right-side) | [components/ui/sheet.tsx](components/ui/sheet.tsx) |
| Create Task / Add Supplier Booking / reassign / confirm dialogs | [components/ui/dialog.tsx](components/ui/dialog.tsx), `dialog-footer.tsx`, `input.tsx`, `textarea.tsx`, `checkbox.tsx`, `combobox.tsx`, `calendar.tsx` + `popover.tsx` |
| Upcoming-group cards | [components/ui/card.tsx](components/ui/card.tsx) + `section-heading.tsx` |
| Header overflow menus | [components/ui/dropdown-menu.tsx](components/ui/dropdown-menu.tsx), `button-group.tsx` |
| Feedback | [components/ui/toast.tsx](components/ui/toast.tsx) — `toast.add(...)` |
| CSV export | [lib/csv.ts](lib/csv.ts) + the per-module `csv.ts` pattern (`downloadTextFile`, `timestampedFilename`) |
| Evidence upload | [app/(main)/departure-groups/document-storage.ts](app/(main)/departure-groups/document-storage.ts) — private bucket, signed one-shot upload, 10 MB cap, MIME allowlist |

Two existing screens are close enough to **lift and generalise** rather than rewrite:

- `guide-operations-tab.tsx` — its run-sheet rows, briefing block and CSV export become the Guides &
  Briefings tab's per-group drawer, widened from one group to a board.
- `documents/components/critical-alerts.tsx` + `group-board.tsx` — the alert list and the group
  card grid are structurally identical to the spec's Critical Alerts and Upcoming Groups board.

---

## 2. Findings — the gap between today and the specification

### F1 — The route is a stub, and it is untracked

`app/(main)/operations/page.tsx` renders a bare `<div>`. The sidebar already links it, so **every
user can already reach a broken page today.** Phase 0 must land a real page even before the
migration.

### F2 — There is no cross-group operational read. This is the blocking defect.

Every operational read is scoped to one group: `getDepartureGroupDetail(groupId)` hydrates one
group's whole store. `listDepartureGroups()` is the only all-groups read, and it deliberately loads
a narrow set — `LIST_COLLECTIONS` = groups, snapshots, readinessItems, pilgrims, accommodations,
transports, flights, bookings ([lib/data/departure-groups.ts:232](lib/data/departure-groups.ts:232)).

That is already **eight of the eleven collections Operations needs**. Missing: `tasks`, `rooms`,
`roomAssignments`, `activity`. `loadStore` already accepts an arbitrary `only` set and an omitted
`groupIds` means *all groups*, so **no new database view is required** (D2). What is required is a
new module read that asks for the Operations collection set and derives cross-group view models.

### F3 — Tasks have no priority

The spec's table has a **Priority** column (`Critical · High · Normal · Low`), the alert feed sorts
by it, and the AI agent prioritises on it. `departure_group_tasks` has no priority column, and
`CreateGroupTaskInput` has no priority field.

### F4 — Tasks cannot be BLOCKED

The spec's status set is `Open · In Progress · Blocked · Complete`. The schema's CHECK constraint
allows `OPEN · IN_PROGRESS · COMPLETE · OVERDUE` only. The spec's own worked example
(*"Confirm Makkah hotel booking voucher … Blocked"*) is unrepresentable today.

`OVERDUE` stays as a **derived** status — `createGroupTaskInStore` and
`updateGroupTaskStatusInStore` already compute it from `due_at` vs now, and that behaviour is
correct and must not be lost when `BLOCKED` is added.

### F5 — A task can only link to a readiness item

`linked_readiness_item_id` is the only link. The spec's **Linked Item** column names flight, hotel,
transport, rooming and guide, and the drawer prints "Linked item: Makkah Hotel Booking". A
polymorphic `linked_entity_type` + `linked_entity_id` pair is needed — the `ActivityEntityType`
union is already exactly the right vocabulary to reuse.

### F6 — "Unassigned" is not representable, but is a headline KPI

`owner_name` is `not null default ''` and `createGroupTaskInStore` writes `input.ownerName.trim()`
with no unassigned path. The spec's **Unassigned Operations Work / 4 / Needs an owner** KPI, the
`Unassigned` saved view and the AI agent's "suggest task owners" all need a defined representation.
`owner_id` is also never written — `createGroupTaskInStore` hardcodes `owner_id: null` — so "My
Tasks" can only ever match on a name string.

### F7 — Tasks have no notes, evidence or audit trail

The spec's drawer offers **Add Note** and **Upload Evidence**, and the Activity tab must show
*"Admin reassigned airport transfer task to Operations Team."* Task mutations currently write one
group-activity row and nothing else; there is no per-task timeline, no note record, no evidence path.

### F8 — A supplier service can be marked confirmed with no supplier, no reference and no evidence

This is the spec's one hard prohibition, and today's code violates it.
`markAccommodationConfirmedInStore` ([lib/data/departure-groups-rooming.ts:173](lib/data/departure-groups-rooming.ts:173))
and `markTransportConfirmedInStore` ([lib/data/departure-groups-transport.ts:264](lib/data/departure-groups-transport.ts:264))
both check only *"not already confirmed"* and *"not cancelled"*, then set `status = 'CONFIRMED'`.
Neither requires `supplier_name`, `booking_reference`, `voucher_url`/`confirmation_url`, a
responsible staff member, or a confirmation timestamp — and **no confirmation timestamp column
exists at all** on either table.

Recording a reference (`setAccommodationReferenceInStore`) and a voucher
(`setAccommodationVoucherInStore`) are separate, optional, unordered steps.

### F9 — The supplier workflow has three states the schema cannot express

`SupplierStatus` is `NOT_REQUESTED · REQUESTED · CONFIRMED · COMPLETED · CANCELLED`. The spec's
workflow is:

```text
Not Requested → Requested → Supplier Responded → Confirmation Uploaded → Verified → Completed
```

`Supplier Responded`, `Confirmation Uploaded` and `Verified` have no representation. Note the
precedent the Visa module set for exactly this distinction: **recording is not verifying**
(`visa_verified_at` / `visa_verified_by_name`, [20260815090000:40](supabase/migrations/20260815090000_visa_operations.sql:40)).
Operations must repeat it.

### F10 — Four service categories have no schema home

The spec lists ten categories. Six are modelled: Flights, Makkah accommodation, Madinah
accommodation, Airport transfers, Intercity transport, Ziyarah transport (the last three are all
`departure_group_transports` rows distinguished by `route_label`). **Catering, Guide / Mutawwif,
Travel insurance and Other have no table** — they exist only as free-text readiness items and as a
`CATERING` readiness category with weight 1.

### F11 — There is no supplier record, only a free-text name

`supplier_name` is `text` on accommodations, transports and flights. There is no supplier/broker
entity, so the spec's **Supplier / Broker** column cannot be a link, duplicates are inevitable
("Al Noor Travel Services" vs "Al-Noor Travel"), and the AI agent's "draft supplier follow-up
message" has no contact to address. **Deliberately deferred (D6)** — v1 keeps free text.

### F12 — Flight risk states are not modelled

The spec's top states are `Flights Confirmed · Seats Held · Tickets Issued · Ticketing Deadline
Risk · Passenger Name Mismatch`. The first three derive cleanly from `status` / `seats_held` /
`seats_ticketed`. **Ticketing Deadline Risk** must be derived from `ticketing_deadline` vs now with
a configurable threshold that does not exist. **Passenger Name Mismatch** lives per pilgrim
(`departure_group_pilgrims.flight_status = 'NAME_MISMATCH'`) and has to be counted up to the flight.

### F13 — Rooming status is derived nowhere

The spec's Green / Amber / Red rooming indicator needs: rooms reserved vs bed capacity vs pilgrims
assigned vs pilgrims booked. The parts exist (`rooms_reserved`, `rooms_allocated`, per-room
`occupancy_capacity` / `assigned_pilgrim_count`, per-pilgrim `room_assignment_status`) but nothing
combines them into a status, and **overbooking is not detected anywhere**.

### F14 — Transport warning conditions do not exist

The spec names four:

```text
Vehicle capacity below booked pilgrims
Pickup time missing within 48 hours of pickup
Driver contact missing within 24 hours
Transport not confirmed before configured deadline
```

None is computed, and there is **no configured deadline** — nor any configuration file for the
Operations module at all. Note the trap: two of these are "within N hours of *the pickup*", but
`pickup_at` is the very field that may be missing, so the rule must fall back to the group's
departure date.

### F15 — Guides have no briefing or run-sheet state

`departure_groups` carries `primary_guide_name`, `backup_guide_name`, `guide_whatsapp_link`,
`pilgrim_broadcast_link`, `emergency_phone`. It does **not** carry briefing status, briefing sent
timestamp, or run-sheet state — all three are columns in the spec's guide board. `backup_guide_name`
exists but `backup_guide_id` does not (unlike `primary_guide_id`).

### F16 — Readiness percentages exist per group but not as a matrix

`scoreReadiness()` returns `categories[]` — but **only for categories that actually have items**, in
weight order. The spec's matrix is a fixed grid (Docs, Visa, Pay, Flight, Hotel, Transport, Guide,
Overall) with one row per group. A group with no CATERING items must render `—`, not shift its
columns. Also: the spec's `Docs` column and the engine's `DOCUMENT` category are the same thing, but
`Pay` maps to `PAYMENT` and there is no `Rooming` column in the spec's matrix even though `ROOMING`
is a weighted category — the mapping must be written down, not guessed per component.

### F17 — Activity is group-scoped, with no filters

`departure_group_activity_logs` is queried per group. `loadStore` supports `activityLimit` across all
groups (newest-first) but the spec's filters — group, staff owner, action type, service category,
date range — have no support. Additionally, Visa and Documents write their own timelines
(`visa_application_events`, `document_review_events`), so a naive read of only the group log risks
missing detail — though in practice **every visa transition also writes a group activity row**,
because the Visa actions call through `markGroupApplicationsSubmitted` / `uploadGroupPilgrimVisa`
etc. (D7).

### F18 — There is no Operations capability matrix

`lib/access/departure-groups-access.ts` covers group editing; `documents-access.ts` and
`visa-access.ts` cover their modules. There is no `operations-access.ts`, and the spec's matrix
introduces requirements none of the three encode — notably **CEO read-only by default**, **Finance:
payment blockers and supplier payables, no broad task editing**, and **Guide: assigned group tasks,
run sheet, pilgrim travel details, rooming — but no finance or supplier cost access**.

### F19 — `getCurrentStaffRole()` treats everyone as ADMIN

[lib/data/departure-groups.ts:256](lib/data/departure-groups.ts:256) reads
`user_metadata.staff_role` and falls back to `ADMIN`. Every access decision in this plan flows
through it, so the role matrix is **written correctly but unenforced in practice** until a staff
table lands. Carried forward from the Visa plan (F13 there) — do not re-solve it here, but do not
let it silently invalidate the matrix either.

### F20 — There is no operations report export

The spec's header offers **Export Operations Report**. Each module has its own `csv.ts`
(`documents/csv.ts`, `visa/csv.ts`, `departure-groups/csv.ts` and `xlsx.ts`) built on
[lib/csv.ts](lib/csv.ts). Operations needs its own, and needs to decide what "the report" is — the
current filtered view, or a fixed multi-section brief.

---

## 3. Target architecture

### 3.1 Route

```text
app/(main)/operations/
  page.tsx                       Server Component. Role gate, one hydration, nowIso, Provider
  operations-store.tsx           Context provider (mirrors visa-store.tsx exactly)
  types.ts                       View models re-exported + tabs, saved views, filters
  utils.ts                       Labels, tones, formatters, queue predicates, sorting
  csv.ts                         Operations report + per-tab exports
  actions.ts                     Server Actions ("use server")
  operations-table/
    operations-data-table.tsx    Forked from visa-data-table (row selection + bulk bar)
    task-columns.tsx
    supplier-columns.tsx
    flight-columns.tsx
    accommodation-columns.tsx
    transport-columns.tsx
  components/
    operations-control-center.tsx  The client shell: header, KPIs, alerts, tabs
    operations-metrics.tsx         5 (+1) clickable KPI cards
    operations-alerts.tsx          Critical Operations Alerts
    tabs/
      overview-tab.tsx
      tasks-tab.tsx
      supplier-confirmations-tab.tsx
      flights-tab.tsx
      accommodation-rooming-tab.tsx
      transport-tab.tsx
      guides-briefings-tab.tsx
      group-readiness-tab.tsx
      activity-tab.tsx
    upcoming-groups-board.tsx
    task-drawer.tsx
    create-task-dialog.tsx
    add-supplier-booking-sheet.tsx
    confirm-supplier-dialog.tsx     Enforces the evidence rule (F8)
    assign-owner-dialog.tsx
    assign-guide-dialog.tsx
    briefing-sheet.tsx
    ai-operations-panel.tsx
```

**One route, nine client tabs** — not nested routes. Same call as the Departure Group detail page:
only the active tab is mounted, tab state lives in the shell, and a KPI card or alert can hand a tab
a pre-set filter. Deep links use `?tab=tasks&view=overdue` read in the Server Component and passed
as `initialTab` / `initialView` (the pattern `departure-groups/[groupId]/page.tsx` already uses for
`?add=1` / `?edit=1`).

Supporting files:

```text
lib/access/operations-access.ts       Capability matrix (§3.6)
lib/data/operations.ts                Row → view model, KPIs, alerts, readiness matrix, risk rules
lib/data/operations-repository.ts     Supabase reads/writes this module owns
lib/data/operations-copy.ts           Every threshold and label (§3.5)
lib/data/operations-ai.ts             AI Operations Agent, server-only
lib/types/operations.ts              Row shapes for the new tables
lib/validations/operations.ts        zod schemas + toOperationsFieldErrors
supabase/migrations/20260816090000_operations_control_center.sql
```

### 3.2 Schema — `20260816090000_operations_control_center.sql`

Additive only. Safe on a database with 20260809090000 … 20260815090000 applied.

#### A. Tasks become real operational work items (F3–F7)

```sql
alter table public.departure_group_tasks
  add column if not exists priority            text not null default 'NORMAL'
    check (priority in ('CRITICAL','HIGH','NORMAL','LOW')),
  add column if not exists linked_entity_type  text
    check (linked_entity_type is null or linked_entity_type in
      ('FLIGHT','ACCOMMODATION','ROOM','TRANSPORT','SUPPLIER_SERVICE',
       'BOOKING','PILGRIM','PAYMENT','READINESS_ITEM','DOCUMENT','VISA','GROUP')),
  add column if not exists linked_entity_id    uuid,
  add column if not exists linked_entity_label text,
  add column if not exists blocked_reason      text,
  add column if not exists created_at          timestamptz not null default now(),
  add column if not exists created_by          uuid references auth.users (id) on delete set null,
  add column if not exists created_by_name     text,
  add column if not exists completed_at        timestamptz,
  add column if not exists completed_by_name   text;

-- BLOCKED joins the status set (F4). OVERDUE stays derived from due_at.
alter table public.departure_group_tasks drop constraint if exists departure_group_tasks_status_check;
alter table public.departure_group_tasks add constraint departure_group_tasks_status_check
  check (status in ('OPEN','IN_PROGRESS','BLOCKED','COMPLETE','OVERDUE'));

-- Unassigned is NULL, not '' (F6). Backfill first, then relax the default.
update public.departure_group_tasks set owner_name = null where owner_name = '';
alter table public.departure_group_tasks alter column owner_name drop not null;
alter table public.departure_group_tasks alter column owner_name drop default;

create index if not exists dgt_unassigned_idx on public.departure_group_tasks (due_at)
  where owner_name is null and status <> 'COMPLETE';
create index if not exists dgt_priority_due_idx on public.departure_group_tasks (priority, due_at)
  where status <> 'COMPLETE';
create index if not exists dgt_linked_idx on public.departure_group_tasks (linked_entity_type, linked_entity_id)
  where linked_entity_id is not null;
```

`linked_entity_label` is denormalised on purpose: the table prints *"Makkah Accommodation"* on every
row, and joining five possible parent tables to render one cell is not worth it. It is a snapshot,
refreshed when the link is set.

#### B. Task timeline — append-only (F7)

Mirrors `visa_application_events` exactly.

```sql
create table if not exists public.departure_group_task_events (
  id                  uuid primary key default gen_random_uuid(),
  task_id             uuid not null references public.departure_group_tasks (id) on delete cascade,
  departure_group_id  uuid not null references public.departure_groups (id) on delete cascade,
  actor_id            uuid references auth.users (id) on delete set null,
  actor_name          text not null default 'System',
  actor_role          text,
  action              text not null
    check (action in ('CREATED','ASSIGNED','REASSIGNED','STATUS_CHANGED','PRIORITY_CHANGED',
                      'DUE_CHANGED','BLOCKED','UNBLOCKED','NOTE_ADDED','EVIDENCE_UPLOADED',
                      'LINKED','COMPLETED','REOPENED','ESCALATED')),
  from_value          text,
  to_value            text,
  note                text,
  evidence_path       text,          -- object path in the private bucket, never a public URL
  created_at          timestamptz not null default now()
);
create index if not exists dgte_task_idx  on public.departure_group_task_events (task_id, created_at desc);
create index if not exists dgte_group_idx on public.departure_group_task_events (departure_group_id, created_at desc);
```

RLS: select + insert for `authenticated`, matching `visa_application_events`.

#### C. Supplier confirmation, as state on the service row (F8, F9)

The confirmation workflow is a property **of the service**, not of a parallel record. Adding a
side-table keyed polymorphically to three service tables would create the same
"two sources disagreeing" failure the readiness engine was rewritten to remove. So the same five
columns go on each of the three existing service tables:

```sql
-- applied identically to departure_group_accommodations, departure_group_transports,
-- and departure_group_flights
alter table public.<table>
  add column if not exists supplier_contact       text,
  add column if not exists confirmation_owner_id  uuid references auth.users (id) on delete set null,
  add column if not exists confirmation_owner_name text,
  add column if not exists requested_at           timestamptz,
  add column if not exists responded_at           timestamptz,
  add column if not exists evidence_path          text,
  add column if not exists evidence_uploaded_at   timestamptz,
  add column if not exists confirmed_at           timestamptz,
  add column if not exists verified_at            timestamptz,
  add column if not exists verified_by            uuid references auth.users (id) on delete set null,
  add column if not exists verified_by_name       text,
  add column if not exists confirmation_due_at    timestamptz;
```

`voucher_url` (accommodations) and `confirmation_url` (transports) are kept and continue to hold
externally-hosted links; `evidence_path` is the private-bucket object path for an uploaded file.
Either satisfies the evidence requirement.

`SupplierStatus` gains the two missing states:

```sql
-- on each of the three tables
check (status in ('NOT_REQUESTED','REQUESTED','RESPONDED','CONFIRMED','VERIFIED','COMPLETED','CANCELLED'))
```

`CONFIRMED` keeps its existing meaning (the supplier has confirmed and evidence is on file);
`VERIFIED` is the staff signature on top, exactly as `visa_verified_at` sits above an issued visa.
**Existing rows are unaffected** — no value is removed.

#### D. The four homeless categories (F10)

```sql
create table if not exists public.departure_group_supplier_services (
  id                  uuid primary key default gen_random_uuid(),
  departure_group_id  uuid not null references public.departure_groups (id) on delete cascade,
  category            text not null
    check (category in ('CATERING','GUIDE_SERVICE','INSURANCE','ZIYARAH','OTHER')),
  service_label       text not null,
  status              text not null default 'NOT_REQUESTED'
    check (status in ('NOT_REQUESTED','REQUESTED','RESPONDED','CONFIRMED','VERIFIED','COMPLETED','CANCELLED')),
  supplier_name       text,
  supplier_contact    text,
  booking_reference   text,
  pax_count           integer,
  service_date        date,
  internal_cost       numeric(12,2),
  notes               text,
  -- the same twelve confirmation columns as §C
  …,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
```

Plus `set_updated_at` trigger (the function already exists, created by 20260815090000) and RLS
matching `visa_submission_batches`.

#### E. Guide briefing state (F15)

```sql
alter table public.departure_groups
  add column if not exists backup_guide_id      uuid references auth.users (id) on delete set null,
  add column if not exists briefing_status      text not null default 'NOT_STARTED'
    check (briefing_status in ('NOT_STARTED','DRAFT','SENT','ACKNOWLEDGED')),
  add column if not exists briefing_sent_at     timestamptz,
  add column if not exists briefing_sent_by_name text,
  add column if not exists run_sheet_status     text not null default 'NOT_STARTED'
    check (run_sheet_status in ('NOT_STARTED','DRAFT','FINAL')),
  add column if not exists run_sheet_updated_at timestamptz,
  add column if not exists assembly_point       text,
  add column if not exists assembly_at          timestamptz,
  add column if not exists checkin_at           timestamptz;
```

`assembly_point` / `assembly_at` / `checkin_at` are what the spec's day-of-departure briefing block
prints; today `guide-operations-tab.tsx` infers them from the outbound flight, which is a guess
(a group does not always assemble three hours before departure).

#### F. One read view for the supplier board

```sql
create or replace view public.operations_supplier_service_rows as
  select 'FLIGHT'::text as service_kind, f.id as service_id, f.departure_group_id,
         case f.direction when 'OUTBOUND' then 'Outbound Flight' else 'Return Flight' end as service_label,
         'FLIGHTS' as category, f.status, f.supplier_name, f.booking_reference as reference, …
    from public.departure_group_flights f
  union all
  select 'ACCOMMODATION', a.id, a.departure_group_id,
         initcap(a.city) || ' Accommodation',
         'ACCOMMODATION_' || a.city, a.status, a.supplier_name, a.booking_reference, …
    from public.departure_group_accommodations a
  union all
  select 'TRANSPORT', t.id, t.departure_group_id, t.route_label, 'TRANSPORT', t.status, … 
    from public.departure_group_transports t
  union all
  select 'SUPPLIER_SERVICE', s.id, s.departure_group_id, s.service_label, s.category, s.status, …
    from public.departure_group_supplier_services s;
```

This is the **one** place the four shapes are unioned. It is read-only — every write goes to the
underlying table through its own mutator.

### 3.3 Data layer

Mirror the Documents/Visa shape exactly.

```text
lib/data/operations-repository.ts
  activeGroupIds(db)                  → ids where group_status not in (DEPARTED, COMPLETED, CLOSED, CANCELLED)
  loadOperationsStore(db, groupIds)   → loadStore(db, { groupIds, only: OPERATIONS_COLLECTIONS, activityLimit: 300 })
  loadSupplierServiceRows(db, groupIds)
  loadTaskTimeline(db, taskId)
  insertTaskEvent(db, event)
  updateTaskFields(db, taskId, patch)
  insertSupplierService / updateSupplierService
  class OperationsPersistenceError    (same shape as VisaPersistenceError)

lib/data/operations.ts                — pure, no Supabase import, unit-testable
  toOperationsSnapshot(store, supplierRows, nowIso) → OperationsSnapshot
  computeOperationsKpis(snapshot)
  deriveOperationsAlerts(snapshot)
  buildUpcomingGroupCards(snapshot)
  buildReadinessMatrix(snapshot)
  toTaskItems / toSupplierItems / toFlightItems / toAccommodationItems / toTransportItems / toGuideBoard
  flightRiskState / roomingIndicator / transportWarnings / scoreTaskPriority
```

`OPERATIONS_COLLECTIONS` = `LIST_COLLECTIONS` ∪ `{ tasks, rooms, roomAssignments, activity }`.

Two invariants, both inherited:

1. **Readiness is derived on read.** `loadOperationsStore` runs `syncGroupDerivedState()` +
   `deriveReadinessStatuses()` per group before anything is read off it, exactly as
   `listDepartureGroups()` does — so a hotel confirmed in another session moves the Operations
   badge immediately.
2. **Costs are nulled before they leave the module, not hidden in the UI.** `internal_cost` on
   accommodations, transports and supplier services is stripped in `page.tsx` for every role
   without `viewSupplierCosts` — Guide and Marketing above all.

**Scoping decision:** query active group ids first, then pass them to `loadStore`. Loading *every*
group including five years of closed ones would grow without bound; the operations control tower
only ever cares about groups that have not departed (plus, for the Activity tab, the last 300 events
across those groups).

### 3.4 Mutations — reuse, don't reimplement

| Operation | Path |
|---|---|
| Create / complete / reopen task | existing `createGroupTask` / `updateGroupTaskStatus` wrappers, extended for priority, link and BLOCKED |
| Reassign task, add note, upload evidence | **new** `operations-tasks.ts` mutators + `departure_group_task_events` |
| Bulk assign / bulk update | loop the single-task mutator inside one `mutate()` call (Visa's `createBatchAction` sets the precedent) |
| Assign / edit hotel, upload voucher, set reference | existing `updateGroupAccommodation`, `setGroupAccommodationVoucher`, `setGroupAccommodationReference` |
| Mark supplier confirmed | existing `markGroupAccommodationConfirmed` / `markGroupTransportConfirmed`, **with the F8 guard added inside the pure mutator** so the Departure Group page inherits the same rule |
| Verify supplier confirmation | **new** mutator — separate capability, separate timestamp, never the same action as confirming |
| Auto-assign rooms, assign pilgrim to room | existing `autoAssignGroupRooms`, `assignGroupPilgrimToRoom` |
| Flight edits, ticketing | existing `upsertGroupFlight`, `recordGroupFlightTicketing`, `markGroupFlightTicketsIssued` |
| Transport edits | existing `upsertGroupTransport`, `setGroupTransportConfirmation` |
| Assign guide / backup guide, briefing state | existing `updateGroupDetails` extended with the §3.2E columns |
| Non-modelled supplier services | **new** `operations-supplier-services.ts` mutators |

**The F8 guard belongs in the pure mutator, not the Operations UI.** Putting it in a dialog would
leave the Departure Group's Hotels tab able to confirm without evidence — the exact class of
disagreement the readiness rewrite eliminated.

### 3.5 Configuration — `lib/data/operations-copy.ts`

Every threshold the spec implies, in one file, as `visa-copy.ts` does:

```text
UPCOMING_DEPARTURE_WINDOW_DAYS   = 30    "Upcoming Departures / next 30 days"
CRITICAL_DEPARTURE_WINDOW_DAYS   = 14    a blocker inside this window is 🔴, outside it 🟠
TICKETING_DEADLINE_RISK_DAYS     = 7     F12
TRANSPORT_PICKUP_REQUIRED_HOURS  = 48    F14
TRANSPORT_DRIVER_REQUIRED_HOURS  = 24    F14
SUPPLIER_CONFIRMATION_LEAD_DAYS  = 21    default confirmation_due_at, when not set explicitly
BRIEFING_DUE_DAYS_BEFORE         = 3
MAX_CRITICAL_ALERTS              = 6     "only show serious blockers here"
READINESS_MATRIX_COLUMNS         = [DOCUMENT, VISA, PAYMENT, FLIGHT, HOTEL, TRANSPORT, GUIDE]  F16
SERVICE_CATEGORY_LABELS, TASK_PRIORITY_LABELS, SUPPLIER_STATUS_LABELS, …
```

Admin can edit these later behind `configureThresholds`; nothing else in the module may hardcode a
number.

### 3.6 Capability matrix — `lib/access/operations-access.ts`

Pure functions over `StaffRole`, callable from Server and Client Components, same posture as
`visa-access.ts`. Capabilities decide what is **fetched**, not merely what is rendered.

```text
viewModule                  createTask          editTask           reassignTask
bulkUpdateTasks             completeTask        addTaskNote        uploadTaskEvidence
viewSupplierBoard           requestSupplier     confirmSupplier    verifySupplierConfirmation
addSupplierService          uploadSupplierEvidence
manageFlights               manageAccommodation manageRooming      manageTransport
assignGuide                 sendBriefing        generateRunSheet   exportManifest
viewReadinessMatrix         overrideReadiness   viewSupplierCosts  viewFinanceBlockers
viewPilgrimContactDetails   sendCommunications  runAiAgent         exportOperationsReport
configureThresholds         readOnly            assignedGroupOnly  scopedToOwnTasks
```

| Role | Shape |
|---|---|
| **ADMIN** | everything, incl. `verifySupplierConfirmation`, `overrideReadiness`, `configureThresholds` |
| **CEO** | full visibility, `readOnly: true`; may `createTask` (escalation is how a CEO acts) and `exportOperationsReport`; no supplier or readiness writes |
| **OPERATIONS** | full task / supplier / flight / hotel / rooming / transport / readiness management; **no** `verifySupplierConfirmation` (mirrors Visa, where Operations may record but not verify) |
| **VISA** | visa- and document-related tasks and readiness; `requestSupplier` only, no confirm; no flight/hotel/transport edits |
| **FINANCE** | `viewFinanceBlockers`, `viewSupplierCosts`, payment-blocker tasks only; no broad task editing, no supplier confirmation |
| **MARKETING** | group sales status + approved communications; **no** supplier board, **no** costs, **no** pilgrim contact details |
| **GUIDE** | `assignedGroupOnly: true` + `scopedToOwnTasks: true`; run sheet, rooming, pilgrim travel details, incidents; **no** `viewSupplierCosts`, no finance, no supplier board |

Tab visibility follows, as `visibleTabsFor()` does for groups — hidden tabs are **not rendered**,
not merely disabled.

---

## 4. Screens

### 4.0 Header

```text
Home > Operations
Operations Control Center
Track supplier confirmations, travel readiness, staff tasks, and critical group risks.
[ + Create Task ] [ + Add Supplier Booking ] [ ⋮ → Export Operations Report ]
```

`PageHeader` with `breadcrumb=[{Home,/dashboard},{Operations,/operations}]`. Header buttons follow
`visa-list.tsx`: primary `variant="secondary"`, secondary `variant="outline_without_border"`,
overflow in a `DropdownMenu`. Each is capability-gated (`createTask`, `addSupplierService`,
`exportOperationsReport`).

### 4.1 KPI cards

Six `KpiCard`s in `KpiRow` (which is a 4-column grid at `lg` — six wraps to 4+2, consistent with how
Visa's five wrap). Every card is a `<button>` that sets the tab **and** a saved view; read-only roles
get non-clickable cards.

| Card | Value | Derivation | Opens |
|---|---|---|---|
| Upcoming Departures | count | `daysUntilDeparture` ∈ [0, 30] and status not departed/cancelled | Overview, filtered to the window |
| Groups At Risk | count | groups with ≥1 CRITICAL alert, or `readinessStatus ∈ {BLOCKED, AT_RISK}` inside the critical window | Group Readiness |
| Supplier Confirmations Pending | count | supplier rows with `status ∈ {NOT_REQUESTED, REQUESTED, RESPONDED}` on active groups | Supplier Confirmations |
| Tasks Due Today | count | `status ≠ COMPLETE` and `due_at ≤ end of today` (includes overdue) | Operational Tasks → *Due Today* |
| Unassigned Operations Work | count | tasks with `owner_name is null` and `status ≠ COMPLETE`, **plus** readiness items with `assigned_to_name is null` and status not complete | Operational Tasks → *Unassigned* |
| Group Readiness Average | `%` | mean `readinessScore` over active groups | Group Readiness |

### 4.2 Critical Operations Alerts

Directly below the KPIs. `deriveOperationsAlerts()` runs the **existing** `buildBlockers()` per
group, then applies three cross-group rules the per-group version cannot know:

1. **Severity is a function of proximity.** A blocker on a group departing in ≤ 14 days is 🔴; the
   same blocker at 60 days is 🟠. `buildBlockers` already tags CRITICAL/WARNING by *kind* — this
   composes the two.
2. **Sort by (severity, daysUntilDeparture, category weight)**, then cap at `MAX_CRITICAL_ALERTS`.
   The spec is explicit: *"only show serious operational blockers here — not every low-priority
   task."*
3. **Each alert carries its own action pair**, mapping to a tab + filter or a dialog:

```text
🔴 August Umrah Group 04 departs in 7 days
   Makkah hotel confirmation is missing              [Open Group] [Assign Supplier Task]
🔴 Hajj Group 01 departs in 12 days
   2 airport transfers remain unconfirmed            [Open Transport Queue]
🟠 September Umrah Group 01
   Rooming list is only 24 / 40 assigned             [Open Rooming]
🟠 Ramadan Umrah Group 02
   Guide is not assigned                             [Assign Guide]
```

`[Open Group]` navigates to `/departure-groups/{id}`; everything else stays on `/operations` and
switches tab + filter. Reuse `critical-alerts.tsx`, widened with a second action slot.

### 4.3 Overview tab (default)

Vertical order, exactly as specified:

```text
Critical alerts (rendered above the tabs, always visible)
Upcoming groups board
Supplier confirmation summary
Today's operations tasks
Readiness by group
Unassigned work
Recent operational activity
```

**Upcoming groups board** — compact `Card` per group, sorted by departure date, capped at ~8 with a
"show all" that jumps to Group Readiness:

```text
August Umrah Group 04
Departs in 7 days · 32 / 40 pilgrims
Status: Preparing · Readiness: 78%          ← GroupStatusBadge + ProgressBar

Flights       ✓ Confirmed        ← from buildSupplierLines() + flight status
Hotels        🔴 1 pending
Transport     ✓ Confirmed
Documents     🟠 2 missing       ← readiness DOCUMENT category + pilgrim document counters
Visa          🟠 5 pending       ← count of pilgrims in VISA_PENDING_STATES
Payments      🟠 4 overdue       ← bookings with next_due_at past and balance > 0
Guide         ✓ Assigned         ← primary_guide_name

[Open Group]
```

Every line is a `ToneBadge`, and every line is clickable into the tab that owns it. This is
`buildSupplierLines()` plus four counts already computed inside `buildBlockers()` — extract them
into a shared `groupServiceLines()` so the alert text and the card row can never disagree.

The remaining five sections are compact renders of the other tabs' data: top 5 pending supplier
confirmations, today's tasks (max 8), the readiness matrix (top 5 by risk), unassigned work, and the
last 10 high-impact activity rows.

### 4.4 Operational Tasks tab

Header actions: `[ + Create Task ] [ Bulk Assign ] [ Bulk Update ] [ Saved Views ▾ ]`.
Table = `operations-data-table.tsx` (forked from Visa's, for row selection + bulk bar).

| Column | Content | Source |
|---|---|---|
| Task | title + category chip | `title`, `category` |
| Departure Group | group name + `departs in N days` | join on `departure_group_id` |
| Owner | `PersonChip` (falls back to "Unassigned") | `owner_name` |
| Due | date-time, red when overdue | `due_at` |
| Priority | `ToneBadge` — Critical=danger, High=warning, Normal=info, Low=neutral | `priority` (F3) |
| Status | Open · In Progress · Blocked · Complete | `status` (F4) |
| Linked Item | label + icon | `linked_entity_type` / `linked_entity_label` (F5) |
| Actions | Complete · Reassign · Open · ⋮ | |

**Saved views** (`SavedViewBar`, two rows as Visa does): `My Tasks · Due Today · Overdue · Critical
Blockers · Unassigned · Hotels & Suppliers · Transport · Guide Tasks · Departing in 7 Days ·
Completed This Week`.

**Default sort** = `scoreTaskPriority()` desc — a deterministic composite of priority weight, days to
departure, overdue-ness and blocked state (mirrors `scoreVisaApplication()`).

**Task drawer** (`Sheet`): group, priority, owner, due, linked item, description, then
`[Mark Complete] [Reassign] [Add Note] [Upload Evidence]`, then the append-only timeline from
`departure_group_task_events`. Every button is capability-gated; every action writes an event row.

### 4.5 Supplier Confirmations tab

Reads `operations_supplier_service_rows`. Category filter across the spec's ten categories.

Columns: Group · Service · Supplier/Broker · Reference · Due · Status · Owner · Evidence · Actions.

**The workflow gate (F8/F9) is the point of this tab.** `confirm-supplier-dialog.tsx` will not
enable its submit button, and the mutator behind it will return `{ ok: false }`, unless all four are
present:

```text
supplier_name is not null and <> ''
booking_reference is not null OR evidence_path/voucher_url is not null
confirmation_owner_name is not null
confirmed_at is set by the action (never client-supplied)
```

`VERIFIED` is a **separate** action behind `verifySupplierConfirmation` — Operations confirms, Admin
or Visa verifies, exactly as with issued visas. The status column shows both states distinctly;
readiness treats `CONFIRMED` and `VERIFIED` alike for now (`HOTEL_*_CONFIRMED` auto-sources already
accept `CONFIRMED`/`COMPLETED`, and must be widened to accept `VERIFIED` in the same change — **easy
to miss, and it would silently regress every group's readiness score**).

### 4.6 Flights & Tickets tab

Cross-group risk queue only — route detail and transit legs stay in the group's Flights tab.

Top state chips: `Flights Confirmed · Seats Held · Tickets Issued · Ticketing Deadline Risk ·
Passenger Name Mismatch`, each a filter.

Columns: Group · Route (`origin→destination`) · Airline + flight number · PNR · `seats_held /
seats_ticketed` · Ticketing Deadline · Status · Issue · Owner · Actions.

`flightRiskState()` (F12):

```text
AT_RISK          ticketing_deadline within TICKETING_DEADLINE_RISK_DAYS and seats_ticketed < seats_held
OVERDUE          ticketing_deadline has passed and seats_ticketed < seats_held
NAME_MISMATCH    any pilgrim on the group with flight_status = 'NAME_MISMATCH'
SEATS_SHORT      seats_held < confirmed pilgrim count
OK               otherwise
```

The Issue column prints the derived sentence (*"8 tickets pending"*), never a bare flag.

### 4.7 Accommodation & Rooming tab

Columns: Group · City · Hotel · Check-in/out · Rooms Reserved · Pilgrims Assigned · Confirmation
Status · Rooming Status · Actions.

`roomingIndicator()` (F13), returning a `Tone` **and** an explanatory sentence:

```text
danger   (Red)    no accommodation row, OR Σ room capacity < pilgrim count (insufficient),
                  OR assigned > capacity (overbooked), OR status NOT_REQUESTED/REQUESTED
warning  (Amber)  confirmed, but assigned < pilgrim count
success  (Green)  confirmed and every pilgrim assigned within capacity
```

Actions: Assign Hotel · Upload Voucher · Auto-Assign Rooms · Open Rooming Board · Export Rooming
List — all wrapping mutators that already exist. "Open Rooming Board" deep-links into the group's
Hotels & Rooms tab rather than duplicating the board.

### 4.8 Transport tab

Columns: Group · Route · Supplier · Vehicle · Capacity · Passengers · Pickup date/time · Driver ·
Status · Actions.

Status shows the derived operational state, not just `SupplierStatus`: `Not Requested · Requested ·
Confirmed · Driver Assigned · Pickup Scheduled · Completed · Cancelled` — where *Driver Assigned* =
confirmed + `driver_name` present, and *Pickup Scheduled* = driver assigned + `pickup_at` present.

`transportWarnings()` (F14) returns zero or more sentences per row:

```text
"Vehicle seats 32 but 40 pilgrims are booked"          vehicle_capacity < passenger_count
"Pickup time is not set and travel is in 36 hours"     pickup_at null within 48h of pickup/departure
"No driver contact 18 hours before pickup"             driver_phone null within 24h
"Not confirmed and the confirmation deadline passed"   status < CONFIRMED past confirmation_due_at
```

The fallback when `pickup_at` is null is the group's departure date — stated explicitly so the rule
cannot silently never fire.

### 4.9 Guides & Briefings tab

Board columns: Group · Primary Guide · Backup Guide · Pilgrim Count · Briefing Status · WhatsApp
Group · Emergency Contact · Run Sheet · Status.

Actions: Assign Guide · Assign Backup Guide · Generate Group Briefing · Send Pilgrim Update ·
Create WhatsApp Group Link · Generate Departure Run Sheet · Print Group Manifest · Export Emergency
Contacts. The last four already exist inside `guide-operations-tab.tsx` and
`departure-groups/manifest.ts` — lift them, do not rewrite.

The day-of-departure briefing block reads the new `assembly_point` / `assembly_at` / `checkin_at`
columns, falling back to the outbound flight only when they are unset (and labelling it as an
estimate when it does).

**Guide role scoping is a query filter, not a UI conditional.** `page.tsx` restricts
`activeGroupIds` to groups where `primary_guide_name` or `backup_guide_name` matches the current
staff name before hydrating anything, and nulls `internal_cost` everywhere. A guide must never
receive supplier costs in the payload.

### 4.10 Group Readiness tab

The matrix, one row per active group:

```text
Group                       Docs   Visa   Pay   Flight Hotel Transport Guide  Overall
August Umrah Group 04       88%    69%    87%   100%   50%   100%     100%   78%
```

`buildReadinessMatrix()` (F16) iterates the **fixed** `READINESS_MATRIX_COLUMNS`, reading
`scoreReadiness().categories` into a map and rendering `—` for absent categories. Column mapping is
declared once in `operations-copy.ts`:

```text
Docs → DOCUMENT   Visa → VISA   Pay → PAYMENT   Flight → FLIGHT
Hotel → HOTEL     Transport → TRANSPORT         Guide → GUIDE
Overall → scoreReadiness().score   (weighted, NOT the mean of the columns)
```

Each cell is a button opening the exact unresolved queue — the tab + filter that owns that category,
using the existing `CATEGORY_TAB` map as the model. Each row also carries its
`READY · AT_RISK · BLOCKED · NOT_STARTED` label and its primary blocker sentence, because the spec
is explicit: **do not show only percentages without explaining the blocker.**

### 4.11 Activity tab

Cross-group feed from `departure_group_activity_logs`, newest first, grouped by day
(`Today / Yesterday / date`). Filters: Group · Staff owner · Action type · Service category · Date
range — all client-side over the loaded window, with a "load more" that raises `activityLimit`.

`is_high_impact` is the default filter (the spec asks for *high-impact operational events*), with a
toggle to see everything.

---

## 5. AI Operations Agent

### 5.1 Posture

A **prioritisation and coordination layer, not an autonomous booking tool.** Same posture as the
Documents Agent and the Visa Assistant: it has no code path to a supplier confirmation, a flight
change, a readiness completion or a message send.

Server-only, in `lib/data/operations-ai.ts`, gated on `isAiConfigured()`
(`process.env.ANTHROPIC_API_KEY`), model `claude-opus-5` — matching
[lib/data/documents-ai.ts:33](lib/data/documents-ai.ts:33).

### 5.2 The split that matters

**Everything countable is computed deterministically. The model is only used to write prose.**

| Capability | How |
|---|---|
| Identify groups with readiness risk | deterministic — `buildReadinessMatrix` |
| Prioritise tasks by departure date and severity | deterministic — `scoreTaskPriority()` |
| Detect unconfirmed supplier services | deterministic — supplier rows query |
| Detect capacity mismatch (pilgrims > bus seats / beds / flight seats) | deterministic — `transportWarnings`, `roomingIndicator`, `flightRiskState` |
| Find missing guide assignment / rooming gaps | deterministic |
| Suggest task owners by role and workload | deterministic — role → capability map, ranked by open task count |
| **Draft supplier follow-up message** | model |
| **Draft internal escalation summary** | model |
| **Generate daily operations brief** | model, over a deterministic fact sheet |
| **Generate guide departure run sheet** | deterministic composition, model only for the covering note |

Counting with an LLM is slower, costlier and occasionally wrong — the panel must never print a
number the model produced.

### 5.3 Never, autonomously

```text
Confirm supplier bookings          Change flight details
Assign a paid service              Mark readiness items complete without evidence
Send supplier messages             Cancel bookings
Move pilgrims between groups
```

Enforced structurally, not by prompt: `operations-ai.ts` imports **no** mutator and constructs **no**
`GroupActor`, so it cannot reach a write path — the same guarantee `documents-ai.ts` relies on. Its
only output is a `OperationsBrief` object rendered by the panel, plus draft text the user must
review before any send.

### 5.4 Panel

Right rail on `xl+` (`grid xl:grid-cols-[1fr_320px]`, as `visa-list.tsx`), collapsing below.

```text
AI Operations Agent

August Umrah Group 04 is at risk.
Main blockers:
1. Makkah hotel voucher missing
2. Five visa applications unresolved
3. Four payments overdue

Recommended sequence:
1. Escalate hotel confirmation to M. Rameez
2. Open Visa Batch 02 review queue
3. Send finance reminders to four pilgrims

[Create Recommended Tasks]
```

`[Create Recommended Tasks]` opens a **review dialog** listing each proposed task with an editable
title, owner and due date and a checkbox — nothing is created until the user submits, and creation
runs through the ordinary `createTaskAction` with the ordinary capability check.

---

## 6. Build phases

Each phase is independently shippable and leaves the app working.

| Phase | Scope | Ships |
|---|---|---|
| **0 — Replace the stub** | `page.tsx` Server Component + role gate + `operations-store` + shell with header, KPI row, alerts, and the 9 tabs (7 rendering `EmptyState`). Overview and Group Readiness fully working from **existing** data only — no migration | A real control tower on day one; F1 closed |
| **1 — Migration** | `20260816090000_operations_control_center.sql` (§3.2 A–F), `lib/types/operations.ts`, backfills, RLS | Schema for F3–F5, F7–F10, F15 |
| **2 — Data layer** | `operations-repository.ts`, `operations.ts`, `operations-copy.ts`, `operations-access.ts`, `validations/operations.ts` | All derivations + the capability matrix (F2, F12–F14, F16, F18) |
| **3 — Tasks** | Tasks tab, drawer, create/reassign dialogs, bulk bar, task events, `actions.ts` task half. **Extend the existing pure task mutators** so the group page gets priority and BLOCKED too | F3–F7 closed |
| **4 — Suppliers** | Supplier Confirmations tab, confirm/verify dialogs, evidence upload, **the F8 guard inside the pure mutators**, new supplier-service CRUD, widening the `HOTEL_*_CONFIRMED` auto-sources to accept `VERIFIED` | F8–F10 closed |
| **5 — Service tabs** | Flights, Accommodation & Rooming, Transport, Guides & Briefings — each wrapping existing mutators | F12–F15 closed |
| **6 — Activity + export** | Activity tab with filters, `csv.ts`, Export Operations Report | F17, F20 closed |
| **7 — AI panel** | `operations-ai.ts` + `ai-operations-panel.tsx` + recommended-tasks review dialog | §5 |

---

## 7. Decisions and risks

**D1 — One route, nine client tabs.** Not nested routes. One hydration serves every tab; nested
routes would re-fetch eight collections per navigation. Matches the Departure Group detail page.

**D2 — No new database view for the main read.** Documents and Visa each built a view because their
unit is *one row per person* assembled from a five-table join. Operations' unit is *one group with
eleven collections hanging off it* — that is not a view, it is the store `loadStore` already
hydrates. Only the supplier board gets a view (§3.2F), because that genuinely is a union of four
like-shaped things.

**D3 — Supplier confirmation is state on the service row, not a parallel table.** A side-table would
recreate the "two sources of truth disagreeing" failure the readiness engine was rewritten to fix.

**D4 — Confirming and verifying are different actions with different capabilities.** Inherited
directly from the Visa module's `visa_verified_at`. Operations confirms; Admin/Visa verifies.

**D5 — The evidence guard lives in the pure mutator.** So the Departure Group page inherits it. A
UI-only guard would leave the old path open.

**D6 — No supplier master in v1 (F11).** `supplier_name` stays free text, with a combobox offering
distinct existing values to limit drift. A real `suppliers` table with contacts, contracts and
payables belongs with the Finance module, not here — building half of it now would have to be
migrated twice.

**D7 — Activity reads the group log only (F17).** Every visa and document transition already writes
a group activity row because those modules call through the group mutators. Unioning
`visa_application_events` and `document_review_events` is deferred until a concrete gap is observed.

**D8 — `OVERDUE` stays derived, `BLOCKED` becomes stored.** Overdue is a fact about the clock and
must never be persisted stale; blocked is a human assertion with a reason.

**D9 — Unassigned is `NULL`, not `''`.** Requires a backfill and dropping a `not null` — the only
non-additive step in the migration, and the one to review most carefully.

### Risks

| Risk | Mitigation |
|---|---|
| **Loading eleven collections for every active group is the heaviest query in the app** | Scope to non-departed groups; `activityLimit: 300`; `export const dynamic = "force-dynamic"` with React `cache()` per request. Measure before Phase 5. If it bites, move the Activity tab to its own on-demand fetch |
| **Widening `SupplierStatus` touches the readiness auto-sources** | `HOTEL_MAKKAH_CONFIRMED`, `HOTEL_MADINAH_CONFIRMED`, `TRANSPORT_*_CONFIRMED` and `FLIGHT_OUTBOUND_CONFIRMED` all test the status value. Adding `RESPONDED`/`VERIFIED` without updating them would show verified hotels as unconfirmed and drop every readiness score. **Phase 4 must change both in one commit** |
| **Dropping `owner_name`'s `not null`** | Backfill `''` → `NULL` first; audit every read (`toTask`, `guide-operations-tab`, CSV exports) for `owner_name.trim()` on a now-nullable value |
| **The role matrix is unenforced (F19)** | Write it correctly regardless — every decision already flows through `getCurrentStaffRole()`, so it activates the day a staff table lands. Do not scatter role literals through components |
| **Operations drifting into a second group-editor** | Every "Actions" cell either opens a narrow dialog or deep-links to `/departure-groups/{id}?tab=…`. No tab gets an inline full editor |
| **Alert fatigue** | `MAX_CRITICAL_ALERTS` is a hard cap, severity is proximity-weighted, and low-priority tasks are structurally excluded from the alert feed |
| **Six KPI cards in a 4-column grid** | Verify the 4+2 wrap at `lg` and `xl` before committing; the sixth card is explicitly optional in the spec and can be dropped into the Overview instead |

---

## 8. Suggested sequencing

```text
1.  Phase 0        Replace the stub. Overview + Group Readiness live on existing data.
2.  Phase 1 + 2    Migration and data layer, together — the types must match the columns.
3.  Phase 3        Tasks. The highest-traffic surface, and the one with no existing cross-group home.
4.  Phase 4        Suppliers. The spec's one hard prohibition; land it before the service tabs
                   so they inherit the guard rather than route around it.
5.  Phase 5        Flights, Accommodation & Rooming, Transport, Guides.
6.  Phase 6        Activity + export.
7.  Phase 7        AI panel, last — it reads everything the earlier phases produce.
```

Phases 0 and 3 are the ones that change what staff can do each morning. Phase 4 is the one that
makes "confirmed" mean something.
