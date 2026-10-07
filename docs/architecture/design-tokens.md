# Design tokens

The reference a new UI PR should be checked against before merge. Not a
history of how the system got here — see the styling audit/fix-report/
roadmap artifacts from that work if you want that. This doc just says what
"correct" looks like today.

## Type scale

Six steps. Every heading or label in the app should land on one of these —
if what you're building doesn't fit, that's a signal to ask whether a new
step is really needed, not to reach for an arbitrary `text-*` value.

| Step    | Classes                                 | Component                                           | Used for                                                                                                                                                                                       |
| ------- | --------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Display | `text-3xl font-semibold tracking-tight` | `PageHeader`'s `<h2>`                               | The one title per page. Never more than one per page.                                                                                                                                          |
| H2      | `text-xl font-medium tracking-tight`    | `SectionHeading`, `DialogTitle`                     | A named section within a page, or a dialog's own title. A dialog title must never be larger than this — it floats over a page and should never visually outrank that page's own Display title. |
| H3      | `text-base font-medium`                 | `CardTitle`                                         | A card's own heading inside a section.                                                                                                                                                         |
| Body    | `text-sm`                               | plain paragraph text, `CardDescription`             | Default running text — descriptions, longer labels, table cells that hold prose rather than data.                                                                                              |
| Label   | `text-xs font-medium`                   | form field labels, KPI card titles, nav item labels | The dominant size in this app — a dense CRM reads mostly at this size. Weight and color carry hierarchy here, not size.                                                                        |
| Caption | `text-[11px]` / `text-[10px]`           | timestamps, meta text, badge counts                 | The smallest step. Muted-foreground color, never the only way status is conveyed.                                                                                                              |

Two exceptions, both deliberate rather than accidental:

- **KPI/metric numbers** (dashboard cards, detail-page stat rows) — these
  are the one place a step above Display is earned. `text-3xl`–`text-4xl`
  with `tabular-nums` (Roboto Mono) is correct there; it's not a stray
  oversized heading, it's the number the whole card exists to show.
- **`font-playfair` (Playfair Display)** — reserved for the login page's
  hero headline only. One expensive typographic moment, used exactly once.
  Don't reach for it elsewhere. Below `xl:` the full decorative hero
  column (gradient mesh, grid texture, `text-8xl` headline) is hidden
  entirely and replaced by a compact stand-in inside the form column
  (`text-2xl sm:text-3xl`, still Playfair, no decorative background) — the
  brand moment scales down rather than disappearing on tablet/mobile.

## Tables

Every module's list view goes through `components/data-table/data-table.tsx`'s
shared `DataTable` — don't hand-roll a table. Below `md:`, it automatically
renders each row as a card (first non-selection column large as the row's
identity, every other visible column as a label/value line) instead of a
horizontally-scrolling table, reading the label from whatever
`header()`/`sortableHeader()` call the column already uses — a table gets
this for free from its existing column definitions, nothing extra to wire
up. If a column's cell renders something that reads badly stacked in a
card (very wide content, a dense inline chart), that's worth a second look
at the column itself, not a reason to bypass `DataTable`.

## Color tokens

Read `app/globals.css`'s `:root` / `.dark` blocks for the literal values.
The rule that matters more than the values themselves:

- **Brand** — `--primary` (emerald) and `--accent` (teal) are the two brand
  colors. `--secondary` is a neutral slate, deliberately _not_ a second
  green — it means "muted emphasis," not "a slightly different brand
  color." Don't reach for `--secondary` expecting brand-green.
- **Status** — every status/severity color in the app goes through
  `lib/ui/tone.ts`'s `Tone` vocabulary (`neutral | info | success | warning
