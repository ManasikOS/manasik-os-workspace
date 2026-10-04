# Leads — UI Consistency & Duplicate Removal

Implementation plan for bringing the Leads module onto the same design primitives the
rest of the app already shares, and deleting the forked copies it carries.

Nothing here is a bug report. Every item is a place where Leads **works**, but does its
own thing — its own table, its own KPI cards, its own colour vocabulary, its own column
headers — while fifteen other modules use one shared implementation. The result is a
page that reads as a different product from Pilgrims and Departure Groups sitting one
click away in the same sidebar.

Grouped into five themes:

- **A. Shared primitives Leads has forked.** Delete the fork, adopt the shared one.
- **B. Colour and badge vocabulary.** Leads invented a second `Tone` type.
- **C. Sheet / dialog chrome.** Leads' overlays are shaped unlike every other module's.
- **D. Page shell details.** Header, KPI row, saved views, filter bar.
- **E. Dead code and dead data.**

Phases at the end give a safe merge order.

---

## The reference implementations

Two pages establish the house style. Read them before touching anything:

| Concern | Canonical implementation | Used by |
| --- | --- | --- |
| Page shell | `app/(main)/pilgrims/components/pilgrims-list.tsx` | Pilgrims |
| Table | `components/data-table/data-table.tsx` | Pilgrims, Departure Groups, Packages, Suppliers, Team, Finance, Settings |
| KPI tiles | `components/data-table/kpi-card.tsx` (`KpiCard`, `KpiRow`) | Pilgrims + others |
| Saved-view pills | `components/data-table/saved-view-bar.tsx` | Pilgrims |
| Filter chips | `components/data-table/filter-select.tsx` | every list page incl. Leads ✅ |
| Column headers | `components/data-table/sortable-header.tsx` (`header`, `sortableHeader`) | 15 modules |
| Status colour | `lib/ui/tone.ts` + `components/ui/tone-badge.tsx` (`ToneBadge`, `ProgressBar`, `PersonChip`, `EmptyState`) | Pilgrims, Documents, Visa, Operations, Packages, Suppliers, Team, Reports |
| List filtering | `hooks/use-filtered-rows.ts` | every list page incl. Leads ✅ |

Leads already uses `FilterSelect` and `useFilteredRows`. It uses **none** of the other five.

---

## A. Shared primitives Leads has forked

### A1 — `LeadsDataTable` is a 302-line fork of `DataTable` — **the headline item**

`app/(main)/leads/leads-table/leads-data-table.tsx` (302 lines)
`components/data-table/data-table.tsx` (shared, ~300 lines)

The two are the same component. Header markup, body markup, footer, page-size dropdown,
`resetPageToken` render-phase reset — all byte-for-byte equivalent. Leads' fork exists
for exactly three reasons the shared one does not cover:

1. **Row selection + a bulk-action bar.** `rowSelection` state, `getRowId: row => row.id`,
   and a `bulkBar(selected, clear)` render prop.
2. **A page-index clamp** (`leads-data-table.tsx:110-113`) that the shared table lacks —
   without it a stale page index renders an empty table under a `51–60 of 12` footer.
   This is a real improvement, not a divergence.
3. **A keyboard-operable row** (`lead-table-row.tsx`) — `tabIndex={0}`, `role="button"`,
   Enter/Space open the drawer. The shared table's `onRowClick` row is mouse-only.
   Also a real improvement.

And it is not a lone fork. Three other modules made the same one:

| File | Lines | Why it forked |
| --- | --- | --- |
| `app/(main)/leads/leads-table/leads-data-table.tsx` | 302 | selection + bulk bar |
| `app/(main)/documents/documents-table/documents-data-table.tsx` | 229 | selection |
| `app/(main)/operations/operations-table/operations-data-table.tsx` | 231 | selection |
| `app/(main)/visa/visa-table/visa-data-table.tsx` | 232 | selection |

`visa-data-table.tsx:54-56` says so in a comment: *"Forked from documents… the shared
data-table has no row selection, and batch selection is this module's central
interaction."* Four forks, ~994 lines, one missing feature.

**Fix.** Extend the shared `DataTable` rather than deleting Leads' capabilities:

```ts
// components/data-table/data-table.tsx — new optional props
interface DataTableProps<TData> {
  // …existing…
  /** Enables the selection column's state. Requires `getRowId`. */
  enableRowSelection?: boolean;
  /** Rendered above the table when at least one row is selected. */
  bulkBar?: (selected: TData[], clear: () => void) => React.ReactNode;
  /** Row is focusable and Enter/Space activates `onRowClick`. */
  rowsAreButtons?: boolean;
  rowAriaLabel?: (row: TData) => string;
}
```

