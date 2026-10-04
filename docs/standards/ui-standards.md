# UI Standards

These are hard rules, not preferences — they come straight from
`AGENTS.md`, plus the general principles behind clean, elegant SaaS
interfaces (Notion, Linear, Stripe Dashboard, etc.) applied on top. A PR
that violates the project-specific rules (§1–3) should not merge; the
design-quality rules (§4–8) are what "correct" looks like when a screen is
technically compliant but still feels cluttered or inconsistent.

## Design philosophy: restraint over decoration

The elegant-SaaS pattern across products people describe as "clean" —
Notion, Linear, Stripe — is the same in every case: **minimalism with a
clear hierarchy, not fewer features but less visual noise around them.**
Concretely, that means:

- Hierarchy comes from **size, weight, and spacing** — not from adding
  more colors, borders, or shadows. If two elements need to look
  different in importance, make the more important one bigger/bolder/
  closer to the top, don't give it a louder color.
- Color is reserved for **state and meaning** (success, warning,
  destructive, the one accent for an active/selected state) — never
  decoration. A screen with five colors in casual use reads as noisy no
  matter how "on-brand" each one is individually.
- White space is a layout tool, not empty space to fill. Group related
  fields/cards tightly, separate unrelated groups generously. When in
  doubt, add space rather than a divider line.
- Every screen has **one primary focal point** (a page title, a headline
  KPI, a primary action) with everything else visibly subordinate to it.
  If a reviewer can't tell what the page wants them to look at first in
  two seconds, the hierarchy has failed.

This is the standard this app's design tokens already encode — the rules
below just make it checkable.

## 1. shadcn UI only — no custom or third-party component libraries

- All UI primitives come through **shadcn UI via the shadcn MCP**. Before
  building any new primitive (a dropdown, a dialog, a combobox, a data
  table cell), check whether shadcn already has it
  (`mcp__shadcn__search_items_in_registries` /
  `list_items_in_registries`) and add it through the MCP
  (`get_add_command_for_items`) rather than hand-rolling it or pulling in
  another component library.
- Compose from shadcn primitives + this app's existing components under
  `components/**` (e.g. `components/data-table/data-table.tsx` for every
  list view) rather than writing a parallel implementation.
- If a genuinely new pattern is needed that shadcn doesn't cover, build it
  as a composition of shadcn primitives, following the existing tokens
  (below) — don't introduce a different design language for one feature.

## 2. Inputs use the `InputGroup` pattern

Every input field follows this exact shape:

```tsx
<InputGroup>
  <InputGroupAddon align="block-start">{label}</InputGroupAddon>
  <InputGroupInput {...props} />
</InputGroup>
```

Don't use a bare `<Label>` + `<Input>` pair, and don't invent a different
wrapper for form fields — this is the one accepted pattern across the app.

## 3. Follow the existing design tokens — don't change the visual language

- Reference [`docs/architecture/design-tokens.md`](../architecture/design-tokens.md)
  for the type scale, spacing, and table conventions before writing any
  new UI. It documents what "correct" looks like today; treat deviations
  from it as bugs, not style choices.
- Reference the screenshots in `doc/ui/` (project root) for how a screen
  is intended to look and feel — layout, density, hierarchy. **Do not
  change any color** from what's already defined in the design tokens /
  Tailwind theme; the reference images are for layout and structure only,
  not a license to introduce a new palette.
- One `PageHeader` Display title per page. Dialog titles never outrank it.
  KPI numbers are the one place a size above Display is earned (see the
  design-tokens doc for the exact exception).

## 4. Spacing rhythm

- The app's base spacing unit is `0.25rem` (4px) — every gap, padding, and
  margin should land on a multiple of it (`gap-2`, `p-4`, `space-y-6`, …),
  which keeps every screen on the same 4/8px rhythm rather than
  one-off pixel values. Never hand-write an arbitrary `px-[13px]`-style
  value to nudge something into place — if the scale doesn't have the
  step you need, that's a sign the layout is wrong, not the scale.
- Group tightly, separate generously: fields belonging to one logical
  group sit close together (`gap-2`/`gap-3`); unrelated sections get a
  full section gap (`gap-6`/`gap-8`) or their own `Card`, not a thin
  divider trying to do the same job.
- Don't add a border or a background tint to create separation where
  spacing alone would do it — reach for space first, a divider second,
  and a new visual boundary only when content genuinely needs to be
  contained (e.g. a table, a card).

## 5. Typographic and information hierarchy

- Follow the six-step type scale in
  [`docs/architecture/design-tokens.md`](../architecture/design-tokens.md)
  exactly — don't reach for an arbitrary `text-*` size outside it.
