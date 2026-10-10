# TASK-042 Package Dialog Step Content UI Polish

## What
Make the seven step panels of the Create/Edit Package dialog feel consistent
and elegant: one visual rhythm, a correct heading hierarchy, uniform repeater
cards, accessible selection lists, and clearer validation feedback.

## Why
Audit of `create-package-dialog.tsx`, `components/ui/sidebar-stepper-dialog-body.tsx`
and `create-package/components/step-*.tsx` found:

**Shell**
- Hierarchy inverted: panel title is `text-lg`, in-step `SectionHeading` is `text-xl`.
- Step descriptions are `text-[11px]`; in the sidebar they are truncated to one line.
- Step counter shown three times (sidebar, panel header, mobile strip).
- Footer error is generic ("Complete the required fields"), hidden on mobile, truncated at `max-w-56`.
- Continue uses the `secondary` variant; locked steps show a lock with no reason.
- Scroll area `overflow-y-auto px-1` clips focus rings and card shadows.

**Steps**
- Step 1 is a flat stack of fields with no groups, a `-mt-3` spacing hack, a leftover "RIGHT CARD" wrapper, and a `grid-cols-3` with no mobile breakpoint.
- Steps 2-6 differ in section headings, `px-2` wrappers (left edges misaligned) and vertical gaps (`gap-5` / `gap-6` / `space-y-6` / `pb-10`).
- Repeater cards (steps 2, 4, 5, 6): badge ("Step N" / "Rule N" / "Task N") plus a duplicated name above the name input, three different paddings, raw `<button>` controls with no `aria-label`.
- Step 5 selection lists are clickable `Card`s (`onClick`, not keyboard accessible) with a hand-drawn radio.
- Fixed-option dropdowns are a `DropdownMenuTrigger` around a read-only input, with no chevron; the design-tokens doc says fixed options use `Select`.
- Helper text varies (`10px` / `11px` / `xs`); required marker varies (red span / plain `*` / none).
- Dead code in step 1 (commented template/AI buttons, unused imports, unreachable dialogs).
- Step 4 (821 lines) shows every section expanded at once.

## Guardrails (from the request)
- **Do not change any input height.** Record every `[data-slot=input-group]` height before and after; they must match.
- **Keep `Card`** — do not swap it for a `div`. Use `CardHeader` / `CardTitle` / `CardDescription` / `CardAction` inside it.
- **No custom components** — only shared ones: `Card`, `SectionHeading`, `InputGroup`, `Accordion`, `Tabs`, `Separator`, `Badge` / `ToneBadge`, `Switch`, `Checkbox`, `Tooltip`, `Button`. If `radio-group` is missing, add it from the shadcn registry via MCP.
- **No color changes**; follow `docs/architecture/design-tokens.md`.
- Any server-waiting action keeps using `runWithLoadingToast`.

## Plan (in order)
1. **Shared rhythm spec** — panel title stays; groups inside a step use `CardTitle` (`text-base`) + `CardDescription`; `gap-4` between fields, `gap-5` between groups; helper text always `text-xs text-muted-foreground`; one required-marker style; identical outer wrapper and padding on every step (remove `px-2`, `pb-10` hacks).
2. **Shell polish** (`sidebar-stepper-dialog-body.tsx`) — full description under the panel title at `text-sm`; sidebar description allowed two lines; drop the duplicate counter; Continue uses the primary variant; `Tooltip` on locked steps explaining why; move scroll padding so rings/shadows are not clipped; footer message visible on mobile and names the first missing field. Check other consumers first.
3. **Step 1** — two Cards ("Package identity", "Capacity & sizing"); responsive breakpoints on the Journey/Days/Nights row; shared helper-text style; Status as a `ToneBadge` in the card header instead of a disabled input; remove dead code.
4. **Repeater cards (steps 2, 4, 5, 6)** — one anatomy: `CardHeader` with title and `CardAction` holding move/delete `Button`s with `aria-label`s and a delete tooltip; replace badge + duplicate name with a small index label; one padding, one inner gap; each list under a `SectionHeading` with its Add action.
5. **Selection lists (step 5)** — seat rule as a real radio group inside Card rows; communication templates as `Checkbox` rows; keyboard accessible, labels linked with `htmlFor`.
6. **Dropdown fields** — keep each trigger input unchanged and add a chevron through `InputGroupAddon align="inline-end"` (no height change). Switch to `Select` only if it fits the InputGroup format with identical height.
7. **Step 4 length** — `Accordion` for Makkah / Madinah (first open by default) with item counts in the triggers.
8. **Validation feedback** — `aria-invalid` plus a short message line under the specific field (a line below the input, so input height is unaffected).

## Open decisions
1. Step 2's "Fixed Due Date" / "Days Prior" inputs are bare `h-7` inputs outside the standard InputGroup format; bringing them into it changes their height. Default: leave them alone.
2. Steps 3 and 4: assumed in scope for the same changes unless told otherwise.
3. `SidebarStepperDialogBody` is shared — default is to fix it there; confirm no other dialog regresses.

## Data model changes
None.

## Access control changes
None.

## UI surfaces
- `components/ui/sidebar-stepper-dialog-body.tsx`
- `app/(main)/packages/components/create-package-dialog.tsx`
- `app/(main)/packages/create-package/components/step-1` … `step-6` (step 7 only for rhythm/spacing consistency)
- Possibly `components/ui/radio-group.tsx` (from shadcn registry) if absent.

## Test plan
- Automated: `npm run lint`, `npm run typecheck`, `npm run test` must pass. No business-rule logic changes, so no new Vitest cases expected.
- Manual in browser: walk all 7 steps at 320 / 768 / 1024 / 1440 px in light and dark mode; Tab through every step (radio group, checkboxes, move/delete buttons, locked-step tooltip); compare recorded input-group heights before vs after (must be identical); confirm no console errors; confirm edit mode with the live-groups banner still renders correctly.

## Status
In progress — code built, browser verification outstanding.

Decisions taken: step 2's bare `h-7` inputs left unchanged; steps 3 and 4 in
scope; shared `SidebarStepperDialogBody` fixed in place (also used by
`create-departure-group-dialog.tsx` and `add-new-lead.tsx`).

Built: stepper shell (full description, locked-step tooltip, primary Continue,
unclipped scroll); dialog (named footer message, inline errors on steps already
left); steps 1–6 regrouped into Cards with a uniform repeater anatomy and
icon `Button` controls with `aria-label`s; chevrons on dropdown fields; step 4
accommodation in an `Accordion`; step 5 seat rule as `RadioGroup` (added
`components/ui/radio-group.tsx` from the shadcn registry) and templates as
`Checkbox` rows.

Checked: `tsc --noEmit` clean, `npm run lint` 0 errors, `npm run test` 5050 passed.

Not yet done: walk the 7 steps in the browser (320/768/1024/1440, light/dark),
keyboard pass, and the before/after `[data-slot=input-group]` height comparison.