Also port into the shared table, unconditionally (they benefit every caller):

- the page-index clamp from `leads-data-table.tsx:110-113`;
- the keyboard row treatment from `lead-table-row.tsx`, behind `rowsAreButtons`;
- `font-number` on the `startRow–endRow of totalRows` span — Leads has it, the shared
  one does not, and the footer digits jitter without it.

Then in Leads:

- delete `app/(main)/leads/leads-table/leads-data-table.tsx`;
- delete `app/(main)/leads/leads-table/lead-table-row.tsx`;
- `leads-list.tsx` swaps `<LeadsDataTable …>` for `<DataTable<LeadListItem> …>` with
  `enableRowSelection`, `getRowId={(l) => l.id}`, `rowsAreButtons`, and the same
  `bulkBar` / `toolbar` / `emptyMessage` props it passes today.

The shared table's search box is `components/ui/search-input.tsx`; Leads' fork hand-rolls
the same `InputGroup` + magnifier + clear button inline (`leads-data-table.tsx:130-158`).
Adopting `DataTable` fixes that for free — pass
`searchPlaceholder="Search by name, mobile, email, lead ID, package…"`.

**Deliberately out of scope, worth a follow-up ticket:** once the shared table supports
selection, Documents / Operations / Visa can each delete ~230 lines the same way. Doing
all four in one change would put four modules' tables at risk for a Leads task; the
shared-table work here is what unblocks them.

### A2 — `leads-columns.tsx` re-declares `header` and `sortableHeader`

`app/(main)/leads/leads-table/leads-columns.tsx:68` and `:81`

Private copies of `components/data-table/sortable-header.tsx`. The bodies are identical
apart from Leads calling its own `toggleSort(sort, field)` where the shared one inlines
the same flip. Fifteen modules import the shared pair; Leads and Departure Groups are the
only holdouts (`departure-groups/components/groups-table/groups-columns.tsx:67,80`).

**Fix.** Delete both local functions; import from `@/components/data-table/sortable-header`.

The shared signature takes `DataTableSort` (`{ field: string; direction }`) rather than
`LeadSort` (`{ field: LeadSortField; direction }`). Pilgrims already solved this — its
`buildPilgrimColumns` accepts `onSortChange: (sort: DataTableSort) => void` and the caller
narrows (`pilgrims-list.tsx:135`: `(s) => setSort(s as PilgrimSort)`). Mirror that in
`buildLeadColumns`. `LEAD_COLUMN_SORT_FIELDS` stays as-is; it already matches the shape
`DataTable.sortFieldByColumnId` wants.

Do Departure Groups in the same commit — it is the identical two-function deletion and
leaves zero forks of the header helpers in the codebase.

### A3 — `LeadsMetrics` is a third KPI-card implementation

`app/(main)/leads/components/leads-metrics.tsx` (118 lines)

Three implementations of one tile exist:

| | `KpiCard` (shared) | `DepartureGroupsKPICards` | `LeadsMetrics` |
| --- | --- | --- | --- |
| Icon | yes | yes | **no** |
| Value | `text-4xl font-bold font-number` | same | same |
| Caption | `text-xs text-muted-foreground` | `text-sm` | **`text-sm`** |
| Row grid | `md:2 lg:4 gap-5` | `md:2 lg:4 gap-5` | **`md:2 lg:4-or-5 gap-4`** |
| Clickable | caller wraps in a bare `<button>` | no | yes, with `aria-pressed` + active ring |

Leads' cards are the only KPI tiles in the app with no icons, and the only row with
`gap-4`. Side by side with Pilgrims the difference is immediately visible.

But Leads' *interaction* is the best of the three: the card is a real toggle with
`aria-pressed` and a `border-primary/60 bg-primary/5` active state. Pilgrims wraps
`KpiCard` in a naked `<button className="text-left">` (`pilgrims-list.tsx:190-197`) and
gets no pressed styling at all.

**Fix.** Promote the interaction into the shared card, then delete both forks.

```ts
// components/data-table/kpi-card.tsx
interface KpiCardProps {
  title: string;
  value: string;
  desc?: React.ReactNode;
  icon?: React.ReactNode;
  /** Makes the tile a toggle button. */
  onSelect?: () => void;
  selected?: boolean;
}

export function KpiRow({
  children,
  columns = 4,
}: { children: React.ReactNode; columns?: 4 | 5 });
```

