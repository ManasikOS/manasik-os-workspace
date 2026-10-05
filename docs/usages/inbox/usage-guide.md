# Manasik Inbox: Practical Usage Guide

> **Audience:** agency staff, team leads, Finance/Visa reviewers, administrators, and owners
>
> **Code review date:** 2026-09-29
>
> **Scope:** the current Inbox UI and its connected channel, Copilot, media, workflow, routing, SLA, retention, and CRM code

> **Newer, plain-language version:** for staff who are not technical, use the [Everyday User Guide](everyday-user-guide.md). It was re-checked against the screens on 2026-10-05; a few statements below are out of date (see [the review record](../../progress/2026-10-05-inbox-usage-review.md), items D1–D10).

## 1. What the Inbox is meant to achieve

Manasik Inbox is the agency's shared workspace for WhatsApp, Messenger, Instagram, and email conversations. It is not only a message reader. It turns incoming conversations into an ordered work queue, adds evidence-backed assistance, and connects the customer's words to the agency's operational records.

Used well, the Inbox should produce six outcomes:

1. **No enquiry is lost.** New messages, waiting replies, overdue work, document matters, payment discussions, complaints, and urgent cases have explicit queues.
2. **Staff respond faster without surrendering judgement.** Copilot reads intent, urgency, sentiment, language, travel details, and possible risks, then offers editable drafts or a suggested next action.
3. **Sales replies stay grounded.** Suggested departures, prices, seats, room types, and inclusions come from CRM records. Price and seat availability are checked again before quote-related actions.
4. **Sensitive files become controlled work.** A passport or receipt is treated as candidate evidence, not as an approved fact. The system highlights uncertainty and routes the required human review.
5. **Conversation decisions become traceable CRM work.** Leads, draft quotes, bookings, follow-ups, document requests, visa tasks, payment tasks, complaints, seat holds, and handoffs can point back to the source conversation and message.
6. **Automation remains bounded.** Channel policy, permissions, open reviews, current CRM facts, and hard-coded safety rules are checked outside the language model.

The operating principle is:

> **The CRM is the source of truth. Copilot interprets the conversation and writes suggestions; it does not invent commercial, financial, visa, medical, religious, or operational facts.**

The human messaging workspace remains usable when AI features are disabled or unavailable.

## 2. Understand the three layers

The word “AI” can refer to different behavior in this system. Keep these layers separate when configuring or troubleshooting the Inbox.

| Layer | What it does | Can it contact the customer? |
|---|---|---|
| **Inbox** | Stores conversations, applies channel rules, handles ownership, notes, attachments, delivery state, queues, search, and CRM actions | Staff messages use this layer |
| **Copilot intelligence** | Reads intent, urgency, sentiment, language and travel details; matches offers; raises risks; proposes next actions and editable drafts | Only according to the configured autonomy level and final send gate |
| **Channel AI agent** | Runs an automated conversation on supported messaging channels using tools, knowledge, guardrails, and handoff rules | Yes, when the channel agent and applicable AI surface are active |

Changing Inbox autonomy does not necessarily disable an older channel-agent configuration. Before go-live, an administrator should verify both the Inbox autonomy setting and every connected channel's assistant setting.

## 3. Before staff begin

An administrator should complete the following setup.

1. Connect each required channel and verify a real inbound and outbound message.
2. For WhatsApp, synchronise approved templates. A business-started chat and a reply after the 24-hour window require a template.
3. For email, connect a mailbox with IMAP enabled before using **Compose email**.
4. Publish current knowledge, packages, inclusions, prices, departure groups, room pricing, and availability. Copilot cannot safely recommend information that is missing or stale in the CRM.
5. Configure automatic assignment, staff shifts and leave, SLA targets, working hours, and holidays under **Management → Settings → Operations**.
6. Configure attachment and message retention under **Management → Settings → Data**.
7. Configure the assistant persona, languages, knowledge, capabilities, and Inbox autonomy under **Management → AI agent**.
8. Start automation in **Observe only** or **Draft replies**. Review real evidence before increasing autonomy.
9. Confirm staff roles. UI visibility is not permission to perform a protected action; the server checks the user's role, agency, and owning module again.

### Recommended rollout

