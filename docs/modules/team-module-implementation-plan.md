# Team Module — Implementation Plan

Build the **Team** page at `/management/team` on the same data, access and action architecture
already used by **Packages**, **Departure Groups**, **Leads**, **Pilgrims**, **Documents**,
**Visa**, **Operations**, **Suppliers**, **Finance** and **Reports**.

Status: **plan only. Nothing in here is implemented.**

The product rule the whole plan enforces:

```text
Team              = who can access the OS, and who owns the work
Departure Groups  = the actual trip
Tasks             = what each person must do next
```

And the boundary it must not cross:

```text
Team page          →  staff access, role, branch, ownership, seasonal validity, audit
Departure Groups   →  the trip; ownership is *displayed* here and *edited* from either side
Operations / Tasks →  the live work queue; Team only summarises a person's slice of it
```

The Team page is **not** an HR system. Payroll, attendance, leave, recruitment, appraisals,
salary and contracts are explicitly out of scope for V1 (§13).

Two supporting rules carried into every section below:

- **A staff record is an access record.** Every field on it exists to answer "what may this person
  see and do", not "how do we employ this person".
- **Task count is a workload signal, never a performance score.** The UI must never rank staff,
  compute a productivity percentage, or colour a person red for being busy.

---

## 1. What exists today

### 1.1 The route

| File                                                           | State                                                                                                          |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `app/(main)/management/team/`                                  | **Does not exist.** No route, no folder, no page.                                                              |
| `app/(main)/management/`                                       | **Does not exist.** The `Management` sidebar group currently points at two top-level routes.                   |
| [components/app-sidebar.tsx:92](components/app-sidebar.tsx:92) | Nav entry `Team → /team`, icon `Users`, inside `adminBar[5]` — the **Management** group, alongside `Settings`. |
| [components/app-sidebar.tsx:96](components/app-sidebar.tsx:96) | Nav entry `Settings → /settings`. **No route exists.** Out of scope here.                                      |

So navigation is half-satisfied: the group placement and icon are right, the URL disagrees with the
spec, and the destination 404s today. Nothing in the codebase links to `/team` other than the
sidebar.

### 1.2 What already exists and is the real starting point

Like Suppliers before it, this is closer to greenfield than it looks — **there is no staff entity
anywhere in the database.** What exists is the entire surrounding machinery the module plugs into,
plus a set of columns that have been waiting for exactly this table.

| Concern                        | Where it already lives                                                                                                                                                                                                                     | Fitness for the spec                                                                                                                                                                                                                             |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Staff identity                 | Nowhere. `auth.users` + `user_metadata.staff_role` / `user_metadata.full_name`                                                                                                                                                             | **Missing.** No branch, no employment type, no access window, no status, not queryable, not joinable                                                                                                                                             |
| Role resolution                | `getCurrentStaffRole()` — [lib/data/departure-groups.ts:264](lib/data/departure-groups.ts:264)                                                                                                                                             | **Stub. Defaults everyone to `ADMIN`.** Its own comment says _"Point it at the real profile row when roles land"_. Flagged as a known limitation in the Visa, Operations and Suppliers plans. **This module is where that deferral is paid off** |
| The seven roles                | `STAFF_ROLES` + `ROLE_LABELS` — [lib/access/departure-groups-access.ts:19](lib/access/departure-groups-access.ts:19)                                                                                                                       | **Complete and reusable verbatim.** `ADMIN · CEO · FINANCE · MARKETING · OPERATIONS · VISA · GUIDE` matches the spec's role table exactly                                                                                                        |
| Per-module capability matrices | `lib/access/*-access.ts` — ten files, one per module, pure functions over `StaffRole`                                                                                                                                                      | **Complete.** The spec's "Can access / Cannot access" panel is a _rendering_ of these ten files, not a new permission store                                                                                                                      |
| Group ownership columns        | `primary_guide_id/_name`, `backup_guide_name`, `operations_owner_id/_name`, `visa_owner_id/_name`, `finance_owner_id/_name` on `departure_groups` ([20260809090000:58](supabase/migrations/20260809090000_create_departure_groups.sql:58)) | **The assignment substrate already exists** — but the `_id` columns are unused in practice and the `_name` columns are free text                                                                                                                 |
| Guide assignment UI            | [assign-guide-dialog.tsx:58](<app/(main)/operations/components/assign-guide-dialog.tsx:58>)                                                                                                                                                | **Free-text `<Input>` for a person's name.** No picker, no id written, no validation                                                                                                                                                             |
| Guide-scoped filtering         | `filterGroupsForRole()` — [departure-groups-access.ts:199](lib/access/departure-groups-access.ts:199)                                                                                                                                      | Matches on `primaryGuideName === currentUserName`. **String equality on a display name** — the exact fragility a staff table removes                                                                                                             |
| Tasks                          | `departure_group_tasks` with `owner_id`, `owner_name`, `due_at`, `status`, `category` + index `departure_group_tasks_owner_idx` ([20260809090000:428](supabase/migrations/20260809090000_create_departure_groups.sql:428))                 | **Complete and already indexed by owner.** The Tasks & Workload tab is an aggregation over this table — no new task entity                                                                                                                       |
| Activity trail                 | `departure_group_activity_logs` with `actor_id`, `actor_name_snapshot`, `entity_type`, `before_value`/`after_value`, `is_high_impact` ([20260809090000:451](supabase/migrations/20260809090000_create_departure_groups.sql:451))           | **Reusable for the group-scoped half of the Activity tab.** Cannot hold login events, role changes or account lifecycle — those are not group-scoped (see F5)                                                                                    |
| Auth flows                     | [app/(auth)/actions.ts](<app/(auth)/actions.ts>) — `signInWithPassword`, `signInWithOtp`, `resetPasswordForEmail`, `updateUser`                                                                                                            | Covers sign-in and self-service reset. **No invite, no admin-side reset, no session revocation** (F6)                                                                                                                                            |
| Supabase clients               | [utils/supabase/server.ts](utils/supabase/server.ts), `client.ts`, `middleware.ts` — all on `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`                                                                                                         | **No service-role client exists.** Blocking for invitations (F6)                                                                                                                                                                                 |
| Route protection               | [proxy.ts](proxy.ts)                                                                                                                                                                                                                       | Session-only gate. Deliberately optimistic; `requireUser()` in [lib/dal.ts:23](lib/dal.ts:23) is the real check. Role gating is per-page `notFound()`                                                                                            |
| List + profile precedent       | [app/(main)/suppliers/](<app/(main)/suppliers/>) — `page.tsx` → repository → view models → Provider → List; `[supplierId]/page.tsx` → profile → tabbed detail with role-gated tabs                                                         | **The closest structural twin.** Directory list + entity profile with 5–6 tabs                                                                                                                                                                   |
| Flattening-view precedent      | `pilgrim_journey_rows`, `visa_application_rows`, `supplier_directory_rows`                                                                                                                                                                 | **Copy this shape exactly:** one view, one server-only repository, one client-safe derivation file                                                                                                                                               |
| CSV export                     | [lib/csv.ts](lib/csv.ts) (`toCsv`), per-module `csv.ts`                                                                                                                                                                                    | Covers **Export Team List** and **Export Access Audit** with no new machinery                                                                                                                                                                    |

