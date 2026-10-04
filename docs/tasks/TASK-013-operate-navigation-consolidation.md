# TASK-013 Operate Navigation Consolidation

## What

Consolidate the seven sidebar destinations under **Operate** into one operational
workspace plus two specialist workspaces. Remove navigation that offers a
second, largely overlapping cross-group view of the same flight, accommodation,
transport, or support work.

The target sidebar is:

| Sidebar item | Route | Job for the user |
|---|---|---|
| Operations | `/operations` | Resolve what could stop an active departure: readiness, tasks, supplier confirmations, travel, rooming, transport, support, guide briefings, and activity. |
| Documents | `/documents` | Run the agency-wide evidence collection and document-review workflow. |
| Visa Operations | `/visa` | Run the application, batch-submission, status-check, and issuance workflow. |

## Why

An operations user currently has seven choices under one heading, but four
choices are duplicate cross-group views of information that is already inside
the Readiness Center. This makes navigation depend on knowing the data type
before the user can see the operational problem, and it creates conflicting
counts, filters, and deep links for the same work.

The product should use one clear rule:

> Open **Operations** to find and resolve an active-departure problem. Open a
> specialist workspace only when its workflow has its own high-volume queue,
> bulk actions, or controlled lifecycle.

## Audit findings and navigation decisions

| Current nav/page | User value today | Overlap / concern | Decision |
|---|---|---|---|
| **Readiness Center** → `/operations` | A cross-group mission-control view with tasks, supplier confirmations, flight risk, accommodation/rooming risk, transport risk, guide briefings, readiness, and activity. | Its name implies a single readiness report although it is the actual operational home. Its tabs already duplicate three separate sidebar routes. | **Keep and rename in the sidebar to “Operations”.** Retain the page title “Operations Control Center” initially, then test whether the shorter “Operations” title is clearer in the header. |
| **Documents** → `/documents` | Full document queue: review drawer, upload/request actions, saved views, assignment, alerts, exports, and a visa-submission-pack export. | This is not merely a summary. It is a distinct evidence-review workflow with sensitive-file access and batch work. | **Keep as a standalone specialist workspace.** Surface only document blockers and a deep link from Operations; do not duplicate its table or review controls in Operations. |
| **Visas** → `/visa` | Full visa queue: batch creation, submission pack, status checks, officer assignment, application review, and issue/verification work. | It shares document prerequisites but owns a separate, regulated application lifecycle and batch operations. | **Keep as a standalone specialist workspace; rename nav label to “Visa Operations”.** Surface visa blockers and a deep link from Operations; do not merge its workflow into Documents or Operations. |
| **Flights & Tickets** → `/flights-tickets` | Cross-group flight list, statuses, ticketing deadline, and a manifest drill-in. | `/operations` already has **Flights & Tickets** with risk states, deadline/seat/name-mismatch warnings, search, and group drill-in. Both are read-across views while edits occur in a departure group. | **Remove from the sidebar and retire as a top-level workspace.** Move the useful manifest action into the Operations flight tab or direct it to the existing group-flight detail. Redirect legacy links to `/operations?tab=flights`. |
| **Hotels & Rooming** → `/hotels-rooming` | Cross-group stay list plus a separate rooming board for partially filled rooms across groups. | The main stay list duplicates the Operations **Accommodation & Rooming** tab. The rooming-board clustering is valuable, but it is a mode of rooming work, not a page that warrants a top-level destination. | **Remove from the sidebar and retire the top-level list.** Add a persisted “Rooming board” view inside Operations → Accommodation & Rooming, preserving partial-room and shared-hotel filters. Redirect `/hotels-rooming` and `/hotels-rooming/rooming-board` to that tab/view. |
| **Transport & Movements** → `/transport-movements` | Cross-group movements, capacity and driver warnings. | `/operations` already has **Transport**, which prioritises the same missing-driver, capacity, and supplier risks and links to the group action surface. | **Remove from the sidebar and retire as a top-level workspace.** Carry any missing filters/columns into Operations → Transport, then redirect legacy links to `/operations?tab=transport`. |
| **Support & Incidents** → `/support-incidents` | Cross-pilgrim triage with priority, SLA, status update, and drill-in to the pilgrim support tab. | It is operational work but is disconnected from the place staff assess a group’s blockers, handoffs, and daily workload. It is not a specialist lifecycle large enough to justify the fourth remaining top-level Operate destination. | **Remove from the sidebar and add an Operations → Support Cases tab.** Preserve priority/SLA/status controls and the pilgrim drill-in; permission-gate it with the existing pilgrim-support capabilities. Redirect legacy links to `/operations?tab=support`. |

