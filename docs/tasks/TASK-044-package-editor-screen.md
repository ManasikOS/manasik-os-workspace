# TASK-044 Package Editor Screen (replace the create/edit dialog)

## What
Replace `CreatePackageDialog` with a real full-page editor at
`/packages/new` and `/packages/[packageId]/edit`. The 7-step wizard,
validation, save-draft / publish / live-edit rules and the approval flow are
unchanged. What changes is the container, the unsaved-changes guard, the
change-review presentation, and a much smaller, split-up code structure.

## Why
- The dialog is already full-viewport (`h-dvh` / `90vh x max-w-6xl`), so the
  modal backdrop adds nothing but a layer. It then stacks two more modals on
  top (change review, leave confirmation).
- Root cause of the "no blur on the second dialog" complaint: in
  `components/ui/dialog.tsx` every overlay is `z-40` and every popup `z-50`, so
  a nested dialog's overlay renders *under* the parent popup and never dims or
  blurs it. (`sheet.tsx` already uses `z-50` for both, so equal z-index plus
  DOM order stacks correctly there; the Dialog overlay now matches it.)
- Research summary (Smashing Magazine "Modal vs Separate Page", FlowX,
  Eleken, Nuxeo, Cloudscape, Material/SAP Fiori): long multi-step forms belong
  on pages; one modal should not open another; unsaved-changes prompts appear
  only when something would be lost and name each outcome plainly.
- Page wins other things for free: a URL per step, back button, no state loss
  on accidental refresh of a *saved* draft, and the room for the diff view.
- `create-package-dialog.tsx` is 842 lines mixing data loading, form state,
  step navigation, persistence, banners and three dialogs. A page is the
  chance to split it into pieces that can each be read in one sitting.

> Refinement of the earlier recommendation: the leave confirmation is a
> single centred confirm dialog, **not** a popover. On a page it is the only
> modal layer (so blur works), and a navigation blocked from a link click or
> the browser back button has no button to anchor a popover to. One
> component, one behaviour, for every exit path.

## Data model changes
None.

## Access control changes
None. Existing capabilities only:
- `/packages/new` -> `createPackage` (404 otherwise, as today).
- `/packages/[packageId]/edit` -> `editPackage` **and** the object-level
  `canRoleViewPackage` check already in the edit route (finding A5 in
  `docs/modules/packages-production-readiness-plan.md`). It must survive the
  move; the page now also loads the form server-side, so the read stays
  RLS-scoped through `createClient(cookies())`.
- `savePackageAction` / `publishPackageAction` keep their own
  `requirePackageCapability` gate; nothing in them changes.

## UI surfaces

### Routes
| Route | Behaviour |
|---|---|
| `/packages/new` | Server page: capability gate, renders `PackageEditorScreen mode="create"` |
| `/packages/[packageId]/edit` | Server page: gates, loads edit data on the server, renders `PackageEditorScreen mode="edit"` |
| `/packages?create=1` | Server redirect to `/packages/new` (keeps the Departure Groups deep link working) |
| `/packages/[id]?edit=1` | Server redirect to `/packages/[id]/edit` |
| `/packages/create-package` | Existing redirect stays |

Server-side loading removes the client `useEffect` fetch, `editData` /
`editError` / `isEditLoading` state and the hand-rolled skeleton. Errors use
the route's `error.tsx`; loading uses a route `loading.tsx`.

To share the read with `getPackageForEditAction`, its body moved into
`app/(main)/packages/package-edit-snapshot.ts` (`loadPackageEditSnapshot`),
which both the action and the edit page call. It sits next to the packages
module rather than in `lib/data` because it uses `rowToFormData` from
`create-package/mappers`, and `lib/` does not import runtime code from `app/`.
The caller does the capability check; the function does the id check, the
object-level `canRoleViewPackage` check and the read. **Slice 2: done.**

### File structure
All new files under `app/(main)/packages/components/package-editor/`:

```
package-editor/
  package-editor-screen.tsx        thin shell (~120 lines): wires the hooks, renders layout
  use-package-editor-form.ts       form, savedForm, packageId, updatedAt, changes, isDirty
  use-package-editor-save.ts       persist / saveDraft / saveChanges / publish (+ runWithLoadingToast)
  use-package-editor-steps.ts      activeStep, direction, visited steps, validity, clickable, field errors
  package-editor-steps.tsx         STEPS metadata + dynamic() loaders + one renderer (no 7-element array per render)
  package-editor-notices.tsx       the three banners (pending change, live groups, role limit)
  package-leave-confirm-dialog.tsx Keep editing / Discard / Save
  package-change-review-sheet.tsx  the existing review dialog, moved to a Sheet
  use-unsaved-changes-guard.ts     beforeunload + in-app link + back-button interception
  decide-package-save-route.ts     pure: draft | direct-save | needs-review  (+ .test.ts)
```