1. Start with staff-only messaging and deterministic queues.
2. Enable Copilot reading in shadow/observe mode and review its triage and warnings.
3. Enable editable drafts after the knowledge and offer data are trustworthy.
4. Enable only the narrow approved automatic replies after the promotion blockers are clear.
5. Add bounded lead intake last, and keep booking confirmation, payments, refunds, discounts, visa outcomes, and sensitive advice human-owned.

The live programme checklist still marks several end-to-end exits and production measurements as pending. Treat an implemented feature as environment-dependent until its entitlement, surface setting, migrations, channel connection, and live verification are confirmed.

## 4. Workspace tour

Open **Inbox** from the CRM. The workspace has four practical regions.

### 4.1 Queue rail

The rail is the daily work plan. Empty specialist queues are tucked behind **More queues**; the core working queues remain visible.

| Group | Queue | Use it for |
|---|---|---|
| Inbox | All conversations | Broad review of open work |
| Inbox | Assigned to me | The individual operator's working list |
| Inbox | Unassigned | Conversations that need an owner |
| Inbox | Needs a reply | The customer wrote last |
| Inbox | Waiting for customer | Staff replied last |
| Inbox | Waiting for our team | A colleague or review is still required |
| Inbox | Closed | Completed conversations |
| Inbox | Spam | Conversations marked as spam, or linked to spam leads (see [spam-state-contract.md](../../inbox/spam-state-contract.md)) |
| Sales | New enquiries | First-time trip enquiries |
| Sales | Qualified | Traveller, date, and room details are sufficiently known |
| Sales | Ready to book | The customer has agreed and needs booking work |
| Sales | Quote sent | A quote is with the customer |
| Needs attention | Urgent | Blocking or urgent human work |
| Needs attention | Complaints | Complaint, cancellation, or refund-related work |
| Needs attention | Payments | Payment discussion or unverified payment proof |
| Needs attention | Documents | Passports, photos, or documents are involved |
| Needs attention | Visa questions | Visa-related enquiries |
| Needs attention | Nearing deadline | A reply target or channel window is close |
| Needs attention | Overdue | A reply target has been missed |
| Channels | WhatsApp, Instagram, Messenger, Email | Work by provider |

**Departure changes** and **Group changes** exist in the catalogue but are intentionally hidden because their queue predicates are not implemented yet.

### 4.2 Conversation list

Each row shows the contact, channel, latest message preview, unread count, state, lead stage, and recent activity. Use the search box to search beyond the currently loaded page, and use **Load older chats** when needed.

Useful habits:

- Save recurring queue/search combinations as saved views.
- Use **Select conversations** to assign or close up to the supported bulk limit.
- Do not rely on the visible row count as a permanent total; lists are paginated.
- The current right-click **Assign to me** and **Delete** rows are visual placeholders without wired actions. Use the owner control, bulk actions, or the conversation menu instead.

### 4.3 Conversation thread and composer

The thread contains customer, staff, assistant, system, and internal-note events. Outbound messages show **Sending**, **Sent**, **Delivered**, **Read**, or **Failed**. A failed optimistic send exposes **Retry** and **Dismiss**; retry uses the same idempotency key so a committed first attempt is not duplicated.

The composer supports:

- customer replies;
- internal notes and staff mentions;
- saved replies;
- editable Copilot drafts;
- image, document, and audio attachments;
- selecting a document from the document vault;
- email subject, Cc, and Bcc fields;
- automatic draft saving while staff type;
- a presence warning when another colleague is composing.

Press **Enter** to send and **Shift+Enter** for a new line. An internal note is never sent to the customer.

### 4.4 Customer and intelligence panel

The context panel brings together:

- open human reviews, placed at the top;
- the linked lead or a possible identity match;
- missing lead details;
- Copilot's intent, urgency, sentiment, language, evidence, and confidence;
- structured travel details;
- a live-matched departure and alternatives;
- lead, booking, outstanding balance where permitted, and follow-up;
- booking handoff;
- actions that turn the conversation into CRM work;
- the conversation's history.

Select **Why?** on an intelligence fact to inspect the customer message used as evidence. Low-confidence facts are prompts to verify, not facts to copy into the CRM.

## 5. The most efficient daily workflow

### Start of shift

1. Open **Assigned to me**.
2. Clear **Urgent**, **Complaints**, **Payments**, and **Overdue** before routine enquiries.
3. Check **Unassigned** if you coordinate the team.
4. Use **Needs a reply** as the main processing queue.
5. Scan **Nearing deadline** during the shift so a provider reply window does not close unnecessarily.

