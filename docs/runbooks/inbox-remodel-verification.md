# Inbox remodel: browser verification

The manual check for everything built in [TASK-007](../tasks/TASK-007-inbox-dialog-ux-remodel.md) and
[TASK-009](../tasks/TASK-009-inbox-remodel-remaining-work.md) (branch `upgrade-inbox`). Nothing in those tasks has been
seen running yet: the code is unit-tested, typechecked and linted, but no one has signed in and used it. This is the script
that closes checklist section G.

Follow it top to bottom. Each step says what to do and what you should see. If it does not match, note the step number and
what you saw, and stop that section: later steps in the same section often depend on it.

## 0. Before you start

**Use a non-production project** (staging, or a copy). Several steps send WhatsApp messages, change owners, close chats and
write to travellers' records.

### 0.1 Apply the pending migration

`supabase/migrations/20261203090000_inbox_saved_views.sql` is **already applied** on the Manasik OS project (the table exists;
checked 2026-09-25), although the migration history table records it under a different version number than the file name. On any other environment, apply it first or
Section 9 (saved views) fails. Then check:

```sql
select count(*) from public.inbox_saved_views;   -- 0, and no error
```

### 0.2 People (create or reuse)

| Person | Role | Needed for |
|---|---|---|
| **Admin** | ADMIN | everything |
| **Sales A** | MARKETING | ownership, assign, bulk, notifications |
| **Sales B** | OPERATIONS | receiving assignments, notifications |
| **Finance** | FINANCE | role-gating checks (should not see some buttons) |
| **Visa officer** | VISA | receives a visa file (step 7.4) |

Use two browsers (or one normal and one private window) so Admin and Sales A can be signed in together.

### 0.3 Data you need

1. A **WhatsApp test number** connected to the agency, with at least one **approved template** (for the new-chat steps).
2. A **customer phone** you control that can message that number.
3. One **lead whose mobile equals that customer phone** (for the "will link to" line). Note its name and reference.
4. A **second lead sharing the same mobile** (only for step 3.3; skip it if you cannot create one).
5. A **confirmed booking** on a departure group, with **two travellers**, linked to the lead in (3), and a second booking
   left as a **seat hold** (booking status `HELD`, with a future `seat_hold_expires_at`). Note the booking references.
6. A **passport photo** and a **payment receipt photo** to send from the customer phone.
7. At least **8 conversations** in different states so lists and queues have something in them.

### 0.4 Record your environment

Browser + version, screen size, date, the branch commit (`git log -1 --format=%h`). Write it at the top of your results.

---

## 1. Opening the Inbox

| # | Do | You should see |
|---|---|---|
| 1.1 | Sign in as **Admin**. Click the inbox icon in the CRM header. | The Inbox opens **in a new tab** at `/inbox`, without the CRM sidebar or header. |
| 1.2 | Look at the rail's bottom. | A **Back to the CRM** link. Click it: you land on the dashboard. |
| 1.3 | Go to `/inbox` directly, signed out. | You are sent to the login page. |
| 1.4 | Sign in as **Finance**, open `/inbox`. | The Inbox opens (Finance may view). No **New chat**, no owner dropdown, no **Select conversations**. |
| 1.5 | Sign in as a role with no Inbox access (for example **Guide**), open `/inbox`. | A not-found page. |
| 1.6 | As Admin, open `/inbox?view=payments`, then `/inbox?conversation=<a real conversation id>`. | The first opens the Payments queue; the second opens that chat directly. |
| 1.7 | Open `/inbox?conversation=not-an-id&view=nonsense`. | The Inbox opens on its default view with no error. |
| 1.8 | Pick another chat in the list, then **refresh the page**. | The **address changed** when you picked it, and after the refresh the same chat is open. |
| 1.9 | Open the browser console. | No red errors while doing 1.1 to 1.8. |

**Check the page height (G3):** the Inbox should fill the window exactly, with **no page scrollbar** and nothing cut off at
the bottom. If there is dead space or a second scrollbar, record the window size.

---

## 2. The rail and queues

