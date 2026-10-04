# Browser run on a database built from the repository (TASK-032 S6, part 2)

**Question.** Does the Inbox work, in a real browser, on a database built from nothing with the repository's own migrations (the clean-rebuild
proof, `2026-10-03-clean-rebuild-proof.md`), and what do the 32 existing Playwright specs say?

**Setup (all local, nothing shared).** The self-hosted Supabase stack in Docker, rebuilt from the 227 committed migrations; the app built with
`next build` and served on port 3100 from a separate checkout; the two fixture agencies (`lr2-fixture-agency-a`, `lr2-fixture-agency-b`) as test
agencies with simulated WhatsApp numbers; four test logins created on this local stack only; Chrome through `PLAYWRIGHT_BROWSER_CHANNEL=chrome`.
Settings and passwords live outside the repository.

## What the run found, and fixed in this change

| # | Finding | Effect | Fix |
|---|---|---|---|
| 1 | **The Inbox list did not load on a fresh database.** The code embedded the lead through `conversations_lead_id_fkey`; `20260828090000` replaces that key with the agency-scoped `conversations_lead_agency_fkey` on any database built from scratch. Staging still has the old key. | A production database built from the migrations would have shown "Inbox unavailable" for every staff member. | The code names `conversations_lead_agency_fkey`; the new migration adds that key where it is missing (staging) and keeps the old one until the new build is live. |
| 2 | **Six composite foreign keys cleared `agency_id` on delete** (`ON DELETE SET NULL` on a `(child_id, agency_id)` key nulls both columns, and `agency_id` is NOT NULL). Verified: deleting a lead that has a conversation failed. Affects booking_sessions (booking, group, lead), conversations (lead), inbox_autonomy_decisions (message), message_media_analyses (intervention). | Deleting a lead, booking, departure group, message or intervention that something still points at is refused with a not-null error, on a fresh build and on staging for the two keys it already has. | The migration re-creates each with `ON DELETE SET NULL (child_column)`. |
| 3 | The login form's inputs had **no accessible name** (the label text sits in a plain `div`). | Screen readers announce an unnamed edit field; every spec failed at sign-in. | `aria-label` on the email and password inputs. |
| 4 | The **owner picker showed the raw staff id** until opened (Base UI Select needs its `items` to render the label). | Staff saw a UUID instead of a name in the thread header. | `items` passed to the Select. |
| 5 | **Reply/Note tabs carried an invalid `aria-selected`** on a wrapper (axe: critical). | Invalid ARIA on every open chat. | Removed from the highlight wrapper; the tab trigger keeps its own. |
| 6 | The attachment `<input type="file">` was **unlabelled** (axe: critical). | Unnamed control. | `aria-label`. |
| 7 | Each conversation row was a **button inside a button** (the tooltip trigger wrapped the row button; axe: serious). | Invalid, unreliable keyboard and screen-reader behaviour in the list. | The trigger renders a `div`. Also fixes the missing `key` (lint error `react/jsx-key`). |
| 8 | Fixture data did not match real data: WhatsApp conversations were keyed `lr2-fixture-...` (template sends read the recipient from that id) with invalid phone numbers; the grouped queue rail was off. | Template sends refused; most views missing from the rail. | The seeder uses fictional numbers in the reserved range `+44 7700 900xxx`, keys WhatsApp chats by their digits like real ones, seeds an approved template, and turns the grouped queue rail on for both fixture agencies. |
| 9 | Two specs were stale: the coworker note's wording changed; V4 expected an opened foreign conversation to hide the whole thread, but the Inbox now (correctly) falls back to the agency's own first conversation. | False failures. | V4 now asserts nothing of the other agency is visible; the note expectation matches the current words. **V4 is not an isolation leak:** the screenshot shows Agency A's own chat. |

Database proofs: `supabase/tests/database/composite_foreign_key_delete_behaviour.test.sql` (4 of 4 on the rebuilt database); static tests in
`lib/security/composite-foreign-key-delete-migration.test.ts`.

## Update 2: the missing spec groups written (same day, third pass)

**43 specs now run; 42 pass.** New specs: **C5** (start a new WhatsApp chat with an approved template; the same number is matched, not duplicated), **C8** (a second staff member is warned
while the first is writing), **C9** (Copilot unavailable: nothing offered, nothing sent), **K3** (a read-only user's shortcuts explain what the role cannot do), **K4** (`e`, `b`,
`g d`, `q` open and create nothing and say why), **X1** (the recommended next action: one action, says why it cannot run), **X2** (lead link present when linked, absent
otherwise), **B4** (a spam change with one selected conversation gone changes none and says so) and the **two-agency isolation spec** (lists, addresses, and, with the staff member's own token,
read, change, write and join the other agency's live channel: all refused, the other agency's row unchanged). A seeded lead-linked conversation and `e2e/support/fixture-admin.ts`
(service-role checks and cleanup, fixture agencies only) support them.

**Defects these specs found, fixed in the same change**

