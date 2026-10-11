# TASK-045 Add Lead Screen (replace the Add Lead dialog)

## What
Replace the `AddNewLead` dialog with a full-page screen at `/leads/new`, laid
out like the package editor (TASK-044): `PageHeader`, a `HorizontalStepper`
card, one step at full width, and a sticky action bar. The six steps, the
field set, the validation messages and `createLeadAction` stay as they are.
What changes is the container, where the data comes from, how duplicates are
checked, and where the person lands after creating the lead.

## Why
- The dialog is already full-viewport on mobile and `90vh x max-w-4xl` on
  desktop, uses `SidebarStepperDialogBody`, and opens a second dialog
  (`DiscardConfirmDialog`) on top of itself. Same reasons as TASK-044.
- A page gives a URL, a working Back button, and the same stepper the
  Packages module already uses, so the two create flows feel alike.
- `add-new-lead.tsx` is 720 lines mixing defaults, validation, step gating,
  submit and the dialog shell. A page is the chance to split it.

## What the dialog touches today (analysis)

| Thing | Where | Consequence for the screen |
|---|---|---|
| Open state `addOpen` and the mount `<AddNewLead>` | `leads-list.tsx:123, 340`; trigger button `:397` | Only entry point. Becomes a link. Remove state + mount. |
| `useLeads()` in the form: `createLead`, `findDuplicate`, `currentStaffId`, `store.packages` | `add-new-lead.tsx:142` | `/leads/new` is outside `LeadsProvider` (provided inside `leads/page.tsx`). The screen needs its own data, see Data loading. |
| `useLeads()` in step components, only for `staffOptions` | `lead-sales-setup.tsx:91`, `lead-next-action.tsx:52`, `lead-review-summary.tsx:79` | Change to a `staffOptions` prop. Decouples them from the provider. |
| `findDuplicate` is a synchronous scan of every lead already in the client | `leads-store.tsx:296` | The new route must not ship every lead to the browser. Use a server check. |
| Duplicate gate is client-only | `createLeadInStore` (`lib/data/leads.ts:488`) stores `duplicateOverrideReason` but never rejects a duplicate | Real gap: a direct action call skips the gate. Fix server-side as part of this task. |
| Follow-up switch off sends `nextFollowUpAt: null`, but the server returns "A next follow-up is required" (`leads.ts:509`) | form `submit` vs `createLeadInStore` | Existing mismatch. Resolve: remove the switch (follow-up is required, as the server says) or relax the server. Decide in slice 1. |
| `createLeadAction` returns `reference` only | `actions.ts:154` | Add `leadId` so the screen can land on `/leads?open=<id>` (existing deep link). |
| `revalidatePath("/leads")` after create | `actions.ts:75` | List is fresh when the person returns. No `router.refresh()`. |
| Inbox, WhatsApp agent, CSV import create leads through their own paths | `app/inbox/actions.ts`, `lib/agent/whatsapp/lead-capture.ts`, `importLeadsAction` | Not affected. Inbox links use `/leads?open=<id>`. |
| `SidebarStepperDialogBody` | also used by `create-departure-group-dialog.tsx` | Leave the component alone. |
| `discard-confirm-dialog.tsx` | only used by the form | Keep, reuse for the leave prompt. |
| Capability | `createLead` in `lib/access/leads-access.ts`; Operations and Finance cannot create | Page returns 404 without it, matching `/packages/new`. Action keeps its own check. |

## Reference: how the package editor is built
`PackageEditorScreen` (header + breadcrumb) -> `PackageEditorWorkspace`
(`HorizontalStepper` in a `Card`, step heading, animated step content,
`PackageEditorFooter`, leave dialog) driven by three hooks: form, stepper,
save. Step content is lazy-loaded. Unsaved edits are guarded by
`use-unsaved-changes-guard.ts` (`beforeunload`, link clicks, Back button).
The leads screen copies this shape. The difference is that nothing is saved
until Create, so there are no drafts, no "live" mode and no review sheet.