`onSelect` renders the card inside a `<button type="button" aria-pressed={selected}>`
and applies `border-primary/60 bg-primary/5` when selected. `columns` covers Leads'
fifth "Estimated Pipeline Value" tile, which only CEO/Marketing/Finance/Admin see.

Then:

- delete `app/(main)/leads/components/leads-metrics.tsx`; `leads-list.tsx` renders
  `<KpiRow columns={can.viewPipelineValue ? 5 : 4}>` with five `<KpiCard>` children,
  keeping the existing `QuickFilter` union (move it to `../types`);
- delete `app/(main)/departure-groups/components/departure-groups-kpi-cards/components/departure-groups-kpi-cards.tsx`
  and have `departure-groups-kpi.tsx` render `KpiCard` (its `desc` becomes a plain string
  instead of a pre-wrapped `<p className="text-sm">`, which is the whole `text-sm` vs
  `text-xs` divergence);
- rewrite the Pilgrims KPI row to pass `onSelect`/`selected` instead of wrapping in
  `<button>` — it gains the pressed state it is missing today.

Pick icons for the four Leads tiles from the same lucide vocabulary the other rows use:
`Sparkles` (New Leads), `PhoneCall` (Contacted), `AlertCircle` with `text-destructive`
(Follow-up Overdue), `CheckCircle2` (Booked), `TrendingUp` (Pipeline Value).

### A4 — Saved-view pills are inlined instead of using `SavedViewBar`

`app/(main)/leads/components/leads-list.tsx:422-440`
`components/data-table/saved-view-bar.tsx`

Leads hand-rolls the pill group. The markup is character-identical to `SavedViewBar`
except for one addition Leads makes and the shared component lacks: `aria-pressed={selected}`.
Departure Groups inlines the same block a third time (`departure-groups-list.tsx:539-556`),
and adds `w-fit` where Leads does.

**Fix.** Add `aria-pressed` to `SavedViewBar` (it belongs there), then replace both inline
blocks with:

```tsx
<SavedViewBar views={LEAD_SAVED_VIEWS} active={savedView} onChange={setSavedView} />
```

`LEAD_SAVED_VIEWS` is eleven entries — nearly triple Pilgrims' four — so the bar will wrap
to two rows on narrow viewports. `SavedViewBar` already has `flex-wrap`; add `w-fit` to it
so it does not stretch edge-to-edge, matching what both callers add locally today.

---

## B. Colour and badge vocabulary

### B1 — Leads defines a second, incompatible `Tone` type

`app/(main)/leads/utils.ts:151-232`

```ts
// Leads' Tone — a pair of raw Tailwind class strings
export interface Tone { badge: string; dot: string; }
```

```ts
// lib/ui/tone.ts — the app's Tone: a semantic name
export type Tone = "neutral" | "info" | "success" | "warning" | "danger" | "brand";
```

`lib/ui/tone.ts` exists precisely so "a status reads the same colour everywhere in the
app" (its own header comment). Twenty-three files import it. Leads imports none of them,
and its `STAGE_TONES` reaches for eleven distinct hues — blue, amber, cyan, purple,
orange, yellow, emerald, rose, slate, zinc, neutral — five of which (`cyan`, `purple`,
`orange`, `zinc`, `neutral`) appear nowhere else in the product. `slate`/`zinc`/`neutral`
are three near-identical greys used for three different stages, a distinction no user can
resolve.

`TEMPERATURE_TONES` and `FOLLOW_UP_TONES` are the same story at smaller scale — and
`FOLLOW_UP_TONES.OVERDUE` is already `bg-destructive/10 text-destructive`, i.e. exactly
`TONE_CLASS.danger`, spelled out longhand.

**Fix.** Map every Leads status onto the six semantic tones and render with `ToneBadge`.

```ts
// app/(main)/leads/utils.ts
import type { Tone } from "@/lib/ui/tone";

export const STAGE_TONES: Record<LeadStage, Tone> = {
  NEW_LEAD:        "info",
  CONTACTED:       "warning",
  QUALIFIED:       "info",
  PROPOSAL_SENT:   "brand",
  NEGOTIATION:     "warning",
  DEPOSIT_PENDING: "warning",
  BOOKED:          "success",
  LOST:            "danger",
  POSTPONED:       "neutral",
  DUPLICATE:       "neutral",
  SPAM:            "neutral",
};

export const TEMPERATURE_TONES: Record<LeadTemperature, Tone> = {
  HOT: "danger", WARM: "warning", COLD: "info",
};

export const FOLLOW_UP_TONES: Record<FollowUpStatus, Tone> = {
  OVERDUE: "danger", TODAY: "warning", UPCOMING: "neutral",
  COMPLETED: "neutral", NONE: "neutral",
};
```

