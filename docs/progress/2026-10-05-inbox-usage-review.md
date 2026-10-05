# Inbox usage review — 5 October 2026

A point-in-time record. It was written while producing the plain-language
[Everyday User Guide](../usages/inbox/everyday-user-guide.md) and lists what was
found when every Inbox screen was compared with the code.

## How this was checked

- Read the full-page route (`app/inbox/page.tsx`, `layout.tsx`), every component in
  `app/inbox/components/`, all Server Actions in `app/inbox/*.ts`, and the pure rules
  in `lib/inbox/*` (queues, views, shortcuts, channel policy, composer state, bulk
  actions, assignment, risk interventions, conversions, media routing, next best
  action), the role files in `lib/access/*`, and the admin settings forms under
  `app/(main)/management/`.
- The role matrix in the guide (§24) was **computed from the code** with a throwaway
  Vitest file that called `capabilitiesForInbox` and `capabilitiesForLeads` for every
  role. The file was deleted afterwards; the working tree was clean.
- **Not done:** the app was not run in a signed-in browser, the full test suite was not
  run, and no live channel (WhatsApp/Messenger/Instagram/email) was exercised. Anything
  that depends on live data, plan entitlements, feature flags or provider behaviour is
  described from code only.

## 1. Where the older guides no longer match the screen

These are documentation errors, not code defects. The new guide follows the screen.

| # | Older statement | What the code does now | Evidence |
|---|---|---|---|
| D1 | `usage-guide.md` §4.2: each list row shows "state, lead stage". | The state chip and lead-stage badge are **commented out**. The row shows avatar, name, age, preview, unread badge. Lead stage and status appear only in the **hover card**. | `app/inbox/components/conversation-list.tsx:460-476`, `lib/inbox/conversation-peek.ts` |
| D2 | `usage-guide.md` §4.3/§7 and `usage.md` §3: a **Draft with Copilot** button sits in the composer. | The composer's button is **commented out**. "Draft with Copilot" now exists only as the default **Recommended next action** button (and **Draft reply** in the closing-window banner / offer card). | `message-composer.tsx:605-625`, `lib/inbox/next-best-action.ts:75` |
| D3 | `usage-guide.md` §7: staff can translate an individual inbound message. | The per-message **Translate** control is **commented out** in the thread. Only **Translate conversation summary** remains in the Copilot reading. | `conversation-panel.tsx:705-710`, `conversation-intelligence-rail.tsx:110-115` |
| D4 | `usage-guide.md` §4.2 and §16.8: right-click **Assign to me** and **Delete** are visual placeholders. | No right-click menu exists in the list any more. | `grep` for `ContextMenu` / `onContextMenu` in `app/inbox/components` returns nothing |
| D5 | `usage-guide.md` §6.4 says voice notes show **no** transcript; §16 point 3 says they can show one. | Both cannot be true. The panel renders a **Staff only** transcript when the `inbox_voice_transcript` surface is on and a transcript exists. §6.4 is stale. | `conversation-panel.tsx:662-673`, `voice-transcript-panel.tsx` |
| D6 | `usage-guide.md` §13 and `staff-guide.md`: Marketing and Operations are treated alike for sales work. | **Operations cannot** create leads, select a departure group, create a booking or draft quote, or schedule a follow-up, and does **not** have Copilot. Only **Admin and Marketing** can. | `lib/access/leads-access.ts` (`createLead`, `createQuoteDraft`, `convertToBooking`, `findGroups`, `logContact`, `useCopilot`) |
| D7 | `usage-guide.md` §6.2 and `finance-evidence-guide.md` read as if any staff member can route a receipt to Finance. | **Copy to Finance** is allowed only for **Admin, CEO and Finance**. Marketing/Operations need `viewLedger`, which they do not have, so they see a "not allowed" note. | `lib/finance/finance-evidence.ts:87-95`, `lib/data/inbox-repository.ts:225-235` |
| D8 | `staff-guide.md` shortcut table: `q` "Start a **draft** quote". | `q` only **focuses** the **Create quote** button. It never presses it. | `lib/inbox/shortcut-targets.ts` (`START_QUOTE` branch) |
| D9 | `usage.md` §3 step 4: "**Draft reply** … grounded suggestion". | The offer card's **Draft reply** is correct, but it disappears (with **Create quote**) when the offer is in "Human review required" mode. | `conversation-offer-card.tsx:182-227`, `lib/inbox/offer-card-mode.ts` |
| D10 | `usage-guide.md` §4.1 lists Messenger/Instagram "support case" without saying what it is. | There is **no separate support-case record**. The UI and the send check both use an **open review** of one of five kinds: complaint, distressed customer, fraud concern, medical urgency or refund request. | `lib/data/inbox-repository.ts:62`, `app/inbox/actions.ts:2172-2176` |

## 2. Possible defects and rough edges found

Severity is a judgement for a travel agency's daily use. None were fixed here; this task
was documentation only. Each needs a decision from the owner of the module.

