# TASK-027 Inbox UI/UX audit and fix plan

## What
A code-read audit of the full-page Inbox (`/inbox`) and the components it
renders, with a prioritised plan to fix the defects and UX gaps found. No
code is changed by this document.

Scope read: `app/inbox/page.tsx`, `layout.tsx`, every file in
`app/inbox/components/` that makes up the rail, list, thread, composer and
customer panel, and `inbox-workspace-controller.tsx` (loading/sync). Server
actions and RLS were not audited here.

## Why
The Inbox is where staff spend hours. The audit found controls that do
nothing, a screen size where the Inbox is unusable, and several places where
feedback or accessibility is missing. These are listed by severity so they
can be shipped in small slices.

Findings below are from reading the code, not from a browser session; items
marked **verify** need a quick check in the running app before work starts.

---

## Findings

### P0 — broken or dangerous

| # | Finding | Where | Fix |
|---|---|---|---|
| F1 | The right-click menu on every chat row shows **"Assign to me"** and **"Delete"** with **no handlers**. They look real, do nothing, and "Delete" is styled as a destructive action on a conversation. Also `ContextMenuTrigger` wraps the row so keyboard users cannot reach the menu. | `conversation-list.tsx` ~L452–467 | Remove "Delete" (retention rules forbid ad-hoc deletion; see `docs/runbooks/inbox-retention-and-deletion.md`). Wire "Assign to me" to the existing assign action, or remove the menu until it is real. Add the same actions to a keyboard-reachable row menu. |
| F2 | **Unread badge and bold-unread styling are dead.** `unread_count` exists in the schema and list UI, but nothing in `lib/`, `app/` or `supabase/` ever writes it (grep finds only the column default). Every chat looks read. | `conversation-list.tsx`, `20260825090000_whatsapp_channel.sql` | **Verify** with a live inbound message. If confirmed: increment on inbound ingest, clear when a staff member opens the chat, and patch via the existing list-patch realtime path. Or remove the dead UI. |
| F3 | **Below 1024px the view rail is hidden** (`hidden … lg:block`). Phones and tablets cannot switch queue, start a WhatsApp chat or compose an email, see the shortcuts, or go back to the CRM. | `inbox-collapsible-layout.tsx` | Show a compact queue picker (select or sheet) in the list header below `lg`, including New chat / New email. |
| F4 | **Mobile is a stacked layout, not list→thread.** The list takes the top 40% of the screen and the thread the rest, so the thread is cramped and the composer is tiny. | `inbox-collapsible-layout.tsx` (`h-2/5`) | Below `md`, show either the list or the thread. Opening a chat shows the thread with a "Back to chats" button; browser Back returns to the list. |
| F5 | **Switching queue can fail silently.** `loadChatListPart` ignores errors when `isFirstLoad` is false, so a failed queue switch leaves the old list on screen under the new queue's highlight with no message. | `inbox-workspace-controller.tsx` L226–230 | Toast the error, keep the previous queue highlighted, and offer Retry. |

### P1 — wrong or misleading behaviour