Delete the local `Tone` interface. Every `cn("…", STAGE_TONES[x].badge)` becomes
`<ToneBadge tone={STAGE_TONES[x]} label={STAGE_LABELS[x]} />`.

**On the eleven-stage collision.** Collapsing to six tones means `NEW_LEAD`/`QUALIFIED`
both read `info`, and the three terminal stages all read `neutral`. That is the correct
trade — the label is always rendered alongside, colour was never the only signal
(`tone-badge.tsx` header comment), and the pipeline order is already carried by the
`STAGE_ORDER` array and the stage column's position, not by hue. If product wants the
pipeline to stay visually ordered, the right answer is a stage **stepper** in the drawer,
not eleven badge colours in a table cell — file that separately.

**The dot.** `Tone.dot` drives a solid 6px indicator on the stage dropdown trigger
(`leads-columns.tsx:262-265`). `lib/ui/tone.ts` already exports `TONE_BAR` — the solid
variant of each tone, used for progress-bar fills. Reuse it: `cn("size-1.5 rounded-full",
TONE_BAR[STAGE_TONES[lead.stage]])`. No new export needed.

### B2 — Hand-rolled avatar and owner chip instead of `PersonChip`

`leads-columns.tsx:305-318` renders the assignee as a `size-6 rounded-full
bg-muted-foreground/30 …` circle plus a `text-xs font-medium text-foreground truncate`
name. `PersonChip` in `components/ui/tone-badge.tsx:73-105` is that exact markup, and
derives the initials itself.

**Fix.** `<PersonChip name={lead.assignedToName} />`. `LeadListItem.assignedToInitials`
becomes unused at the call site — see E3.

The lead's *own* avatar (`leads-columns.tsx:176-185`) is a different, larger `size-9`
tinted circle carrying `lead.avatarTone`. Leave it; it is a deliberate identity affordance
with no shared equivalent, and Pilgrims' `PersonChip` in the same column position is a
plain grey circle. Worth a follow-up on whether `PersonChip` should take a `tone`, but not
part of this change.

### B3 — Ad-hoc emerald value badge

`leads-columns.tsx:376-385`

```tsx
<Badge className="bg-emerald-500/10 border-none gap-1">
  <TrendingUp className="size-3 text-emerald-600 dark:text-emerald-400" />
  <span className="text-emerald-700 dark:text-emerald-300 font-number">…</span>
```

Three hand-written emerald shades for what `TONE_CLASS.success` already is. Pilgrims
renders money as plain `font-number` text, not a badge.

**Fix.** `<ToneBadge tone="success" label={formatCurrencyLKR(v)} className="font-number" />`,
keeping the `TrendingUp` icon as a child if product wants it. `ToneBadge` takes a `label`
string, so if the icon must stay, add an optional `icon?: React.ReactNode` prop to
`ToneBadge` rather than bypassing it — Documents and Visa would use that too.

### B4 — Empty states are bare table cells

Leads' drawer and sheets render empty lists as loose `<p className="text-xs
text-muted-foreground">` lines. `EmptyState` in `components/ui/tone-badge.tsx:106-128`
is the shared treatment (icon, title, description, optional action) and is what the
Pilgrims detail tabs use.

**Fix.** Sweep `lead-drawer.tsx`, `find-available-groups-sheet.tsx` and
`manage-lead-sources-sheet.tsx` for "no X yet" strings and replace with `<EmptyState>`.
The table's own `emptyMessage` prop stays as-is — `DataTable` handles that case.

---

## C. Sheet and dialog chrome

### C1 — The Add Lead sheet is near-full-screen; every other sheet is a panel

`app/(main)/leads/add-new-lead/add-new-lead.tsx:345-346`

```tsx
<SheetContent className="min-w-[calc(100vw-5rem)] w-full p-0 gap-0 overflow-hidden">
```

That is the viewport minus 80px — effectively a full-page takeover rendered as a sheet.
For comparison, the most complex sheet in the app, Create Departure Group (1,300 lines,
three steps, a calendar, a pricing table):