### Explicit non-decisions

- Do not remove the underlying group-level Flights, Hotels, Transport, or
  Pilgrim Support tabs. Those are the canonical places to edit the record.
- Do not merge Documents and Visa Operations. Their review, ownership, export,
  and security needs make a combined queue less clear and less safe.
- Do not introduce a new Operations domain table. This is composition of
  existing agency-scoped repositories and mutations.
- The unlinked `/guides-field-team` and `/itinerary-services` routes are not
  part of the current **Operate** sidebar and are out of scope for this task.

## Proposed information architecture

```text
Operate
├── Operations
│   ├── Overview
│   ├── Operational Tasks
│   ├── Supplier Confirmations
│   ├── Flights & Tickets
│   ├── Accommodation & Rooming
│   │   ├── Stay risk queue
│   │   └── Rooming board
│   ├── Transport
│   ├── Support Cases
│   ├── Guides & Briefings
│   ├── Group Readiness
│   └── Activity
├── Documents
└── Visa Operations
```

`Operations` must become URL-addressable rather than relying only on local tab
state. Use `tab` as the query parameter and a second view parameter only when a
tab needs it, for example:

- `/operations?tab=flights`
- `/operations?tab=accommodation&view=rooming-board`
- `/operations?tab=transport`
- `/operations?tab=support`

This preserves shareable links, lets redirects retain user intent, and avoids
adding another sidebar entry for a sub-view.

## Delivery plan

### Slice 1 — Establish the canonical Operations URL contract

1. Define the allowed Operations tab IDs and tab-specific view values in a
   typed URL-state helper; unknown values fall back to `overview`.
2. Hydrate the selected tab/view from `searchParams`, and update the URL using
   client navigation without a full page reload.
3. Update dashboard cards, breadcrumbs, and internal links that mean an
   Operations subqueue to use the canonical URL.
4. Keep all destinations backward-compatible during migration with permanent
   redirects from the retired top-level URLs. Preserve meaningful context such
   as a flight manifest ID only where an equivalent destination exists;
   otherwise route to the parent Operations queue rather than a misleading
   exact filter.

### Slice 2 — Make Operations the complete operational queue

1. Add **Support Cases** to the Operations snapshot using the existing
   `listAllSupportRequests` read model and retain the current table’s priority,
   SLA, filtering, status mutation, and pilgrim drill-in behavior.
2. Ensure the new tab is rendered only for roles that pass the same combined
   `viewMedical || manageSupportRequests` gate used today. Do not expose case
   details in overview metrics or activity to roles lacking that access.
3. Compare the retired Flights, Hotels, and Transport columns/actions against
   their Operations tabs. Bring across only gaps that help a user resolve an
   exception: flight manifest drill-in; hotel city/date/capacity context; and
   transport status filtering. Do not rebuild a second all-record table.
4. Add the existing cross-group partial-room clustering as
   `Accommodation & Rooming → Rooming board`. It must retain the current
   partial-only, multi-group, and hotel-search paths and link to the canonical
   group-level rooming action.
5. Add concise Overview cards for urgent support, rooming, transport, flight,
   document, and visa blockers only when the viewer has the corresponding
   capability. Each card links into its canonical queue rather than showing
   a parallel mini-workflow.

### Slice 3 — Simplify the sidebar and retire duplicate surfaces

1. In `components/app-sidebar.tsx`, rename **Readiness Center** to
   **Operations**, rename **Visas** to **Visa Operations**, and remove Flights
   & Tickets, Hotels & Rooming, Transport & Movements, and Support & Incidents.
2. Replace retired page implementations with server redirects after Slice 2
   proves every critical workflow is reachable in Operations. Do not delete
   data repositories, group-level editors, or the flight manifest detail route.
3. Update page breadcrumbs to say **Operations**, not the ambiguous
   “Operate” placeholder link, for all surviving routes and redirected
   destinations.
4. Update any documentation that defines the old navigation map.

### Slice 4 — Validate the reduction with real user journeys

Test these journeys with Operations, Visa, and Operations/Guide roles:

1. A coordinator finds a ticketing deadline, opens the group flight record or
   manifest, and returns to the same Operations queue.
2. A coordinator finds partially occupied rooms across groups and reaches the
   group-level room assignment action.
3. A coordinator finds an over-capacity movement or missing driver and reaches
   the group transport action.
4. A support-capable user triages an urgent overdue case and changes its
   status; a user without medical/support access cannot view it.
5. A document reviewer and visa officer reach their full queues directly;
   Operations only shows authorised blocker summaries and routes them to the
   specialist workspace.