| # | Finding | Where | Fix |
|---|---|---|---|
| F6 | **Thread always jumps to the bottom** on any new message, even when the person scrolled up to read history. | `conversation-panel.tsx` scroll effect (~L242) | Only auto-scroll when already near the bottom (or the message is the person's own). Otherwise show a "New messages ↓" pill. |
| F7 | **Header count is wrong.** "N conversations" counts the loaded page, so it shows e.g. "50" while the queue holds 400. The rail already has the true count. | `conversation-list.tsx` ~L180 | Use `viewCounts[activeView]` and say "Showing 50 of 400" when more exist. |
| F8 | **No message list semantics.** The thread has no `role="log"` / live region, so screen readers do not hear new customer messages. Delivery status uses `aria-live` on each message (noisy, and fires on load). | `conversation-panel.tsx` | Make the thread a labelled `role="log"` with `aria-live="polite"` and drop per-message live regions except for pending/failed sends. |
| F9 | **Passport / receipt review cards are appended to the end of the thread**, not beside the message that carried the file, so staff lose the link between a photo and its review. | `conversation-panel.tsx` ~L607 | Render each card directly under its source message (`analysis.message_id`). |
| F10 | **Search is two systems in one box.** Typing filters the loaded list instantly, then swaps to server results ~350ms later (rows can jump). Client filter and server search match different fields. "Load older" stays visible during a search. | `conversation-list.tsx` | Show a single result list with a loading state, no instant client filter, and hide "Load older" while searching. Add a clear (×) button and an empty state that names the search term. |
| F11 | **Failed server search is silent.** `searchInboxConversationsAction` result is dropped if `!result.ok`, leaving "Searching all conversations…" forever. | `conversation-list.tsx` effect | Show "Search failed. Try again." |
| F12 | Conversation action errors appear inline in the header next to the menu and never clear (`setError` only resets on the next action). Success gives no confirmation (Close, Take control). | `conversation-actions-menu.tsx` | Use `toast` for both outcomes. Add a confirm step for "Close conversation" or an Undo toast. |
| F13 | Composer errors are an unstyled `<span>` with no `role="alert"`. | `message-composer.tsx` ~L439 | Use an alert region with the same style as other composer notices. |
| F14 | Two things called "Staff replying" / "Copilot Replying" are shown as an **icon only** in the list row, inside a Tooltip trigger `<span>` that is not focusable. Meaning is only on hover. | `conversation-list.tsx` ~L395 | Use a visible text chip (reuses the existing `STATE_TAG` map, which is currently defined and then only used for its label). "Needs staff" (the state that matters most) is never shown at all. |
| F15 | **"Needs staff" is invisible in the list** although it is the highest-priority state. | same | Always show a chip for `HUMAN_REQUESTED`. |
| F16 | The browser **Back button does not work** on the full page: the URL is updated with `replaceState`, so queue/chat changes add no history. Reload and links work, but Back leaves the Inbox. | `inbox-workspace-controller.tsx` ~L283 | Use `pushState` for chat/queue changes and handle `popstate`. (Required for F4 on mobile.) |

### P2 — polish and consistency

| # | Finding | Fix |
|---|---|---|
| F17 | Many `text-[10px]` / `text-[11px]` values in the thread (timestamps, notes, actor labels). These are off the type scale in `docs/architecture/design-tokens.md` and hard to read. | Move to the scale (`text-xs`), raise contrast of timestamps. |
| F18 | Staff and AI messages use the same bubble colour; only a tiny label differs. Hard-coded `text-white` and `bg-primary!` overrides. | Give AI replies a distinct, token-based treatment (e.g. outlined bubble + Copilot icon). Remove `!` overrides. |
| F19 | No date separators in the thread; the "Conversation history" pill is static. Timestamps show no year and use 24-hour time. | Add day dividers ("Today", "Yesterday", date) and a consistent time format. |
| F20 | Bubbles are capped at `max-w-[76%]`, too narrow on small screens. | `max-w-[88%] sm:max-w-[76%]`. |
| F21 | Composer Copilot button is **icon-only** (label commented out) and relies on `title`. Send button uses `outline_without_border`, so the primary action does not look primary. "Insert saved reply" is an unlabeled chevron next to Send, easy to mistake for a Send menu. | Show the label (or aria-label + tooltip), make Send the primary variant, and move saved replies to a labelled button. |
| F22 | Disabled composer state shows a long paragraph; the Reply tab stays selectable when replies are blocked. | Disable the Reply tab with a short reason and keep the long text in the banner. |
| F23 | Large blocks of commented-out JSX (rail "Back" button, composer quote/convert buttons). | Delete. History lives in git. |
| F24 | Rail items: `py-3` plus small text makes rows tall; collapsed mode shows only an icon with the label in a tooltip (fine), but the collapse toggle sits between the list and the footer actions with no separator. | Tidy spacing; move the toggle to the rail header. |
| F25 | "Lead details" panel title says "Details" with a "Customer" eyebrow; toggle is labelled "lead details" while the Sheet says "Customer details". | Pick one name ("Customer details") everywhere. |
| F26 | `InboxWorkspaceContent` empty state "No conversations are available in this view." has no icon, no next step. | Add a titled empty state per queue ("No unassigned chats — everything has an owner"), and a "Clear search" action when searching. |
| F27 | `conversation-list.tsx` exports `hasArabic` which `conversation-panel.tsx` imports from a component file. Misc generic helper in a component. | Move to `lib/inbox/` (rule: no generic names; use e.g. `containsArabicScript`). |
| F28 | Several components exceed the 200-line guideline (`message-composer` 806, `conversation-panel` 740, `inbox-workspace-controller` 730, `conversation-convert-menu` 554, `conversation-list` 504). TASK-010 already covers decomposition. | Do the UX fixes above inside the split from TASK-010 rather than adding to these files. |

### Verified as fine (no action)
- Realtime/sync design is sound: single-flight runners, stale-patch guards, scoped reads.
- Optimistic sending with idempotency keys, retry and dismiss is well done.
- Keyboard shortcuts registry, help dialog and focus behaviour are good.
- Loading skeletons exist for the three main panes.

---

## Plan (ordered slices, one PR each)

1. **Slice A — remove broken controls (F1, F23).** Smallest, safest, removes a user-visible trap. Includes a test that no row menu item lacks a handler.
2. **Slice B — correctness of list data (F2, F7, F10, F11, F5).** Confirm F2 first against a live inbound message; fix or remove the unread UI. Fix the count text, search flow and failure feedback.
3. **Slice C — status clarity in the list (F14, F15).** Text chips for Needs staff / Staff / Copilot; keep one place that maps state → label.
4. **Slice D — responsive Inbox (F3, F4, F16).** Mobile list→thread navigation, queue picker below `lg`, history-based Back. Test at 320 / 768 / 1024 / 1440.
5. **Slice E — thread behaviour and accessibility (F6, F8, F9, F19, F20, F17, F18).** Smart scroll plus "New messages" pill, `role="log"`, review cards under their message, date separators, type-scale fixes.
6. **Slice F — composer and action feedback (F12, F13, F21, F22).** Toasts, confirm/undo for Close, labelled Send/Copilot/saved replies.
7. **Slice G — naming and cleanup (F24–F28).** Done alongside TASK-010's decomposition.

## Data model changes
Only if F2 is confirmed: a migration to maintain `whatsapp_conversations.unread_count` (increment on inbound, reset on open) with RLS unchanged, plus a test. Otherwise none.

## Access control changes
None. "Assign to me" (F1) must use the existing assign action and its capability check; no new capability.

## UI surfaces
`app/inbox/components/`: `conversation-list`, `conversation-panel`, `message-composer`, `conversation-actions-menu`, `inbox-collapsible-layout`, `inbox-view-rail`, `inbox-view-navigation`, `inbox-workspace-controller`, `inbox-workspace-content`, `inbox-section-skeletons`. shadcn components only; no colour changes.

## Test plan
- **Vitest:** list count text and search state (F7, F10, F11); state→chip mapping (F14, F15); scroll-near-bottom helper (F6); history/URL handling (F16); unread increment/reset if F2 is built.
- **Playwright (existing `e2e/inbox-lr2` harness):** queue-switch failure toast (F5); mobile list→thread→Back at 375px (F3, F4); keyboard path through list, thread and composer.
- **Manual in browser:** screen reader pass on the thread (F8); contrast of timestamps (F17); dark mode on the new chips and bubbles.
- `npm run lint`, `npm run typecheck`, `npm run test` pass before each PR.

## Status
In progress — Slices A–F committed (B, D, E, F not yet checked in a signed-in browser). Slice G done except F28 (component splitting), which stays with TASK-010.