```tsx
// departure-groups/components/create-departure-group-sheet.tsx:524-526
<SheetContent side="right" className="data-[side=right]:sm:max-w-3xl w-full p-0 gap-0">
```

`sheet.tsx` defaults to `sm:max-w-sm`. The house override is `sm:max-w-3xl`.

**Fix.** `className="data-[side=right]:sm:max-w-3xl w-full p-0 gap-0"`.

The form is currently a two-column `flex-col lg:flex-row` split (`add-new-lead.tsx:359`)
sized for the full-width sheet. At `max-w-3xl` the `lg:` breakpoint (1024px) still fires
inside a 768px panel, so the two columns would each get ~370px and the inputs would
crush. Change the split to a container query or a plain single column — Create Departure
Group is single-column throughout and is a longer form. Recommend single column; the
`OpportunityPreviewCard` currently in the right rail moves to the bottom of the scroll
area, or into the sticky footer as a one-line summary.

### C2 — The scroll container is height-hardcoded

`add-new-lead.tsx:358`

```tsx
<div className="overflow-y-auto h-full custom-scroll max-h-[calc(100vh-16rem)] p-4 sm:p-5 …">
```

`16rem` is a guess at header + footer height. If either changes the body either clips or
leaves a gap. The house pattern (`create-departure-group-sheet.tsx:557`) is:

```tsx
<div className="flex-1 overflow-y-auto custom-scroll px-4 py-4 flex flex-col mt-2 gap-4">
```

`SheetContent` is already `flex flex-col`, so `flex-1` computes the correct height.

**Fix.** Adopt the `flex-1` form. Same change applies to `lead-drawer.tsx:205`, which puts
`overflow-y-auto` on `SheetContent` itself rather than on an inner body — that scrolls the
header out of view, which no other drawer in the app does.

### C3 — Every dialog wraps its title in a hand-styled div

Seven files, same shape:

```tsx
// leads/components/log-contact-dialog.tsx:111-119 — and 6 others
<DialogContent className="max-w-lg gap-4">
  <DialogHeader className="gap-1">
    <div className="flex items-center gap-2 text-base font-bold">
      <MessageSquare className="size-4 text-primary" />
      <DialogTitle>Log contact</DialogTitle>
    </div>
    <DialogDescription className="text-sm text-muted-foreground">…</DialogDescription>
```

versus the house pattern:

```tsx
// departure-groups/components/confirm-action-dialog.tsx:160-164
<DialogContent className="sm:max-w-md">
  <DialogHeader>
    <DialogTitle>{copy.title}</DialogTitle>
    <DialogDescription>{copy.description}</DialogDescription>
  </DialogHeader>
```

Every override is redundant or wrong: `DialogContent` already applies `gap-4`;
`DialogDescription` already applies `text-sm text-muted-foreground`; `text-base font-bold`
overrides `DialogTitle`'s own type scale, so Leads' dialog titles are heavier than
everything else's. Affected: `convert-to-booking-dialog.tsx:99`,
`import-leads-dialog.tsx:111`, `log-contact-dialog.tsx:111`, `mark-lost-dialog.tsx:79`,
`set-follow-up-dialog.tsx:68`, `manage-lead-sources-sheet.tsx:71`,
`send-quote-sheet.tsx:112`, `add-new-lead/components/discard-confirm-dialog.tsx:28`.

**Fix.** Flatten all eight to the canonical form. Where the leading icon is worth keeping
(the destructive dialogs — `mark-lost`, `discard-confirm`), put it inside `DialogTitle`
rather than in a wrapper div, and drop the `font-bold`/`text-base`:

```tsx
<DialogTitle className="flex items-center gap-2">
  <Ban className="size-4 text-destructive" /> Mark as lost
</DialogTitle>
```

Also normalise widths to the `sm:` prefix the shared component uses — `max-w-md` →
`sm:max-w-md`, `max-w-lg` → `sm:max-w-lg`. Without `sm:` the dialog cannot go full-bleed
on mobile, which is what `DialogContent`'s own `max-w-[calc(100%-2rem)]` is for.

Drop `discard-confirm-dialog.tsx`'s `bg-card/95 backdrop-blur-2xl border shadow-2xl` —
`DialogContent` already applies `bg-white/90 dark:bg-card/90 backdrop-blur-3xl ring`, and
the override fights it in dark mode.

### C4 — Sheet widths are ad-hoc