Rules for the split:
- Hooks return plain values and handlers. The screen has no `useState` of its
  own beyond which overlay is open.
- Only one place decides what "Save" does: `decide-package-save-route.ts`
  (`isLive`, `sensitiveChanges.length`). Today this branching is repeated in
  `handleSaveChanges`, `saveAndLeave` and the footer buttons.
- Step content is rendered by looking up the active step's component once,
  instead of building all seven JSX elements on every render.
- Names stay specific (`usePackageEditorSave`, not `useSave`).

### Layout
- `PageHeader` (title, breadcrumb Home > Packages > New / package title), then
  one `Card` that holds the existing `SidebarStepperDialogBody` unchanged
  (it already renders no `Dialog` itself). Card height:
  `h-[calc(100dvh-<header>)]` with the step panel scrolling inside and the
  action footer pinned; on mobile it keeps the existing progress strip.
- Do not rename `SidebarStepperDialogBody` in this task (two other dialogs use
  it). If it later feels wrong to import a "dialog body" in a page, rename it
  in its own task.
- Keep all spacing, colours and tokens as they are
  (`docs/architecture/design-tokens.md`); no new visual language.

### Unsaved-changes behaviour
One hook, `useUnsavedChangesGuard(isDirty, onBlocked)`:
1. `beforeunload` (already there) for tab close / hard reload.
2. Capture-phase click listener for internal `<a href>` clicks while dirty ->
   `preventDefault`, remember the target, open the confirm dialog.
3. `popstate` handling for the browser back button (push one sentinel history
   entry while dirty; on pop, re-push and open the dialog).
4. The Cancel button and breadcrumb link use the same path.

`PackageLeaveConfirmDialog` copy (outcomes named, nothing called "Cancel"):
- Title: "You have unsaved changes"
- Buttons: **Keep editing** / **Discard changes** / **Save draft and leave**
  (or **Review and save changes** for a live package with sensitive edits).
- Escape and outside click mean "Keep editing". Never "Discard".
- Shown only when `isDirty`. When nothing changed, leaving is instant.
- On confirm, continue to the remembered target (Cancel -> `/packages` or the
  package detail).

Verify before building: `useProgressRouter().push` called from code is not
covered by (2); any programmatic `router.push` made while dirty must go
through the guard or be preceded by saving. Today only success paths do this.

### Change review
`package-change-review-dialog.tsx` becomes `package-change-review-sheet.tsx`:
a right-side `Sheet` (`sm:max-w-3xl`, full width on mobile) with the same
content: grouped diffs, required reason, supersede checkbox. On the page this
is a single modal layer. The review logic and props stay as they are; only the
shell changes. A footer pinned inside the sheet holds "Keep editing" and
"Send for approval / Confirm and apply".

### After save
- Create, first "Save draft": `router.replace("/packages/<id>/edit")` with the
  current step kept in the URL. Without this a refresh would drop the new
  `packageId` and the next save would create a duplicate draft.
- Publish: `router.push("/packages/<id>")` as today.
- Live save (applied / pending / saved): `router.push("/packages/<id>")` then
  refresh, as today.
- Step in the URL (`?step=pricing`) is written with `history.replaceState`
  (no server round trip) and read once on load, clamped by the same
  `checkStepClickable` rule so a pasted URL cannot skip locked steps.

### Entry points updated
- `packages-list.tsx`: remove `createOpen`, `editingPackageId`,
  `autoOpenCreate`, the dialog mount, and the stale comment about a
  "route-based wizard also exists". "New package" and "Edit" become links.
- `packages/page.tsx`: `?create=1` redirects to `/packages/new`.
- `package-detail.tsx`: remove `editOpen` + dialog mount; Edit links to
  `/packages/[id]/edit`.
- Delete `create-package-dialog.tsx` and fix the doc comments in the three
  route files that still describe the dialog.

### Separate, small fix (do first, own commit)
`components/ui/dialog.tsx`: the overlay moved from `z-40` to `z-50`, matching
the popup and `sheet.tsx`. Overlay and popup now share a z-index, so DOM
order decides: a nested dialog's portal comes later, so its overlay paints
over the parent popup and under its own popup. `sheet.tsx` needed no change.
Benefits Settings and Add Lead, which still nest dialogs. Not required for
the new screen, so it did not block it. **Status: code done, browser check
pending** (needs a logged-in session: open Packages > Create, make an edit,
press Cancel, and confirm the create dialog dims and blurs).

## Test plan