## Data model changes
None. (The duplicate lookup is a narrow read on `leads`; add an index on
`leads(mobile)` only if the query plan shows a scan; check in slice 2.)

## Access control changes
None to capabilities. Two additions inside existing ones:
- `/leads/new` server page: `createLead` or 404.
- `createLeadAction` re-runs the duplicate check server-side and refuses when
  a match exists and `createAnyway` with a reason is not set (agency-scoped
  through the RLS client as today). The field error key is `duplicateReason`.

## UI surfaces

### Routes
| Route | Behaviour |
|---|---|
| `/leads/new` | Server page: `getCurrentStaffRole`, `createLead` gate, loads packages + assignable staff, renders `LeadEditorScreen` |
| `/leads/new/loading.tsx` | Skeleton matching the stepper card |
| `/leads` | Unchanged apart from "Add Lead" becoming a link |

### Data loading (`/leads/new/page.tsx`)
- `loadLeadStore(supabase, { only: ["packages"] })` (option already exists,
  `leads-repository.ts:219`) and `loadAssignableStaff(supabase)`, in
  `Promise.all`, started before the role lookup resolves like `leads/page.tsx`.
- No leads, notes, quotes or activity are loaded or serialised.
- Props to the client: `currentStaffId`, `staffOptions`, `packages`.

### Duplicate check (client)
- New Server Action `checkLeadDuplicateAction({ mobile, email })` replaces
  `findDuplicateLeadAction`'s whole-store read: `requireUser()`, Zod-validated
  input, narrow select (`mobile = normalised` or `lower(email) = email`, limit
  1, only the columns the warning card shows).
- Returns `DuplicateLeadSummary` (`id, reference, name, mobile, email, stage,
  assignedToName, interestedIn`) + `matchedOn`. `DuplicateCheckSection` takes
  this type instead of `LeadListItem`.
- Triggered when the mobile reaches nine digits and when email is committed
  (blur), debounced, last request wins. State:
  `idle | checking | clear | found | failed`.
  - `checking`: Continue stays enabled but shows "Checking for an existing lead…".
  - `failed`: say so and allow Continue; the server gate on create is the backstop.
- The email-on-step-2 notice (`emailDuplicateNotice`, currently commented out)
  is wired back in: a match found on email shows on the Contact step with a
  "Review duplicate" link to step 1.

### File structure
All new files under `app/(main)/leads/components/lead-editor/`; the existing
step components move there with `git mv` (no rewrite) and keep their names.

```
app/(main)/leads/new/
  page.tsx                         server gate + data load
  loading.tsx                      skeleton
app/(main)/leads/components/lead-editor/
  lead-editor-screen.tsx           PageHeader + workspace (~60 lines)
  lead-editor-workspace.tsx        stepper card, step content, footer, leave dialog
  lead-editor-steps.tsx            LEAD_EDITOR_STEPS metadata + step renderer
  lead-editor-footer.tsx           sticky bar: Cancel, hint, Back, Continue / Create lead
  lead-editor-defaults.ts          buildBlankLeadForm(assigneeId) (pure, was blankForm)
  decide-lead-step-gate.ts         pure: can this step continue, and the reason (+ .test.ts)
  validate-lead-form.ts            pure: every problem by field key (+ .test.ts)
  lead-editor-payload.ts           pure: form -> createLeadAction input
  (the duplicate rule itself is `lib/data/lead-duplicate-gate.ts`, shared with the action)
  use-lead-editor-form.ts          formData, updateField, updateSource, updateAssignedTo, isDirty
  use-lead-editor-stepper.ts       activeStep, highestReached, direction, visible errors
  use-lead-duplicate-check.ts      debounced check + status
  use-lead-editor-submit.ts        validate -> createLeadAction -> toast -> navigate
  lead-editor-loading.tsx          skeleton, used by `new/loading.tsx`
  lead-leave-confirm-dialog.tsx    was discard-confirm-dialog.tsx (same copy)
  (steps) duplicate-check-section, lead-contact-info, lead-sales-setup,
          lead-travel-interest, lead-next-action, lead-review-summary
```

