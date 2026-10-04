# TASK-033 Inbox: calmer layout and cleaner information hierarchy

## What
A design audit of the full-page Inbox (`/inbox`) and a sliced plan to make it
feel less crowded: more room for the conversation, fewer repeated labels and
dividers, and a clear "what do I look at first" on every pane. This is a
**layout, spacing and information-hierarchy** pass. It changes no colours, no
data, no permissions and no server code.

It is separate from [TASK-027](TASK-027-inbox-ui-ux-audit-and-fixes.md), which
fixed *broken or misleading behaviour* (dead menus, scroll jumps, mobile
navigation). That work is done; this plan starts from the screen as it now is.

## Why
Staff read this screen for hours. Reading the code, the Inbox is correct but
dense: every pane shows everything it knows at once. The causes are structural,
so they are listed by pane with the file to change.

**Method and limits.** Code-read only (`app/inbox/components/*`, list, thread,
composer, rail, customer panel, layout). I have not seen the screen rendered
with real data. Items marked **verify** need a screenshot before the slice
starts — Slice 0 produces those screenshots.

---

## Findings

### A. The conversation gets squeezed (biggest single problem)

Fixed widths: rail `w-56` (224px) + list `w-80` (320px) + customer panel
`w-80` (320px). The customer panel docks from `xl` (1280px).

| Screen width | Left for the thread | Reading |
|---|---|---|
| 1024 | ~480px (panel is a sheet) | tight |
| **1280** | **~416px** | **cramped: bubbles are 76% of this, composer toolbar overflows** |
| 1440 | ~576px | ok |
| 1536 | ~672px | comfortable |
| 1920 | ~1056px | spacious |

On a common 1280–1366px laptop the person reading the chat gets the
*narrowest* of the three columns.

**Fix:** the thread is the focal point, so it gets a width floor (~560px)
and the side panels give way to it. Dock the customer panel only from `2xl`
(1536); below that it opens as a sheet from the header button. Auto-collapse
the rail to icons between 1024–1439 unless the person expanded it. Remember
the choice per person (`localStorage`, wrapped in try/catch). File:
`inbox-collapsible-layout.tsx` (`DESKTOP_CONTEXT_MEDIA_QUERY`, `RAIL_*`
classes).

### B. Conversation list row repeats itself

`conversation-list.tsx` renders four lines per row (name, preview, chips +
time), `py-3`, a `border-b` on each row, avatar `size-11` plus a channel logo
hanging off its corner.

