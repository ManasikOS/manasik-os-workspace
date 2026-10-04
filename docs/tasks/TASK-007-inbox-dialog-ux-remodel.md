# TASK-007 Inbox Dialog UX Remodel

> Plan only. No code is written by this document.
> Source: the UX review PDF ("The UI direction is correct; I would not redesign it") plus
> [`docs/inbox/channels-and-ai-agent-guide.md`](../inbox/channels-and-ai-agent-guide.md).
> Guiding rule from the review: every visible Copilot insight must answer
> **What is known? What is missing? What is safe to do next?**

## What

Keep the current shell (rail | list | thread | context panel, in the header overlay) and change what it
*says*. Replace generic or ambiguous elements with state-specific, evidence-backed ones; remove the
dangerous one; add a full-page shell that reuses the same component.

## Why

The overlay already loads rich data (`intelligence`, `leadContext`, `composerPresence`, queue counts) but shows
it generically. Examples in the current code:

| Today | Where | Problem |
|---|---|---|
| "Clear all chats" in the daily rail | `inbox-view-rail.tsx:286`, `clear-all-chats-dialog.tsx` | Agency-wide purge breaks traceability |
| State badge from `STATE_LABEL[conversation.state]`; the owner line is commented out | `conversation-panel.tsx:381-400` | Nobody can see who owns the chat or whether the assistant may speak |
| "Suggest live packages" button, always shown | `inbox-copilot.tsx:55` | Suggests before intent is complete |
| "Departure group: Selected" | `customer-context-panel.tsx:149` | One label for recommended / selected / held / booked |
| Channel-first rail (`VIEWS`) as fallback; grouped rail only when `queuesV2` | `inbox-view-rail.tsx:49,216` | Agencies work by urgency, not channel |
| Only the lead stage badge, no completeness | `customer-context-panel.tsx:115` | "QUALIFIED" with no reason |

## Design contract (per the skill's reference-led step)

- **Screen job:** let staff clear a conversation quickly and safely: who owns it, what they want, what is missing,
  what is allowed, and the one next action.