### For each conversation

1. **Read the channel-policy banner first.** It determines whether free text, a WhatsApp template, a human support reply, or no send is allowed.
2. **Check ownership.** Assign the conversation or take control. Sending a staff reply takes control and can reassign a conversation currently owned by a colleague.
3. **Read human-review cards before drafting.** A blocking card may prohibit a claim such as “payment received” even when ordinary communication remains possible.
4. **Verify the customer identity.** Link only when the evidence is strong enough. A similar name is not sufficient.
5. **Review Copilot's evidence and confidence.** Correct the triage reading when it is wrong; that review becomes measured evidence for future autonomy decisions.
6. **Complete the missing sales facts.** Traveller count, dates/period, origin, room type, passport readiness, and contact details produce better offer matches.
7. **Use the proposed next action.** Draft a reply, create a quote, request documents, open a complaint case, or create the relevant task—but review the result.
8. **Send or create work.** Re-read outward-facing text. Preview workflow conversions before confirming them.
9. **Leave an internal note when another team owns the next step.** Mention the colleague if a direct notification is needed.
10. **Close the conversation only when no customer or team action remains.** A new inbound message reopens a closed conversation and retains its routed owner.

### End of shift

1. Move conversations out of **Unassigned**.
2. Ensure acknowledged reviews have an owner and next step.
3. Leave notes on unresolved payment, document, visa, complaint, and booking cases.
4. Check **Nearing deadline** and **Overdue** again.
5. Hand confirmed bookings to Operations with the saved handoff snapshot.

## 6. How intelligent document and media handling works

Media processing happens in the background. The customer message is stored first; document analysis must not delay receipt of the conversation.

Accepted inbound families are images, supported documents, and audio. Video, archives, executables, and unknown types fail closed and may receive an unsupported-type notice. Originals are private and exposed to staff through short-lived signed links.

### 6.1 Passport image or PDF

The system may classify an image or PDF as a passport and extract candidate values such as:

- passport number;
- expiry date;
- full name;
- extraction confidence.

It then compares the candidate against travellers connected to the conversation's booking and the agency's passport-validity rule.

**Staff procedure**

1. Open the original image/PDF; do not rely only on the extracted fields.
2. If several travellers are possible, select the correct traveller.
3. Review fields below 90% confidence and any highlighted mismatch.
4. Check expiry against the departure date and required validity period.
5. Edit the passport number or expiry when necessary, then confirm. Only this explicit confirmation writes the values to the traveller record.
6. Assign a visa officer if the control is available and the file needs visa follow-up.
7. Select **Save to Documents** when the passport must become part of the traveller's formal checklist.
8. Continue verification in the Documents module. Saving creates a submitted document; it does **not** verify or approve it.
9. Resolve or dismiss the review with a meaningful note after the required work is complete.

**Important constraints**

- The button is currently passport-specific; a receipt or arbitrary document cannot be promoted through this Inbox action.
- A target traveller, an existing passport checklist item, the retained Inbox file, and the required permissions must exist.
- Multi-traveller bookings require an explicit traveller selection.
- If the passport is not saved to Documents, the Inbox copy expires according to the attachment retention policy.

**Outcome:** a sensitive document reaches the right traveller and normal verification workflow without silently changing a person record.

### 6.2 Payment receipt or transfer slip

The system may extract a candidate amount, reference, and payment date. It always opens a blocking, Finance-owned payment review.

**Staff procedure**

1. Open the original receipt.
2. Use **Send acknowledgement** only as a draft; read and edit it before sending.
3. Select **Open Finance review** when permitted.
4. Finance checks the bank or payment ledger and records the payment through the Finance workflow.
5. Finance or an administrator resolves the review with a note.
6. Only after Finance verification should staff confirm the payment to the customer.

The receipt is proof of a **claim**, not proof of settlement. Receipt analysis never creates, allocates, verifies, or confirms a payment. The current Inbox UI does not save receipts into Documents.

**Outcome:** the customer's evidence is preserved and routed without corrupting the financial ledger or making an unsafe promise.

### 6.3 Brochure, itinerary, Office file, or other document