### 1.3 The UI vocabulary to reuse — no new components

Everything the spec draws already has a component. **This plan adds zero files under
`components/`, introduces no new colours, spacing or typography, and defines no new theme tokens.**
New work is composition only.

| Spec element                                                                                        | Existing component                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Breadcrumb + title + subtitle + header actions                                                      | [components/page-header.tsx](components/page-header.tsx)                                                                                                                                                                                                                                                                           |
| KPI cards (5, clickable → quick filter)                                                             | [components/data-table/kpi-card.tsx](components/data-table/kpi-card.tsx) — `KpiCard`, `KpiRow`. Clickable variant: wrap in `<button className="text-left">`, as [suppliers-list.tsx:157](<app/(main)/suppliers/components/suppliers-list.tsx:157>). **`KpiRow` is a 4-column grid — the fifth card wraps; do not change the grid** |
| Saved views (10 pills)                                                                              | [components/data-table/saved-view-bar.tsx](components/data-table/saved-view-bar.tsx) — `SavedViewBar`                                                                                                                                                                                                                              |
| Filter chips (6)                                                                                    | [components/data-table/filter-select.tsx](components/data-table/filter-select.tsx) — `FilterSelect`, with the `More Filters` toggle pattern from [suppliers-list.tsx:204](<app/(main)/suppliers/components/suppliers-list.tsx:204>)                                                                                                |
| Team table + search + pagination + row click                                                        | [components/data-table/data-table.tsx](components/data-table/data-table.tsx)                                                                                                                                                                                                                                                       |
| Sortable headers                                                                                    | [components/data-table/sortable-header.tsx](components/data-table/sortable-header.tsx) — `header()`                                                                                                                                                                                                                                |
| **Avatar**                                                                                          | **There is no `avatar.tsx`.** Use `PersonChip` — [components/ui/tone-badge.tsx:69](components/ui/tone-badge.tsx:69) — which already renders an initials disc + name. **Do not add an Avatar component** (D8)                                                                                                                       |
| Profile tabs (5)                                                                                    | [components/animate-ui/components/animate/tabs.tsx](components/animate-ui/components/animate/tabs.tsx), as [supplier-detail.tsx:38](<app/(main)/suppliers/[supplierId]/components/supplier-detail.tsx:38>)                                                                                                                         |
| Status badges (Active / Invited / Deactivated / Seasonal Inactive), workload chips, readiness chips | [components/ui/tone-badge.tsx](components/ui/tone-badge.tsx) — `ToneBadge`, `ProgressBar`, `EmptyState`, `PermissionDenied`                                                                                                                                                                                                        |
| Colour vocabulary                                                                                   | [lib/ui/tone.ts](lib/ui/tone.ts) — `Tone`, `TONE_CLASS`. Account status and workload map onto existing tones with **no new palette**: Active→`success`, Invited→`info`, Seasonal Inactive→`warning`, Deactivated→`neutral`; Low/Normal→`neutral`/`success`, High→`warning`, Overloaded→`danger`                                    |
| Invite Team Member (compact **Dialog**, per spec)                                                   | [components/ui/dialog.tsx](components/ui/dialog.tsx) + `dialog-footer.tsx`, `input.tsx`, `combobox.tsx` (Role / Branch / Employment Type), `checkbox.tsx` (send-email / send-WhatsApp), `calendar.tsx` + `popover.tsx` (start / end date)                                                                                          |
| Assign Departure Group / Change Role / Deactivate / Revoke Sessions                                 | [components/ui/dialog.tsx](components/ui/dialog.tsx), with the confirm pattern from [confirm-action-dialog.tsx](<app/(main)/departure-groups/components/confirm-action-dialog.tsx>)                                                                                                                                                |
| Edit Profile (right-side sheet)                                                                     | [components/ui/sheet.tsx](components/ui/sheet.tsx), as [edit-group-details-sheet.tsx](<app/(main)/departure-groups/[groupId]/components/edit-group-details-sheet.tsx>)                                                                                                                                                             |
| Profile header stat cards / work summary                                                            | [components/ui/card.tsx](components/ui/card.tsx) + [components/section-heading.tsx](components/section-heading.tsx)                                                                                                                                                                                                                |
| Header overflow menu (`More ▾`)                                                                     | [components/ui/dropdown-menu.tsx](components/ui/dropdown-menu.tsx)                                                                                                                                                                                                                                                                 |
| Permission ✓ / ✕ list                                                                               | Plain `<ul>` + `Check` / `X` from `lucide-react` inside a `Card`. No new component                                                                                                                                                                                                                                                 |
| Feedback                                                                                            | [components/ui/toast.tsx](components/ui/toast.tsx) — `toast.add(...)`                                                                                                                                                                                                                                                              |
| Form reset on open                                                                                  | [hooks/use-reset-on-open.ts](hooks/use-reset-on-open.ts)                                                                                                                                                                                                                                                                           |

---

## 2. Findings — the gap between today and the specification

### F1 — There is no staff entity. This is the blocking defect.

Staff exist only as `auth.users` rows plus untyped `user_metadata`. Consequences the spec cannot
tolerate:

- the Team table has nothing to list — there is no query that returns "the agency's staff";
- branch, employment type, access window and account status have nowhere to live;
- "Seasonal Guides Active" and "Accounts Needing Review" are uncomputable;
- ownership is stored as a **display name string**, so renaming a person silently breaks
  `filterGroupsForRole()` and a guide loses access to their own groups;
- there is no picker anywhere — [assign-guide-dialog.tsx](<app/(main)/operations/components/assign-guide-dialog.tsx>)
  asks an operator to _type_ a guide's name.

### F2 — `getCurrentStaffRole()` returns `ADMIN` for everybody

[lib/data/departure-groups.ts:264](lib/data/departure-groups.ts:264) reads
`user_metadata.staff_role` and falls back to `ADMIN`. Every capability matrix in
`lib/access/` — ten files, several hundred lines of carefully reasoned gating — is therefore
**dead code in production**. Nothing is actually restricted today.

This is not a Team-page cosmetic issue. It means:

- the spec's permission panel would display a role the user does not really have;
- role-specific sidebars (§10) cannot work;
- shipping the Team page _without_ fixing this would let any signed-in user open it and invite an
  Admin.

**Fixing `getCurrentStaffRole()` is the highest-value deliverable in this module** and the reason
Phase 1 ships before any UI.

### F3 — Group ownership is a name, not a relationship