Automated (Vitest):
- `decide-package-save-route.test.ts`: draft vs live x sensitive vs
  display-only edits -> draft save / direct save / open review.
- Step clamp from `?step=`: locked steps are not reachable by URL; unknown
  step falls back to the first.
- `useUnsavedChangesGuard`: not dirty -> no listeners and no prompt; dirty ->
  internal link click is blocked, external/hash links and modified clicks
  (ctrl/cmd) are not; cleanup removes listeners.
- Existing `actions.save-package.test.ts` etc. keep passing untouched.
- `npm run lint`, `npm run typecheck`, `npm run test` all green.

Manual in the browser (after each slice):
- Create: fill step 1, Continue through, Save draft -> URL becomes
  `/edit`, refresh keeps the draft, no duplicate row.
- Create, change nothing, Cancel -> leaves immediately, no prompt.
- Dirty, then each exit: Cancel, breadcrumb, sidebar link, browser Back, tab
  close. Each shows the prompt (tab close shows the browser's own).
- Escape / click outside the prompt -> stays on the form.
- Live package, edit a display-only field -> saves directly.
- Live package, edit price -> review sheet; reason required; pending-change
  conflict checkbox; role without `editSensitiveTerms` sees the blocked state.
- Direct visit to `/packages/new` without `createPackage`, and
  `/packages/<id>/edit` for a package the role may not view -> 404.
- `/packages?create=1` and `/packages/<id>?edit=1` redirect correctly.
- Widths 320 / 768 / 1024 / 1440: footer pinned, nothing clipped, progress
  strip on mobile. Light and dark theme.
- Keyboard only: Tab order through stepper, form, footer; focus moves to the
  step heading on step change; dialogs and sheet trap and restore focus.
- Loading and error states: slow network on edit load; deleted package id.

## Slices (one PR each, in order)
1. **Overlay stacking fix** (`dialog.tsx`, `sheet.tsx`). Exit: a nested dialog
   dims and blurs its parent in the Settings dialog.
2. **Extract edit snapshot** into `lib/data` and have `getPackageForEditAction`
   call it. Exit: action tests pass, no behaviour change.
3. **Editor hooks and pure helpers** (`use-package-editor-*`,
   `decide-package-save-route` + tests), still rendered by the existing
   dialog. Exit: dialog behaves identically, file is far shorter.
4. **New routes and `PackageEditorScreen`** with leave dialog, guard hook and
   review sheet. Exit: full manual checklist above passes on both routes.
5. **Switch entry points, add redirects, delete `CreatePackageDialog`**, update
   comments. Exit: no references to the dialog remain (`grep`), links work
   from list, detail and Departure Groups.
6. **Docs**: update `docs/modules/` packages doc and set this task to Done.

### Slice 3 status: code done, browser check pending
`create-package-dialog.tsx` went from 842 to about 376 lines. The new files in
`components/package-editor/` are `decide-package-save-route.ts` (+ test),
`use-package-editor-form.ts`, `use-package-editor-steps.ts`,
`use-package-editor-save.ts`, `use-unsaved-changes-guard.ts` (only the
`beforeunload` part so far; slice 4 adds link and Back-button interception),
`package-editor-steps.tsx` and `package-editor-notices.tsx`. Behaviour is
meant to be identical; the footer Save button and "save and leave" now both
go through `decidePackageSaveRoute`.

### Slice 4 status: code done, browser check pending
- `/packages/new` and `/packages/[packageId]/edit` render
  `PackageEditorScreen`; the edit page loads the package on the server via
  `loadPackageEditSnapshot` (404 if the role cannot view it). Each has a
  matching `loading.tsx`.
- The editor body moved out of the dialog into
  `package-editor/package-editor-workspace.tsx`, used by both the page and the
  old dialog until slice 5 removes the dialog. The leave prompt is
  `package-leave-confirm-dialog.tsx`; the review is now
  `package-change-review-sheet.tsx`.
- `use-unsaved-changes-guard.ts` stops link clicks (pure rule + tests in
  `unsaved-changes-link-click.ts`) and the Back button. The Back handling
  listens in the capture phase to run before Next's own `popstate` handler
  (confirmed in `next/dist/client/components/app-router.js`). If that ever
  stops working, Back leaves without asking, as before. Forward is not
  guarded.
- Save and publish: `onDraftSaved`, `onPublished` and `onClose` let the page
  and the dialog differ. On the page, the first draft save puts
  `/packages/<id>/edit` in the address with `history.replaceState` and does
  not call `router.refresh()`, so the form is not remounted mid-edit.
- **Deferred:** step in the URL (`?step=`). It is an extra, not needed for
  the exit criterion; do it as a follow-up if wanted.
- **Needs a look in the browser:** the card height
  (`h-[calc(100dvh-13rem)]`) was chosen without seeing the real header; the
  step panel is `absolute inset-0` and collapses if the card has no height.

### Slice 5 status: code done, browser check pending
- Packages list: "Create Package" goes to `/packages/new`, row Edit to
  `/packages/[id]/edit`; the dialog state, `autoOpenCreate` and the stale
  "route-based wizard also exists" comment are gone.
- Package detail: Edit goes to `/packages/[id]/edit`; `autoOpenEdit` removed.
- `/packages?create=1` redirects to `/packages/new`; `/packages/[id]?edit=1`
  redirects to `/packages/[id]/edit`. Both gates are enforced by the
  destination page.
- `create-package-dialog.tsx` deleted. Departure Groups' "create a package"
  link (`router.push("/packages/new")`) now lands on the editor page.
- Remaining mentions of the dialog are in historical task docs
  (TASK-041/042/043), the packages runbook and module plan; slice 6 updates
  the two that describe current behaviour.

## Risks
- In-app navigation interception is the most delicate part (App Router has
  no route-change event). Keep it in one hook with tests; do not scatter it.
- Existing deep links elsewhere that assume `?create=1`. Grep and redirect;
  the packages page keeps accepting it.
- `SidebarStepperDialogBody` height assumptions were written for a dialog
  (`absolute inset-0` panel). Check the card has a fixed height or the panel
  collapses to zero.

## Status
In progress: all six slices are written and the type check, lint and
packages tests pass. **Not done until the manual checklist in "Test plan" has
been run in a browser** (the work was built without a logged-in session). Open
items:
- Run the manual checklist; `PKG-EDP-01` to `PKG-EDP-12` in
  `docs/runbooks/packages-screen-test-plan.md` cover the new behaviour.
- Confirm the card height and the Back-button guard (see slice 4 notes).
- Follow-up, not required: current step in the URL (`?step=`).
- `lib/ops/gate/schema-baseline.test.ts` fails on the migration count; it is
  unrelated to this task.

Set this to Done, and slice 6's "docs" box to ticked, once the checklist passes.

### Revision: one long page, not a stepper in a card
The first build put the old stepper (sidebar, one step at a time, fixed-height
box with its own scroll and footer) inside a card on the page. That is still a
dialog layout. It was replaced with a real page:

- All seven sections are on one scrolling page, each a card with its own
  heading and description (`package-editor-sections.tsx`).
- A sticky section nav (`package-editor-section-nav.tsx`): a list beside the form
  on wide screens, a sticky sideways strip on narrow ones. It highlights the
  section in view (scroll spy) and shows complete / has-problems state.
- The actions sit in a sticky bar at the bottom of the screen
  (`package-editor-action-bar.tsx`): Cancel, save status, "N sections need
  attention", Save draft, Publish. Publishing an incomplete package scrolls to
  the first section with a problem.
- Sections no longer lock behind earlier ones; "Continue" and "Back" are gone.
  A section shows its messages once scrolled past, or for all sections after a
  publish attempt.
- `use-package-editor-steps.ts` became `use-package-editor-sections.ts`; the
  step-lock rule and its tests were removed. `SidebarStepperDialogBody` is no
  longer used by the editor (other dialogs still use it).
- Not changed: save rules, unsaved-changes guard, review sheet, routes.
- Needs a look in the browser: sticky offsets (`lg:top-4`, `scroll-mt-24`)
  against the real app header, and that each step's form reads well at page
  width.

### Revision 2: horizontal stepper, full-width step, normal page flow
The long single page was replaced with what was actually asked for: a
horizontal stepper component and one step at a time at full width.

- New `components/ui/horizontal-stepper.tsx`: numbered steps joined by lines
  with check / lock / warning states and a tooltip for locked steps. Below
  `md` it becomes "Step N of 7 - name" over a segmented progress bar.
- The open step sits in a full-width card under the stepper, in normal page
  flow (no fixed-height box, no inner scrollbar). A tall step scrolls the page.
- Actions are a sticky bar at the bottom: Cancel, save status, the open step's
  first problem, Back, Save draft / Save changes, then Continue, or Publish on
  the last step.
- Later steps stay locked until earlier ones are valid (as before);
  `use-package-editor-stepper.ts` and `canOpenPackageEditorStep` are back, the
  section-based files from revision 1 are gone.
- The stepper is a custom component because shadcn has no stepper in its core
  set (the shadcn MCP was unavailable when this was built). It uses only
  shadcn primitives (Tooltip) and the design tokens.
- Needs a look in the browser: the stepper at 768 / 1024 / 1440 px (labels in
  `w-24`/`w-28` columns) and the sticky footer offset (`bottom-4`).