- Images and PDFs can be classified as passport, receipt, brochure, or other when media intelligence is enabled.
- Brochure/other summaries may be stored by the background analysis, but the current thread renders a dedicated review card only for passports and receipts.
- Word, Excel, PowerPoint, text, and CSV files are retained and can be opened, but the current media-reading model does not extract fields from them.
- Staff should open the original, decide its business purpose, and create the appropriate task or note.

**Outcome:** useful files remain accessible in the conversation, while the system avoids pretending it understood an unsupported document format.

### 6.4 Voice note

The Inbox retains supported audio and shows an audio player. The current Inbox media worker records the voice analysis as ready but does not persist or display a transcript or summary in this UI.

Listen to the original. Confirm important names, numbers, dates, passport details, payment facts, and commitments in writing with the customer. If audio playback fails, the UI renews the short-lived link once and asks the user to press Play again.

**Outcome:** staff keep access to the original message without treating an absent or uncertain transcript as authoritative.

### 6.5 When analysis is missing or fails

Possible causes include disabled plan entitlement, unsupported MIME type, provider download failure, storage failure, model failure, or exhausted retries.

Do not wait for AI when the customer needs a response. Open the original, handle the conversation manually, add an internal note, and route the work. Administrators can inspect the media/worker operations runbook and job status.

## 7. Using Copilot safely and efficiently

### Read the status honestly

The panel distinguishes:

- **Copilot is reading this conversation** — processing is pending;
- **Read by Copilot** — a model-derived reading exists;
- **Keyword reading** — rules, not a model, produced the reading;
- **This reading may be out of date** — recheck the latest messages;
- **Copilot did not read this conversation** — it was skipped, often to avoid unnecessary cost;
- **Copilot could not read this conversation** — use the deterministic facts and work manually.

### Use evidence, not confidence alone

A high confidence score does not replace the message. Select the evidence link, check the actual words, and correct the triage label when needed. A low-confidence value should not be used to update a lead, quote, traveller, or booking without confirmation.

### Use the offer card

The offer card can show a best departure, other options, price per person, estimated total, room type, available seats, inclusions, constraints, and missing information.

- **Draft reply** inserts editable text into the composer.
- **Create quote** creates a draft quote only; it sends nothing.
- **Open group** opens the source departure group.
- **Ask for missing details** prepares a follow-up question.

If seats or pricing changed, or the live check failed, quote/confirmation actions are withheld. Offer age is a reminder; actual staleness is determined by comparing live data with the stored snapshot.

### Treat “Draft with Copilot” as a first draft

Before sending, verify:

- the customer's name and requested journey;
- dates, party and room arrangement;
- price, currency, inclusions, and exclusions;
- live availability;
- channel tone and language;
- any open intervention;
- that the text makes no payment, visa, discount, refund, booking, health, safety, or religious promise.

Substantial edits and rejections are useful evidence; they can prevent unsafe promotion or retire a poor approved answer.

### Translation

Staff may translate an individual inbound message or the stored conversation summary. Translation is generated on demand and is not persisted as the authoritative message. Keep the original visible when making a sensitive decision.

## 8. Channel rules

| Channel | Start a new conversation | Free-form reply | Recovery after normal window |
|---|---|---|---|
| WhatsApp | Yes, with an approved template | Within 24 hours of the customer's message | Use an approved template; review variables, category, preview, and projected charge |
| Messenger | No; customer writes first | Within 24 hours | A staff-written active support reply may use `HUMAN_AGENT` within seven days when an open support case exists; otherwise blocked |
| Instagram | No; customer writes first | Within 24 hours | Same human-support rule as Messenger |
| Email | Yes, from a connected mailbox | At any time | No Meta-style reply window |

The banner is guidance; the server performs the authoritative check immediately before provider contact.

For a new WhatsApp chat, enter the number with country code, review possible lead matches, choose an approved template, fill every variable, inspect the preview and charge, then send. This path links an exact existing lead where appropriate; it does not automatically create a lead merely because a number was entered.

For a new email, use **Compose email**, then supply recipient, subject, body, and optional Cc/Bcc. Copilot is not an autonomous email agent; email remains staff-authored.

## 9. Ownership and team collaboration

- **Take control** moves a supported conversation to staff handling.
- **Hand back to AI** is available only when the conversation and permissions allow it.
- **Assign owner** places responsibility on a staff member; **Unassigned** returns it to the team queue.
- Sending a staff message takes control and may assign the conversation to the sender.
- Composer presence is a warning, not a hard lock. If two people continue, both can still send.
- Use internal notes for decisions, checks, and context. Use mentions when a named colleague must act.
- Use bulk assignment/close for a bounded selection, not as a replacement for reviewing risky conversations.