| Finding | Effect | Fix |
|---|---|---|
| **Queue counts never followed a delete.** The stored per-queue counts have triggers on insert and update only; the retention sweep deletes conversations. | Counts drift up for good. **Live staging already shows it** for the real agency (ALL counted 10, 7 rows; WAITING_CUSTOMER 6, 3). Rail badges, the "n conversations" line and the empty-view message disagree with the list ("Showing 0 of 1" over an empty list). | `20270108090000_queue_counts_follow_deletes.sql`: a BEFORE DELETE trigger, plus a one-time recount from the membership rows. 5 of 5 database assertions. **Not yet applied to staging.** |
| **The "a colleague is writing a reply" warning was hidden for up to a minute.** It is judged against a clock that ticks once a minute; the colleague's timestamp is newer than a clock set when the page opened, and a future timestamp is rejected. | The warning meant to prevent two people answering one customer did not show when it mattered. | The clock refreshes the moment a presence stamp arrives. |
| Two more selects showed an internal id instead of a name until opened (the New chat template picker, the triage review picker). | A UUID or code in the field. | `items` passed to both, as for the owner picker. |
| The Copilot card says "Your role cannot use Copilot" for an Admin whose conversation simply has no lead linked yet. | The reason shown is not the real one (C9's "no control is misleading"). | **Not changed** (copy decision); recorded as a finding on the C9 spec. With a lead linked, the card is available. |

**Not written, and why (still open in TASK-030):** O4 (a handoff needs a confirmed booking linked through a lead, plus an Operations user to acknowledge it: a booking, departure-group and
Operations login fixture), C4 (translation calls an AI provider), C6 (e-mail needs a configured test mailbox), X3 (a conversion preview needs a conversation the rules turn into a task or case),
F1 to F6 (Finance, CEO and unprivileged logins, receipt, passport, voice-note and brochure fixtures).

## Update: the eight failures traced (same day, second pass)

**Now 31 of 32 specs pass** (one worker, Chrome, `PLAYWRIGHT_SLOW_FACTOR=3`, local Docker stack). Causes found:

| Failure | Cause | Kind | Fix |
|---|---|---|---|
| Realtime: a second session never saw a change (LR2 convergence, O1, and the specs that depend on them) | The Inbox joined its two **private** channels before the browser client had given its realtime socket the user's token; the server answered "Unauthorized" and the join was never retried. Verified on the wire. | **Product bug** (real) | Both subscriptions now call `realtime.setAuth()` first (`inbox-realtime.tsx`). |
| Same symptom, second cause | The production Content-Security-Policy allowed only `*.supabase.co`, so a Supabase custom domain or self-hosted stack was blocked entirely (REST and Realtime). | **Config gap** (hits any custom Supabase domain, including a production one) | `next.config.ts` adds the one origin from `NEXT_PUBLIC_SUPABASE_URL` when it is not `*.supabase.co`. |
| K1 `r` did nothing | The shortcut code treated the mere presence of `data-disabled` as "disabled", and the tab trigger renders `data-disabled="false"` when enabled. | **Product bug** | The attribute's value decides (`shortcut-targets.ts`, with a unit test). |
| Specs could not find "Send"; screen readers could not either | The Send button became an icon with **no accessible name** (axe: critical `button-name`). | **Product bug** (accessibility) | `aria-label` "Send" / "Add note". |
| LR2 draft, C2, O3, V1, V2, B2, C1 | Spec problems: waited for the wrong request (draft save), expected no alert while the permanent "Reply window closed" notice is correct, did not confirm the new close dialog, V1 needs more than 40 s for 15 page loads, "Send" matched two buttons, B2 picked a chat the colleague already owned; fixtures left earlier runs' messages behind. | Spec/fixture | Specs and seeder updated; the seeder now clears a fixture's earlier messages. |
| Slow screens | A local Docker database makes each server action take 1 to 2 seconds, and the Inbox queues them. | Environment | Opt-in `PLAYWRIGHT_SLOW_FACTOR` multiplies the timeouts; unset, nothing changes. |

**Still failing: A6 colour contrast only**, with measured ratios: the primary green `#10b981` on its light backgrounds is **2.3:1** (the active rail item, the selected
conversation's name, the active tab; AA needs 4.5:1), and the muted grey `#737373` on `#f7f7f7` is **4.42:1** (the time and preview text in the selected row; needs 4.5:1).
Left alone: the colours belong to the design system. A darker green for text (for example `#047857`, about 5.5:1 on white) and `#6b6b6b` would pass.

## Result of the first pass after the earlier fixes (32 specs, one worker, Chrome)

**16 passed, 8 failed, 8 skipped** (the skipped ones depend on an earlier failing step in the same file). The first run, before any fix, was 0 of 32
because the Inbox could not load.

Still failing, not yet diagnosed to a cause (each needs a trace-level look in a browser):

| Spec | Symptom |
|---|---|
| A6 (axe, list/chat/help/phone) | **Colour contrast** (serious) on muted text over the selected row and on `text-primary` text. Left alone: it needs a design decision, because the colours are the design system's. |
| K1 `r` | Pressing `r` does not move the cursor to the reply box. |
| LR2 draft | A typed draft is empty after leaving and re-opening the conversation (draft retention). |
| LR2 realtime, O1 | The second signed-in session does not see the first one's change without a reload. The realtime path itself works on this stack (a signed-in client joined the private channel and received `inbox.invalidate` after a database change), so the fault is in the browser client's use of it. |
| C2 (and so C3, C7) | Template send: needs a re-run now that the fixtures are valid. |
| V1/V2 | Intermittent "conversation list not found" on slow page loads; needs a re-run with the grouped rail seeded. |

The O, B and the missing groups from TASK-030 (O4, B4, C4 to C9, X, F) and the two-agency UI isolation spec are **not written yet**.

## Gate evidence gained

A constraint-and-index comparison, table by table, between this rebuilt database and staging found **15 tables where staging is behind the repository**:
`20260828090000_tenant_uniqueness` is recorded as applied on staging but its effect is partly missing (reference, number, code and receipt uniqueness are still
global instead of per agency, and the agency-scoped composite foreign keys are absent) on agencies, booking_sessions, conversation_messages, conversations,
departure_group_bookings, departure_group_pilgrims, finance_adjustments, invoices, lead_activity, lead_notes, payments, pilgrims, refund_requests,
supplier_commitments and suppliers. A fresh production database gets the correct form; staging does not. A catch-up migration for staging is a separate, larger
decision (it replaces global unique keys with per-agency ones), and the go-live gate should compare constraints and indexes, not only migration names.
