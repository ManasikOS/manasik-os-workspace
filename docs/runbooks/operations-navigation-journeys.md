# Operations navigation — journey verification (TASK-013, Slice 4)

Manual check that the consolidated Operate navigation works for real users.
Run it on staging or a disposable Supabase project with one staff user per
role below. Record the result of every row; a failed row is a bug in
`TASK-013`, not a note.

Automated coverage (already passing): the URL contract, redirect mapping,
support/rooming/transport/blocker-card rules, and the login return path.
Everything here needs a signed-in browser session.

## Expected access, by role

Derived from the capability functions (`operations-access`, `pilgrims-access`,
`documents-access`, `visa-access`), not assumed:

| Role | Operations | Support Cases tab | Documents | Visa Operations | Scoping |
|---|---|---|---|---|---|
| ADMIN | yes | yes, can change status | yes | yes | all groups |
| OPERATIONS | yes | yes, can change status | yes | yes | all groups |
| VISA | yes | **no** | yes | yes | all groups |
| GUIDE | yes | yes, **assigned groups only** | **no** | yes | assigned groups only |
| CEO / FINANCE / MARKETING | yes, read-only | **no** | yes | yes | all groups |

Overview "What needs attention" cards follow the same rules: the support card
needs Support access, the documents card needs Documents access, the visa card
needs Visa access.

## 0. Sidebar and bookmarks (all roles)

1. Under **Operate** the sidebar lists exactly: Operations, Documents, Visa
   Operations (each only where the role has access above).
2. Open each old bookmark while signed in; each must land, with no 404, on:
   - `/flights-tickets` → `/operations?tab=flights`
   - `/hotels-rooming` → `/operations?tab=accommodation`
   - `/hotels-rooming/rooming-board` → `/operations?tab=accommodation&view=rooming-board`
   - `/transport-movements` → `/operations?tab=transport`
   - `/support-incidents` → `/operations?tab=support` (Overview for roles without Support access)
3. Signed out, open `/operations?tab=support`. After logging in you must land
   on `/operations?tab=support`, not the dashboard.
4. Browser Back/Forward moves between Operations tabs; reloading keeps the tab.

## 1. Flight ticketing deadline (OPERATIONS)

1. Operations → Flights & Tickets → view "Ticketing Deadline Risk".
2. Click **Manifest** on a row; the manifest opens.
3. Use the breadcrumb "Flights & Tickets"; you return to `?tab=flights`.
4. Click **Open Flight**; the group's own Flights tab opens.

## 2. Partial rooms across groups (OPERATIONS)

1. Operations → Accommodation & Rooming → **Rooming board**; URL has `view=rooming-board`.
2. Default filter is "Partial rooms"; try "Shared hotel (2+ groups)" and the hotel search.
3. Click a room row; the group's Hotels tab opens (the assignment action).
4. Reload on the rooming-board URL; the board is still open.
5. **GUIDE:** the board lists only rooms of assigned groups.

## 3. Over-capacity movement or missing driver (OPERATIONS)

1. Operations → Transport; try "Needs Attention", "Requested", "Confirmed".
2. A route with a missing driver or capacity warning is listed under Needs Attention.
3. Click **Open**; the group's Transport tab opens.

## 4. Urgent overdue support case (ADMIN/OPERATIONS, then VISA and GUIDE)

1. ADMIN or OPERATIONS: Operations → Support Cases. Find an Urgent case past
   its SLA; change its status; confirm the toast and that the status updates.
   Click the row; the pilgrim's Support tab opens.
2. **VISA (or CEO/FINANCE/MARKETING):** no Support Cases tab and no support
   card on Overview; `?tab=support` shows Overview. Support case text never
   appears in Overview cards or Activity.
3. **GUIDE:** Support Cases lists only cases of assigned groups. Create or
   find a case in a group the guide is *not* assigned to; it must not appear.
   (This restriction was added in Slice 4 — verify it specifically.)

## 5. Specialist workspaces (DOCUMENTS/VISA roles)

1. A document reviewer opens **Documents** directly; the full queue, review
   drawer and exports are present.
2. A visa officer opens **Visa Operations** directly; batches and status checks
   are present.
3. On Operations Overview the Missing documents / Visas pending cards show
   counts only and link to those workspaces; no table or review control is
   duplicated in Operations.
4. **GUIDE:** no Missing documents card; Visa card behaves per the matrix.

## 6. Responsive check (any role with Operations)

At 320px, 768px, 1024px and 1440px:

- The Operations tab strip (now 10 tabs) wraps and stays usable; no horizontal page scroll.
- Overview attention cards reflow (1, 2, then 3 columns).
- Support Cases, Rooming board and stay/transport tables remain legible
  (scroll inside their card, not the page).

## Result log

| Journey | Role | Date | Result | Notes / bug link |
|---|---|---|---|---|
| 0 Sidebar & bookmarks | | | | |
| 1 Flight deadline | | | | |
| 2 Rooming board | | | | |
| 3 Transport | | | | |
| 4 Support (incl. VISA, GUIDE) | | | | |
| 5 Specialist workspaces | | | | |
| 6 Responsive | | | | |