`lead-drawer.tsx:205` `sm:min-w-[32rem]`, `find-available-groups-sheet.tsx:43`
`sm:min-w-[30rem]`, `send-quote-sheet.tsx:112` `sm:min-w-[28rem]`,
`manage-lead-sources-sheet.tsx:71` `sm:min-w-[26rem]`. Four different widths, none of them
a Tailwind scale token, and `min-w` on a sheet fights the component's own `data-[side]`
`max-w` rules rather than replacing them.

**Fix.** Two sizes, expressed the way `sheet.tsx` expects:
`data-[side=right]:sm:max-w-xl` for the drawer, `data-[side=right]:sm:max-w-md` for the
three utility sheets. Keep `w-full` so mobile stays full-bleed.

---

## D. Page shell details

`leads-list.tsx` against `pilgrims-list.tsx`:

| | Pilgrims | Leads | Action |
| --- | --- | --- | --- |
| Root container | `flex flex-col gap-6` | `flex flex-col gap-6 w-full mx-auto pb-10` | Drop `w-full mx-auto pb-10` — `app/(main)/layout.tsx:72` already applies `px-10 pb-5 pt-6`. (DG carries the same redundancy.) |
| Header action row | `flex items-center gap-2` | `flex items-center gap-4` | → `gap-2` |
| Overflow trigger | `<Button variant="outline_without_border">` | same **+ `className="bg-white"`** | Delete `bg-white`. It is a hardcoded light-mode colour on a dark-mode-aware button — a white pill on a dark page. Same bug at `departure-groups-list.tsx:391`, `departure-group-detail.tsx:378`, `packages-list.tsx:334`; fix all four, it is a one-token deletion each. |
| "More Filters" button | `variant="outline_without_border" size="sm"` + muted classes + `<ChevronDown/>` | `variant="ghost" size="sm"`, no chevron | Adopt the Pilgrims form so the button matches the `FilterSelect` chips beside it. (DG matches Leads here; fix both.) |
| Secondary filters | separate row below, revealed by `showMoreFilters` | appended inline to the same row | Move to a second row, matching Pilgrims. With seven chips the single row already wraps mid-group. |
| Result count | none | `{sorted.length} of {leads.length}` in a `bg-primary/10` pill | Keep — it is better than both neighbours. DG shows `{n} Total` in the same pill (`departure-groups-list.tsx:548-552`); align DG's wording to `n of m`. |
| Search placeholder | passed as `searchPlaceholder` prop | hardcoded inside the forked table | Resolved by A1. |

### D1 — The sort control has no equivalent elsewhere

`app/(main)/leads/leads-table/lead-table-sorting.tsx` (147 lines) renders a
`Sort: <field>` dropdown plus a direction-flip button into the table toolbar. No other
module has one — everywhere else sorting is driven purely by clicking column headers.

**Keep it.** It is genuinely useful: several `LEAD_SORT_OPTIONS` fields (temperature,
created date) have no column header to click, so removing it would make them unreachable.
It already renders through the shared `toolbar` prop, so A1 does not disturb it.

Two consistency touches while it is open:

- Departure Groups shows `Sorted by {sortLabel(sort)}` as static text to the right of its
  result count (`departure-groups-list.tsx:556-558`), and Leads has an identical unused
  `sortLabel()` at `utils.ts:485`. Either surface it in Leads or delete the helper —
  see E1.
- The flip button (`lead-table-sorting.tsx:130-145`) duplicates the two Order menu items
  directly above it. Harmless, but it is the only place in the app where one control is
  offered twice in the same popover. Low priority.

---

## E. Dead code and dead data

### E1 — Unused exports in the Leads module

| Symbol | Location | Status |
| --- | --- | --- |
| `LEAD_COLUMN_COUNT` | `leads-columns.tsx:479` | Zero references. Left over from before the table computed `colSpan={columns.length}`. Delete. |
| `JourneyBadge` | `leads-columns.tsx:482-491` | Zero references. Comment claims "reused by the drawer header"; the drawer builds its own badge. Delete, or use it in the drawer — pick one. |
| `sortLabel` | `utils.ts:485-491` | Zero references (see D1). Delete unless D1's first bullet is taken. |
| `filters.temperature` | `types.ts:71`, `utils.ts:610-612` | The filter exists in `LeadFilters`, is seeded to `ALL`, and is matched against — but `leads-list.tsx` renders **no** temperature `FilterSelect`, in either the primary or the "More Filters" row. It can never be anything but `ALL`. Either add the chip (`TEMPERATURE_LABELS` is right there and temperature is a first-class field on the row) or remove the filter key. **Recommend adding the chip** to the More Filters row — the data supports it and the omission looks like an oversight, not a decision. |