`departure_groups` carries both `*_owner_id uuid references auth.users` and `*_owner_name text`,
but only the name is ever written. There is also **no backup-guide id**, and no representation at
all for the spec's `Backup Operations` responsibility. A one-column-per-responsibility layout
cannot express "two backup guides" or "this person owns Visa on six groups" without a scan of every
group row.

### F4 — Task workload is computable today, but only per group

`departure_group_tasks` has `owner_id`, `owner_name`, `due_at`, `status` and an owner index. A
person's workload is `select … where owner_id = $1` across all groups — cheap. But `owner_id` is
**never populated** (tasks are created with `owner_name` only, mirroring F3), so the index is
currently useless.

The `OVERDUE` status is also a stored value, not derived — see
[departure-groups-tasks.ts](lib/data/departure-groups-tasks.ts). Any workload count must derive
overdue from `due_at < now` **and** the stored status, or the two surfaces will disagree.

### F5 — There is no non-group activity log

`departure_group_activity_logs` is `not null references departure_groups`. The spec's Activity &
Security tab needs events that have **no group**: login, role change, account activation and
deactivation, invitation acceptance, session revocation, password change. These cannot be written
to the existing table without a fake group id.

### F6 — Invitations have no transport, and no admin client exists

`.env.local` carries `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` only.
Every client in `utils/supabase/` is anon-key based. `supabase.auth.admin.inviteUserByEmail`,
`admin.signOut(jwt, 'global')` and `admin.updateUserById` all require the **secret / service-role
key**, which must never reach the browser.

WhatsApp invitation delivery has **no provider integration anywhere in the codebase** — the
existing "send WhatsApp" surfaces (`whatsappLink`, `guide_whatsapp_link`) are all `wa.me` deep
links opened by a human.

### F7 — Sessions, last login and 2FA are not observable from the app

`Active sessions: 2`, `Last login`, `Password updated: 15 July 2026` and `2FA: Enabled` live in
`auth.sessions` / `auth.users`, which the anon key cannot read and which are not exposed through
PostgREST. `last_sign_in_at` is available on the current user's own JWT only.

### F8 — Route, sidebar and spec disagree

Spec says `/management/team`. Sidebar says `/team`. Neither exists. There is also no
`app/(main)/management/` segment, so the breadcrumb's `Management` node has no destination.

### F9 — The sidebar is role-blind

[app-sidebar.tsx](components/app-sidebar.tsx) builds one hardcoded `adminBar` array for every user,
including links to routes that do not exist (`/tasks`, `/settings`, `/help`, `/marketing`,
`/finance`). §10 of the spec requires six role-specific sidebars. This is a real change to a shared
component and is deliberately sequenced **last** (Phase 9).

### F10 — RLS across the codebase is `using (true)`

Every existing migration grants `select`/`all` to `authenticated` unconditionally and relies on the
application layer to gate. That posture is acceptable for group data; it is **not** acceptable for
`staff_profiles`, where a Marketing user could otherwise read every colleague's access window and
role, or worse, write their own row to `ADMIN` through the browser client. The Team tables need
real policies (D5).

### F11 — There is no `/tasks` route for the KPI cards to link to

"Unassigned Tasks → opens a filtered Tasks view" has no destination. The nearest live surface is
the Tasks tab of the Operations Control Center
([tasks-tab.tsx](<app/(main)/operations/components/tabs/tasks-tab.tsx>)).

---

## 3. Decisions