| danger | brand`) and its exports (`TONE_CLASS`, `TONE_BAR`, `TONE_TEXT`,
  `TONE_BORDER`, `TONE_BADGE_BORDER`, `TONE_STAT_CARD`). An ESLint rule
  (`eslint.config.mjs`) fails the build on a raw Tailwind status-color
  utility (`bg-amber-500`, `text-emerald-600`, etc.) anywhere outside
  `lib/ui/tone.ts` and `components/ui/tone-badge.tsx` — if you hit that
  error, you reached for a hex/utility color instead of a tone. Import
  from `@/lib/ui/tone` instead.
  - A genuinely fixed categorical legend that isn't a status signal (e.g.
    a 4-way icon legend for document type, a chat-bubble-by-sender-role
    color) is the one legitimate exception — wrap it in a scoped
    `/* eslint-disable no-restricted-syntax -- <reason> */` block with a
    one-line reason, rather than force-fitting it into a tone it doesn't
    semantically mean.
  - If a repeated status-color pattern doesn't fit any existing `TONE_*`
    export, it's fine to add a new one to `lib/ui/tone.ts` — follow
    `TONE_BADGE_BORDER`/`TONE_STAT_CARD` as the precedent for how to shape
    and name it. Don't add one for a single one-off use site.
- **Dark mode** — every brand color gets its own dark-mode value, pulled
  back a step in saturation/lightness from the light-mode hex. Never carry
  a light-mode value into `.dark` unchanged — it reads neon against a dark
  ground.

## Radius & shadow

- **Radius** — use the token scale (`rounded-sm` → `rounded-4xl`, defined
  in `app/globals.css`'s `@theme inline` block from a single `--radius`
  base). Never a literal `rounded-[Npx]`. `Card`, `Dialog` and `Button`
  all resolve through this scale — if you're adding a new primitive, do
  too.
- **Shadow** — prefer the default Tailwind shadow scale (`shadow-xs` →
  `shadow-lg`) or `Card`'s own layered custom shadow as precedent for a
  bespoke one. Avoid raw palette shadow colors (`shadow-gray-400`,
  `shadow-black`) — if a shadow needs color, it should come from a
  semantic token, not a literal.

## Spacing

Two canonical paddings for a card/section-shaped container — pick one, not
whatever felt right in the moment:

- **Default**: `px-6 py-5` (`Card`'s own default) — the standard case.
- **Compact**: `p-3` to `p-4` — dense contexts (KPI tiles, table-adjacent
  panels, nested cards inside another card).

`px-3`/`py-2` is the standard control-internal padding (buttons, inputs,
badges) — that one's set by the primitives themselves, not chosen per call
site.

## Components

- **Fixed-option dropdown** → `components/ui/select.tsx`'s `Select`. Never
  a bare native `<select>` — an ESLint pass across the whole codebase
  closed every instance of this; a new one reopens exactly the "OS-chrome
  control next to hand-styled siblings" problem that pass fixed.
- **Search/type-ahead dropdown** → `components/ui/combobox.tsx`'s
  `Combobox`. Reach for this instead of `Select` only when the list is
  long enough to need filtering.
- **Status badge/progress bar** → `ToneBadge`/`ProgressBar` from
  `components/ui/tone-badge.tsx`, not a hand-built `<span>` with tone
  classes inlined.
- Before adding a new primitive, or a new variant to an existing one,
  check it against `/dev/components` (the component gallery route) —
  render every variant of what you're touching there and look at it next
  to its siblings before shipping. It's dev-only, not linked from the app
  nav.

## Enforcement

What's actually machine-checked today, so you don't have to remember it
by hand:

- `no-restricted-syntax` in `eslint.config.mjs` — raw status-color
  utilities outside the tone system (see Color tokens above).
- `no-restricted-syntax` in `eslint.config.mjs` — a literal `rounded-[Npx]`
  that doesn't reference `--radius` (a `rounded-[calc(var(--radius)-3px)]`
  or `rounded-[min(var(--radius-md),10px)]` is fine — it's still the
  token scale, just wrapped in an arbitrary-value bracket).
- `no-restricted-syntax` in `eslint.config.mjs` — a raw-palette shadow
  color (`shadow-gray-400`, `shadow-black`, …).
- `no-restricted-syntax` in `eslint.config.mjs` — `toISOString().slice(0,
10)` instead of `colomboDayKey()` (unrelated to styling, but the same
  mechanism — worth knowing it's there if you're adding a rule of your
  own).

Three real exceptions the radius/shadow rule knows about, all "no scale
step fits something this small or this literal" rather than laziness:
`components/animate-ui/**` (vendored from the `@animate-ui` registry, not
hand-authored), the ID card studio's millimeter-measured print template,
and a couple of 2px legend-swatch/tooltip-arrow corners marked with a
scoped `eslint-disable` and a one-line reason at the call site rather than
a blanket exemption.

Not machine-checked: the component gallery at `/dev/components` is a
manual check, not a CI gate — this repo has no test runner or CI workflow
yet, so wiring a smoke test that loads it on every PR is real follow-up
work, not something to bolt on unilaterally alongside a styling pass.