| # | Do | You should see |
|---|---|---|
| 2.1 | Look at the rail. | Every queue row shows a **count** for the whole agency (not only the open one). Empty queues outside *All, Assigned to me, Unassigned, Needs a reply, Waiting for customer, Waiting for our team* are hidden. |
| 2.2 | Click **More queues**. | The hidden queues appear; the button now says **Fewer queues**. |
| 2.3 | Open a queue that is empty. | It stays visible while open, and the list says "No conversations found." |
| 2.4 | Receive a new customer message (from the customer phone). | A count goes up without reloading. |
| 2.5 | Collapse and expand the rail. | Icons remain, labels hide, tooltips name each item. |
| 2.6 | As Admin, look for **Clear all chats**. | It does **not exist** anywhere in the rail or menus. |

If your agency shows the older, channel-first rail instead, that is the per-agency `inbox_queues_v2` flag being off. Record
it; it is not a failure (checklist item D3).

---

## 3. New chat

| # | Do | You should see |
|---|---|---|
| 3.1 | Click **New chat**. Type only `9477`. | No lead line yet (too short). |
| 3.2 | Type the customer phone in full (with country code). Wait a moment. | Under the number: **"This chat will be linked to {lead name} ({reference})."** |
| 3.3 | (If you set up a second lead with the same mobile.) | **"More than one lead uses this number…"** and no lead names shown. |
| 3.4 | Type a number no lead uses. | **"No lead uses this number yet. Sending will not create one…"** |
| 3.5 | Change the number quickly several times. | The line never shows text for a number you already changed away from. |
| 3.6 | Choose a template. | The preview ends with the **category** ("Marketing message.") and either a projected charge or "no matching Meta rate has been observed yet". |
| 3.7 | Fill every variable, send to your own phone. | The dialog closes, the chat opens as **Assigned to you**, and the message arrives on the phone. |
| 3.8 | Check the labels. | The template picker has its label inside the field (same style as the others); the number field says "WhatsApp number, with country code". |

---

## 4. Thread header: who owns it

Use a chat with an inbound customer message.

| # | Do | You should see |
|---|---|---|
| 4.1 | Open a chat the assistant is handling. | Two chips: an owner chip and **Assistant active**. Never the words `AI_ACTIVE` or "Copilot is replying". |
| 4.2 | Open a chat waiting for staff. | **Staff action needed** with a warning icon (not colour alone). |
| 4.3 | Open a chat staff own. | **Assistant paused**. |
| 4.4 | Open a closed chat. | **Closed**, and **no owner dropdown**. |
| 4.5 | As **Admin**, use the owner dropdown to choose **Sales B**. | A toast "Owner changed". The chat now says paused and Sales B owns it. |
| 4.6 | In Sales B's browser, open the bell. | A notice: "{Admin} gave you the conversation with {customer}". |
| 4.7 | In the Admin browser, open the same chat's **History** (right panel, bottom). | "Owner changed from … to Sales B by Admin". |
| 4.8 | Choose **Unassigned** on a staff-owned chat. | It goes back to **Staff action needed**, not "paused with no owner". |
| 4.9 | As **Finance**, look at the header. | A plain owner chip; **no dropdown**. |
| 4.10 | Choose a person who cannot take chats (Finance) if they appear in the list. | A plain message and nothing changes. |

**Database check (G5):**

```sql
select kind, actor_kind, data, occurred_at
from public.conversation_events
where conversation_id = '<the chat id>' order by occurred_at desc;
-- expect an OWNER_CHANGED row per change, with from/to names and changed_by_name
```

---

## 5. Replying, windows and the composer