Shared code moved, not copied:
- `use-unsaved-changes-guard.ts` + `unsaved-changes-link-click.ts` (+ test)
  moved from `packages/components/package-editor/` to `hooks/` (the guard is
  not package-specific). Packages imports from the new path. Pure move.
- `HorizontalStepper` is already in `components/ui`.
- Footer is **not** generalised now: the leads bar has no save/draft logic,
  so a 60-line lead-specific footer is smaller than parameterising the
  package one. Revisit if a third create flow appears.

### Layout
- `PageHeader`: title "Add lead", subtitle "Capture a new enquiry and
  schedule the first follow-up", breadcrumb Home > Leads > New.
- Card with `HorizontalStepper` (6 steps, same locked/complete/error
  semantics as now: later steps locked until earlier ones are valid) and the
  open step's heading + description, as in `PackageEditorWorkspace`.
- Step content in a `Card` beneath it. The lead steps are short forms
  (`md:grid-cols-2`), so the card content is capped at `max-w-3xl` and left
  aligned with the stepper; stretching two inputs across 1,100 px reads
  badly. Check at 1440 px in the browser.
- Sticky action bar at the bottom (`sticky bottom-2 sm:bottom-4`, same
  classes as `PackageEditorFooter`): Cancel, status/hint text, Back,
  Continue; on the last step "Create lead" and a secondary "Create and add
  another".
- Focus moves to the step heading on step change; first problem is scrolled
  to and focused after a failed Continue (same effect as the package editor).
- All colours and tokens unchanged; inputs keep the `InputGroup` format.

### Behaviour kept exactly
- Step gating rules in `stepCanContinue` / `stepBlockedReason` move into
  `decide-lead-step-gate.ts` unchanged, then get tests.
- Past-follow-up check runs in the change handler and again on submit (never
  during render; see the existing comment).
- `blankForm` is still built on demand, not a module constant.
- Errors show after a first attempt or first edit, not on a blank form.
- Create calls `createLeadAction` through a `runWithLoadingToast`
  ("Creating lead…" -> "Lead LD-… created" / failure message), per the UI
  rule; the current plain `toast.add` after a silent wait is replaced.

### After create
- "Create lead": `router.push("/leads?open=<leadId>")` (drawer opens on the
  new lead; the list is already revalidated).