### E2 — `lib/data/leads-seed.ts` is a 23-line indirection

The file's own header says live data moved to Supabase and date helpers moved to
`lib/date.ts`. What remains is one constant and a pass-through re-export:

```ts
export { COLOMBO_TZ, colomboDayKey } from "@/lib/date";
export const BASELINE_PRICE_LKR: Record<LeadJourneyType, number> = { … };
```

Two consumers: `app/(main)/leads/utils.ts:18` imports `COLOMBO_TZ`/`colomboDayKey`
*through* the shim rather than from `lib/date`, and `lib/data/leads.ts:13` imports both
the constant and `colomboDayKey`.

**Fix.** Move `BASELINE_PRICE_LKR` into `lib/data/leads.ts` (its only real consumer,
used by `pricePerPerson`), repoint both files at `@/lib/date` directly, delete
`lib/data/leads-seed.ts`.

### E3 — Duplicated helpers Leads should stop redeclaring

| Duplicate | Leads copy | Canonical | Action |
| --- | --- | --- | --- |
| `activeFilterCount(filters)` | `utils.ts:623-625` | `useFilteredRows` already returns `activeFilterCount` (`hooks/use-filtered-rows.ts`) | Delete the helper; read `list.activeFilterCount`. Leads is calling the hook and then ignoring the value it returns. (Pilgrims has the same redundancy — `pilgrims/utils.ts:206`. Fix both; five other modules have it too, follow-up.) |
| `ALL = "ALL"` | `types.ts:59` | `ALL_FILTER` (`hooks/use-filtered-rows.ts`) / `ALL_FILTER_VALUE` (`filter-select.tsx`) | Import `ALL_FILTER` and delete the local const. Two constants that must always agree are one constant with extra steps — the hook's own comment. |
| `assignedToInitials` on `LeadListItem` | `lib/data/leads.ts` (built in `toLeadListItem`) | `PersonChip` derives initials from the name | After B2, drop the field from the view model and its computation. |
| `toggleSort` | `utils.ts:493-499` | four near-identical copies across Leads/DG/Packages/Pilgrims | Leave for now. Unifying it means a generic over each module's `SortField` union; it is a real cleanup but belongs with the shared-sortable-header follow-up, not here. Noted so it is not mistaken for an oversight. |
| `formatDate` / `formatTime` / `formatDateTime` | `utils.ts:235-250` | six modules each define their own (DG, Documents, Leads, Operations, Visa) | Out of scope. There is no shared formatter module yet; creating `lib/format.ts` and migrating six modules is its own change. Flagged, not fixed. |
| `formatCurrencyLKR` | `utils.ts:274` | Pilgrims defines a **different** one (`pilgrims/utils.ts:118` abbreviates to lakhs; Leads' does not) | Out of scope for the same reason, and the two genuinely differ — do not silently unify them. |
| `JOURNEY_TYPE_LABELS` | `utils.ts:93` | four identical copies (DG, Leads, Pilgrims, Visa), same three keys, same three labels | Out of scope but the cheapest of the lot: one `lib/data/journey.ts` and four import swaps. Recommend a follow-up ticket. |
| `STAGE_LABELS` vs `LEAD_STAGE_LABELS` | `utils.ts:37` vs `lib/data/reports-copy.ts:38` | two maps over the *same* eleven `LeadStage` values | They disagree: reports says `"New Leads"`/`"Duplicate"`, the module says `"New Lead"`/`"Spam / Invalid"`. A user reading the Sales Funnel report and the Leads table sees two names for one stage. **In scope** — make `reports-copy.ts` re-export the Leads map, or lift both into `lib/types/leads.ts` beside the `LeadStage` union. |

### E4 — Dead imports in the shared table

`components/data-table/data-table.tsx:21-24,31,35` import `InputGroup`,
`InputGroupAddon`, `InputGroupInput`, `InputGroupText`, `Search` and `X` — none used
since the search box moved to `SearchInput`. Delete while A1 is open. The Leads fork
carries the same unused block (`leads-data-table.tsx:21-25`) and dies with the file.

---

## Phasing

Ordered so each phase is independently shippable and reviewable, and so nothing depends
on a later phase.

**Phase 1 — extend the shared primitives (no Leads changes yet).**
`DataTable` gains `enableRowSelection` / `bulkBar` / `rowsAreButtons` / `rowAriaLabel`,
plus the page clamp, the keyboard row and `font-number` unconditionally (A1).
`KpiCard` gains `onSelect` / `selected`; `KpiRow` gains `columns` (A3).
`SavedViewBar` gains `aria-pressed` and `w-fit` (A4). `ToneBadge` gains `icon` (B3).
Dead imports out of `data-table.tsx` (E4).
*Verify:* Pilgrims and Departure Groups render byte-identically — every new prop is
optional and every unconditional change is additive. This is the risk-bearing phase; it
touches components fifteen modules render.

**Phase 2 — Leads adopts the table.**
Delete `leads-data-table.tsx` and `lead-table-row.tsx`; `leads-list.tsx` renders
`DataTable` (A1). Delete the local `header`/`sortableHeader` from `leads-columns.tsx` and
retype `buildLeadColumns` against `DataTableSort` (A2). Do the same two-function deletion
in `groups-columns.tsx`.
*Verify:* selection survives sort/filter/page-turn; bulk bar appears and clears; Enter and
Space on a focused row open the drawer; the `51–60 of 12` clamp holds when you page deep
then filter hard.

**Phase 3 — Leads adopts the tone system.**
Rewrite `STAGE_TONES` / `TEMPERATURE_TONES` / `FOLLOW_UP_TONES` as `Record<_, Tone>`;
delete the local `Tone` interface; swap every badge to `ToneBadge`; the stage dot reads
`TONE_BAR` (B1). `PersonChip` for the owner column (B2). `ToneBadge tone="success"` for
the value column (B3). `EmptyState` sweep (B4).
*Verify visually, light and dark:* stage column, temperature pill, follow-up badge, value
badge, owner cell, and the same badges inside `lead-drawer.tsx`. This phase changes what
the page looks like more than any other — get product sign-off on the eleven-stages-to-six-tones
collapse before merging.

**Phase 4 — Leads adopts the KPI and saved-view components.**
Delete `leads-metrics.tsx`; render `KpiRow`/`KpiCard` with icons (A3). Delete
`departure-groups-kpi-cards.tsx` and repoint `departure-groups-kpi.tsx`. Rewrite the
Pilgrims KPI row onto `onSelect`. Replace both inline saved-view blocks with
`SavedViewBar` (A4).

**Phase 5 — page shell and overlay chrome.**
All of D (container classes, `bg-white` in four files, More Filters button, secondary
filter row, DG count wording). All of C (Add Lead sheet width and scroll container,
drawer scroll container, eight dialog headers, four sheet widths).
*Verify:* the Add Lead form at `max-w-3xl` — this is the one change in the plan that
requires re-laying-out a real form, not just swapping classes. Budget time for it.

**Phase 6 — dead code and duplicate data.**
E1 (four unused symbols, plus the temperature-filter decision), E2 (`leads-seed.ts`),
E3's in-scope rows (`activeFilterCount`, `ALL`, `assignedToInitials`, the
`STAGE_LABELS`/`LEAD_STAGE_LABELS` reconciliation).
*Verify:* `npx tsc --noEmit` and `npm run lint` clean; grep that no `leads-seed` import
survives.

**Follow-up tickets (explicitly not in this change).**
Documents / Operations / Visa delete their data-table forks now that the shared one has
selection (~690 lines). A shared `lib/format.ts` for the six duplicated date formatters.
A shared `lib/data/journey.ts` for the four `JOURNEY_TYPE_LABELS`. A generic `toggleSort`.
`activeFilterCount` removal in the five remaining modules. A stage stepper for the lead
drawer, if product wants pipeline position back as a visual.

---

## What is deliberately *not* changed

- **The drawer-vs-detail-route split.** Pilgrims opens a full `/pilgrims/[id]` route with
  eight tabs; Leads opens a right-hand `Sheet`. That is a product decision that fits the
  workload — a lead is a short-lived record an agent skims between calls — not a styling
  inconsistency. The drawer's *chrome* gets fixed (C2, C4); its existence does not.
- **`LeadTableSorting`.** Unique to Leads, and load-bearing (D1).
- **The lead's tinted `avatarTone` circle.** Deliberate identity affordance (B2).
- **`formatCurrencyLKR` unification.** Leads and Pilgrims genuinely format differently;
  merging them silently would change numbers on two pages (E3).