- The **ownership chip is on almost every row** ("Copilot replying", "Staff
  replying" …). When ~90% of rows carry the same chip it carries no
  information and hides the rows that matter. (TASK-027 F14/F15 made this
  visible on purpose; the follow-up is to show it only when it differs from
  the normal case.)
- The **lead-stage badge** on every row is a second chip with a third idea.
- **Time sits at the bottom right**, away from the name. Every mail/chat
  product puts it top-right beside the name; the eye expects it there.
- The avatar already carries the channel logo, so the channel is told twice
  when the list is filtered to a channel.

**Fix (new component `InboxConversationRow`, split out of the list):**
- Line 1: name (left) + relative time (right). Unread count replaces the time
  weight, not an extra badge.
- Line 2: one-line preview, `You:` prefix kept.
- Line 3 appears **only when there is an exception**: *Needs staff*, *Mine*,
  *Unassigned* (when not in the Unassigned queue), overdue SLA. Normal rows
  are two lines.
- Lead stage moves to the context panel (it is already there) and a tooltip.
- Drop the per-row `border-b`; use `py-3` spacing and a subtle selected
  background. Keep a hairline only between day groups if grouping is added.
- Avatar `size-10`, channel logo smaller and inside the avatar edge so rows
  keep a clean left edge.
- A pure helper `listRowSignals(conversation, activeView, currentStaffId)`
  decides which exception chips show, so the rule is unit-tested.

### C. List header stacks four things

Title + count, search box, a status line, then a row holding **Saved views**
and **Select conversations**, nudged with `mt-1.5`. Bulk-select is rarely
used but always visible.

**Fix:**
- Title row: `Queue name` · count on the left; a single overflow button
  (`DropdownMenu`) on the right holding *Select conversations* and *Saved
  views*. Search becomes the only full-width control.
- Search result/status text sits inside the search group (as helper text), not
  as a separate paragraph pushing the list down.
- Empty list: replace the bare "No conversations found." with the titled,
  actionable empty state per queue that TASK-027 F26 asked for (verify it
  landed on the list pane — only the workspace pane was found in code).

### D. Rail: the main action is the hardest to find

`inbox-view-rail.tsx` lists queues, then a footer of six ghost buttons:
collapse, back to CRM, keyboard shortcuts, outcome metrics, **New chat**,
**New email**. "Start a conversation" is the most common write action and it
is the least visible control on the screen.

**Fix:**
- One primary **New** button at the top of the rail (opens a menu: *WhatsApp
  chat*, *Email*) — reuses the existing two dialogs.
- Footer shrinks to utilities: Back to CRM, Outcomes, Shortcuts, Collapse.
  Shortcuts and Outcomes can share one "More" menu.
- Rail heading uses the Label step, not a section heading; the page already
  has the queue title in the list.
- Group labels shown for every group (currently skipped for the first), with
  a bit more space between groups instead of a divider.

### E. Thread: heavy per-message furniture

`conversation-panel.tsx` wraps each message in a padded row (`px-3.5 py-2.5`)
inside `gap-3`, and prints a metadata line (actor, time, delivery status)
under **every** bubble.

- Ten messages from the same sender = ten identical meta lines.
- Header packs avatar, name, phone, owner picker, status badge, actions menu
  and panel toggle; it wraps to two lines on narrow widths (TASK-018 patched
  the symptom).
- The day pill has a border and background that compete with bubbles.

**Fix:**
- New pure helper `groupThreadMessages` — consecutive messages from the same
  sender within ~5 minutes form a group: **one** meta line under the last
  bubble; the time of any bubble appears on hover/focus. Failed/pending state
  is always shown (it must never hide).
- Vertical rhythm: `gap-1` inside a group, `gap-4` between groups; drop the
  extra row padding.
- Day divider: plain muted text with a hairline, no pill border.
- Header: left = avatar, name, and **one** muted line (phone / email). Right =
  owner control (ghost select), actions menu, panel toggle. The status badge
  is shown only when it is not the normal state (same rule as list rows).
- Header height fixed at one row at all widths; secondary info truncates.

### F. Composer: up to six strips before you can type

Above the textarea the composer can stack: policy banner, disabled note,
error, presence banner, ownership notice, and a "Suggested next step" line.
The toolbar then holds Reply/Note tabs, Draft with Copilot, Attach, Saved
replies and Send — five controls that do not fit in ~416px.

- "Suggested next step" **duplicates** the Recommended next action card in the
  customer panel.

**Fix:**
- New `ComposerNoticeStrip` that shows **one** notice at a time by priority
  (policy block → error → presence → ownership), with "+N more" to expand.
  A pure `pickComposerNotice` ranks them and is unit-tested.
- Remove the in-composer "Suggested next step" line (kept in the panel).
- Toolbar: left = segmented Reply / Note; right = icon buttons with tooltips
  (Attach, Saved replies, Draft with Copilot) and a primary **Send**. Labels
  appear from `lg` upward only where there is room.
- Textarea keeps its current height; padding is `p-3` consistently.

### G. Customer panel: long scroll, repeated facts, mixed heading styles

`customer-context-panel.tsx` stacks about nine sections separated by seven
`<Separator>`s inside `space-y-6`:
risk → next action → "Customer details" (an H2-size heading) → identity →
completeness → Copilot reading → Copilot drafting → Travel interest → Booking
→ Follow-up → Turn into work → History.

- **The customer's name is below a large promo-style card.** Identity should
  be first.
- **Package and period appear three times** (completeness, Copilot's facts,
  "Travel interest").
- Headings mix styles: sentence-case section headings, `UPPERCASE` micro
  labels ("Recommended next action", "Travel details", "Flags"), and an
  `text-xl` H2 inside a 320px panel — the dialog/section H2 step is too loud
  here and outranks the page.
- "Review is required before anything is sent or created." is printed on the
  next-action card every time.

**Fix:**
- Sticky identity header: name, reference, stage badge, language, phone —
  always visible.
- Urgent review cards (risk) stay directly under it.
- **Next step** card: tighter (title, one-line reason, one button); the review
  disclaimer moves to a tooltip on the button.
- Everything else becomes a `Collapsible`/accordion list using shadcn:
  *Trip* (merge completeness + travel interest + Copilot's travel details —
  one source per fact), *Booking*, *Follow-up*, *Copilot's reading*, *History*.
  *Trip* and *Booking* open by default; open/closed state remembered.
- Remove the `Separator`s; spacing and the accordion rows do the grouping.
- One heading style in the panel (Label step, sentence case). Delete the
  `uppercase` micro labels.

### H. Cross-cutting

- **Divider overload:** borders between rail/list/thread/panel, header,
  every list row, composer top, every panel section. Per `ui-standards.md` §4
  (space first, divider second) keep pane-to-pane lines and the composer top
  line; remove the rest.
- **Type scale:** the design tokens allow Caption (`text-[11px]`) for
  timestamps; the thread now uses `text-xs` for everything, flattening
  hierarchy. Timestamps/meta → Caption, names → Label (`text-xs font-medium`)
  or Body.
- **Spacing:** values are on the 4px scale already; the issue is *uniform*
  density (everything `gap-3`). The plan introduces a rule: related things
  `gap-1`/`gap-2`, groups `gap-4`/`gap-6`.
- **Motion:** only the panel width transitions animate (150–200ms, reduced
  motion respected); keep, and reuse the same easing for accordion open.
- **Accessibility to keep:** `role="log"` thread, `aria-current` rows,
  keyboard shortcuts (J/K, /, R, N), chips never colour-only. Every removal
  above must keep its information reachable (tooltip, hover, or the context
  panel).

### Verified as fine (no action)
- Skeleton states exist for list, thread and panel.
- Colour usage is state-driven and goes through tone tokens.
- Compact queue bar and mobile list→thread navigation (TASK-027 D) work as
  designed; this plan only re-spaces them.

---

## Plan (ordered slices, one PR each)

| Slice | Scope | Findings | Risk |
|---|---|---|---|
| **0** | Baseline screenshots at 375 / 768 / 1024 / 1280 / 1440 / 1920, light and dark, with seeded data, using the existing Playwright harness. Attach to the PR of each slice for before/after. No code change. | — | none |
| **1** | Layout width budget: panel docks from `2xl`, rail auto-collapses 1024–1439, remembered choice, thread min-width. | A | low |
| **2** | `InboxConversationRow` + `listRowSignals`: two-line normal rows, exception chips only, time top-right, no per-row divider. | B | low |
| **3** | List header: overflow menu for Select/Saved views, search helper text inline, per-queue empty state. | C | low |
| **4** | Rail: primary **New** menu at top, footer reduced to utilities, group labels. | D | low |
| **5** | Thread: `groupThreadMessages`, spacing rhythm, day divider, one-row header with conditional status badge. | E | medium (touches `conversation-panel.tsx`, 768 lines — split as part of this slice, per TASK-010) |
| **6** | Composer: `ComposerNoticeStrip` + `pickComposerNotice`, icon toolbar with tooltips, remove duplicate "Suggested next step". | F | medium (touches `message-composer.tsx`, 763 lines — extract the toolbar) |
| **7** | Customer panel: sticky identity header, tighter Next-step card, accordion sections, merged Trip section, one heading style. | G | medium |
| **8** | Divider/type-scale sweep and a final screenshot pass against Slice 0. | H | low |

Order rationale: Slice 1 gives every later slice more room to judge by; 2–4
are isolated and low-risk; 5–7 are the larger ones and each leaves the file it
touches smaller than it found it.

Each slice is shippable alone. If time is short, **1 + 2 + 6** give the most
visible calm for the least change.

## Data model changes
None.

## Access control changes
None. No capability gates move; every control still renders under the same
condition, only its place or form changes.

## UI surfaces
`app/inbox/components/`: `inbox-collapsible-layout`, `conversation-list`
(row extracted to a new `inbox-conversation-row`), `saved-views-menu`,
`bulk-selection-bar`, `inbox-view-rail`, `inbox-view-navigation`,
`conversation-panel`, `conversation-ownership-badges`,
`conversation-state-chip`, `message-composer`, `channel-policy-banner`,
`composer-presence-banner`, `customer-context-panel`,
`recommended-next-action-card`, `conversation-intelligence-rail`,
`lead-completeness-block`.
New, specifically named: `InboxConversationRow`, `ComposerNoticeStrip`,
`ComposerToolbar`, `CustomerContextAccordion`, `CustomerIdentityHeader`.
New helpers in `lib/inbox/`: `list-row-signals.ts`, `group-thread-messages.ts`,
`pick-composer-notice.ts`, `inbox-layout-budget.ts`.

Components come from shadcn through the MCP (`Collapsible`/`Accordion`,
`DropdownMenu`, `Tooltip` already present — confirm `Accordion` with
`mcp__shadcn__search_items_in_registries` before adding). Inputs keep the
`InputGroup` pattern. **No colour changes** — existing tokens and `Tone`
vocabulary only.

## Test plan
- **Vitest (pure helpers):**
  - `listRowSignals`: normal row → none; human-requested → *Needs staff*;
    assigned to me → *Mine*; hides *Unassigned* inside that queue.
  - `groupThreadMessages`: same sender within window groups; different
    sender, gap over window, day change, note and failed message break the
    group; a failed/pending message is never folded away.
  - `pickComposerNotice`: priority order and "+N more" count.
  - `inbox-layout-budget`: given viewport width, whether the panel docks and
    whether the rail auto-collapses; the thread never drops below the floor.
- **Playwright (existing `e2e/inbox-*` harness):** screenshots at the six
  widths for each slice; keyboard path (J/K, /, R, N) unchanged; composer
  fits one toolbar row at 1024px; no horizontal scroll at 375px; the
  `inbox-accessibility` spec still passes.
- **Manual in browser:** screen-reader pass on grouped messages (time still
  announced); dark mode on the new row and accordion states; contrast of
  Caption timestamps (4.5:1); reduced-motion on accordion and panel.
- `npm run lint`, `npm run typecheck`, `npm run test` pass before each PR.

## Open questions
These have a recommended default, so the work is not blocked; change them if
you disagree.
1. **Panel docking breakpoint.** Default `2xl` (1536). On a 1366px laptop the
   panel becomes a sheet; the alternative is keeping it docked and letting the
   list narrow instead.
2. **Lead stage in the list.** Default: removed from rows (still in the
   panel). If sales staff scan the list by stage, keep it as a hover tooltip
   or an optional "show stage" setting.
3. **Grouped messages hide the per-message time until hover.** Default yes;
   touch devices show the time on tap.

## Status
- Slice 1 follow-up: the customer panel now **docks as a rail from 1280px**
  (it was 1536px) and the queue rail stays folded until 1440px, so the chat
  still keeps ~564px at both 1280 and 1440. Below 1280px the panel is a sheet.
- Slice 1 (width budget): code done on `feat/inbox-layout-width-budget` —
  panel docks from 1536px, rail folds to icons below 1440px, both choices
  remembered per browser. Unit-tested; **not yet checked in a signed-in
  browser** at 1024 / 1280 / 1440 / 1536 (Slice 0 screenshots still to take).
- Slice 7 (customer panel): code done on `feat/inbox-conversation-row`
  (uncommitted) — sticky `CustomerIdentityHeader`, then risk cards and the
  tighter next-step card, then a remembered accordion
  (`CustomerContextAccordion`: Trip and Booking open by default, Follow-up,
  Copilot, Turn into work, Conversation history closed). Separators and the
  `text-xl` heading removed; uppercase micro labels now sentence case; the
  "review is required" line moved to the button tooltip. Closed sections stay
  mounted so a Copilot draft is not lost. Copilot's travel details stay inside
  the Copilot section rather than being merged into Trip. Unit-tested
  (section-state parsing); not yet checked in a signed-in browser.
- Slice 3 (list header): code done on `feat/inbox-conversation-row`
  (uncommitted) — title and count on the left, **Saved views** and
  **Select conversations** as two icon buttons with tooltips on the right
  (two buttons rather than one overflow menu, because Saved views is itself a
  menu with a naming form), search is the only full-width control, and the
  empty list now uses the per-queue copy with a "Clear search" action. The
  accessible name "Select conversations" is unchanged, so the existing e2e
  selectors still match. Not yet checked in a signed-in browser.
- Slice 4 (rail): code done on `feat/inbox-conversation-row` (uncommitted) —
  a primary **New conversation** menu (WhatsApp chat / Email) at the top of the
  rail; the two dialogs now accept `open` / `onOpenChange` / `showTrigger` and
  keep their own buttons for the compact bar below `lg`. Rail heading is a
  quiet label, footer is down from six buttons to four (collapse, back to CRM,
  Outcomes, Shortcuts), more space between queue groups. Not done on purpose:
  the first group stays unlabeled (its label would just repeat "Inbox"), and
  Shortcuts/Outcomes were not merged into a "More" menu because Outcomes is
  itself a dialog with its own trigger. The e2e start-chat step now opens the
  menu first. Not yet checked in a signed-in browser.
- Slice 5 (thread): code done on `feat/inbox-conversation-row` (uncommitted) —
  `groupThreadMessages` groups same-sender messages within 5 minutes; the
  sender/time/delivery line prints once under the last bubble (a failed
  message always keeps its own line), the time of any bubble stays on hover
  and in screen-reader text. Spacing is `mt-1` inside a group and `mt-4`
  between groups, the day pill became a plain divider with hairlines, and the
  header no longer shows the "Assistant active" badge (shown only when staff
  must act or the assistant is paused), stays on one row, and truncates its
  second line. Time on touch devices is not shown on tap yet (open question
  3). `conversation-panel.tsx` is still ~850 lines: the split is not done in
  this slice. Not yet checked in a signed-in browser.
- Slice 6 (composer): code done on `feat/inbox-conversation-row`
  (uncommitted) — `ComposerNoticeStrip` + `pickComposerNotice` show one notice
  at a time (send error, then "replying blocked", then a colleague writing,
  then ownership) with "N more notes" to expand; the presence banner file was
  replaced by `composerPresenceMessage`; the "Suggested next step" line is
  gone (the customer panel's next-step card says it); Saved replies is an icon
  button. Already done by hand before this slice and left alone: Send is
  icon-only and the Copilot button is commented out. The policy banner stays
  above the composer because it carries action widgets. Risk: the e2e check
  that a colleague's "is writing a reply" notice is visible assumes it is the
  top notice. Not yet checked in a signed-in browser.
- Slices 0, 2 and 8: not started in git (Slice 2 work was lost, see PR notes).
- The Inbox + Copilot checklist (`docs/inbox/checklist.md`) is not affected
  because this is a UI polish task, not a programme slice.