| # | Do | You should see |
|---|---|---|
| 5.1 | Open a chat with an open WhatsApp window. | A compact banner: **"Reply window open"** and "Free-form reply allowed for 23h 42m" (the time will differ). |
| 5.2 | Use a chat whose window closes in under 2 hours (or set `service_window_expires_at` to about 90 minutes from now). | **"Reply window closes in 1h 30m"** with a **Draft reply** button. Click it: Copilot writes a draft into the box (you review it; nothing sends). |
| 5.3 | Open a chat whose window is closed. | **"Reply window closed"**, "Meta charges may apply", and the template picker. |
| 5.4 | Open a Messenger or Instagram chat inside the support window. | **"Human support reply allowed for …"** saying a person must write it. |
| 5.5 | Look at the composer tabs. | **Reply** and **Internal note**. |
| 5.6 | Look at the toolbar under the box. | **More actions** (menu) on the left; **Draft with Copilot** and **Send** on the right. |
| 5.7 | Open **More actions**. | **Create quote** first, then task/case options. Unavailable ones are greyed with a reason. |
| 5.8 | In a chat where the customer says they paid (or has an unverified payment claim). | A prominent **Follow up on payment** button and the line "Suggested next step: The customer says they paid…". |
| 5.9 | In a chat asking about a visa, or a complaint or refund. | The matching suggested button (visa task / complaint case). |
| 5.10 | Open a chat owned by a colleague while it is **not** staff-handled. | Above the box: "{Name} is the owner. Sending a reply makes you the owner and pauses the assistant." |
| 5.11 | Open a chat a colleague owns **and** staff are handling. | "{Name} owns this chat. Check with them before you reply…". Sending is **not** blocked. |
| 5.12 | Have a colleague start typing in the same chat. | "{Name} is writing a reply. Please coordinate before sending." |

---

## 6. The right-hand panel