- **Primary action per state:** one, contextual (see §5). Never a permanent row of every CRM conversion.
- **Required states for every new block:** loading (skeleton), empty, error (with retry), stale, no-permission.
- **Responsive:** overlay is already mobile-stacked. Test 320 / 768 / 1024 / 1440.
- **Reject:** raw enum names (`HUMAN_ACTIVE`), L0–L3 jargon, colour-only status, always-on action rows, inventing
  new colours (repo rule: don't change colours, follow existing tokens).
- **Constraints from AGENTS.md:** shadcn components only; every input uses the `InputGroup` /
  `InputGroupAddon align="block-start"` / `InputGroupInput` format; unique, specific component names (no
  `Card`/`Panel`/`Item` wrappers of our own); plain, clear copy.

## Guardrails (apply to every phase)

1. **Display-only first.** Phases 1–4 derive labels from data that already exists. Anything needing a new field is
   listed under "Data changes" and is a separate, gated step.
2. **One pure mapper per concept, unit-tested** in `lib/inbox/` (e.g. `ownership-status.ts`,
   `departure-group-status.ts`, `lead-completeness.ts`, `reply-window-policy.ts`). Components render the mapper
   output and hold no branching logic. This is the repo's "deterministic core, LLM at the edges" rule and is where
   Vitest coverage goes.
3. **Never claim more than evidence supports.** "Confirm payment" is never shown unless finance reconciliation
   exists. Voice transcripts are labelled non-authoritative.
4. **Server stays the authority.** UI hides/disables for clarity; every action still re-checks capability and
   agency scope in the Server Action.
5. Keep components under ~200 lines; `conversation-panel.tsx` (661) and `conversation-convert-menu.tsx` (445) get
   split as touched, not rewritten wholesale.
6. Follow the Inbox programme rules: read `docs/inbox/architecture.md` §1, §3.2, §16 first; do one slice per PR;
   tick `docs/inbox/checklist.md` in the same PR.

## Phases

### Phase 0. Confirm scope before building (small)
- Open a slice in `docs/inbox/implementation-plan.md` for this work, or confirm which existing slice each item
  belongs to (checklist first).
- Decide the open questions at the bottom.
- Screenshot the current overlay at 4 breakpoints as the "before".

### Phase 1. P0 safety and clarity (ship first)

**1.1 Remove "Clear all chats" from the rail**
- Delete `ClearAllChatsDialog` usage and the `canClearAllChats` prop chain (`inbox-view-rail.tsx`,
  `inbox-workspace-content.tsx`); fix the stale comment about counters at `inbox-workspace-content.tsx:95`.
- Add a compact "⋯" rail menu with: Inbox settings, Archived conversations, Export conversation history
  (only entries that already have a destination; hide the rest).
- Purge, if kept at all, moves to *Settings → Data & Retention → Data deletion request*: Admin only,
  re-authentication, typed agency name, explanation of what is removed, delayed execution, audit event. That is its
  own task (touches the action, capability `clearAllChats`, audit log). This task only removes it from the rail.
- Acceptance: no destructive control reachable from the daily rail; capability still enforced server-side until
  the purge task lands.

**1.2 Ownership + assistant status header** (`conversation-panel.tsx` header)
- New mapper `ownership-status.ts`: `(state, assigned_to_*, composerPresence, aiGenerating?) → { owner, assistant, nextResponder, tone, label }`.
- Copy table (from the review):

| Real state | Label | Treatment |
|---|---|---|
| AI generating now | Copilot is drafting… | soft animated dot, respects reduced motion |
| AI sent last, waiting | Assistant active | calm neutral badge |
| Staff owns | Assigned to {name} | avatar + name chip |
| Risk / intent needs staff (`HUMAN_REQUESTED`) | Staff action needed | amber/red **with icon + text** |
| Paused by staff ownership (`HUMAN_ACTIVE`) | Assistant paused | muted |
| Review required | Human review required | warning chip |

- Restore the owner chip (currently commented out); "Unassigned" when null; "Via: {routing rule}" as secondary text
  only if the routing reason is already stored (else defer).
- Add an owner control (`Select`) gated on the existing assign capability; wire to the existing assign action.
- Answer in one glance: who owns it, can the assistant speak, who must respond next.
- Open question: is there a signal for "AI generating right now"? If not, do not show "drafting…"; show
  "Assistant active" only. (See Data changes.)

**1.3 Stateful Departure Group block** (`customer-context-panel.tsx`, `select-departure-group-button.tsx`)
- Mapper `departure-group-status.ts` returns one of five distinct states with distinct labels/icons:
  None → "No departure selected"; Recommended → "Recommended: {group}"; Preference → "Lead preference: {group}";
  Seat hold → "Seat hold: {group} · expires in 1h 42m"; Booked → "Booked: {group}".
- Never reuse one label for recommendation, selection, hold, and booking. Booked state shows booking ref, payment
  status, "Open booking".
- Uses existing `lead.selected_departure_group_id`, `booking`, and the offer from `intelligence`. Seat-hold expiry
  needs confirmation that a hold record is readable here (else it renders as Preference and is flagged in Data changes).

**1.4 Replace "Suggest live packages" with a stateful offer card** (`inbox-copilot.tsx`, `conversation-offer-card.tsx`)
- Four states from the review, chosen by a mapper over the existing offer + completeness data:
  A incomplete intent → "Still needed: …" + [Ask for missing details];
  B enough data → recommended option (dates, seats, room) + why + [Draft reply] [Create quote] [Open group];
  C no viable group → what was requested + [Show nearest options] [Ask for flexible dates];
  D full/stale/unavailable → "Human review required. Do not confirm to the customer." + [Show alternatives].
- The old button becomes a secondary "Refresh options" only inside state B/C.
- Quote actions disabled when price/seat data is not fresh (the docs already require this), with a visible reason.

**1.5 Attachment workflow actions** (`attachment-intelligence-card.tsx`, `inbox-message-media.tsx`)
- Passport/ID: candidate fields (name, expiry, confidence) + [Review fields] [Save to Documents] [Assign visa officer];
  if several travellers, "Which traveller does this belong to?" selector first.
- Payment proof: candidate amount/reference, status "Not verified" + [Send acknowledgement] [Open Finance review]
  [View booking]. **No "Confirm payment" button.**
- Voice note: "Transcript is non-authoritative", [Play original] [Copy summary] [Create support task].
- [Save to Documents] wires the existing backend primitive that currently has no UI (documented gap). Needs a Server
  Action wrapper with `requireUser()`, Zod, agency scope. Confidence is shown as text plus a number, not colour alone.

### Phase 2. P1 workflow

**2.1 Task-based work queues (make the grouped rail the default)**
- The grouped rail already exists behind `queuesV2`. Plan: order the groups INBOX / SALES / ATTENTION / CHANNELS +
  Archived, Spam; hide low-use queues behind "More queues" or until the count is non-zero.
- Counts must be **server aggregates**, not loaded-list counts (documented gap; the rail badge today is the loaded
  list). Depends on the existing `queueCounts` / `viewCounts` from `patchListRow`; confirm they cover every queue.
- Roll out by turning `inbox_queues_v2` on per agency, then delete the legacy `VIEWS` branch after one release.

**2.2 Lead completeness block** (new `lead-completeness-block.tsx`, mapper `lead-completeness.ts`)
- "4 of 6 details collected" checklist (journey type, package interest, travel period, contact details, traveller
  count, room preference), each with ✓ / ○ (icon + text), and [Ask next best question] drafting into the composer via
  the existing `composer-draft-event.ts`.
- Deterministic calculation over lead + extracted intent; the model only proposes the wording. Not an opaque score.

**2.3 Right-panel order** (`customer-context-panel.tsx`): Customer/Lead (with owner) → Travel intent →
Recommended next step / offer → Booking → Conversation history (lead created, Copilot reply sent, reopened by
customer) → Copilot details (collapsed). Replace the "Customer / Details" heading pair with the person's name.

**2.4 Send-policy banner** (`channel-policy-banner.tsx`)
- Mapper `reply-window-policy.ts` returns: Open ("Free-form reply allowed for 23h 42m"), Closing (<2h,
  "Window closes in 1h 42m", [Draft reply]), Closed ("Choose an approved template. Meta charges may apply.",
  [Choose template]), Messenger/Instagram human-support exception ("Written and sent by a staff member, allowed
  until {time}").
- Copy shows permission and consequence only; timers tick with a coarse interval (not per-second renders).

**2.5 Composer regrouping** (`message-composer.tsx`, `conversation-convert-menu.tsx`)
- Two tabs: Reply | Internal note. Row: Attach · Saved reply · Template · ⋯ ; right: Draft with Copilot · Send.
- The ⋯ menu holds create quote / task / request documents / visa task / follow up on payment / open complaint /
  escalate to guide / hold seats / assign.
- **Contextual primary action** table (new pure function `next-best-action.ts`):
  new enquiry → Draft reply + Find groups; wants price → Create quote; claims payment → Acknowledge + Open Finance
  review; passport received → Save to Documents + Assign visa officer; booking ref missing → Find booking +
  Escalate; complaint/refund → Open case + Assign owner; departure question → Open departure + Draft verified update.
- Presence line near the composer: "{Name} is drafting a reply · [Take over anyway]" (uses `composerPresence`, a
  compact line not an alert). Warn before send if replying takes ownership from another staff member (documented
  gap: replying may reassign).

**2.6 "Why?" evidence on every recommendation**
- Standard `Why this matches` expandable (uses the existing `intelligence-evidence-popover.tsx`) with bullet
  reasons and [View evidence]. Applies to offers and to risk states, e.g. "Payment verification required — Why:
  customer stated LKR 250,000, no confirmed payment on the linked booking. [Open payment review]".
- Standard: no recommendation renders without at least one evidence line, or it shows "Based on limited
  information".

### Phase 3. P2 scale and settings
**3.1 Full-page mode.** Add an Inbox route that renders the *same* `HeaderInboxDialogContent` data logic in a
page shell, with wider list/context, persistent filters, saved queue views, keyboard navigation, deeper search, bulk
actions. First step is only an extraction: split the load/sync state (`header-inbox-dialog.tsx`, ~660 lines) into a
`use-inbox-workspace-state` hook so the dialog and the page share it with zero behaviour change. Bulk actions and
saved views are separate later tasks. Add an "Open full page" control to the overlay header.

**3.2 Admin AI settings language.** Show: Observe only / Draft replies / Safe automatic replies / Lead intake
assistant, plus the always-human-only list (payment confirmation, visa outcome, discounts, refund/cancellation
commitments, bank details, booking changes, religious rulings, medical/safety advice). L0–L3, Shadow/Propose/Active,
job queues, model choice, prompt packing stay internal. **Blocked** until the backend items below are fixed.

### Phase 4. New chat dialog (the modified file in your working tree)
Small and independent; can ride with Phase 1.
- Fix the mis-indented Send button block and the duplicate `id`/label pattern in `new-chat-dialog.tsx`.
- Show category + projected Meta charge in the preview (guide says it is shown for resume; add for new chats), plus a
  visible "Will link to existing lead {name}" or "No lead yet: a lead is created only when you choose" line.
- Keep the required `InputGroup` format; move the number hint into the group's addon text.

## Backend items that gate parts of the UI (from the review's "Architecture corrections")
| Finding | UI consequence |
|---|---|
| Legacy WhatsApp switch can authorise replies when Inbox Reply is L0 | Do **not** ship the "Observe only" label until one effective autonomy policy controls all sends |
| `max_turns_per_conversation` (40) can never trigger under a 20-message context cap | Fix, then show "Assistant handed off after X messages" |
| `escalate_after_failed_turns` is not read at runtime | Remove from Admin UI or implement first |
| Working-hours follow-up setting doesn't restrict sends | Do not offer automated follow-ups yet |
| Queue counts come from loaded list | Use server aggregates (Phase 2.1) |
| Reopen on customer reply | Show "Reopened by customer" in timeline |
| "Save to Documents" primitive has no button | Phase 1.5 |

## Data model changes
Likely **None** for Phases 1–2 (all derived). To confirm in Phase 0:
1. A readable "AI generating now" signal (else drop the "drafting…" state).
2. Routing reason ("Via: Package enquiry routing") on the conversation.
3. Seat-hold expiry readable from the inbox context.
4. Per-queue server counts for every queue in the grouped rail.
Any new column or table ships with RLS in the same migration.

## Access control changes
None new. Reuse `capabilitiesForInbox`: `sendMessage`, assign, `canUseCopilot`, `canCreateBooking`,
`canSelectDepartureGroup`, `canConvertConversation`. `clearAllChats` is removed from the rail; its server check stays
until the retention task replaces it.

## UI surfaces touched
`components/header-inbox-launcher.tsx`, `header-inbox-dialog.tsx`; in `app/inbox/components`:
`inbox-view-rail`, `inbox-workspace-content`, `conversation-panel` (header), `customer-context-panel`,
`inbox-copilot`, `conversation-offer-card`, `select-departure-group-button`, `attachment-intelligence-card`,
`channel-policy-banner`, `message-composer`, `conversation-convert-menu`, `composer-presence-banner`,
`new-chat-dialog`, plus new files for the mappers, completeness block and status chips.

## Test plan
**Automated (Vitest, `npm run lint && typecheck && test`):**
- Every mapper: ownership-status (all 6 states + null owner), departure-group-status (5 states, expired hold),
  lead-completeness (0/6…6/6, unknown values), reply-window-policy (open/closing/closed/exception boundaries, e.g.
  exactly 2h), next-best-action (each row of the table), offer-state chooser (A–D, stale price disables quote).
- Guard test: no "Confirm payment" action is produced for any payment-proof input.
- Action tests for Save to Documents: unauthorised, wrong agency, invalid traveller.

**Manual, in browser (per the skill's verification list):**
- Tab through the whole overlay; focus is trapped in the dialog and restored to the trigger on close.
- Screen reader reads owner, status, and policy in order; status never conveyed by colour alone.
- 320 / 768 / 1024 / 1440 px; light and dark; reduced motion.
- Loading, empty, error, stale, and no-permission state for each new block.
- No console errors; realtime patch does not cause a skeleton flash on the open chat.
- Compare against `/doc/ui` reference images and design tokens; no colour changes.

## Rollout
Each phase is one PR. Phase 1.1 and 4 are safe to ship immediately. Gate Phases 1.2–2.6 behind the existing
`inbox_queues_v2`-style agency flag if staff need a gradual switch. Keep the old copy reachable for one release only
where a flag is used, then delete it.

## Open questions
1. Is full-page mode a route under `app/inbox` (the folder already exists) or a new path?
2. Where does the purge action live now: a new Data & Retention settings page, or removed entirely?
3. Which role may reassign an owner from the header select?
4. Should "Ask next best question" only draft, or may the bounded agent send it?

## Status
In progress. Phase 1 built (not yet browser-verified or merged):

- 1.1 Done: "Clear all chats" is gone everywhere. The rail button and `ClearAllChatsDialog` were removed first; then, by
  decision, the `clearAllInboxChats` action, the `clearAllChats` capability and its Roles & Permissions key, and
  `lib/inbox/clear-chats.ts` (with its test) were deleted, so nothing can wipe an agency's conversations from the app.
  A stored `clearAllChats` permission row on a custom role, if one exists, is now simply unused. If a purge is ever
  needed it would be a new, separately designed Data & Retention request (Admin, re-authentication, typed agency name,
  delayed execution, audit event). The "⋯" rail menu was **not** added: no destination pages exist yet for its entries.
- 1.2 Done, except the owner `Select`: there is no assign-conversation action to wire it to, so the header shows
  owner and assistant status chips only (`lib/inbox/ownership-status.ts`). "Copilot is drafting…" is not shown because
  no "AI generating now" signal exists. Routing reason ("Via …") deferred for the same reason.
- 1.3 Done for none / recommended / preference / booked (`lib/inbox/departure-group-status.ts`). Seat hold deferred:
  the Inbox context cannot read hold records yet. A booked lead shows the booking reference, not the group name.
- 1.4 Done: readiness gating and the "no matching departure" state in `inbox-copilot.tsx`
  (`lib/inbox/copilot-readiness.ts`); needs-details and human-review modes on the offer card
  (`lib/inbox/offer-card-mode.ts`).
- 1.5a Save to Documents backend built (not browser-verified): `savePassportToDocumentsAction` in
  `app/inbox/actions.ts` copies the passport into the traveller's PASSPORT_BIO checklist item as "submitted"
  (never verified), decisions in `lib/inbox/retention/promote-passport-plan.ts`. New capability
  `saveAttachmentToDocuments` (Inbox view + Documents upload + sensitive-data access). No migration.
  Still open: Assign visa officer, Send acknowledgement, Open Finance review.
- Phase 2 started (built, not browser-verified):
  - 2.1 Rail: every row shows the server count (`viewCounts`), and the grouped rail tucks empty queues behind
    "More queues" (`railQueueVisibility` in `lib/inbox/queues.ts`). The open queue is never hidden. **Not done:** making
    the grouped rail the default; `inbox_queues_v2` is a per-agency database flag, so that is a migration/rollout decision.
  - 2.2 "Details collected" checklist with an "Ask about …" draft (`lib/inbox/lead-completeness.ts`). Five items, not
    six: journey type is left out because chat leads default to Umrah.
  - 2.4 Reply-window banner counts down, warns at 2 hours, and says what to do when closed
    (`lib/inbox/reply-window-notice.ts`). No "Draft reply" button yet: it needs the composer to expose its suggest action.
  - 2.5 Composer: tabs are Reply / Internal note; "Draft with Copilot" sits beside Send; "Create quote" and every
    task/case conversion moved under "More actions" (the existing convert menu, now with a compact composer variant).
    Copilot's suggested next step (`lib/inbox/next-best-action.ts`) gets the prominent button and a one-line reason:
    payment claim → payment follow-up, complaint/refund → complaint case, visa → visa task, documents → document
    request, price request with a current offer → create quote, else draft a reply. Rule-only risk signals are ignored
    while risk is still in shadow mode, so staff are never steered by something they cannot see.
  - 2.6 Evidence: the offer card has a "Why this matches" expander (`lib/inbox/offer-match-reasons.ts`) that says
    "Based on limited information" when nothing solid backs the recommendation; risk reviews now read "Why: …".
    Facts and flags already had the "Why?" popover.
  - 2.3 Panel reorder built (not committed): the human-review cards stay at the very top, then the customer and lead
    details, "Details collected", Copilot's reading (facts, travel details, best departure, flags), departure
    suggestions, travel interest, booking, follow-up, and "Turn into work". `ConversationIntelligenceRail` takes a
    `part` ("risk" | "reading" | "all") for this split. Not done: the "Conversation history" timeline block, which has no
    data source yet, and moving the technical Copilot details into a collapsed section. Not done from the plan: the "Attach" button (brochure links stay as a select), "Take over anyway"
    on the presence line, and a warning before replying takes ownership from another staff member.
- Phase 4 built (not committed): new-chat dialog uses the `InputGroup` format for every field including the template
  picker, the number hint is in the field's label, and the preview shows the template category and projected Meta charge
  (`lib/inbox/template-charge-label.ts`, shared with the in-chat template picker). **Not done:** the "Will link to
  existing lead {name}" line, which needs a server lookup by number before sending.
- 1.2 owner control built (not committed): `assignConversationAction` + `ConversationOwnerSelect` in the thread header for
  roles with `assignConversation`. Assigning pauses the assistant; "Unassigned" on a staff-owned chat returns it to
  "waiting for staff" (`lib/inbox/assignment.ts`). The server only accepts active staff whose role can reply in the Inbox.
  The new owner gets a bell notice (existing `WORKFLOW_CREATED` kind, so no migration) and an `OWNER_CHANGED` row is
  written to `conversation_events` with the owner before and after and who changed it. Both are best effort and never
  undo the assignment. Nothing in the UI reads `conversation_events` yet, so the change does not appear on the thread timeline.
- 3.1 Full-page Inbox built (not committed, not browser-verified): the overlay's load/sync component moved to
  `app/inbox/components/inbox-workspace-controller.tsx` and is shared by the overlay and the new `/inbox` page
  (`page.tsx`, gated on `viewModule`). `/inbox?conversation=<id>&view=<view>` opens a chat directly (`lib/inbox/page-request.ts`;
  the address is validated), which also fixes existing `/inbox?...` links that had no page. The overlay rail offers "Open
  full page"; the overlay closes on navigation and, when already on `/inbox`, an "open this conversation" request updates
  the page address instead of opening a second Inbox. **Not done:** saved queue views, bulk actions, keyboard navigation,
  and deeper search. On the page the address follows the open chat and queue (`history.replaceState`), so a refresh or a
  shared link returns to the same place.
- 1.5 Partly done: payment proof shows "Not verified" and never offers confirm; passport shows Saved / Not saved to
  Documents; voice transcripts are labelled as automatic. **Not done:** the Save to Documents, Assign visa officer,
  Send acknowledgement and Open Finance review buttons. The existing primitive only marks an attachment as promoted
  after a Documents record exists; creating that record (copy the object, add to the checklist) is new
  security-sensitive backend work and needs its own slice.