| # | Severity | Finding | Evidence | Suggested next step |
|---|---|---|---|---|
| B1 | **Medium** (**fixed** on branch `fix/inbox-new-chat-takeover`) | **Starting a chat with a contact that already has a conversation silently takes it over.** `startWhatsAppChat` and `startEmailConversation` upsert on `(agency, channel, external id)` and write `state = HUMAN_ACTIVE` and `assigned_to = the sender`. A conversation owned by a colleague, or **closed**, is reopened and reassigned with no warning and no `OWNER_CHANGED` history row. | `app/inbox/actions.ts:985-1001`, `1095-1110` | Look up an existing conversation first; if it exists, open it instead of overwriting owner/state, or ask for confirmation. Add a Vitest case. |
| B2 | Low | **The follow-up button always creates a "WhatsApp" follow-up**, whatever the channel (email, Messenger, Instagram). | `app/inbox/components/conversation-followup.tsx:51` | Choose the follow-up type from the conversation's channel, or offer a type picker. |
| B3 | Low | **Review buttons are shown to roles that cannot use them.** CEO and Visa cannot close any review, but still see I am on it / Resolve / Dismiss and only get an error after typing a note. The "Only Finance or an Admin can close this" hint is computed as if the viewer were Marketing. | `conversation-intervention-card.tsx`, `lib/inbox/intelligence/rail-view.ts:202`, `lib/inbox/risk/interventions.ts` (`canCloseIntervention`) | Pass the viewer's role into the rail view and hide or disable the buttons. |
| B4 | Low | **Staff see developer wording in an error.** The draft refusal reads "Inbox autonomy is at **L0 Observe**. Move to **L1 Assist**…", while administrators see **Observe only / Draft replies**. | `app/inbox/actions.ts:1752`, `lib/inbox/autonomy/labels.ts` | Use `autonomyLevelName()` and say "Ask an administrator to switch on Draft replies." |
| B5 | Low | **Marketing/Operations cannot route a receipt to Finance** even on their own chat, although they are the people who receive receipts. The only path is a note plus a mention. | `lib/finance/finance-evidence.ts:87-95` | Decide whether the chat's owner may copy a receipt (the helper already takes `assignedToId`, but then also requires `viewLedger`). |
| B6 | Low | **Template sends skip the protection gate.** `sendStaffMessage` runs `evaluateProtection`; `sendConversationTemplateAction` and `startWhatsAppChat` do not. Templates are pre-approved text, so the risk is low, but a blocking review (e.g. payment claim) does not stop a template that says "payment received". | `app/inbox/actions.ts` (compare `sendStaffMessage` ~2147 with `sendConversationTemplateAction` ~1146) | Confirm intent; if unintended, run the same gate on the rendered template text. |
| B7 | Low | **Bulk Close has no confirmation and no undo**, while bulk Mark as spam confirms. | `app/inbox/components/bulk-selection-bar.tsx` | Add a confirm step like spam, or an Undo toast. |
| B8 | Info | **Expired or missing attachments read as "Loading photo…"** forever (the component cannot tell "still arriving" from "gone"). It polls about a minute, then stops, leaving "Loading…". | `app/inbox/components/inbox-message-media.tsx:22-52` | Distinguish expired/failed from pending and say so. |
| B9 | Info | **Two controls carry the `q` shortcut** (offer card and recommended-action card). It focuses the first enabled one only. Harmless, but which one gets focus depends on DOM order. | `conversation-offer-card.tsx:209`, `recommended-next-action-card.tsx:150` | None needed; note for UI tests. |
| B10 | Info | **Operations does not get Copilot** but sees the reading's red review cards and recommended next action. The "Draft with Copilot" action then reads "Your role cannot use Copilot to prepare a reply." | `recommended-next-action-card.tsx:50-56` | Confirm this is the intended role design. |

## 3. Behaviour that surprises first-time users (documented in the guide)

- Opening `/inbox` auto-opens the **first chat** and marks it read (desktop widths).
- Sending a staff reply on a chat that is not already person-owned makes the sender the owner.
- Unassigning a person-owned chat turns it into **Staff action needed**.
- Instagram carries photos only; WhatsApp videos, locations, stickers, contacts and orders are never stored and the customer gets an automatic "not supported" notice.
- Messenger/Instagram have **no template** to reopen a closed 24-hour window; the only exception is a person-written reply on a chat with an open complaint/distress/fraud/medical/refund review, inside seven days.
- In a non-production environment the outbound allow-list, and in a test agency the send guard, refuse real sends.

## 4. Follow-up

- Fix B1 first (it can reassign real customer conversations).
- Update or retire the stale statements D1–D10 in `docs/usages/inbox/usage-guide.md`, `docs/inbox/usage.md` and `docs/inbox/staff-guide.md`, or point them at the new guide.
- A signed-in browser pass against the new guide (the checklist in §21 "Real-life scenarios") would turn the code-only statements into verified ones.