- Every dashboard/detail view leads with **one primary number or
  headline metric**; supporting figures are visually subordinate (smaller,
  lighter weight, muted color) — never two headline-sized numbers
  competing on the same card.
- Numeric columns and KPI figures use tabular/mono figures
  (`font-number` / Roboto Mono, per the design tokens) so digits align —
  a column of right-aligned numbers that don't align vertically reads as
  sloppy immediately.
- Size and weight carry importance; color carries state. Don't use a
  bigger font *and* a louder color to say the same "this matters" twice.

## 6. Color discipline

- Every color in a screen must mean something specific (success,
  destructive, warning, informational, selected/active) — if you can't
  name what a color is communicating, it shouldn't be there.
- Never introduce a new color, tint, or gradient outside the existing
  token set to "make it pop." A screen that needs a new color to feel
  finished needs better spacing/hierarchy instead.
- Reserve the destructive/warning colors for states that are genuinely
  destructive or warning-worthy — using them for routine emphasis burns
  their meaning for the time they're actually needed.

## 7. Empty, loading, and error states — always designed, never default

Every list, table, or data-driven view needs all three states considered,
not just the happy path:

- **Empty state**: never a bare "No results." At minimum, confirm nothing
  is broken; where it adds value, explain why it's empty and offer the
  next action (e.g. "No departures yet — create your first departure
  group" with the create action right there, not just prose).
- **Loading state**: a skeleton that mirrors the eventual layout (matching
  the `DataTable`'s existing skeleton pattern), not a generic spinner
  dropped in the middle of an otherwise-empty page.
- **Error state**: a specific, actionable message (see
  [`engineering-standards.md`](engineering-standards.md#error-handling))
  with a retry action where retrying is meaningful — never a dead end.

## 8. Motion

- Use motion only to explain a change of state (an item appearing,
  a panel expanding, a value updating) — never as decoration.
- Keep transitions short and purposeful: roughly 150–250ms with a stable
  easing curve. Anything longer starts to feel like the UI is slow, not
  polished.
- Respect `prefers-reduced-motion` for anything beyond a simple opacity/
  color transition.

## 9. Tables

Every list view goes through the shared `DataTable`
(`components/data-table/data-table.tsx`). Don't hand-roll a table — the
shared component already handles the responsive mobile card fallback,
sorting, and selection conventions the rest of the app expects.

## 10. Accessibility

- Text must meet WCAG contrast minimums against its background: 4.5:1 for
  body/label text, 3:1 for large text (Display/H2-scale headings) — check
  this before shipping any new color pairing, not just new colors.
- Every interactive element has an explicit `hover`, `focus-visible`,
  `active`, and `disabled` state — relying on the browser default outline
  alone is not sufficient for `focus-visible`.
- Status must never be conveyed by color alone (a red dot with no label,
  a green row with no text) — pair it with a label, icon, or text that
  works for someone who can't distinguish the color.

## 11. No generic component or function names

Same rule as [`engineering-standards.md`](engineering-standards.md#naming)
applied to UI: a component named `Card` or a hook named `useModal` is not
acceptable when there will be more than one of them in the app. Name for
what it specifically renders or does: `DepartureSeatHoldBanner`,
`useVisaDocumentUploadDialog`.

## 12. Text must be clear to everyone

- Labels, empty states, error messages, and helper text are written so a
  non-technical operations user understands them immediately — no jargon,
  no internal terminology leaking into user-facing copy ("seat hold" is
  fine for staff-facing screens; "429 rate limited" is not, anywhere).
- Prefer a short, concrete sentence over a vague one: "This departure has
  no seats left" beats "Unable to process request."

## Before shipping a UI change

- [ ] Every input uses `InputGroup` / `InputGroupAddon` / `InputGroupInput`
- [ ] Every primitive came from shadcn (via MCP), not hand-rolled or from
      another library
- [ ] No new/renamed color introduced outside the existing tokens, and
      every color used is state-driven, not decorative
- [ ] Spacing lands on the app's 4px scale — no arbitrary pixel values
- [ ] One clear primary focal point per screen; nothing competes with it
- [ ] Numeric/KPI figures use tabular figures and are visually subordinate
      to the one headline number
- [ ] Empty, loading, and error states are all designed, not defaulted
- [ ] Any motion is short (~150–250ms), purposeful, and respects
      `prefers-reduced-motion`
- [ ] Text meets WCAG contrast minimums; status is never color-only
- [ ] Component and hook names are specific, not generic
- [ ] Checked against [`docs/architecture/design-tokens.md`](../architecture/design-tokens.md)
      and the relevant `doc/ui/` reference image
- [ ] Verified in the browser at desktop and mobile widths (the app's
      `DataTable` and layouts are responsive — a change that only looks
      right at one width is incomplete)