6. Old bookmarked URLs land on the right Operations queue, with no 404 and no
   loss of agency/role enforcement.

## Data model changes

None planned. The consolidation reuses existing agency-scoped reads,
including operations, support, flights, accommodation/rooming, transport,
documents, and visa data. No migration or new RLS policy is required unless
implementation discovers that the current support query cannot be safely
consumed by the Operations server boundary.

## Access control changes

No new capability is planned. Reuse:

- `capabilitiesForOperations(role)` for the Operations workspace;
- the existing combined pilgrim-support gate for Support Cases;
- existing Documents and Visa capability files for specialist workspaces;
- existing role-restricted group filtering for guide-scoped operations data.

Every existing mutation remains guarded at its Server Action boundary. Moving
a control into Operations must not convert a UI visibility check into the only
authorization check.

## UI surfaces

- `components/app-sidebar.tsx`
- `app/(main)/operations/**`, including URL-state handling, Support Cases, and
  the Accommodation & Rooming rooming-board view
- Legacy route pages under `flights-tickets`, `hotels-rooming`,
  `transport-movements`, and `support-incidents` for redirects only
- Dashboard cards, breadcrumbs, and in-app links pointing at retired routes

The implementation must use existing shadcn and shared table primitives,
existing tokens, responsive table behavior, clear empty/permission states, and
specific user-facing labels. It must not introduce a new visual system or
duplicate table components.

## Test plan

- Add unit tests for parsing/serialising Operations tab and view URL state,
  including invalid values and redirect mappings.
- Add tests for Support Cases filtering and permission-derived visibility if
  the filtering or snapshot derivation has business-rule branches.
- Test the redirect routes and every canonical deep link manually as the roles
  listed in Slice 4.
- Verify at 320px, 768px, 1024px, and 1440px that the expanded Operations tab
  strip remains usable and that table-to-card responsive behavior remains
  legible.
- Run `npm run lint`, `npm run typecheck`, and `npm run test` before opening a
  PR.

## Success measures

- The Operate sidebar contains exactly three intentional destinations:
  Operations, Documents, and Visa Operations.
- A user can reach every former flight, hotel/rooming, transport, and support
  workflow from Operations without needing a second top-level list page.
- There is one canonical URL for each operational queue and old bookmarks do
  not break.
- Documents and Visa retain their complete specialist workflows and their
  existing data-access boundaries.

## Status

In progress.

- **Slice 1 — done.** Typed URL contract (`operations-workspace-navigation.ts`), Operations tabs addressable via `?tab=` / `&view=`, legacy-URL redirect mapping defined and tested. The legacy pages are not redirected yet: that belongs to Slice 3, after Slice 2 makes every workflow reachable.
- **Slice 2 — done (code); manual role checks pending.**
  - Support Cases tab, fetched only for roles passing `canViewSupportCases`; the legacy page renders the same shared queue.
  - Rooming board view at `?tab=accommodation&view=rooming-board`; rooms load only while it is open, guides see only assigned groups.
  - Gap-fills: flight Manifest drill-in (manifest breadcrumb returns to `?tab=flights`), transport status/needs-attention views, allocated/capacity context on stays.
  - Overview "What needs attention" cards (support, flights, rooming, transport, documents, visa), each gated by the viewer's access and linking to its canonical queue.
- **Correction (Slice 4):** Slice 2 first shipped Support Cases unscoped for Guides, who do pass the support gate. Slice 4 now restricts Guides to cases of their assigned groups (`restrictSupportCasesToGroups`, applied server-side in `operations/page.tsx`).
- **Slice 3 — done (code); runtime redirect check pending.** Sidebar Operate is now Operations, Documents, Visa Operations. The four retired list pages plus the rooming-board page are permanent redirects (`legacyOperationsRedirectHref`, which now also maps `/support-incidents`); their list views were deleted; group editors, repositories and the flight manifest route (`/flights-tickets/[flightId]`) are untouched. Breadcrumbs say Operations, including the out-of-scope Guides and Itinerary pages that used the `Operate` placeholder. Revalidation for support and flights now targets `/operations`. Older module plans carry a superseding note.
- **Slice 4 — partly done.** Verified: signed-out access to every retired URL redirects to login with no 404; fixed the login redirect dropping the query string, so shared `/operations?tab=…` links survive login (`loginReturnPath`); fixed the Guide support-case scoping above. **Not done:** the six role journeys and the 320/768/1024/1440px check need signed-in sessions; the checklist and role matrix are in [`docs/runbooks/operations-navigation-journeys.md`](../runbooks/operations-navigation-journeys.md). Do not mark the task complete until its result log is filled.