Automatic routing is owner-sticky first, then skill/role and availability, with load balancing as configured. A shift must exist before a staff member can receive auto-assigned work; leave overrides an overlapping shift.

## 10. Turning conversations into work

The context panel can link or create a lead, select a departure group, create a booking, create a draft quote, schedule a follow-up, and create an Operations handoff. The **Create task or case** menu also supports:

| Action | Result | Main prerequisite |
|---|---|---|
| Request documents | Operations task | Departure group selected |
| Create visa task | Visa task | Departure group selected |
| Follow up on payment | Finance task | Departure group selected |
| Rooming request | Operations task | Departure group selected |
| Transport requirement | Operations task | Departure group selected |
| Escalate to guide | Guide task | Departure group selected |
| Open complaint case | Support case | Traveller profile exists |
| Create traveller profile | Traveller profile | Lead exists and has no profile |
| Record family or mahram link | Traveller relationship | Booking with at least two travellers |
| Hold seats | Time-limited seat hold | Lead, selected group, phone, and no existing booking/hold |
| Recommend a package | Lead recommendation | Lead exists |
| Request post-trip feedback | Marketing task | Departure group and available survey choice |

The menu shows unavailable actions with the missing prerequisite. The workflow is deliberately two-step: enter details, select **Review**, inspect **Check before creating**, then select **Create**. Cancelling after preview dismisses the proposal. Double confirmation is guarded against duplicate creation.

Selecting a departure group records intent; it does not reserve inventory. A seat hold is not a confirmed booking and expires under the group's hold policy. A draft quote is not sent. A booking created from the Inbox follows the booking module's validations and starts in its guarded status.

For a confirmed booking, create an **Operations handoff**. It is a point-in-time snapshot of customer/booking facts, expectations, and open items. Later changes do not rewrite what Sales handed over.

## 11. Human reviews and protection gates

Risk checks include unverified payment claims, unapproved bank details, stale prices, full groups, passport expiry, closing channel windows, concurrent composers, low-confidence drafts, sensitive documents, minors or assistance needs, and unrecorded booking claims. Model-assisted checks can cover complaints, fraud concern, medical urgency, and religious-ruling requests when enabled.

When a review appears:

1. Read **Why** and **What to do**.
2. Select **I am on it** to acknowledge ownership.
3. Perform the check in the source module—the Inbox card is not the financial, booking, document, or visa ledger.
4. Select **Resolve** and record what was found, or **Dismiss** and explain why the warning is not applicable.

Blocking reviews protect the guarded claim. For example, staff can still acknowledge receipt of a payment slip, but cannot state that the payment is confirmed until Finance verifies it. Money reviews can be closed only by Finance or an administrator.

## 12. Autonomy levels

| Level | Admin label | Practical behavior |
|---|---|---|
| L0 | Observe only | Reads and measures; no Inbox autonomous reply |
| L1 | Draft replies | Produces editable proposals for staff |
| L2 | Safe automatic replies | May send approved greetings, FAQs, and qualifying questions within the measured scope |
| L3 | Lead intake assistant | Collects bounded trip details and hands the conversation to staff |

The effective level is the lowest allowed by the plan, the configured surface, current evidence, channel state, and conversation safety state. Unsafe performance can demote the level automatically.

At every level, automation must not:

- confirm a payment;
- promise visa approval;
- grant a discount;
- guarantee or hold unavailable seats/rooms;
- make a material booking change;
- send unapproved bank details;
- commit to a refund or cancellation;
- issue a religious ruling;
- give health or safety advice;
- close a complaint;
- send a marketing broadcast.

A staff member may handle these topics through the correct approved process; they are excluded from autonomous replies.

## 13. Roles and practical permissions

| Role | Typical Inbox access |
|---|---|
| Admin | Full Inbox operation, assignment, conversion, saved replies, retry, and configuration; additional module permissions still apply |
| Marketing | View, send, take/release control, close, assign, convert, and manage saved replies |
| Operations | View, send, take/release control, close, assign, convert, and manage saved replies |
| CEO | View-only Inbox overview by default |
| Finance | View-only Inbox by default; may open the payment ledger and close Finance-owned payment reviews through Finance permissions |
| Visa | View-only Inbox by default; passport/visa actions depend on Visa and sensitive-data permissions |
| Guide | No Inbox module access by default |