| #       | Decision                                                                                                                                                                                                                                  | Why                                                                                                                                                                                                                                      |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D1**  | **`staff_profiles` is a table keyed by `auth.users.id`, not a replacement for it.** Supabase Auth stays the identity provider; `staff_profiles` is the agency's view of that identity                                                     | Keeps password, MFA and session handling with Supabase. Lets a row exist in `INVITED` state before the auth user completes setup                                                                                                         |
| **D2**  | **Ship `getCurrentStaffRole()` off `staff_profiles` in Phase 1, before any Team UI**                                                                                                                                                      | It is the single point every access decision in the app already flows through. Fixing it activates ten capability files at once; shipping the Team UI first would ship an admin surface with no gate                                     |
| **D3**  | **Assignments get their own table, `staff_group_assignments`.** The `departure_groups.*_owner_*` columns become a **denormalised cache** kept in sync by the assignment mutator                                                           | Answers "which groups does this person own" in one indexed query, supports many-to-many (two backup guides), and expresses `BACKUP_OPERATIONS` which no column can. Keeping the cache means the Departure Groups module needs no rewrite |
| **D4**  | **Two new log tables, not one:** `staff_activity_logs` (account lifecycle, role changes, assignments, access events) and reuse of `departure_group_activity_logs` for group work. The profile's Activity tab **merges both** at read time | F5. A person's group work is already logged; duplicating it would create two sources of truth for the same event                                                                                                                         |
| **D5**  | **Real RLS on the Team tables.** A `public.current_staff_role()` security-definer function reads `staff_profiles` for `auth.uid()`; select is limited to own-row + Admin/CEO, writes to Admin only                                        | F10. This is the one module where an application-layer-only gate is indefensible. The helper is reusable by later migrations                                                                                                             |
| **D6**  | **Invitations use a service-role client in a new `utils/supabase/admin.ts`, marked `import "server-only"`,** driving `auth.admin.inviteUserByEmail`                                                                                       | F6. Standard Supabase flow, gives a real secure setup link and a password the app never sees. Requires one new env var, `SUPABASE_SECRET_KEY`                                                                                            |
| **D7**  | **WhatsApp invitation delivery is a `wa.me` deep link the Admin sends by hand in V1**, matching every other WhatsApp surface in the app. The checkbox stays; the copy says "Open WhatsApp with the invite message"                        | F6. No provider, no budget, no webhook. Silently doing nothing behind a ticked checkbox is worse than being explicit                                                                                                                     |
| **D8**  | **No Avatar component.** `PersonChip` renders the initials disc the mock shows                                                                                                                                                            | Rule 2 of the brief: no new UI components. `PersonChip` already exists and is used by Leads and Pilgrims                                                                                                                                 |
| **D9**  | **Permissions are read-only in V1 and rendered _from_ `lib/access/*`,** via one new `describeRoleAccess(role)` function. Only the role itself is editable                                                                                 | Spec §"Access & permissions": role-based first, no per-user granular editing in V1. It also guarantees the panel can never lie about what the app enforces                                                                               |
| **D10** | **Seasonal expiry is enforced at role-resolution time, not by a cron job.** `getCurrentStaffRole()` treats `access_ends_on < today` as `SEASONAL_INACTIVE` and denies. A nightly job may later flip the stored status for reporting       | No scheduler exists in this codebase. Enforcing on read means expiry is correct the instant it happens, with or without a job                                                                                                            |
| **D11** | **Route is `/management/team`,** with `app/(main)/management/page.tsx` redirecting to it so the breadcrumb node resolves. Sidebar `Team` updated to the new URL                                                                           | F8. Follow the spec; the redirect costs four lines and prevents a dead breadcrumb                                                                                                                                                        |
| **D12** | **KPI cards link to a filtered _Team_ view where the subject is a person, and to the Operations Tasks tab where the subject is a task.** "Unassigned Tasks" deep-links to `/operations?tab=tasks&owner=unassigned`                        | F11. Do not build a `/tasks` route inside a Team ticket                                                                                                                                                                                  |
| **D13** | **`last_active_at` is a column on `staff_profiles`, stamped by `requireUser()` at most once per 15 minutes**                                                                                                                              | F7. `auth.sessions` is unreachable. A throttled touch is cheap, is honest about what it measures ("last activity", which is what the spec's column says), and needs no admin key                                                         |
| **D14** | **Active sessions and 2FA status are shown only when the admin client is configured, and are omitted otherwise** — no placeholder numbers                                                                                                 | F7. A hardcoded "2" in a security panel is a lie with consequences                                                                                                                                                                       |
| **D15** | **Deactivation never deletes.** It sets `status = DEACTIVATED`, revokes sessions, and leaves assignments intact but flagged, so the Departure Group shows "owner deactivated" rather than losing its owner                                | Mirrors the module-wide "archive, never erase" posture already stated in `departure-groups-access.ts`                                                                                                                                    |

---

## 4. Data model

New migration: `supabase/migrations/20260820090000_team_access.sql` (next free slot after
`20260819090000_reports.sql`). Additive only; safe on a database with `20260808…20260819` applied.

### 4.1 `staff_profiles`

```text
id                      uuid  primary key  references auth.users (id) on delete cascade
full_name               text  not null
email                   text  not null  unique (citext-normalised via lower() index)
whatsapp                text
role                    text  not null  check in (ADMIN, CEO, FINANCE, MARKETING, OPERATIONS, VISA, GUIDE)
branch                  text  not null  default 'ALL'      -- 'COLOMBO' | 'KANDY' | 'ALL'
employment_type         text  not null  default 'PERMANENT'
                              check in (PERMANENT, SEASONAL, CONTRACT, EXTERNAL_PARTNER)
status                  text  not null  default 'INVITED'
                              check in (ACTIVE, INVITED, DEACTIVATED, SEASONAL_INACTIVE)
access_starts_on        date
access_ends_on          date                                -- seasonal guides
job_title               text                                -- 'Operations Officer' on the profile header
last_active_at          timestamptz
activated_at            timestamptz
deactivated_at          timestamptz
deactivated_by          uuid references auth.users (id) on delete set null
deactivation_reason     text
created_at              timestamptz not null default now()
updated_at              timestamptz not null default now()  -- reuse public.set_updated_at() trigger
constraint staff_access_window check (access_ends_on is null or access_starts_on is null
                                      or access_ends_on >= access_starts_on)
```

Indexes: `(status, role)`, `(branch)`, `(access_ends_on) where access_ends_on is not null`,
`(last_active_at)`, unique `lower(email)`.

> **`role` is deliberately a plain `text` + check, not a Postgres enum** — every existing migration
> in this repo uses that idiom, and an enum makes adding `EXTERNAL_PARTNER` later a migration with
> a lock.

### 4.2 `staff_invitations`

```text
id                  uuid primary key default gen_random_uuid()
staff_profile_id    uuid not null references public.staff_profiles (id) on delete cascade
email               text not null
role                text not null      -- snapshot: what was offered
branch              text not null
employment_type     text not null
invited_by          uuid references auth.users (id) on delete set null
invited_by_name     text
sent_via            text[] not null default '{EMAIL}'    -- EMAIL | WHATSAPP
status              text not null default 'PENDING'
                        check in (PENDING, ACCEPTED, EXPIRED, REVOKED)
expires_at          timestamptz not null
accepted_at         timestamptz
created_at          timestamptz not null default now()
```

Serves **View Invitation History** and the "Pending Invitations" KPI. One row per send, so a resend
is a new row and the history is truthful.

### 4.3 `staff_group_assignments`

```text
id                    uuid primary key default gen_random_uuid()
staff_profile_id      uuid not null references public.staff_profiles (id) on delete cascade
departure_group_id    uuid not null references public.departure_groups (id) on delete cascade
responsibility        text not null
                          check in (PRIMARY_GUIDE, BACKUP_GUIDE, OPERATIONS_OWNER,
                                    BACKUP_OPERATIONS, VISA_OWNER, FINANCE_OWNER, MARKETING_OWNER)
assigned_by           uuid references auth.users (id) on delete set null
assigned_by_name      text
assigned_at           timestamptz not null default now()
unassigned_at         timestamptz                          -- soft release, keeps the audit trail
constraint staff_assignment_unique unique (departure_group_id, staff_profile_id, responsibility)
```

Indexes: `(staff_profile_id) where unassigned_at is null`, `(departure_group_id)`.

**Sync rule (D3):** `assignGroupToStaff` / `unassignGroupFromStaff` write this table _and_ update
the matching `departure_groups.*_owner_id` / `*_owner_name` (or `primary_guide_*` /
`backup_guide_name`) in the same call. `BACKUP_OPERATIONS` and second-or-later `BACKUP_GUIDE` rows
have no column and live only here — which is the point.

### 4.4 `staff_activity_logs`

```text
id                  uuid primary key default gen_random_uuid()
staff_profile_id    uuid not null references public.staff_profiles (id) on delete cascade
actor_id            uuid references auth.users (id) on delete set null
actor_name_snapshot text not null default 'System'
event_type          text not null
                        check in (INVITED, INVITATION_RESENT, INVITATION_REVOKED, ACCOUNT_ACTIVATED,
                                  ROLE_CHANGED, BRANCH_CHANGED, PROFILE_UPDATED, GROUP_ASSIGNED,
                                  GROUP_UNASSIGNED, ACCOUNT_DEACTIVATED, ACCOUNT_REACTIVATED,
                                  ACCESS_EXPIRED, ACCESS_EXTENDED, PASSWORD_RESET_SENT,
                                  SESSIONS_REVOKED, SENSITIVE_DATA_VIEWED)
before_value        jsonb
after_value         jsonb
message             text not null default ''
is_high_impact      boolean not null default false
created_at          timestamptz not null default now()
```

Index: `(staff_profile_id, created_at desc)`. Append-only; no update or delete policy.

`SENSITIVE_DATA_VIEWED` is reserved for the spec's _"sensitive document/visa access where relevant"_
and is **not written in V1** (§13) — the enum value exists so adding it later is not a migration.

### 4.5 `team_directory_rows` (view)

One row per staff profile, flattened for the list — same shape as `supplier_directory_rows`:

```sql
select p.*,
       (select count(*) from staff_group_assignments a
          where a.staff_profile_id = p.id and a.unassigned_at is null)          as assigned_group_count,
       (select coalesce(jsonb_agg(jsonb_build_object(
                 'groupId', g.id, 'groupName', g.group_name,
                 'responsibility', a.responsibility) order by g.departure_date), '[]'::jsonb)
          from staff_group_assignments a
          join departure_groups g on g.id = a.departure_group_id
         where a.staff_profile_id = p.id and a.unassigned_at is null
         limit 3)                                                               as primary_groups,
       (select count(*) from departure_group_tasks t
         where t.owner_id = p.id and t.status <> 'COMPLETE')                    as open_task_count,
       (select count(*) from departure_group_tasks t
         where t.owner_id = p.id and t.status <> 'COMPLETE' and t.due_at < now()) as overdue_task_count,
       (select count(*) from departure_group_tasks t
         where t.owner_id = p.id and t.status <> 'COMPLETE'
           and t.due_at::date = current_date)                                   as due_today_count,
       (select max(i.created_at) from staff_invitations i
         where i.staff_profile_id = p.id and i.status = 'PENDING')              as pending_invitation_at
from staff_profiles p;
```

> Overdue is derived from `due_at`, **not** from `status = 'OVERDUE'` (F4). The derivation file
> reconciles the two the same way `deriveReadinessStatuses()` does.

### 4.6 RLS (D5)

```sql
create or replace function public.current_staff_role() returns text
  language sql stable security definer set search_path = public as $$
  select role from public.staff_profiles where id = auth.uid()
$$;
```

| Table                     | select                                                             | insert / update / delete                            |
| ------------------------- | ------------------------------------------------------------------ | --------------------------------------------------- |
| `staff_profiles`          | `id = auth.uid()` **or** `current_staff_role() in ('ADMIN','CEO')` | `current_staff_role() = 'ADMIN'`                    |
| `staff_invitations`       | `current_staff_role() in ('ADMIN','CEO')`                          | `ADMIN`                                             |
| `staff_group_assignments` | `authenticated` (group screens need owner names)                   | `current_staff_role() in ('ADMIN','OPERATIONS')`    |
| `staff_activity_logs`     | `staff_profile_id = auth.uid()` or `ADMIN`/`CEO`                   | insert `authenticated`; **no** update/delete policy |

Everything a Guide or Marketing user needs about a _colleague_ (a name on a group) comes from
`staff_group_assignments` and the cached `departure_groups` columns — never from `staff_profiles`.

### 4.7 Backfill

The migration's final block inserts one `staff_profiles` row per existing `auth.users` row:
`role` from `user_metadata.staff_role` (falling back to `ADMIN` so the current single operator is
not locked out), `full_name` from `user_metadata.full_name`, `status = 'ACTIVE'`,
`branch = 'ALL'`, `employment_type = 'PERMANENT'`.

> **Deployment note:** applying this migration _activates_ every capability matrix in the app
> (D2/F2). Verify the backfill assigned the intended role to the intended person before deploying
> to an environment with more than one user.

---

## 5. Server-side files

Following the module conventions exactly (`lib/access` → `lib/types` → `lib/data/*-repository`
server-only → `lib/data/*` pure derivations → `lib/data/*-copy` labels → `lib/validations`).

| File                          | Responsibility                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/types/team.ts`           | `StaffProfileRow`, `StaffInvitationRow`, `StaffGroupAssignmentRow`, `StaffActivityRow`, `TeamDirectoryRow`, plus the client-safe view models `TeamMemberListItem`, `TeamMemberProfile`, `TeamWorkloadSummary`, `RoleAccessSummary`                                                                                                                                          |
| `lib/access/team-access.ts`   | `TeamCapabilities` + `capabilitiesForTeam(role)` + `TEAM_TAB_IDS` / `visibleTabsForTeamMember(role, isSelf)` + `describeRoleAccess(role)` (D9)                                                                                                                                                                                                                              |
| `lib/data/team-repository.ts` | **Server-only.** `loadTeamDirectory`, `loadStaffProfile`, `loadStaffAssignments`, `loadStaffTasks`, `loadStaffActivity`, and every mutator: `inviteStaff`, `resendInvitation`, `revokeInvitation`, `updateStaffProfile`, `changeStaffRole`, `assignGroupToStaff`, `unassignGroupFromStaff`, `deactivateStaff`, `reactivateStaff`, `extendSeasonalAccess`, `touchLastActive` |
| `lib/data/team.ts`            | Pure, client-safe: `toTeamMemberListItems`, `computeTeamKpis`, `workloadBand`, `accountStatusTone`, `needsAccessReview`, `mergeActivityStreams`                                                                                                                                                                                                                             |
| `lib/data/team-copy.ts`       | `ROLE_DESCRIPTIONS`, `BRANCH_LABELS`, `EMPLOYMENT_TYPE_LABELS`, `ACCOUNT_STATUS_LABELS`, `RESPONSIBILITY_LABELS`, `ACTIVITY_EVENT_COPY`, `WORKLOAD_BANDS`, `ACCESS_REVIEW_DAYS = 60`                                                                                                                                                                                        |
| `lib/validations/team.ts`     | `inviteStaffSchema`, `updateStaffProfileSchema`, `changeRoleSchema`, `assignGroupSchema`, `deactivateStaffSchema`, `extendAccessSchema`, `toTeamFieldErrors`                                                                                                                                                                                                                |
| `utils/supabase/admin.ts`     | **New.** `import "server-only"` + `createAdminClient()` on `SUPABASE_SECRET_KEY`, `persistSession: false`. Throws a clear error if the env var is absent (D6/D14)                                                                                                                                                                                                           |

### 5.1 `capabilitiesForTeam` — the shape

```ts
interface TeamCapabilities {
  viewModule: boolean; // ADMIN, CEO
  viewFullDirectory: boolean; // ADMIN, CEO — otherwise own profile only
  inviteStaff: boolean; // ADMIN
  editProfile: boolean; // ADMIN
  changeRole: boolean; // ADMIN
  deactivateStaff: boolean; // ADMIN
  assignGroups: boolean; // ADMIN, OPERATIONS
  viewWorkload: boolean; // ADMIN, CEO, OPERATIONS
  viewSecurityTab: boolean; // ADMIN
  manageSessionsAndPasswords: boolean; // ADMIN
  exportTeamList: boolean; // ADMIN, CEO
  exportAccessAudit: boolean; // ADMIN
  viewOwnProfileOnly: boolean; // everyone else
}
```

`OPERATIONS` gets `assignGroups` because group ownership is operational, not administrative — it is
the same person who runs [assign-guide-dialog.tsx](<app/(main)/operations/components/assign-guide-dialog.tsx>)
today. Everyone else lands on their **own** profile with tabs limited to Overview, Access
(read-only), Assigned Groups and My Tasks.

### 5.2 The `getCurrentStaffRole()` replacement (Phase 1)

`lib/data/departure-groups.ts:264` keeps its **name, signature and `cache()` wrapper** so the ~40
call sites across the app need no edit. The body changes to:

1. `getUser()`;
2. select `role, full_name, status, access_ends_on` from `staff_profiles` where `id = user.id`;
3. no row → **denied** posture (`GUIDE` with no assignments is the safest floor; a `notFound()` on
   every module follows naturally from the existing capability files);
4. `status <> 'ACTIVE'`, or `access_ends_on < today` (D10) → same denied posture;
5. otherwise return the real `{ role, name }`.

It also returns a new optional `staffId` field so mutators can finally populate `owner_id` and
`*_owner_id` (F3/F4). Existing destructuring `const { role } = …` is unaffected.

> This is the one change in the plan that touches every module. It ships alone, behind a working
> backfill, and is verified by signing in as each role before any Team UI exists.

---

## 6. Routes and client files

```text
app/(main)/management/page.tsx                       → redirect("/management/team")
app/(main)/management/team/
  page.tsx                                           Server Component: role gate, load, provide
  loading.tsx                                        Skeleton (copy packages/loading.tsx)
  error.tsx                                          Copy packages/error.tsx
  team-store.tsx                                     Client context (copy suppliers-store.tsx)
  types.ts                                           Filters, saved views, quick filters, sort
  utils.ts                                           matchesTeamSearch/Filters, sortTeam, formatLastActive
  csv.ts                                             teamToCsv, accessAuditToCsv
  actions.ts                                         All Server Actions
  components/
    team-list.tsx                                    Header + KPIs + saved views + filters + table
    invite-team-member-dialog.tsx                    Spec's compact Dialog
    invitation-history-sheet.tsx                     More ▾ → View Invitation History
    deactivated-staff-sheet.tsx                      More ▾ → View Deactivated Staff
    roles-permissions-sheet.tsx                      More ▾ → Manage Roles & Permissions (read-only, D9)
    deactivate-staff-dialog.tsx
    change-role-dialog.tsx
    assign-group-dialog.tsx                          Reused by the profile page
    extend-access-dialog.tsx                         Seasonal guides
  team-table/
    team-columns.tsx                                 buildTeamColumns(...)
  [userId]/
    page.tsx                                         Server Component: profile load + tab gate
    loading.tsx
    components/
      team-member-detail.tsx                         Tab shell (copy supplier-detail.tsx)
      edit-profile-sheet.tsx
      tabs/overview-tab.tsx
      tabs/access-permissions-tab.tsx
      tabs/assigned-groups-tab.tsx
      tabs/tasks-workload-tab.tsx
      tabs/activity-security-tab.tsx
```

`components/app-sidebar.tsx` — `Team` URL `/team` → `/management/team` (D11), plus the role-aware
rework in Phase 9.

### 6.1 List page contract

`page.tsx` is a Server Component (`export const dynamic = "force-dynamic"`), matching
[suppliers/page.tsx](<app/(main)/suppliers/page.tsx>):

```ts
const { role, name } = await getCurrentStaffRole();
const can = capabilitiesForTeam(role);
if (!can.viewModule) {
  if (can.viewOwnProfileOnly) redirect(`/management/team/${ownStaffId}`);
  notFound();
}
const [rows, groupOptions] = await Promise.all([
  loadTeamDirectory(supabase, can),
  can.assignGroups ? loadDepartureGroupPickerOptions(supabase) : [],
]);
const nowIso = new Date().toISOString(); // one clock, serialised down
```

`nowIso` decided once on the server is non-negotiable — every "18 minutes ago", "overdue" and
"60+ days" derivation measures against it, exactly as Suppliers and Pilgrims do.

### 6.2 Table columns → data

| Spec column     | Source                                                                                                                                       |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Team Member     | `PersonChip` with `full_name`; `email` / `whatsapp` underneath                                                                               |
| Role            | `ROLE_LABELS[role]` (reused from `departure-groups-access.ts`) as a `ToneBadge`                                                              |
| Branch          | `BRANCH_LABELS[branch]`                                                                                                                      |
| Status          | `ToneBadge`, tone from `accountStatusTone()`                                                                                                 |
| Assigned Groups | `assigned_group_count` + first two names from `primary_groups`                                                                               |
| Open Tasks      | `open_task_count` · `overdue_task_count` overdue (danger tone when > 0)                                                                      |
| Last Active     | `formatLastActive(last_active_at, nowIso)` — "18 minutes ago" / "Never" / "Invited 3 days ago"                                               |
| Actions         | `DropdownMenu`: Open profile · Edit · Assign group · Change role · Deactivate — each item rendered only when the matching capability is true |

### 6.3 KPI cards → filters (D12)

| Card                    | Value                                                                         | Click                                    |
| ----------------------- | ----------------------------------------------------------------------------- | ---------------------------------------- |
| Active Team Members     | `status = ACTIVE`                                                             | saved view `Active Staff`                |
| Pending Invitations     | `status = INVITED`                                                            | saved view `Pending Invitations`         |
| Seasonal Guides Active  | `role = GUIDE ∧ employment_type = SEASONAL ∧ status = ACTIVE`                 | saved view `Seasonal Guides`             |
| Unassigned Tasks        | count of `departure_group_tasks` with `owner_id is null ∧ status <> COMPLETE` | `/operations?tab=tasks&owner=unassigned` |
| Accounts Needing Review | `last_active_at < now − 60d` (or null while `ACTIVE`)                         | saved view `No Recent Activity`          |

Saved views (`SavedViewBar`), verbatim from the spec: All Team Members · Active Staff · Seasonal
Guides · Operations Team · Visa Team · Finance Team · Pending Invitations · Deactivated Accounts ·
Overloaded Staff · No Recent Activity.

Filters (`FilterSelect`): Role · Branch · Account Status · Assigned Group · Task Load · Last Active.

---

## 7. Server Actions

`app/(main)/management/team/actions.ts` — every action follows the house shape: `requireUser()` →
`getCurrentStaffRole()` → capability check → Zod parse → repository call → `revalidatePath` →
`{ ok, error?, fieldErrors? }`.

| Action                       | Capability                   | Notes                                                                                                                                    |
| ---------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `inviteTeamMemberAction`     | `inviteStaff`                | See §7.1                                                                                                                                 |
| `resendInvitationAction`     | `inviteStaff`                | New `staff_invitations` row; re-issues the auth invite                                                                                   |
| `revokeInvitationAction`     | `inviteStaff`                | Invitation → `REVOKED`, profile → `DEACTIVATED`                                                                                          |
| `updateStaffProfileAction`   | `editProfile`                | Name, WhatsApp, job title, branch, employment type, dates                                                                                |
| `changeStaffRoleAction`      | `changeRole`                 | **Always logs** `ROLE_CHANGED` with before/after, `is_high_impact = true`. Refuses to demote the last remaining `ADMIN`                  |
| `assignGroupAction`          | `assignGroups`               | Writes assignment + syncs the `departure_groups` cache + logs to **both** `staff_activity_logs` and `departure_group_activity_logs` (D4) |
| `unassignGroupAction`        | `assignGroups`               | Soft release via `unassigned_at`; clears the cached column if it pointed at this person                                                  |
| `deactivateStaffAction`      | `deactivateStaff`            | Status + `deactivated_by/at/reason`, revoke sessions if the admin client exists, keep assignments (D15). Refuses on the last `ADMIN`     |
| `reactivateStaffAction`      | `deactivateStaff`            | Back to `ACTIVE`, clears the deactivation fields                                                                                         |
| `extendSeasonalAccessAction` | `editProfile`                | New `access_ends_on`; logs `ACCESS_EXTENDED`                                                                                             |
| `sendPasswordResetAction`    | `manageSessionsAndPasswords` | Reuses `supabase.auth.resetPasswordForEmail` from [app/(auth)/actions.ts:140](<app/(auth)/actions.ts:140>) — **no admin key needed**     |
| `revokeSessionsAction`       | `manageSessionsAndPasswords` | `admin.signOut(userId, 'global')`. Hidden when the admin client is unconfigured (D14)                                                    |

`revalidatePath("/management/team")`, the profile path, and — for assignment actions —
`/departure-groups/[groupId]` and `/operations`.

### 7.1 Invite flow (D6/D7)

1. Validate (`inviteStaffSchema`: name, email, optional `+94` WhatsApp, role, branch, employment
   type, optional start/end date, at least one delivery channel; **`SEASONAL` requires
   `access_ends_on`**).
2. Reject a duplicate `lower(email)` already in `staff_profiles` with a field error.
3. `createAdminClient().auth.admin.inviteUserByEmail(email, { redirectTo: siteUrl("/login?mode=setup") })`
   — reuse [lib/site-url.ts](lib/site-url.ts).
4. Insert `staff_profiles` with the returned `user.id` and `status = 'INVITED'`.
5. Insert `staff_invitations` (`PENDING`, `expires_at = now + 7 days`).
6. Log `INVITED`.
7. If WhatsApp was ticked, return a `wa.me` URL in the result; the dialog opens it in a new tab and
   the toast says "Invitation email sent · open WhatsApp to send the link".

**Acceptance:** the user completes Supabase's setup link and signs in. `requireUser()`'s
`touchLastActive` (D13) sees `status = 'INVITED'`, flips it to `ACTIVE`, stamps `activated_at`,
marks the invitation `ACCEPTED`, and logs `ACCOUNT_ACTIVATED`. The spec's _"Admin is notified when
account activates"_ is satisfied in V1 by that log line surfacing in the Admin's activity feed —
**no notification system is built here** (§13).

---

## 8. Profile page (`/management/team/[userId]`)

Five tabs, gated by `visibleTabsForTeamMember(role, isSelf)`.

### 8.1 Overview

Header (`PageHeader`) with name, job title, and `ToneBadge`s for status / branch / employment type;
contact card; `[Edit Profile]` / `[Deactivate Access]` gated on capability. Work summary as five
`Card`s: Assigned Groups · Open Tasks · Overdue · Completed This Week · Current Workload
(`workloadBand()`, D-band thresholds 0–4 / 5–8 / 9–12 / 13+). Assigned-groups preview lists up to
three groups with responsibility, `ProgressBar` readiness and `[Open Group]`.

### 8.2 Access & Permissions

Role `Combobox` + `[Save Role Change]` (Admin only), then the ✓ / ✕ panel rendered by
`describeRoleAccess(role)` (D9). That function walks the ten existing `capabilitiesFor*` matrices
and produces `{ canAccess: string[], cannotAccess: string[] }` — so the panel is generated from the
enforcement code and cannot drift from it. Below: the last five `ROLE_CHANGED` entries.

### 8.3 Assigned Groups

Table of `staff_group_assignments` joined to groups: Group · Responsibility · Status
(`readiness_status` as a `ToneBadge`). `[ + Assign Departure Group ]` opens `assign-group-dialog`
(group `Combobox` + responsibility `Combobox`). For `GUIDE`, each row also shows pilgrim count and
"Departs in N days"; `[Open Guide Workspace]` links to the existing
[guide-operations-tab](<app/(main)/departure-groups/[groupId]/components/tabs/guide-operations-tab.tsx>)
via `/departure-groups/{id}?tab=guide` — **no new workspace is built**.

### 8.4 Tasks & Workload

Four counters (Open · Due Today · Overdue · Completed This Week) over `departure_group_tasks`
filtered by `owner_id`, then a `DataTable`: Task · Departure Group · Priority · Due · Status ·
`[Open]` → `/departure-groups/{groupId}?tab=readiness`.

> `departure_group_tasks` has **no `priority` column.** Render the existing `category` in that
> position, or add `priority` in this migration. **Recommendation: render `category`** and leave
> priority to the Tasks module — adding a column to a table two other modules write is out of scope
> here (§13, open question Q2).

### 8.5 Activity & Security

Merged feed (D4): `staff_activity_logs` for this person ∪ `departure_group_activity_logs` where
`actor_id = userId`, sorted by `created_at desc`, capped at 50, rendered with the existing activity
row markup from [suppliers .../tabs/activity-tab.tsx](<app/(main)/suppliers/[supplierId]/components/tabs/activity-tab.tsx>).

Security block (Admin only): Last login (= `last_active_at`, labelled honestly), Password updated
and 2FA **only when the admin client is configured** (D14), `[Reset Password]` (always available,
no admin key needed) and `[Revoke Sessions]` (admin key only).

---

## 9. Seasonal guide workflow

- **Invite:** `employment_type = SEASONAL` makes `access_ends_on` required (§7.1).
- **Enforcement:** `getCurrentStaffRole()` denies once `access_ends_on < today` (D10) — access dies
  on the date whether or not any job runs.
- **Visibility:** a `SEASONAL_INACTIVE` `ToneBadge` in the Status column; the "Seasonal Guides
  Active" KPI counts only unexpired ones; the `Seasonal Guides` saved view lists both.
- **Warning:** the Team list shows an inline `EmptyState`-style banner when any seasonal access
  expires within 7 days, with `[Extend Access]`. This replaces the spec's "automatically reminds
  Admin" — **there is no email/notification system** (§13).
- **Group completion:** when a group moves to `COMPLETED`, `markGroupCompleted` in
  [departure-groups-lifecycle.ts](lib/data/departure-groups-lifecycle.ts) also writes a
  `staff_activity_logs` row (`ACCESS_EXPIRED` candidate) for each assigned `SEASONAL` guide. That
  surfaces the review prompt on the Team page; the Admin then deactivates or retains. **No
  automatic deactivation on group completion** — the access window is the contract, not the group.

Guide access scope is already correct once F2 is fixed: `capabilitiesFor("GUIDE")` restricts to
assigned groups, `visibleTabsFor("GUIDE")` hides Payments/Activity, and
`capabilitiesForSuppliers("GUIDE")` limits to emergency contacts. **`filterGroupsForRole()` should
switch from name-matching to `staff_group_assignments`** in Phase 5 (F3).

---

## 10. Role-specific sidebar (Phase 9)

`AppSidebar` becomes role-aware without becoming a new component:

1. `app/(main)/layout.tsx` calls `getCurrentStaffRole()` and passes `role` into `<AppSidebar />`.
   The layout is already a Server Component; `AppSidebar` stays `"use client"` and receives the
   role as a prop — no context, no fetch.
2. Add `roles: StaffRole[]` to the existing `NavItem` type and filter `adminBar` sections by it.
3. Map the spec's six sidebars onto the existing entries. Links to routes that do not exist
   (`/tasks`, `/settings`, `/help`, `/marketing`, `/finance`) should be **removed or disabled in the
   same pass** (F9) — shipping a role-filtered sidebar that still 404s defeats the point.

Guides see `My Groups` (`/departure-groups`, already filtered for them), `My Tasks`
(`/management/team/{self}?tab=tasks`) and their group's guide tab. **No new Guide routes.**

---

## 11. Build order

Mapped to the spec's V1 order, resequenced so the access fix lands first (D2).

| Phase     | Deliverable                                                                                                                                                                                                | Spec item    | Depends on                   |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ---------------------------- |
| **1**     | Migration `20260820090000_team_access.sql` (all four tables, view, RLS, backfill) + `lib/types/team.ts` + **`getCurrentStaffRole()` reading `staff_profiles`**                                             | prerequisite | —                            |
| **2**     | `lib/access/team-access.ts`, `lib/data/team-repository.ts` (reads), `lib/data/team.ts`, `team-copy.ts`, route + redirect + sidebar URL, `team-list.tsx` with table, KPIs, saved views, filters, CSV export | 1            | 1                            |
| **3**     | `utils/supabase/admin.ts`, `lib/validations/team.ts`, invite dialog + `inviteTeamMemberAction` + invitation history sheet                                                                                  | 2            | 2                            |
| **4**     | Profile route, Overview + Access & Permissions tabs, `describeRoleAccess`, change-role dialog                                                                                                              | 3            | 2                            |
| **5**     | Account status lifecycle: deactivate / reactivate / deactivated-staff sheet; `filterGroupsForRole()` moved onto assignments                                                                                | 4            | 4                            |
| **6**     | `staff_group_assignments` mutators, Assigned Groups tab, assign/unassign dialogs, `departure_groups` cache sync, **`assign-guide-dialog.tsx` converted from free text to a staff picker**                  | 5            | 5                            |
| **7**     | Seasonal expiry: date enforcement in role resolution, expiry banner, extend-access dialog, group-completion review prompt                                                                                  | 6            | 6                            |
| **8**     | Tasks & Workload tab; populate `owner_id` in `createGroupTask` (F4); workload bands and the `Overloaded Staff` view                                                                                        | 7            | 6                            |
| **9**     | Activity & Security tab, merged feed, password reset / revoke sessions, Export Access Audit, **role-specific sidebar**                                                                                     | 8 + §10      | 8                            |
| **later** | Per-user permission overrides                                                                                                                                                                              | 9            | — deliberately unbuilt (§13) |

Phases 1 and 2 are the minimum shippable Team page. Phase 1 is independently valuable and should
be reviewed and deployed on its own.

---

## 12. Cross-module impact

| File                                                                                                                   | Change                                                                              | Phase |
| ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ----- |
| [lib/data/departure-groups.ts:264](lib/data/departure-groups.ts:264)                                                   | `getCurrentStaffRole()` reads `staff_profiles`; returns `staffId`                   | 1     |
| [lib/access/departure-groups-access.ts:199](lib/access/departure-groups-access.ts:199)                                 | `filterGroupsForRole()` takes assigned group ids instead of a name                  | 5     |
| [app/(main)/operations/components/assign-guide-dialog.tsx](<app/(main)/operations/components/assign-guide-dialog.tsx>) | Free-text input → staff `Combobox`; writes `primary_guide_id` and an assignment row | 6     |
| [lib/data/departure-groups-tasks.ts](lib/data/departure-groups-tasks.ts)                                               | `createGroupTask` / `reassignTask` populate `owner_id`                              | 8     |
| [lib/data/departure-groups-lifecycle.ts](lib/data/departure-groups-lifecycle.ts)                                       | `COMPLETED` writes a guide access-review log row                                    | 7     |
| [components/app-sidebar.tsx](components/app-sidebar.tsx)                                                               | `Team` URL; then role filtering                                                     | 2, 9  |
| [app/(main)/layout.tsx](<app/(main)/layout.tsx>)                                                                       | Resolve role, pass to `AppSidebar`                                                  | 9     |
| [lib/dal.ts](lib/dal.ts)                                                                                               | `requireUser()` gains the throttled `touchLastActive` + invitation-acceptance flip  | 1     |
| `.env.local` / deploy env                                                                                              | New `SUPABASE_SECRET_KEY`                                                           | 3     |

---

## 13. Explicitly out of scope for V1

Payroll · salary · attendance · leave & holidays · recruitment & applicants · appraisals &
performance scoring · contracts & documents about staff · org chart · shift rostering ·
per-user permission overrides (D9) · a notification/email system beyond the Supabase invite ·
WhatsApp API delivery (D7) · a `/tasks` route (D12) · a separate Guide Workspace route (§8.3) ·
`SENSITIVE_DATA_VIEWED` audit writes (§4.4) · impersonation / "log in as" · multi-agency tenancy
(`agency_id` exists on `departure_groups` and is unused; `staff_profiles` deliberately omits it
until tenancy is a real requirement).

---

## 14. Open questions

| #      | Question                                                         | Recommendation                                                                                                                                                             |
| ------ | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Q1** | Is `SUPABASE_SECRET_KEY` available in the deploy environment?    | Required for Phase 3. Without it, invitations degrade to "create the profile row + admin shares a magic-link manually" — workable but worse. Confirm before Phase 3 starts |
| **Q2** | Should `departure_group_tasks` gain a `priority` column?         | Not in this module. Render `category` in the Priority position (§8.4) and let the Tasks module own it                                                                      |
| **Q3** | Is the branch list fixed at Colombo / Kandy / All?               | Hardcode the three in `team-copy.ts` for V1; a `branches` table is a Settings-module concern                                                                               |
| **Q4** | Should CEO be able to see the full directory?                    | Yes — read-only. The spec's CEO row says "business visibility, strategic read-only", and the Accounts Needing Review KPI is a governance signal                            |
| **Q5** | What happens to a group whose only owner is deactivated?         | D15 keeps the assignment and flags it. Consider a `Groups with deactivated owners` entry in the Operations blockers list — **not built here**                              |
| **Q6** | Does `EXTERNAL_PARTNER` need a role, or only an employment type? | Employment type only in V1, as the spec's role table marks it "optional … later". A partner is invited as `GUIDE` with `employment_type = EXTERNAL_PARTNER`                |