| # | Do | You should see |
|---|---|---|
| 6.1 | Open a chat with an open review (for example an unverified payment claim). | The **"Human review required"** card is at the **very top** of the panel, above everything. Each review shows **"Why: …"**. |
| 6.2 | Look below it. | The customer's name and stage, then **"Details collected — 3 of 5 details collected"** with ticks, then Copilot's reading. |
| 6.3 | Click **Ask about …** in the checklist. | A polite question appears in the message box, **not sent**. |
| 6.4 | Open a chat with a lead missing details. | **Departure suggestions** lists what is still needed and offers **Ask for missing details**. No "Find matching departures" yet. |
| 6.5 | Open a chat with all details. | **Find matching departures**. Click it. Either options appear, or "No matching departure is available right now" with **Ask about flexible dates**. |
| 6.6 | Open the **best departure** card. | A **Why this matches** expander listing reasons; "Based on limited information" if nothing solid. |
| 6.7 | Use a chat whose offer is stale (change the group's price, or reduce seats below the party). | The card is headed **Human review required**, says "Do not confirm this departure…", and **Draft reply / Create quote are not offered**. |
| 6.8 | Look at **Departure group** in Travel interest. | One of: *Not chosen*, *Recommended*, *Lead preference*, *Seat hold*, *Booked*. Never the bare word "Selected". |
| 6.9 | Open the chat whose lead has the **seat hold** booking. | **Seat hold** with "Expires in 1h 42m"; after the expiry passes, **Hold expired**. Never "Booked". |
| 6.10 | Open the chat with the **confirmed** booking. | **Booked**, the group name, "Booking B-… · Status: confirmed", "Payment: balance due / paid in full" (Finance/Admin only) and an **Open booking** link that opens the booking in a new tab. |
| 6.11 | As **Sales A** (no finance rights), look at the same booked chat. | The payment part is **not shown**. |
| 6.12 | Scroll to **History**. | "Conversation started" plus every owner change. If routing is switched on for the agency and it assigned this chat: "Assigned to X by routing: {reason}". After a customer reopens a closed chat: "Reopened by the customer". |

---

## 7. Attachments

Send the **passport photo** and the **receipt photo** from the customer phone to a chat whose lead has a booking with two
travellers. Wait for the review cards to appear under the messages.

### 7.1 Payment receipt

| # | Do | You should see |
|---|---|---|
| 7.1.1 | Look at the receipt card. | A badge **Not verified** and "A payment counts only after Finance has checked it against the booking." **No** "Confirm payment" button anywhere. |
| 7.1.2 | Click **Send acknowledgement**. | A reply appears in the box: "Thank you, we have received your payment proof. Our finance team will check it…". It never says the payment is confirmed. Nothing is sent until you press Send. |
| 7.1.3 | Click **Open Finance review** (Admin/Finance). | The Finance payments page opens **in a new tab**. |
| 7.1.4 | As **Sales A**, look at the card. | **No** Open Finance review button. |

### 7.2 Passport

| # | Do | You should see |
|---|---|---|
| 7.2.1 | Look at the passport card. | A badge **Not saved to Documents** and "The Inbox copy is temporary and expires." |
| 7.2.2 | With two travellers and none chosen, look at the buttons. | **Review fields**, **Assign visa officer** and **Save to Documents** are disabled or say "Choose the traveller above…". |
| 7.2.3 | Choose the traveller. | The buttons enable. |
| 7.2.4 | Click **Review fields**. | Passport number and expiry date, pre-filled from what was read; an unreadable date is left blank. |
| 7.2.5 | Enter an expiry **before the group's departure date**, Save. | A plain refusal from the traveller record ("expires … before the … departure"). Nothing changes. |
| 7.2.6 | Enter a valid number and a later expiry, Save. | "Saved to the traveller's record." Open the traveller in Departure Groups: the number and expiry match. |

### 7.3 Save to Documents (G4)

| # | Do | You should see |
|---|---|---|
| 7.3.1 | Click **Save to Documents**. | "Saved to Documents. It now needs verification there." The badge becomes **Saved to Documents**. |
| 7.3.2 | Open the traveller's documents checklist. | The **passport** item is **Submitted** (not Verified), with the file. |
| 7.3.3 | Click **Save to Documents** again on the same card, or refresh and try. | No second copy; it stays saved. |
| 7.3.4 | On a traveller whose passport item is already **Submitted** or **Verified**, try again with another passport. | A refusal: "already waiting for review" / "already verified". Nothing is replaced. |

```sql
select id, status, document_type, file_path, submitted_at
from public.departure_group_pilgrim_documents
where pilgrim_id = '<traveller id>' and document_type = 'PASSPORT_BIO';
-- status SUBMITTED, file_path under <agency>/<group>/<traveller>/

select promoted_document_id, expires_at from public.message_attachments where id = '<attachment id>';
-- promoted_document_id set, expires_at null

select action, to_status, note from public.document_review_events
where document_id = '<that document id>' order by created_at desc;
-- an UPLOADED row "Saved from an Inbox conversation."
```

### 7.4 Assign visa officer

| # | Do | You should see |
|---|---|---|
| 7.4.1 | Click **Assign visa officer**. | A short list containing only Admin, Operations and Visa staff. Finance and Marketing are absent. |
| 7.4.2 | Choose the **Visa officer**. | "Visa file given to …". |
| 7.4.3 | Open the Visa module, find that traveller. | The officer is shown as assigned, with an "Assigned" history entry "(from an Inbox conversation)". |
| 7.4.4 | Choose **No officer**. | "Visa officer removed." |
| 7.4.5 | As **Sales A** (no visa assignment rights). | **No** Assign visa officer button. |

### 7.5 Voice note

| # | Do | You should see |
|---|---|---|
| 7.5.1 | Send a voice note from the customer phone. | It plays in the bubble; once transcribed, an italic transcript appears with "Automatic transcript. It can be wrong…". |
| 7.5.2 | Click **Copy transcript**, paste somewhere. | The text is pasted; the link says "Copied". |

---

## 8. List, search, shortcuts and bulk actions

### 8.1 Search

| # | Do | You should see |
|---|---|---|
| 8.1.1 | Press **/** with nothing focused. | The search box is focused (and no "/" is typed). |
| 8.1.2 | Type a customer name that is **not** in the loaded list (an older chat). | Immediately the loaded chats filter; about a second later "**Matches from all conversations**" and the older chat appears. |
| 8.1.3 | Click that older result. | It opens fully: thread, header and right panel. |
| 8.1.4 | Search a **lead reference** (for example `LD-1042`), a **phone fragment**, and a **package name**. | Each finds the right chat. |
| 8.1.5 | Type `a,b)or(c` or `%%`. | No error. A single character is not searched at all. |
| 8.1.6 | Clear the search. | The normal list returns. |

### 8.2 Keyboard

| # | Do | You should see |
|---|---|---|
| 8.2.1 | Click empty space, press **j** then **k**. | The next / previous chat opens and scrolls into view. It stops at the ends. |
| 8.2.2 | Type "jk" in the message box. | The letters are typed; the open chat does **not** change. |
| 8.2.3 | Type "j" in the search box. | Typed, no chat change. |
| 8.2.4 | Search, then press **j**. | It moves through the **searched** results. |

### 8.3 Bulk actions

| # | Do | You should see |
|---|---|---|
| 8.3.1 | Click **Select conversations**. | Rows get checkboxes; a bar shows "Choose conversations". |
| 8.3.2 | Select three open chats and one **closed** chat. | "4 selected". |
| 8.3.3 | Choose **Give to… Sales B**. | A toast "Changed the owner of 3 conversations. 1 was left alone." The closed chat is unchanged. |
| 8.3.4 | In Sales B's browser. | **One** bell notice: "{Admin} gave you 3 conversations". |
| 8.3.5 | Select two open chats, press **Close**. | "Closed 2 conversations." They leave the open queues. |
| 8.3.6 | Select 51 chats (if you have them). | "Choose at most 50." and the actions are disabled. |
| 8.3.7 | As **Finance**. | No **Select conversations**. |
| 8.3.8 | Press **Stop selecting**. | Checkboxes go; normal clicking opens chats again. |

**Look at the right-click menu on a chat row.** It has **Assign to me** and **Delete**. Those items may not be wired up yet.
If **Delete** does anything, stop and report it at once.

---

## 9. Saved views

Requires 0.1.

| # | Do | You should see |
|---|---|---|
| 9.1 | Open **Saved views** with none saved. | "No saved views yet." and, when a queue or search is active, **Save this view**. |
| 9.2 | Open the Payments queue, type a search, **Save this view**, name it "Payments today". | The list refreshes and shows "Payments today" with "Search: …". |
| 9.3 | Save a second with the **same name**. | "You already have a saved view with that name." |
| 9.4 | Switch to All, clear the search, then open "Payments today". | The Payments queue opens and the search box is filled. |
| 9.5 | In another browser, sign in as **Sales A** and open Saved views. | **Sales A cannot see Admin's views.** |
| 9.6 | Remove a saved view (the ✕). | It disappears. |
| 9.7 | (Optional) Save 20 views, try a 21st. | "You can keep 20 saved views. Remove one first." |

```sql
select staff_id, name, view, search from public.inbox_saved_views order by created_at;
-- each row belongs to the person who saved it
```

---

## 10. The assistant: autonomy and limits (Admin settings)

Open **Management → AI agent**.

| # | Do | You should see |
|---|---|---|
| 10.1 | Find the autonomy section. | "What the assistant may do on its own", a select named **Assistant behaviour** with **Observe only / Draft replies / Safe automatic replies / Lead intake assistant**. No "L0", "Shadow" or "Propose" anywhere. |
| 10.2 | Change the selection. | The description under it changes ("The system reads conversations but never sends a reply on its own." …). |
| 10.3 | Read the bottom of the section. | **Always human-only, at every setting**, 11 ticked items (payment received, visa approval, discounts, seats, booking changes, unapproved bank details, refunds, religious rulings, health advice, closing complaints, broadcasts). |
| 10.4 | Look at the main form. | **Replies per conversation** with help text; **no** "Escalate after N failed turns". |
| 10.5 | Save the main form. | It saves with no error. |
| 10.6 | As a role without settings rights. | The controls are disabled. |

**Explicit L0 beats the older switch (E1)** — only on staging, with the classic assistant switched on:

1. Make sure the agency's classic **WhatsApp assistant is on** and the Inbox reply level has **never** been saved. Send a customer message: the assistant **replies** (older switch still applies).
2. Save **Observe only**. Send another customer message on a fresh chat: the assistant does **not** reply; the chat is passed to staff.
3. Save **Lead intake assistant** (needs the unlock conditions; if locked, note the reasons shown). Replies resume.

```sql
select from_level, to_level, reason, created_at
from public.inbox_autonomy_level_audit
where agency_id = '<agency>' and surface = 'INBOX_REPLY' order by created_at desc;
-- one row per save
```

**Reply limit (E2):** set **Replies per conversation** to `3`, chat with the assistant until it has replied three times, send a
fourth message. The chat should be handed to staff, and the note should read **"The assistant handed this chat to staff after 3
replies, which is its limit for one conversation."** Put the limit back afterwards.

**Follow-up hours (E4):** with follow-ups enabled **and not in dry-run**, set working hours that are **closed right now** and
leave a quiet lead, then run the follow-up sweep. Nothing should send. Set hours that are open, run again: it sends. (Skip if you
cannot run the sweep; the rule is unit-tested.)

**Reopen (E5):** close a chat, then message it from the customer phone. It reopens, and **History** shows "Reopened by the
customer".

```sql
select kind, occurred_at from public.conversation_events
where conversation_id = '<chat id>' and kind = 'CUSTOMER_REOPENED';
```

---

## 11. Accessibility and layout (G1, G2)

Do these on the `/inbox` page.

| # | Do | You should see |
|---|---|---|
| 11.1 | Use only the keyboard: **Tab** through the rail, list, header, thread, composer and panel. | Every control is reachable, in a sensible order, with a **visible focus ring**. |
| 11.2 | Open a menu or the saved views popup, press **Escape**. | It closes and focus returns to where you were. |
| 11.3 | Turn on a screen reader (NVDA, VoiceOver). Open a chat. | The header reads the owner, the assistant state and a sentence explaining it. The "Details collected" items read "collected" or "still needed". Toasts are announced. |
| 11.4 | Look at every status you saw in this script. | Each has **words or an icon**, never colour alone. |
| 11.5 | Set the window to **320**, **768**, **1024** and **1440** px wide. | No horizontal page scroll; the list, thread and panel remain usable (panels may collapse or stack). Nothing overlaps. |
| 11.6 | Switch the system to **dark mode**. | Text and status chips stay readable. |
| 11.7 | Turn on **reduced motion** in the operating system. | Animations stop or shorten; nothing flashes. |

---

## 12. Regression sweep

Quickly confirm the old basics still work:

- Send a normal reply and see the message appear immediately as "Sending…", then Sent/Delivered.
- Add an **Internal note** and mention a colleague.
- Use **Saved replies** and **Attach brochure** dropdowns.
- **Create quote** from More actions creates a draft quote on the lead (nothing is sent).
- Create a task from **More actions**, then confirm it in the target module.
- Realtime: with two browsers on the same chat, a message in one appears in the other without a reload, and no skeleton flashes.

---

## 13. Reporting results

Copy this table into your notes, one row per section, and mark each step Pass / Fail / Skipped:

| Section | Result | Failing steps and what you saw |
|---|---|---|
| 0 Setup | | |
| 1 Opening | | |
| 2 Rail | | |
| 3 New chat | | |
| 4 Header and owners | | |
| 5 Composer and windows | | |
| 6 Panel | | |
| 7 Attachments | | |
| 8 List, search, bulk | | |
| 9 Saved views | | |
| 10 Assistant settings | | |
| 11 Accessibility | | |
| 12 Regression | | |

A failure worth stopping on immediately:

- any **Delete** action actually deleting a conversation;
- a payment described as received or confirmed anywhere in the UI;
- a passport replacing a **Verified** or **Submitted** document;
- a person seeing another person's saved views;
- a role acting outside its rights (Finance assigning an owner, Sales A assigning a visa officer).

## After a clean run

1. Tick the G boxes in TASK-009 and note the date and commit.
2. Open the pull request from `upgrade-inbox` (compare against `main`) and squash `d55e3d8`, the commit that contains only a file
   rename, into its neighbour.
3. Apply the saved-views migration in production **before** the deploy that ships the Saved views menu, or leave the menu to
   report "not available" until it is applied.
4. Before deploying the autonomy change, list agencies that saved the lowest Inbox reply level and still rely on the older
   WhatsApp assistant switch (they will stop getting automatic replies):

```sql
select distinct a.agency_id
from public.inbox_autonomy_level_audit a
join public.ai_surface_settings legacy
  on legacy.agency_id = a.agency_id and legacy.surface = 'WHATSAPP' and legacy.enabled and legacy.mode = 'ACTIVE'
where a.surface = 'INBOX_REPLY';
```