Passport actions have extra gates: sensitive traveller-data access, Documents upload rights, pilgrim-edit rights, or Visa assignment rights. Quote, booking, lead, and conversion actions likewise use the owning module's permissions.

### Role guides

Short, role-specific versions of this guide: [staff](../../inbox/staff-guide.md), [admin and managers](../../inbox/admin-guide.md), and [Finance evidence](../../inbox/finance-evidence-guide.md). Keyboard shortcuts are listed by pressing **?** in the Inbox. Managers read outcome figures in **Outcomes**; see the admin guide for what each state means.

## 14. Common operating scenarios

| Scenario | Efficient response | Expected outcome |
|---|---|---|
| New package enquiry | Check Copilot evidence, complete missing party/date/room facts, review the offer card, draft and edit a reply | Faster grounded response; conversation enters the appropriate sales queue |
| Customer asks for a price | Confirm current offer check, create a draft quote, review the source group and inclusions | No stale or invented price is sent |
| Customer asks for a discount | Take control or hand off; use the authorised sales process | Automation makes no discount promise |
| “I paid” with a slip | Acknowledge receipt without confirming payment, open Finance, verify, then resolve | Payment ledger remains authoritative |
| Passport photo is clear | Select traveller, compare original, confirm fields, assign visa officer if needed, save to Documents | Traveller record/document checklist updated only by explicit staff actions |
| Passport expires too soon | Keep the review open, request a renewed passport, create a visa/document task | Risk stays visible until addressed |
| Same customer on two channels | Inspect identity evidence; link or keep separate | Cross-channel history improves without an unsafe automatic merge |
| WhatsApp window closed | Use the template picker and review projected charge | Compliant re-engagement; a reply opens a fresh service window |
| Instagram/Messenger on day three | Use a staff-written HUMAN_AGENT reply only for a genuine open support case | Compliant support continuation; automation remains blocked |
| Voice note arrives | Play the original and confirm consequential details in text | No reliance on a missing transcript |
| Two staff open the same chat | Read the presence warning, coordinate in a note, agree who owns the reply | Reduced duplicate or contradictory replies |
| Send fails on a weak network | Read the failure, select Retry once | Idempotent retry avoids a duplicate customer message |
| Customer is ready to book | Verify lead/group/phone, create booking or hold through the guarded action | Capacity-safe CRM record linked to the conversation |
| Complaint or refund request | Open/acknowledge the review, create a complaint case, assign ownership | Traceable human resolution; assistant does not close the complaint |
| Confirmed booking moves to Operations | Create the handoff snapshot and have Operations acknowledge it | Clear transfer of expectations and open work |

## 15. Troubleshooting

### Copilot shows no reading

The surface may be off, still pending, skipped to save cost, unavailable under the plan, or failed. Use the message thread and CRM facts; do not block service on AI completion.

### No matching departure appears

Confirm the lead is linked and has enough travel facts. Then check that the package/group is published and sellable, room pricing exists, dates and journey match, and enough seats remain.

### A quote action is unavailable

The live offer may have changed, the group may be closed/full, the room or party details may be incomplete, or the conversation may not be linked to a lead.

### The composer is disabled

Read the channel-policy banner. Common causes are a closed provider window, no eligible WhatsApp template, no open Messenger/Instagram support case, insufficient permission, another conversation state, or a disconnected channel.

### A passport has no Save to Documents button

Check that the analysis classified it as a passport, a traveller can be resolved, the booking has an eligible passport checklist item, the retained file still exists, and the user has both sensitive-data and Documents upload permissions.

### A document has no AI fields

Media intelligence may be disabled, the job may still be running, the file may be an Office/text format retained without extraction, or the classifier may have judged it brochure/other. Open the original and process it manually.

### A payment review cannot be closed

Finance or an administrator must verify and close money reviews. Record the actual payment in Finance first.

### A colleague's conversation becomes assigned to me

Sending a staff reply takes control; this is intentional. Coordinate before replying when the ownership badge names another person.

### A closed conversation reappears

The next inbound message reopens it. The routed owner is retained.

## 16. Current limitations and rollout cautions

These points are verified against the current branch and should be considered when training staff:

1. Several Inbox programme slices are implemented but still marked unmerged or awaiting live exit proof in `docs/inbox/checklist.md`.
2. Feature visibility depends on plan entitlements, the `inbox_queues_v2` rollout flag, AI surface settings, applied migrations, and connected-provider state.
3. Voice notes can show a staff-only, machine-made transcript when the `inbox_voice_transcript` AI surface is switched on for the agency; otherwise playback only.
4. The Inbox can promote a reviewed passport to Documents and can save a brochure or ordinary file to Documents. Passports and receipts are never saved to the shared vault; receipts go to Finance as evidence.
5. Office/text documents are retained but not read by the current media model.
6. Brochure/other analysis is not rendered as a dedicated review card in the conversation panel.
7. The **Departure changes** and **Group changes** queues are hidden until their membership predicates exist.
8. The conversation-list right-click **Assign to me** and **Delete** items are not currently wired. Use supported controls elsewhere in the Inbox.
9. Composer presence is advisory, not a send lock.
10. Messenger's hard text limit is recorded in code as believed rather than provider-confirmed; keep manual replies concise.
11. The saved `escalate_after_failed_turns` value is not used by the current runtime; a failed automated turn hands off immediately.
12. Quiet-lead follow-up working-hours enforcement is not implemented in the current follow-up sweep.
13. The classic channel AI agent and the newer Inbox autonomy surface have overlapping configuration; verify both when enabling or disabling autonomous replies.

## 17. Administrator optimisation checklist

Review these monthly, and after any package, channel, or staffing change:

- channel health and provider credentials;
- approved WhatsApp templates and observed charges;
- knowledge freshness and unanswered-question backlog;
- departure status, live seats, room prices, inclusions, and exclusions;
- approved bank-account list;
- passport validity threshold;
- queue SLA targets, business hours, and holidays;
- routing roles, group threshold, staff shifts, and leave;
- Copilot triage/risk review accuracy;
- draft rejection and heavy-edit rate;
- autonomy blockers and audit history;
- AI allowance/degradation state;
- retention sweep results and expiring attachments;
- unresolved payment, document, visa, complaint, and handoff reviews.

Do not measure Inbox success only by message volume. Better indicators are first-response time, overdue work, open blocking reviews, draft acceptance/edit rate, safe handoffs, conversion into traceable CRM records, document review completion, and the absence of incorrect payment/price/visa commitments.

## 18. Source map for maintainers

This guide was reconciled against these implementation areas:

| Capability | Primary source |
|---|---|
| Workspace and controls | `app/inbox/components/*`, `app/inbox/actions.ts`, `app/inbox/dialog-actions.ts` |
| Roles | `lib/access/inbox-access.ts` plus owning-module access files |
| Queues and views | `lib/inbox/queues.ts`, `lib/inbox/views.ts`, queue repositories and SQL membership functions |
| Channel rules | `lib/channels/profile.ts`, `lib/channels/policy-state.ts`, `lib/inbox/composer-state.ts` |
| Outbound safety | `lib/inbox/outbound/*`, `lib/inbox/outbox/*`, `lib/inbox/autonomy/send-gate.ts` |
| Intelligence and offers | `lib/inbox/intelligence/*`, `lib/ai/surfaces/inbox/*`, `lib/copilot/sales/*` |
| Risk and interventions | `lib/inbox/risk/*`, `lib/data/inbox-risk-repository.ts` |
| Media | `lib/inbox/media/*`, `app/inbox/components/attachment-intelligence-card.tsx` |
| Documents promotion | `app/inbox/actions.ts`, `lib/inbox/retention/promote-attachment.ts` |
| Conversions and handoff | `lib/inbox/conversions/*`, `lib/agent/kernel/proposals/kinds/conversation-*`, `lib/inbox/handoff/*` |
| Identity | `lib/inbox/identity/*`, `lib/data/identity-graph-repository.ts` |
| Routing and SLA | `lib/inbox/routing/*`, `lib/inbox/sla/*` |
| Autonomy and entitlements | `lib/inbox/autonomy/*`, `lib/billing/entitlements.ts`, `lib/inbox/feature-availability.ts` |
| Retention | `lib/inbox/retention/*`, `docs/runbooks/inbox-retention-and-deletion.md` |
| Programme status | `docs/inbox/architecture.md`, `docs/inbox/implementation-plan.md`, `docs/inbox/checklist.md` |