- "Create and add another": reset the form keeping source, owner and journey
  type (today's `resetForm(true)`), go to step 1, stay on `/leads/new`.

### Unsaved-changes behaviour
- Dirty form: tab close / reload (browser prompt), link click, Back button and
  Cancel all open `LeadLeaveConfirmDialog`: **Keep Editing** / **Discard Changes** (the existing copy, kept).
  Escape and outside click mean Keep editing.
- Not dirty: leaving is instant. Dirty is "a field changed from the blank
  value", as `updateField` computes it today.
- A successful create sets "leaving" before navigating so the guard does not
  fire on our own redirect.
- No "save draft" button. There is no draft concept for leads and adding one
  is out of scope.

### Entry points updated
- `leads-list.tsx`: delete `addOpen`, the `AddNewLead` import and mount;
  "Add Lead" becomes `<Button render={<Link href="/leads/new" />}>` shown for
  `can.createLead`. Import Leads stays a dialog.
- Delete `add-new-lead/add-new-lead.tsx` and the `add-new-lead/` folder
  after the move.
- Fix comments that still say "Add Lead sheet": `leads-store.tsx:67`,
  `lib/validations/leads.ts:4,93`, `settings-dialog.tsx:6`.
- Docs that name the dialog:
  `docs/modules/leads-ui-consistency-implementation-plan.md`,
  `docs/modules/leads-module-implementation-plan.md`,
  `docs/modules/suppliers-module-implementation-plan.md` (links the
  duplicate section path).

## Test plan

Automated (Vitest, per `docs/standards/testing-standards.md`):
- `decide-duplicate-gate.test.ts`: no match -> ok; match without reason ->
  blocked; reason without confirm -> blocked; both -> ok; clearing the
  reason clears the confirmation.
- `decide-lead-step-gate.test.ts`: each step's continue rule and message
  (short mobile, name missing, bad email, follow-up missing/past, switch off).
- `createLeadAction` duplicate gate: duplicate + no override -> `ok: false`
  with `duplicate` field error; duplicate + override -> created; no
  duplicate -> created; role without `createLead` -> refused.
- `checkLeadDuplicateAction`: unauthenticated refused; malformed input
  rejected by Zod; mobile normalisation (`0771234567`, `+94 77 123 4567`,
  `94771234567`) all match the same row.
- `use-unsaved-changes-guard` tests keep passing after the move.
- `npm run lint`, `npm run typecheck`, `npm run test` all green.

Manual in the browser (after each slice):
- Golden path: all six steps, create, land on `/leads?open=<id>`, drawer
  shows the lead, list has it.
- Duplicate: existing mobile -> warning card, Continue blocked until reason +
  confirm; email-only match shows on the Contact step too.
- Duplicate check failing (offline): message shown, Continue allowed, server
  blocks on create.
- Create and add another: form resets, keeps source / owner / journey.
- Dirty then each exit: Cancel, breadcrumb, sidebar link, Back, tab close.
  Not dirty: Cancel leaves with no prompt.
- Role without `createLead` (Operations): `/leads/new` is a 404 and the
  button is not on `/leads`.
- Server error from the action: message in the footer and a failure toast;
  form is kept.
- 320 / 768 / 1024 / 1440 px, light and dark; keyboard only; slow network on
  create (loading toast appears at once).
- Network tab: `/leads/new` loads no lead rows, only packages and staff.

## Slices (one PR each, in order)
1. **Server first**: `checkLeadDuplicateAction`, server-side duplicate gate in
   `createLeadAction`, `leadId` in the result, decision on the follow-up
   switch, tests. Exit: dialog still works; direct action call with a
   duplicate and no override is refused.
2. **Decouple the steps**: `staffOptions` as a prop, `DuplicateLeadSummary`
   type, extract `lead-editor-defaults`, `decide-*` helpers and hooks while
   the dialog still renders them; move the unsaved-changes guard to `hooks/`.
   Exit: dialog behaves identically, `add-new-lead.tsx` is far shorter.
3. **Route and screen**: `/leads/new`, `loading.tsx`, workspace, footer, leave
   dialog, wired to the new hooks. Exit: manual checklist passes on the
   route (dialog still reachable from the list).
4. **Switch the entry point and delete the dialog**: link in `leads-list.tsx`,
   remove `AddNewLead`, fix comments. Exit: `grep -r "AddNewLead\|add-new-lead"`
   returns nothing in code.
5. **Docs**: update the three module docs, tick this task to Done.

## Risks
- Guard hook was written against the package editor; moving it must not
  change its capture-phase `popstate` behaviour. Move with the existing tests.
- Duplicate check moves from instant (client scan) to a network round trip.
  Mitigated by debounce, a visible "checking" state, and the server gate.
  Leads whose mobile is stored un-normalised would be missed by the narrow
  query: confirm in slice 1 that `leads.mobile` is always the nine-digit form
  (`createLeadInStore` and the importer both normalise; check legacy rows).
- Step forms were laid out for a ~700 px dialog panel; verify at 1440 px
  (hence the `max-w-3xl` cap).
- `createLeadAction` still loads the whole lead store to allocate the
  reference and diff-persist (`actions.ts:107`). Out of scope here but it is
  the slowest part of Create; note for a follow-up.

## Decisions (settled)
1. Follow-up switch: **removed**. A next follow-up is required for every new
   lead, as the server already enforced.
2. "Create and add another": **kept**, as a secondary button on the last step
   (slice 3).
3. Prefill from other modules: **not in this task**.

## Status
In progress. All five slices are done in code and docs. **Not Done until the browser run in `docs/runbooks/add-lead-screen-verification.md` passes.** Nothing has been exercised in a browser yet.

### Slice 1: done (code, tests, typecheck and lint pass; browser check pending)
- `lib/data/lead-duplicate-gate.ts` (+ test): the one rule for "is this
  duplicate answered", shared by the action now and the screen in slice 2.
- `findDuplicateLeadSummary` in `leads-repository.ts`: two narrow reads
  (mobile equals, then email ilike with `%`, `_` and `\` escaped), returns a
  `DuplicateLeadSummary`.
- `checkLeadDuplicateAction` replaces the unused `findDuplicateLeadAction`
  (which loaded the whole store). Requires `createLead`, Zod-validated.
- `createLeadAction` now refuses an unanswered duplicate server-side (field
  error key is `duplicateReason`) and returns `leadId`.
- Follow-up switch removed from the dialog (`createFollowUpTask` is gone from
  `AddLeadFormData`, the Next Action step and the review summary).
- Tests: `actions.create-lead.test.ts` (11) and the gate test (5).
- Still to check in a browser: create a lead with the dialog, and try an
  existing mobile (dialog's client warning still applies; server also blocks).
- Still to confirm before slice 3 relies on it: legacy `leads.mobile` rows are
  stored as the nine-digit form (see Risks).

### Slice 2: done (code, tests, typecheck and lint pass; browser check pending)
- Steps moved with `git mv` into `app/(main)/leads/components/lead-editor/`
  (relative imports unchanged: same depth). `discard-confirm-dialog.tsx` is now
  `lead-leave-confirm-dialog.tsx` (`LeadLeaveConfirmDialog`, same copy).
- Steps no longer call `useLeads()`: `staffOptions` is a prop on
  `LeadSalesSetup`, `LeadNextAction` and `LeadReviewSummary`.
  `DuplicateCheckSection` takes `DuplicateLeadSummary` (a `LeadListItem`
  satisfies it, so the dialog's client scan still feeds it).
- New pure files, with tests: `decide-lead-step-gate.ts`,
  `validate-lead-form.ts`, plus `lead-editor-defaults.ts`
  (`buildBlankLeadForm`, `buildNextLeadForm`) and `lead-editor-payload.ts`.
- New hooks: `use-lead-editor-form`, `use-lead-editor-stepper`,
  `use-lead-editor-submit`; `lead-editor-steps.tsx` holds the step list and a
  single `LeadEditorStepContent` renderer (one step built per render, not six).
- `add-new-lead.tsx`: 720 -> 190 lines, same behaviour. It is the only caller
  of these hooks until slice 3.
- `use-unsaved-changes-guard.ts`, `unsaved-changes-link-click.ts` and its test
  moved to `hooks/`; the package editor imports from `@/hooks/...`.
- Not in this slice, on purpose: `use-lead-duplicate-check` (the async server
  check changes behaviour, so it lands with the screen in slice 3) and the
  `runWithLoadingToast` change in `use-lead-editor-submit`.
- Found, not fixed: `lead-contact-info.tsx` has its inline field-error markup
  commented out, so name/mobile/email problems appear only in the footer hint.
  Restore it in slice 3 when the screen is laid out.
- Tests: 19 new (`decide-lead-step-gate` 11, `validate-lead-form` 8); full
  suite 5,285 passing.

### Slice 3: code done, browser check pending
- Route `/leads/new` (`page.tsx`, `loading.tsx`): gate `createLead` or 404;
  loads `loadLeadStore({ only: ["packages"] })` + `loadAssignableStaff`; no
  lead rows reach the browser.
- `components/lead-editor/`: `lead-editor-screen` (header + breadcrumb),
  `lead-editor-workspace` (stepper card, step heading, animated step, footer,
  leave prompt), `lead-editor-footer`, `lead-editor-loading`,
  `use-lead-duplicate-check`.
- Duplicate check: starts at nine digits or a complete email, 400 ms after the
  last keystroke, stale answers ignored, `failed` shown as "could not check"
  (Continue allowed; the server gate backstops). **Deviation from the plan:**
  Continue is blocked while the lookup is running (reason "Checking for an
  existing lead..."), because letting it through would let a person move past
  the step before the answer arrives. Covered by a new gate test.
- An email-only match found while on another step shows a notice with a
  "Review duplicate" button that returns to step 1.
- Create: loading toast "Creating lead..." (`runWithLoadingToast`), then a
  toast naming the reference. This hook change also applies to the dialog.
  Lands on `/leads?open=<leadId>`. "Create and add another" resets the form
  keeping source, owner and journey type, and returns to step 1.
- Restored the inline name / mobile / email messages in
  `lead-contact-info.tsx` (they were commented out).
- Pressing Continue on an incomplete step now shows the messages and focuses
  the first problem, as in the package editor.
- The dialog is untouched in behaviour and still mounted from the list; it
  disappears in slice 4.
- Checks run: `tsc` clean, eslint 0 errors, `app/(main)/leads` tests pass.
  The browser check could not be run: the dev server redirects to login and
  no signed-in session was available.

### Slice 4: code done, browser check pending
- `leads-list.tsx`: "Add Lead" is `<Button render={<Link href="/leads/new" />}>`,
  still shown only for `can.createLead`. `addOpen`, the `AddNewLead` import and
  the mount are gone. Import Leads is still a dialog.
- Deleted `app/(main)/leads/add-new-lead/` (the dialog and its folder).
- `leads-store.tsx`: removed `createLead` and `findDuplicate` from the context;
  nothing used them once the dialog was gone (the screen calls
  `createLeadAction` and `checkLeadDuplicateAction` directly).
- Comments that named the dialog or sheet fixed in `leads-store.tsx`,
  `lib/validations/leads.ts` and `settings-dialog.tsx`.
- Exit check: no reference to `AddNewLead` or `add-new-lead` remains in
  `app`, `lib`, `components`, `hooks`. `tsc` clean, eslint 0 errors, full suite
  5,286 tests passing.
- Left for slice 5: docs that still name the dialog
  (`remaining-modules-master-plan.md`, `leads-module-implementation-plan.md`,
  `leads-ui-consistency-implementation-plan.md` C1,
  `suppliers-module-implementation-plan.md` link, TASK-042 mention).

### Slice 5: done
- New runbook `docs/runbooks/add-lead-screen-verification.md` (21 checks),
  indexed in `docs/runbooks/README.md`.
- Updated: `docs/architecture/remaining-modules-master-plan.md`,
  `docs/modules/leads-module-implementation-plan.md` (file table and a Phase 2
  note), `docs/modules/leads-ui-consistency-implementation-plan.md` (C1/C2
  marked superseded, dialog path updated),
  `docs/modules/suppliers-module-implementation-plan.md` (link),
  `docs/tasks/TASK-042-...md` (one-line note).
- This file's plan text was aligned with what was built (file list, field
  error key, prompt copy).

### To finish
1. Run the runbook in a browser as Admin/Marketing and as Operations.
2. Confirm legacy `leads.mobile` rows are all nine digits
   (`select count(*) from leads where mobile !~ '^\d{9}$'`; expect 0).
3. Set Status to Done and note the date and role used.
4. Follow-ups, not in this task: `createLeadAction` still loads the whole lead
   store to allocate the reference; prefill from Inbox
   (`/leads/new?mobile=...`); a stale duplicate override is kept if the
   mobile is edited after it was answered.
