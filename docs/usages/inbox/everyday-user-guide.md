# Manasik Inbox — Everyday User Guide

> **Who this is for:** anyone who uses the Inbox and is not a technical person — sales and support staff, operations staff, Finance, Visa officers, the CEO and administrators.
>
> **How it was written:** every screen, button, message and rule below was checked against the code on **5 October 2026**. Where the screen and the older guides disagree, this guide follows the screen. The differences are listed in [`docs/progress/2026-10-05-inbox-usage-review.md`](../../progress/2026-10-05-inbox-usage-review.md).
>
> **Short on time?** Read §1 (what the Inbox is), §3 (the screen), §7 (replying) and §22 (what to do when something goes wrong). Use the contents list to jump to anything else.

## Contents

1. [What the Inbox is, in one minute](#1-what-the-inbox-is-in-one-minute)
2. [Words you will see](#2-words-you-will-see)
3. [Opening the Inbox and finding your way around](#3-opening-the-inbox-and-finding-your-way-around)
4. [The queues on the left](#4-the-queues-on-the-left)
5. [The list of conversations](#5-the-list-of-conversations)
6. [Reading a conversation](#6-reading-a-conversation)
7. [Replying to a customer](#7-replying-to-a-customer)
8. [Rules for each channel (the banner above the reply box)](#8-rules-for-each-channel-the-banner-above-the-reply-box)
9. [Starting a new conversation](#9-starting-a-new-conversation)
10. [Who owns a conversation](#10-who-owns-a-conversation)
11. [The customer details panel](#11-the-customer-details-panel)
12. [Copilot, the assistant](#12-copilot-the-assistant)
13. ["Human review required" cards](#13-human-review-required-cards)
14. [Files and voice notes from customers](#14-files-and-voice-notes-from-customers)
15. [Turning a conversation into work](#15-turning-a-conversation-into-work)
16. [Handing a booking over to Operations](#16-handing-a-booking-over-to-operations)
17. [Close, spam and delete — which one to use](#17-close-spam-and-delete--which-one-to-use)
18. [Keyboard shortcuts](#18-keyboard-shortcuts)
19. [The Outcomes panel (for managers)](#19-the-outcomes-panel-for-managers)
20. [Settings that change how the Inbox behaves (administrators)](#20-settings-that-change-how-the-inbox-behaves-administrators)
21. [Real-life scenarios, step by step](#21-real-life-scenarios-step-by-step)
22. [When something goes wrong](#22-when-something-goes-wrong)
23. [Golden rules](#23-golden-rules)
24. [What each role can do](#24-what-each-role-can-do)

---

## 1. What the Inbox is, in one minute

The Inbox is the one place where every customer conversation arrives — **WhatsApp, Facebook Messenger, Instagram and email**. Instead of checking four apps, you check one list.

It does five jobs:

1. **Collects** every message and shows it as a chat.
2. **Sorts** conversations into queues (for example *Needs a reply*, *Payments*, *Overdue*) so you know what to do first.
3. **Lets you reply**, add private notes for colleagues, and send files.
4. **Connects the chat to your CRM** — the customer's lead, booking, follow-up, quote and tasks.
5. **Gives you a helper called Copilot** that reads the chat and suggests what to do next. Inside the Inbox screen, Copilot only *suggests*: you decide and you send. (Your administrator can separately switch on limited automatic replies — see §20. Ask them if you are unsure whether your agency has done so.)

**The most important rule:** the CRM is the truth. Copilot can be wrong. Never promise a price, a seat, a payment, a visa result or a refund unless the CRM or the right team confirms it.

---

## 2. Words you will see

| Word | What it means |
|---|---|
| **Conversation / chat** | All messages with one customer on one channel. |
| **Queue** | A ready-made list, such as *Needs a reply*. A conversation moves between queues by itself as things change. |
| **Owner** | The staff member responsible for the chat. Shown as "Assigned to you", "Assigned to Nadeesha" or "Unassigned". |
| **Assistant / Copilot** | The automatic helper. "Assistant active" means it may answer the customer. "Assistant paused" means a person owns the chat and it stays silent. |
| **Internal note** | A private message for your team. **The customer never sees it.** |
| **Reply window** | WhatsApp, Messenger and Instagram only allow free typing for 24 hours after the customer's last message. After that the rules in §8 apply. |
| **Template** | A WhatsApp message pre-approved by Meta. It is the only way to start a chat or to reach a customer after the window closes. Meta may charge for it. |
| **Lead** | The customer's sales record in the CRM (Leads page). |
| **Departure group** | A scheduled trip (for example "Umrah – March") with seats and prices. |
| **Human review required** | A red card telling you a person must look at something before the chat goes further (§13). |
| **Blocking review** | A review marked **"Do not confirm yet"**. While it is open you cannot send words that confirm the thing it guards (for example "payment received"). |
| **Intent** | What the customer wants, as read by Copilot (for example "Asking for a price"). |
| **Spam** | A chat moved out of the working lists. Nothing is deleted and it can be restored. |

---

## 3. Opening the Inbox and finding your way around

### How to open it

- Click the **Inbox icon** in the top bar of the CRM. The Inbox opens in a **new browser tab**, full screen, with no CRM menu.
- A link to a single chat (from a task or a notification) opens the Inbox directly on that chat.
- Clicking a number on the dashboard's **Inbox panel** opens the Inbox already filtered to the queue behind that number.
- To go back, click **Back to the CRM** at the bottom of the left menu (the arrow button at the top on a small screen).
- The browser's **Back** button works inside the Inbox: it returns you to the previous chat or queue.

> **Good to know:** on a computer the Inbox opens the **first chat in the list** automatically, and opening a chat marks it **read**. If you only wanted to look at the list, that chat will no longer show as unread.

If you do not have permission to use the Inbox (the Guide role), the page simply does not open. If your agency account is suspended, you see the suspended-account page instead.

### The four areas of the screen

```
┌────────────┬────────────────┬──────────────────────────────┬──────────────────┐
│ 1. QUEUES  │ 2. LIST        │ 3. THE CONVERSATION          │ 4. CUSTOMER      │
│            │                │                              │    DETAILS       │
│ All        │ [+] [🔖] [☑]   │ Name · owner · ⋯ menu        │ Who they are     │
│ Mine       │ 🔍 Search…     │ ───────────────────────────  │ Reviews (red)    │
│ Unassigned │                │ messages and notes           │ Next action      │
│ Needs      │ Chat row       │                              │ Trip · Booking   │
│  a reply   │ Chat row       │ ───────────────────────────  │ Follow-up        │
│ …          │ Chat row       │ Channel banner               │ Copilot          │
│            │                │ [Reply | Internal note] box  │ Turn into work   │
│ Outcomes   │                │                              │ History          │
│ Shortcuts  │                │                              │                  │
│ Back to CRM│                │                              │                  │
└────────────┴────────────────┴──────────────────────────────┴──────────────────┘
```

### How the screen adapts to its size

| Your screen | What you get |
|---|---|
| **Wide (about 1440 px or more)** | All four areas, queue menu open. |
| **Laptop (about 1280–1439 px)** | All four areas, but the queue menu is folded to icons so the chat has room. Click **Expand menu** to open it. |
| **Narrower laptop / tablet (about 1024–1279 px)** | Queues folded to icons. Customer details open as a **side sheet** from the **Show customer details** button (the panel icon in the chat header). |
| **Small tablet / phone (below 1024 px)** | The queue menu is replaced by a **bar above the list**: a drop-down to choose the queue, a **back-to-CRM** arrow, a **WhatsApp chat** button and an **email** button. Below about 768 px you see **either the list or one chat**. Use **All chats** at the top of a chat to go back to the list. |

You can fold the queue menu (**Collapse menu / Expand menu**) and hide or show the customer panel (**Hide customer details / Show customer details**). Your choice is remembered and wins over the automatic layout.

Things only the full-width layout has: **Outcomes** and **Keyboard shortcuts** buttons (§18, §19) live in the queue menu, which is hidden on small screens.

---

## 4. The queues on the left

A queue is a ready-made list. **You do not move chats into queues; the system does.** A chat can be in several queues at once (for example *Needs a reply* and *Payments*).

The number next to a queue is how many open chats it holds **across the whole agency** (it shows **99+** for more than 99). It updates by itself.

### Always visible

| Queue | A chat is here when… | What you should do |
|---|---|---|
| **All conversations** | Every open conversation | Use for a broad look. |
| **Assigned to me** | You own it | Your personal to-do list. Start here. |
| **Unassigned** | Nobody owns it | Give it an owner (§10). |
| **Needs a reply** | The customer wrote last | Reply. This is your main working queue. |
| **Waiting for customer** | We replied last | Nothing to do until they answer; chase if it has been quiet. |
| **Waiting for our team** | A colleague was asked to step in, or a review is still open | Follow up with that colleague. |

### Shown when they have chats (otherwise tucked under **More queues**)

| Group | Queue | A chat is here when… |
|---|---|---|
| **Inbox** | **Closed** | The conversation was closed. |
| | **Spam** | It was marked spam, or its lead is spam. |
| **Sales** | **New enquiries** | A first-time customer is asking about a trip. |
| | **Qualified** | We know the travellers, dates and room type. |
| | **Ready to book** | The customer agreed and only needs a booking. |
| | **Quote sent** | A quote is with the customer. |
| **Needs attention** | **Urgent** | A blocking review is open, or the customer is in urgent need. |
| | **Complaints** | The customer is unhappy or asking for a refund. |
| | **Payments** | The customer talks about paying, or a payment claim needs checking. |
| | **Documents** | Passports, photos or other documents are involved. |
| | **Visa questions** | The customer asks about a visa. |
| | **Nearing deadline** | A reply target or a messaging window is about to run out. |
| | **Overdue** | A reply target has already been missed. |
| **Channels** | **WhatsApp**, **Instagram**, **Messenger**, **Email** | Open chats on that channel. |

Notes:

- The queue you are looking at always stays visible, even when empty.
- **More queues / Fewer queues** shows or hides the empty ones. Empty queues are not deleted.
- Two queues, **Departure changes** and **Group changes**, exist in the system but are **hidden** because they are not finished. Do not look for them.
- If your agency has not switched on the grouped queues, you will see the **simple menu** instead: All conversations, Assigned to me, Unassigned, then Channels (WhatsApp, Instagram, Messenger, Email), then Closed and Spam. Everything else in this guide still applies.
- An empty queue explains itself, for example "Nothing is overdue" with a hint about what appears there.

**Suggested daily order:** Assigned to me → Urgent → Complaints → Payments → Overdue → Documents → Needs a reply (oldest first) → Nearing deadline during the day → Unassigned (team leads).

---

## 5. The list of conversations

### What each row shows

- A **coloured circle with initials** (the colour is the same every time for that customer) and a **small channel logo** in the corner.
- The **customer's name** (or phone number / email if the name is unknown). **Bold** means there are unread messages.
- How long ago the **latest activity** was (for example "5 minutes", "2 hours").
- A **preview of the last message**. If the last message was sent by your side it starts with **"You:"**. Messages with no text show "Photo", "Voice message", "Document", "Template message" and so on.
- A **number badge** for unread messages. The chat you have open never shows as unread.

> The row does **not** show the lead stage or the chat state. To see them, hover over the row.

### The hover card

Hold the mouse over a row for a moment to see, without opening the chat: the channel and phone/email, **what was said last and by whom**, **status** (Assistant active / Staff action needed / Assistant paused / Closed), **owner**, **lead and stage**, **package of interest**, the **reply window** ("Open, closes in 3 hours" or "Closed. Only an approved template can start the conversation again."), **when the customer last wrote and when we last replied**, unread count, whether a **support case is open**, and **when the chat started**.

### Searching

- Type at least **2 characters** in **Search conversations**. You can search a **name**, **phone number**, **email**, **lead reference** or **package name**. Names in Sinhala, Tamil and Arabic work.
- While you type, the loaded chats are filtered at once. About a third of a second later the system searches **all** conversations (not just those on screen) and shows **"Matches from all conversations"**. At most **50** results appear; if you see "(first 50)" type more letters.
- If it says **Search failed**, click **Try again**.
- If nothing matches you are told which words found nothing, with a **Clear search** button.
- Special characters are ignored and a search is cut at 60 characters.
- Shortcut: press **/** to jump to the search box.

### Saved views (the bookmark button)

A saved view remembers **a queue plus a search** under a name, for you only.

1. Open a queue and/or type a search.
2. Click the **bookmark** button → **Save this view** → type a name (up to 40 characters) → **Save**.
3. Later, click the bookmark button and choose the view. It switches queue and fills the search box.
4. Remove one with the **×** beside it.

The **Save this view** button only appears when there is something to save (a search, or any queue other than *All conversations*).

### Loading more

The list loads in pages. When more exist, **Load older chats** appears at the bottom. The header says **"Showing 25 of 140"** style text when the queue holds more than what is loaded. (Not shown while searching — use search instead.)

### Selecting several chats at once

1. Click the **checklist button** (**Select conversations**). Rows get tick boxes.
2. Tick the chats. The bar at the bottom says "3 selected". **Choose at most 50.**
3. Pick an action:
   - **Give to…** — choose a colleague, or **Unassigned**. (Needs the *assign* permission.)
   - **Close** — closes them. **There is no confirmation** and no undo button; a closed chat only comes back when the customer writes again. (Needs the *close* permission.)
   - **Mark as spam** (or **Not spam** when you are inside the Spam queue) — asks you to confirm first. (Needs the *close* permission.)
4. A message tells you what happened, for example "Closed 3 conversations. 1 was left alone." A chat is *left alone* when it cannot be changed (already closed, closed chats cannot be assigned, already has that owner, …).
5. **Cancel** stops selecting.

Bulk actions never send messages, never confirm payments and never touch reviews.

---

## 6. Reading a conversation

### The header

- **Customer name** and phone number (or email address).
- **Owner** chip or drop-down and a **status chip** (§10).
- The **⋯ Conversation actions** menu (§10, §17).
- A **panel button** to show or hide customer details.

### The messages

- **Left side, white bubbles** = the customer.
- **Right side, tinted bubbles** = your staff. Copilot's own messages are **outlined** and marked with a ✨ and the name "Copilot", so they never look like a colleague typed them.
- **Centre, dashed, small italic** = system messages.
- **Dashed note cards** = **Internal notes** ("Internal note · Name · 14:32"). Customers never see these.
- A **day divider** ("Today", "Yesterday", a date) appears between days.
- Several messages in a row from the same sender share one line of "who and when", printed under the last bubble. Hold the mouse over a bubble to see its exact time (HH:mm).
- **Email** bubbles show the **subject** at the top.

### Delivery status (under messages your side sent)

| You see | Meaning |
|---|---|
| **Sending…** | On its way. |
| **Sent** | Left the CRM / reached the channel. |
| **Delivered** | Reached the customer's phone or inbox. |
| **Read** | The customer opened it (blue). |
| **Failed** | It did **not** reach the customer. A red line says "Not delivered" and why. |

### New messages while you read

If you scroll up to read older messages and the customer writes, the thread does **not** jump. A button appears: **"1 new message"** / **"3 new messages"**. Click it to jump down. If you were already at the bottom, new messages just appear.

### Unread and read

- Opening a chat clears its unread count, and a message arriving while you watch is cleared too (only when the browser tab is visible).
- On a phone, the chat behind the list is **not** marked read until you actually open it.

### Everything updates by itself

New messages, new chats, owner changes, delivery ticks and "someone is writing" warnings all appear **without refreshing**. If your computer goes to sleep or loses internet, reconnect and the Inbox catches up by itself. If a pane shows an error, use its **Try again** button.

### Picture and voice messages in the thread

See §14.

---

## 7. Replying to a customer

The box at the bottom has two tabs: **Reply** and **Internal note**.

> **Reply** goes to the customer. **Internal note** goes to your team only. Check the tab before you press send.

### Sending a reply

1. Click **Reply** (or press **r**).
2. Type your message. **Enter** sends. **Shift + Enter** starts a new line. (While a Sinhala, Tamil or Arabic keyboard is still suggesting a word, Enter accepts the word and does **not** send.)
3. Press the **send arrow** or **Enter**.
4. Your message appears **at once** as "Sending…" and then changes to Sent / Delivered / Read.

What happens behind the scenes:

- If the Assistant or nobody had the chat, **sending a reply makes you the owner** and pauses the Assistant. A note above the box warns you: *"Nadeesha is the owner. Sending a reply makes you the owner and pauses the assistant."*
- If a **colleague already owns it as a person**, your reply goes out and **the owner does not change**, but the box warns: *"Nadeesha owns this chat. Check with them before you reply so the customer gets one answer."*
- The system re-checks the channel rules, open reviews and permissions **again at the moment of sending**. The screen is only a guide; the final check is on the server.

### Why the box might be disabled

The notice above the box says why. Common reasons: the chat is **closed**, your role cannot reply, the **reply window** has closed (§8), a **Messenger/Instagram** customer has not written yet, or the channel cannot send replies yet. When replying is blocked the box opens on **Internal note**, which still works.

### Sending a file

1. Click the **+** (**Attach a file**) button → **Choose from device** or **Choose from vault**.
2. A chip shows the file name and size: "attaching…" then ready. **×** removes it.
3. Type a caption if you want one (the caption is optional when a file is attached).
4. Send.

| Type | Allowed | Largest |
|---|---|---|
| Photos | JPG, JPEG, PNG | 5 MB |
| Documents | PDF, Word (.docx), Excel (.xlsx), PowerPoint (.pptx) | 10 MB |

- One file per message.
- **Instagram only accepts photos.** Messenger, WhatsApp and Email accept photos and documents.
- The system checks the file's contents, not just its name. Word/Excel/PowerPoint files that contain macros, and PDFs that contain scripts or launch actions, are **refused**.
- **Choose from vault** opens your Document Vault so you can send an approved brochure or form without downloading it first.
- If the upload fails the chip turns red and says why. Remove it and try again.

### Saved replies

Click the **speech-bubble** button to see ready-made answers. Click one to **add it into the box** (it is added under any text already there, so you can edit before sending). If your role allows it, **+ Create reply** adds a new one for the whole team.

### Internal notes and mentions

1. Click **Internal note** (or press **n**).
2. Type the note. To tell someone, click **Mention staff** and choose a name. "@Name" is added to the text and that person is notified. You can mention **up to 20** people. Click the **×** under the box to remove a mention.
3. Press **Add note**.

Notes can be added even on closed chats and when replying is blocked.

### Your draft is saved automatically

Whatever you type in **Reply** is saved as a **private draft** a moment later. If you click another chat or close the tab, the draft is there when you return. Drafts are per chat and per person; colleagues cannot see your draft. Maximum 10,000 characters.

### "Someone is writing" warning

If a colleague is typing a reply in the same chat you see: *"Name is writing a reply. Please coordinate before sending."* This is a **warning, not a lock** — both of you can still send. Agree who answers (use a note). The warning disappears about two minutes after they stop.

### If sending fails

The message stays on screen with **"Not sent"** and two links:

- **Retry** — sends the **same** message again. It is safe: if the first attempt actually went through, the customer will **not** get it twice.
- **Dismiss** — removes it from the screen.

### Email replies

On an email chat the box also has **Subject** (pre-filled with "Re: …" from the customer's last email) and **Add Cc/Bcc** (type addresses separated by commas or semicolons). Email has **no 24-hour window** — you can send any time.

---

## 8. Rules for each channel (the banner above the reply box)

The banner tells you **what you may send right now and for how long**. It uses an icon and words, never colour alone.

| Channel | Free typing | After 24 hours |
|---|---|---|
| **WhatsApp** | Within 24 hours of the customer's last message | Use an **approved template** (may cost money) |
| **Messenger** | Within 24 hours | Only a **person-written reply on an active support case** for up to **7 days**; otherwise not at all |
| **Instagram** | Within 24 hours | Same as Messenger |
| **Email** | Any time | Not applicable |

### What the banner can say

| Banner | Meaning | What to do |
|---|---|---|
| **Reply window open** — "Free-form reply allowed for 18h 20m" | You can type freely. | Reply normally. |
| **Reply window closes in 1h 05m** (turns red under 2 hours) | The window is about to shut. | Reply **now**. A **Draft reply** button offers a Copilot draft in one click. |
| **Reply window closed** — "Choose an approved template…" (WhatsApp) | Free typing is refused. | Click **Choose approved template**. |
| **Human support reply allowed for 3d 4h** (Messenger/Instagram) | A person may reply under Meta's HUMAN_AGENT rule. | Write it yourself; automation can never use this. |
| **Sending unavailable** | Nothing can be sent. | Add a note; wait for the customer to write; or use another channel they agreed to. |
| **Email messaging available** | Email has no window. | Send any time. |

### Sending an approved WhatsApp template in an existing chat

1. In the banner, click **Choose approved template**. (If there are none: *No approved templates* — an administrator must sync them, see §20.)
2. In the side sheet, click a template. Each shows its **name**, **category** (Marketing, Utility, Authentication…) and **projected charge**.
3. Fill **every** "Template value" box (all are required).
4. Check the **Preview** and the **Projected charge**. If it says *"Projected charge unavailable — no matching Meta rate has been observed yet"*, no price is known yet; it is not free.
5. Click **Send approved template**. The sheet closes, you become the owner, and the message is sent. When the customer replies, free typing is available again.

### Messenger and Instagram specifics

- **You cannot start** a Messenger or Instagram conversation. The customer must write first. Until then the box says so and you may only add notes.
- After the 24-hour window there is **no template** to reopen it.
- The **seven-day human-support exception** only works when **all** of these are true: a person (not Copilot) writes the message, the chat is owned by a person, an **open review** of one of these kinds exists on the chat — **complaint, distressed customer, fraud concern, medical urgency or refund request** — and fewer than seven days have passed. (The hover card calls this "a support case is open".) Otherwise you see: *"Outside the allowed Messenger support window. Re-engage on another consented channel or wait for the customer."*

### Test environments

If your agency is a **test agency**, sends are refused with *"This is a test agency. Test agencies never send to real customers."* In a staging/test environment sends only go to approved test contacts. This protects real customers. Production agencies are not affected.

---

## 9. Starting a new conversation

Click the **+** button at the top of the list (**Start a new conversation**) and choose **WhatsApp chat** or **Email**. These buttons only show if your role can send messages. (On small screens the same two buttons sit in the bar above the list.)

### New WhatsApp chat

1. **WhatsApp number, with country code** — digits only is fine, 8 to 15 digits, for example `94771234567`. Do **not** add `+` or `0` at the front of the local number.
2. After you type a full number, a line tells you what will happen:
   - *"This chat will be linked to Amina (LD-1042)."* — one lead uses this number.
   - *"No lead uses this number yet. Sending will not create one…"* — you can add a lead from the chat afterwards.
   - *"More than one lead uses this number. The chat will not be linked to any of them…"* — choose the right lead later from Leads.
3. **Contact name** is optional (otherwise the number is used).
4. Choose an **Approved template** (name · language · category). If none exist: *"No approved templates are available. Create or sync one under Settings → WhatsApp Templates."*
5. Fill every **Template value**. A **Message preview** and the category and projected charge appear. "Meta bills this when it is sent."
6. Click **Send and open chat**. The chat opens, owned by you.

WhatsApp only allows a template as the first message. Free typing works after the customer replies.

> **Good to know:** if the number already has a conversation, that conversation is reused and its saved contact name is kept. If a **colleague owns it and it is still open**, you are told who and **nothing is sent**; open the existing chat or ask them to hand it over. A closed chat, an unowned chat or one you already own can be reused.

### New email

1. If no mailbox is connected you see **Open email settings** (Settings → Email). The mailbox must have **IMAP switched on**, because the Inbox needs it to receive replies.
2. Fill **Recipient email**, optional **Cc/Bcc** (**Add Cc/Bcc**), **Subject**, and **Message**. All of recipient, subject and message are required.
3. Click **Send**. The conversation opens, owned by you.

The same rule applies to an email address that already has a conversation.

---

## 10. Who owns a conversation

### The chips in the chat header

| Chip | Meaning |
|---|---|
| **Assigned to you / Assigned to Name / Unassigned** | The owner. If you may assign chats, this is a drop-down. |
| *(no second chip)* | **Assistant active** — Copilot may answer. This is the normal case, so it has no chip (hover the owner chip to read it). |
| **Staff action needed** (red) | The Assistant stopped. **A person must reply.** |
| **Assistant paused** | A person owns the chat; Copilot stays silent. |
| **Closed** | The conversation is closed. |

### The ⋯ Conversation actions menu

| Action | When it appears | What it does |
|---|---|---|
| **Take control** | Assistant active or staff action needed | You become the owner; Copilot stops. |
| **Hand back to AI** | You (a person) own it | Copilot may answer again. |
| **Close conversation** | Not already closed | Moves it to *Closed*. Asks you to confirm. Nothing is deleted. A new message from the customer reopens it. |
| **Delete conversation** | **Administrators only** | Deletes the whole chat — every message, note and file — **for good**. Asks you to confirm. Leads and bookings made from it are kept. |

### Changing the owner

Use the owner **drop-down** in the header (or press **a**). Pick a colleague, or **Unassigned**.

- Choosing a person makes them the owner, **pauses the Assistant** and **notifies them**.
- Choosing **Unassigned** on a person-owned chat puts it back to **Staff action needed**, so it is not silently ownerless.
- You cannot assign a **closed** chat ("It reopens when the customer writes again").
- The new owner must be an **active** staff member whose role can reply in the Inbox; otherwise: "That person cannot take Inbox conversations."
- If two people change it at the same moment: *"Someone else changed this conversation just now. Refresh and try again."*
- Every owner change is recorded in the chat's **history** (§11).

### Closed chats

A closed chat can still be read and noted, but **cannot be replied to or assigned**. If the customer writes again it **reopens**.

---

## 11. The customer details panel

Open it with the panel button in the chat header. What you see depends on whether the chat is linked to a lead.

### Not linked to a lead yet

You see, top to bottom: any **human reviews**, the **recommended next action**, then **Customer details**:

- **Possible existing lead found** — "This may be someone you already know. Nothing has been linked yet." Each suggestion shows the name, lead number, phone, a **Very likely** or **Possible** label and the reasons. Click **Link conversation** to accept. **Create separate lead** says "these are different people" and creates a new lead, and the pair is never suggested again. Never link only because names look alike.
- **Link or create lead** — links to a lead with the same exact phone number, or creates a new one.
- Copilot's reading and the **Conversation history**.

Who can create leads: Administrator and Marketing only. If your role cannot, you can still see suggestions but the buttons are missing.

### Linked to a lead

At the top: name, lead number and stage, language, phone and email, and small **Open lead / Open booking / Open departure group** buttons (they open the CRM page in a new tab, and only show if your role may open them).

Then, in this order:

1. **Human review cards** (red) — always at the top (§13).
2. **Recommended next action** (§12).
3. Collapsible sections. Which are open is remembered by your browser. By default **Trip** and **Booking** are open.

| Section | What it shows and does |
|---|---|
| **Trip** — "3 of 5 details" | **Details collected**: package interest, travel period, contact details, number of travellers, room preference — each ticked or empty. **Ask about …** puts the next missing question in your reply box (you edit and send it; nothing is sent automatically). Also shows the interested package, preferred period and the **departure group status**. |
| **Booking** — "Not started" or "BK… · deposit pending" | If none: **Select departure group** (opens a list of sellable groups with enough seats, showing dates and seats left) and then **Create booking**. If one exists: reference, status, number of travellers and (if your role may see money) the **payment balance**. A confirmed booking also offers **Operations handoff** (§16). |
| **Follow-up** — "None scheduled" or "in 2 days" | Pick a date and time, then **Schedule WhatsApp follow-up**. You become the follow-up owner. The time must be in the future. If one exists it shows the type, owner and due time. |
| **Copilot** | Copilot's reading of the chat, plus the offer card (§12). |
| **Turn into work** | **Create task or case** (§15). Only for roles that may convert chats. |
| **Conversation history** | When the chat started and every owner change ("who gave it to whom"). |

**Selecting a departure group only records interest.** It does **not** reserve seats. Seats are held when the **booking** is created. The new booking starts as **Deposit pending**.

**To create a booking** the chat needs: a linked lead, a selected departure group, the lead's phone number, and enough information on the lead (travellers, room). If something is missing you are told exactly what (for example "Add the customer's phone number to the lead before creating a booking.").

Who can do what here: Administrator and Marketing can select groups, create bookings, create quotes, schedule follow-ups and create leads. **Operations cannot** (see §24).

---

## 12. Copilot, the assistant

Copilot reads each conversation in the background and fills in **Copilot's reading** in the customer panel. **Nothing you see in this panel sends a message by itself.** Everything it produces lands as editable text or as a button you press. (Automatic replies are a separate administrator setting, §20. When switched on they follow strict limits and always hand price, payment, booking, visa, refund, medical and religious topics to a person.)

### Who sees Copilot features

Copilot actions (drafts, offer card, handoff) are for **Administrator and Marketing**. **Operations, Finance and Visa do not get them**, and the CEO can see the reading but cannot send. Your administrator may also have switched Copilot off or kept it in "Observe only" (see §20), in which case the reading and drafts may be missing. **The Inbox works fully without Copilot.**

### Honest status line

The top of the reading tells you the truth about itself:

| It says | Meaning |
|---|---|
| **Copilot is reading this conversation** | Still working. |
| **Read by Copilot** | A reading exists. |
| **Keyword reading** — "Keyword match, not the AI model" | Simple rules read it, not the AI. |
| **This reading may be out of date** | New messages arrived; check them yourself. |
| **Copilot did not read this conversation** | Skipped (often to save cost). Work normally. |
| **Copilot could not read this conversation** | It failed. Work normally. |

### The facts it shows

**What they want** (for example *Asking for a price*, *Wants to book*, *Says they have paid*, *Visa question*, *Complaint*, *Looks like spam*), **Urgency** (Low / Normal / High / Critical), **How they feel** (Positive / Neutral / Concerned / Angry / Distressed), **Writing in** (English / Sinhala / Tamil). Under some you see **"73% sure"** or **"Only 45% sure. Check before relying on it."**

**Travel details** it found: journey, travellers, travelling in (period), room, hotel distance, budget, travelling from — each marked **Keyword match** when a simple rule found it.

**Flags** — red labels such as *Asked for a refund*, *Sounds distressed or in trouble*, *Mentioned a bank account we have not approved*.

Click **Why?** beside any fact to see **the customer's own words** Copilot used, with a button that jumps to that message. **Always check the words, not just the percentage.** A low-confidence fact must never be copied into the CRM without checking.

**Translate conversation summary** translates Copilot's summary on demand. The translation is not saved as the real message. (There is no per-message translate button on the thread any more.)

### Correct Copilot — "Review this triage reading"

If Copilot's "What they want" is wrong, choose the right intent from the drop-down and click **Record**. You see "Review recorded". This teaches your agency's accuracy figures; it does not change the chat.

### Recommended next action

A single card chooses **the one thing to do next** and why. It never sends or creates anything alone. Examples, in the order the system checks them:

| Situation | Card says | Button |
|---|---|---|
| Customer says they paid | **Follow up on payment** | Opens the **Turn into work** review for a Finance task. |
| Complaint, cancellation, refund | **Open a complaint case** | Same, for a complaint case. |
| Visa question, or passport may expire | **Create a visa task** | Same. |
| Document issue, or an ID/financial document arrived | **Request documents** | Same. |
| Customer asks for a price and a live matching departure exists | **Create quote** | Creates a **draft** quote. |
| Price asked, but no matching departure yet | **Create quote** (greyed) | Greyed with the reason: *"Find a matching departure with live price and seats before creating a quote."* |
| Price asked, but price/seats changed | **Review changed offer** | Opens the group in a new tab. |
| Anything else | **Draft with Copilot** | Puts an editable draft in the reply box. |

The card also shows **urgency** (Low / Normal / High / Critical urgency). If something blocks the action it says why in words, for example *"Your role cannot create tasks or cases from conversations."*

### Draft with Copilot

- Click **Draft with Copilot** (or **Draft reply** in the closing-window banner). A reply appears **in your box**. **Read it. Edit it. Then send.**
- **Check before sending:** the customer's name, trip, dates, party, room, price and currency, what is included, **live seats**, tone and language, any open review, and that it makes **no promise** about payment, visa, discounts, refunds, bookings, health, safety or religion.
- If you heavily rewrite or discard a draft, that is recorded as a "rejection" and teaches the system. Two substantial corrections retire a saved "approved answer" it came from.
- It refuses when the customer **opted out of contact** ("This lead has opted out of contact…").
- If the setting is **Observe only**, you see: *"Inbox autonomy is at L0 Observe. Move to L1 Assist before asking Copilot to draft replies."* Ask an administrator (§20).

### The offer card ("Best departure")

When Copilot found a matching trip, a card shows: **title and badge** (*Strong / Good / Partial / Weak fit*), **departs date and days**, **Price** per person and **room**, **Seats** open, **Total** for the party, **Why this matches** (expandable), **Includes**, **Be aware**, **Not known yet**, and **Other options** (each with **Open**).

**Four buttons:**

| Button | What it does |
|---|---|
| **Draft reply** | Puts an editable reply built from the offer in your box. |
| **Create quote** | Creates a **draft** quote on the lead. **Nothing is sent to the customer.** The quote takes live price, seats and inclusions from the group and applies **no discount**. Needs a linked lead, a known room type and a known party. |
| **Open group** | Opens the departure group page in a new tab. |
| **Ask follow-up / Ask for missing details** | Puts the most useful missing question in your box. |

Three modes:

- **Best departure** — normal.
- **Best departure so far** — details missing; *Ask for missing details* is the main button.
- **Human review required** — the price or seats changed, or the group is full/closed. The card shows a red warning and *"Do not confirm this departure to the customer."* **Draft reply** and **Create quote** are **removed** (only **Open group** and **Ask follow-up** remain).

The card always says **"Worked out 2 hours ago. Seats and prices are checked again each time you open this."** The system re-checks live price and seats every time you press a button, so a stale number is never sent.

### What Copilot never does

Confirm inventory or payment, promise a visa result, grant a discount, promise a refund, give medical advice, or give a religious ruling. Those topics always need a person.

---

## 13. "Human review required" cards

A red card means **a person must look at something**. It stays at the top of the customer panel so it cannot be missed.

### What a card shows

A **headline**, optional badges (**Do not confirm yet** = blocking; **Someone is on it**; the team that owns it), **Why** (the guidance), **What to do**, and sometimes **"Only Finance or an Admin can close this."**

### The three buttons

| Button | Use it when | Needs a note? |
|---|---|---|
| **I am on it** | You are handling it. Shows "Someone is on it" to others. | No |
| **Resolve** | You checked and dealt with it. | **Yes** — "What did you find?" |
| **Dismiss** | It is not a real problem. | **Yes** — "Why is this not a problem?" |

Notes are required (up to 1,000 characters) so every closure is a decision someone answers for.

### While a blocking review is open

The server **refuses to send** words that confirm what the review guards (for example "we have received your payment" while a payment claim is open). You will see a refusal message. Resolve the review with a note first, or rephrase without confirming. If the system cannot read the open reviews it refuses to send rather than guess ("Could not check whether a review is open on this conversation. Try again in a moment.").

### Every kind of review

| Headline | Blocks? | What to do | Who can close |
|---|---|---|---|
| **The customer says they paid, but no payment is recorded** | **Yes** | Do not confirm. Check the bank statement and payments list. Record it if present. Resolve with a note. Meanwhile just acknowledge the message. | Finance, Admin |
| **A bank account was mentioned that is not on the approved list** | **Yes** | Do not send or confirm the details. Finance adds the account if genuine; otherwise warn the customer. | Finance, Admin |
| **The customer is asking for a refund** | **Yes** | Do not promise or refuse. Say a colleague will come back. Finance decides. | Finance, Admin |
| **The customer is worried about fraud** | **Yes** | Reassure with facts a person can stand behind (agency registration, approved bank accounts). Do not send bank details in chat. Do not confirm a payment until Finance checks. | Finance, Admin |
| **Someone may be ill or in a medical emergency** | **Yes** | A person answers **now**. No medical advice. For an emergency, tell them to contact local emergency services, then involve Operations. | Admin, Marketing, Operations, Finance |
| **The customer sounds distressed or in trouble** | **Yes** | A person answers now, kindly and personally. | same as above |
| **A price we sent has changed since** | No | Check the group and tell the customer the current price. | same as above |
| **The departure they want cannot take the whole party** | No | Do not promise seats. Offer the waitlist or another departure. | same |
| **A passport may not be valid long enough** | No | Ask for a renewed passport before the booking goes further. | same |
| **The customer sent an identity or financial document** | No | Handle with care. Move it to the traveller's record. Do not forward or repeat contents in the chat. | same |
| **A traveller is a minor or needs assistance** | No | Check guardian and assistance arrangements first. Do not promise unarranged services. | same |
| **The customer quoted a booking we cannot find** | No | Search by name and phone. Do not say a booking exists until found. | same |
| **The customer is making a complaint** | No | Answer personally. Do not close the complaint yourself. Apologise where due and say who will follow up and when. | same |
| **The customer is asking for a religious ruling** | No | Give no ruling. Kindly point to a qualified scholar or the group's Ustaz. | same |

Roles that **cannot** close any review: **CEO and Visa**. Their buttons still appear, but pressing Resolve or Dismiss ends in an error message. Marketing and Operations **cannot** close the four money reviews (payment claim, bank detail, refund, fraud) and are told so.

A review can also be raised because a **reply target was missed** if your administrator turned that on (§20).

> **Never** treat a payment slip or "I have paid" as money received. Finance confirms payments.

---

## 14. Files and voice notes from customers

Files are processed **in the background** and never delay the message. All files are private; staff open them through short-lived secure links.

### What customers can send

| Channel | Accepted |
|---|---|
| **WhatsApp** | Text, **photos**, **documents** (PDF, Word, Excel, PowerPoint, text, CSV…) and **voice messages** |
| Others | Messages and supported files |

**Not accepted:** videos, contact cards, locations, stickers, orders, interactive replies, archives, programs and unknown types. These are **not stored** in the Inbox, so **you will not see them**. The customer automatically gets *"Sorry, this message type isn't supported. Please send a text message, a document (such as PDF or Word), an image, or an audio message instead."* (once per delivery). Emoji reactions are ignored silently. **If a customer says "I sent you a video / my location" and you see nothing, this is why.**

### Photos and files in the thread

- A photo shows as a picture (click to open full size in a new tab).
- Other files show as a link with the file name.
- While a file is still arriving you see **"Loading photo…"** / **"Loading voice message…"** / **"Loading file…"**. The Inbox looks again every few seconds for about a minute. If it still shows Loading after a few minutes, the file may have failed or expired — see §22.

### Voice notes

- A custom **player**: **Play/Pause**, a **progress bar**, and a **speed button**. Only one voice note plays at a time — starting another pauses the first.
- If it cannot play, the Inbox renews the secure link once: *"Refreshing voice message…"* then *"Voice message refreshed. Press Play again."* If it still fails: *"This voice message could not be played."*
- If your agency has **voice transcripts** switched on, a **"Staff only"** panel appears under the note with the machine-typed words, the language, and **"Low confidence"** when unsure. **It is never sent to the customer.** There is a copy button so you can use the text in your own reply. **A transcript can be wrong — listen to the audio** and confirm any names, numbers, dates or amounts in writing with the customer. If transcripts are off, you only get playback.

### Passport photo or PDF — "Attachment review"

A review card appears under the message. It lists the **fields the AI read** (passport number, expiry, name…), each with **"LLM · 85% confidence"**. Any field **under 90%** is outlined in red with **"Check this field"**.

Follow this order:

1. **Open the original** and compare it with the fields. Never trust the fields alone.
2. If several travellers are possible, choose the right one under **Traveller** (a message says "Choose the traveller above…" until you do). Selecting updates the comparison.
3. Click **Review fields** (if your role allows), correct the **passport number** and **expiry date**, then **Save to traveller record**. **Only this explicit confirmation writes to the traveller's record.** (Roles: Administrator, Operations, Visa.)
4. **Assign visa officer** (if allowed) — choose a colleague to give the traveller's visa file to.
5. **Save to Documents** — copies the passport into the traveller's passport checklist (it becomes **submitted**, not verified; verify it in the Documents module). The badge changes from **"Not saved to Documents — The Inbox copy is temporary and expires"** to **"Saved to Documents — This copy is kept with the booking documents."** (Roles: Administrator, Operations, Visa.) Multi-traveller bookings need you to pick the traveller first.
6. Resolve any passport review with a note.

If you do **not** save it, the Inbox copy **expires** on the date shown ("The Inbox copy expires 12/11/2026") under your agency's retention rules (§20).

**Passports are never saved to the shared Document Vault.**

### Payment receipt or transfer slip — "Attachment review"

The card lists a candidate **amount, reference and date** and a badge **"Not verified — A payment counts only after Finance has checked it against the booking."**

Buttons:

- **Send acknowledgement** — puts this message in your reply box: *"Thank you, we have received your payment proof. Our finance team will check it against your booking and let you know once it has been verified."* Read it, edit it, send. It does **not** confirm payment, and the button only adds text — **you** still press send.
- **Open Finance review** — opens Finance → Payments in a new tab. Only for roles that can see the payments ledger (Administrator, CEO, Finance).
- A second card, **Finance evidence — "Copy this receipt for Finance to review. This does not create or verify a payment."** with **Copy to Finance**. After copying, **Open Finance evidence** appears. Supported file types: PDF, JPG, PNG, WebP, HEIC.

Who may **Copy to Finance**: **Administrator, CEO and Finance** always. **Marketing and Operations cannot**, even on their own chats — they see a note instead. If you are Marketing/Operations, tell Finance about the receipt in an **internal note and mention** them.

A receipt alone creates **no payment, allocation or confirmation**. It also opens a **blocking, Finance-owned review** (§13).

### Brochure or other file — "What to do with this file"

For a brochure or a non-photo file the card says **"Choose where to keep this file. Nothing is sent to the customer."**

- Brochure: **Save as proposal collateral**.
- Other file: **Save to Documents** (the shared Document Vault).
- **Download the original** (new tab).

Buttons are only shown if your role manages the Vault and the file type (PDF, JPG, PNG, Word, Excel, PowerPoint) and size (**10 MB** maximum) fit; otherwise the card says why ("This file is too large to save to Documents (10 MB limit). Download it instead."). After saving, a **Saved to Documents** badge shows. Files the AI cannot read (for example Office files) say **"This file type cannot be read automatically. Download it to open it."**

### If a file shows no review card

Possible reasons: the AI file reading is switched off for your plan, it is still working, the file type is not read (Word, Excel, text), or it decided it was a brochure/other. Open the original and handle it by hand. **Never wait for the AI to answer a customer.**

---

## 15. Turning a conversation into work

Use **Create task or case** (customer panel → **Turn into work**, or the ⋯ **More actions** button on the recommended-action card). Only roles that can convert chats see it (Administrator, Marketing, Operations). Most items also need a **linked lead** — otherwise the menu shows **why** an item is greyed out.

### The 12 things you can create

| Item | What is created | Needs first |
|---|---|---|
| **Request documents** | Task for Operations to ask for travel documents | A selected departure group |
| **Create visa task** | Task for the Visa team | A selected departure group |
| **Follow up on payment** | Task for Finance | A selected departure group |
| **Rooming request** | Task for Operations | A selected departure group |
| **Transport requirement** | Task for Operations | A selected departure group |
| **Escalate to guide** | Task for the group's guide | A selected departure group |
| **Open complaint case** | A support case | A traveller record (appears once a booking lists them) |
| **Create traveller profile** | Traveller profile from the lead | A lead, and no profile yet |
| **Record family or mahram link** | How two travellers are related (used for rooming and mahram checks) | A booking with at least two travellers |
| **Hold seats** | A time-limited **hold** (not a booking) that releases itself | A lead, a selected group, a phone number, and no existing booking or hold |
| **Recommend a package** | Records a recommendation on the lead; does not change what the customer chose | A lead |
| **Request post-trip feedback** | Task to send a survey after the trip | A selected departure group |

Greyed-out reasons you may see: *Link this conversation to a lead first.* · *Select a departure group for this customer first.* · *This customer has no booking yet.* · *This customer has no traveller record yet. It appears once their booking lists them as a traveller.* · *A relationship needs two travellers on the booking.* · *This customer already has a booking or a seat hold.* · *This customer already has a traveller record.* · *Add the customer's phone number to their lead first.*

### The two-step safety flow

1. **Choose** the item. A side sheet asks for what is needed (a choice, a number, a tick box) and an optional **Note for the team** (up to 300 characters).
2. Click **Review**. A sheet titled **Check before creating** shows **exactly what will be made** — "Nothing has been created yet."
3. Click **Create**. You see **Created — "… was added and is linked to this conversation."** The task gets a due time 24 hours ahead and points back to the chat.
4. **Cancel** (or closing the sheet) at the review step **withdraws** the request so nothing stale is left behind.

---

## 16. Handing a booking over to Operations

For a **confirmed** booking, **Booking** section → **Operations handoff**. (Administrator and Marketing.)

- The system builds a **snapshot** in a side sheet: **Customer and booking**, **Customer expectations** (written from the conversation) and **Open items**.
- It needs a **confirmed booking** linked to the chat. Operations is notified and acknowledges the handoff on **their own page** (only Operations or an administrator can). The sheet then changes from **"Waiting for Operations to acknowledge."** to **"Operations acknowledged this on <date>."**
- The snapshot is a **point in time**. Later edits do not change what Sales handed over.
- If it was saved without the expectations text and nobody has acknowledged it yet, press the button again to complete it.

---

## 17. Close, spam and delete — which one to use

| | **Close** | **Mark as spam** | **Delete** |
|---|---|---|---|
| Use when | The matter is finished | The chat is junk or irrelevant | You must remove all data (administrators only) |
| Where it goes | **Closed** queue | **Spam** queue | Gone |
| Reversible? | The customer writing again reopens it | **Yes** — select it in Spam → **Not spam** | **No** |
| Deletes anything? | No | No | **Everything** in that chat |
| Confirmation | Yes (single chat); **none** in bulk | Yes | Yes |
| Who | Admin, Marketing, Operations | same | **Administrator only** |

Spam rules:

- A chat is **skipped (not marked)** if its lead has a **booking**, it has an **open review**, it is already spam, or its lead is spam. You are told how many were left alone.
- If **any selected chat is not your agency's**, **nothing** is changed.
- Spam stops Copilot reading the chat. It does **not** stop the WhatsApp assistant from answering a message that arrives later.
- A chat whose **lead** is marked spam cannot be restored from the Inbox; change the lead's stage in Leads first.
- Each spam change is recorded in the chat's history.

---

## 18. Keyboard shortcuts

Press **?** at any time to see them. They **never act while you are typing**, while a keyboard suggestion is open, or when Ctrl / Alt / Cmd is held. They do not work while a dialog is open (except **Esc**).

| Key | What it does |
|---|---|
| **j** / **k** | Open the next / previous conversation in the list |
| **/** | Jump to the search box |
| **r** | Go to the reply box |
| **n** | Go to the internal note box |
| **a** | Open the owner drop-down |
| **q** | **Move to** the **Create quote** button. It only *focuses* it — you still press it. (Prevents an accidental quote.) |
| **e** | Open the linked **lead** |
| **b** | Open the linked **booking** |
| **g** then **d** | Open the linked **departure group** (second key within 1 second) |
| **Esc** | Close the open sheet or panel |
| **?** | Show the shortcut list |

A shortcut only works if the matching button is visible and available to you. If not, a small message says why ("Your role cannot assign owners.", "This conversation has no linked lead.", "Open a conversation first.").

---

## 19. The Outcomes panel (for managers)

Click **Outcomes** at the bottom of the left menu (full-width screens). It shows numbers about the Inbox, grouped by topic. **You only see figures your role allows:**

| Role | Sees |
|---|---|
| Administrator, CEO | Everything, including AI cost and quality |
| Finance | Daily work, sales and safety figures, plus payment-review figures; no AI cost |
| Marketing, Operations, Visa | Daily work, sales and safety figures |
| Guide | Nothing (no Inbox access) |

Each card has a **basis** ("Right now" or "Last 30 days") and a state:

| State | Meaning |
|---|---|
| **A number** | Counted from your agency's own records. Zero means zero. |
| **No data yet** | Nothing to measure yet. **Not zero.** |
| **Not measurable yet** | The system does not store what is needed. The card says why. |
| **Could not be read** | A source failed just now. Try again. **Not zero.** |

**Open these conversations** opens the exact queue the number was counted from, so you can check it. Do not estimate hidden figures by hand and report them as system numbers.

Known gaps: first-response time, within-target rate, conversion rates, draft acceptance and triage corrections are **not measurable yet**; AI cost leaves out image and voice work, so treat it as a minimum.

The dashboard's **Inbox panel** shows ten counts (New enquiries, Qualified opportunities, Booking-ready, High-value family/group enquiries, Awaiting staff reply, Nearing channel deadline, Payment claims needing verification, Document and visa escalations, AI-safe resolutions, Human interventions required). Click one to open its queue.

---

## 20. Settings that change how the Inbox behaves (administrators)

These live in **Management**. Staff do not need them, but they explain why the Inbox behaves differently between agencies.

| Where | What you can set | Effect on staff |
|---|---|---|
| **Settings → Operations → Automatic assignment** | On/off · keep a customer with their existing owner · only assign in working hours · when a chat counts as a **group** · share chats **to whoever has the least waiting** or **in turn** · who gets **Group enquiries / Visa questions / Document questions** | New chats get an owner by themselves. Nobody off shift, inactive or past their access date is picked; the chat waits **Unassigned** with its clock running. **Off until saved once.** |
| **Settings → Operations → Inbox staff availability** | **Shifts** and **leave** per person | A person must have a **shift** before they can receive auto-assigned chats. **Leave overrides** an overlapping shift. |
| **Settings → Operations → Working hours for reply targets** | Opening hours per day, **days the office is closed** (holidays, dates like `2026-12-25`) | Decides when reply clocks run. |
| **Settings → Operations → Inbox reply targets** | Per queue: **Reply within (minutes)**, **Resolve within (minutes)**, **Only count working hours**, **Open a review when a reply is overdue** | Feeds **Nearing deadline** and **Overdue**. Times are in the agency's time zone (Asia/Colombo by default). |
| **Settings → Data → Inbox retention** | How long to keep booking-linked messages (3–10 years), unconverted enquiries, **attachments (max 365 days)**, **voice audio (max 365 days)**, intelligence, AI audit, raw webhook data (max 90 days) | Decides when files "expire". Runs nightly. |
| **Settings → Email** | Connect a mailbox with IMAP | Needed for *Compose email* and email chats. |
| **Settings → WhatsApp Templates** | Sync approved templates | Without them, no new chats and no re-opening after 24 hours. |
| **Management → AI agent** | Behaviour: **Observe only / Draft replies / Safe automatic replies / Lead intake assistant**; approved answers | Decides whether Copilot drafts exist for staff. |

**Default reply targets** (minutes → readable):

| Queue | First reply | Resolution | Clock |
|---|---|---|---|
| Urgent, Complaints | 15 min | 24 h | Always |
| Ready to book | 15 min | 4 h | Working hours |
| Payments | 30 min | 4 h | Working hours |
| New enquiries | 30 min | 8 h | Working hours |
| Needs a reply | 1 h | — | Working hours |
| Qualified, Quote sent | 2 h | 48 h | Working hours |
| Documents, Visa questions | 4 h | 3 working days | Working hours |

*Waiting for customer, Waiting for our team and Closed have no target by design.*

**Levels of Copilot behaviour**

| Level | Name | What it does |
|---|---|---|
| L0 | **Observe only** | Reads and measures. Staff get no drafts. |
| L1 | **Draft replies** | Prepares editable drafts for staff to check and send. |
| L2 | **Safe automatic replies** | Sends approved greetings, FAQ answers and qualifying questions. Only when the evidence shown allows it. |
| L3 | **Lead intake assistant** | Collects dates, departure city, room arrangement and passport readiness, then hands over. |

The level actually used is the **lowest** of what the plan allows, what is configured, and how safe the conversation is. Price talk, booking confirmation, payments, refunds, visa results, medical or religious guidance **always** go to a person.

**Safe start for a new agency:** connect channels and check one real message each way → sync templates → set shifts, working hours and reply targets → keep Copilot on **Observe only** or **Draft replies** while you watch results → raise only when the evidence supports it.

---

## 21. Real-life scenarios, step by step

### A. A new customer asks about Umrah on WhatsApp

1. Open **Needs a reply** or **New enquiries**. Click the chat (it opens and is marked read).
2. Read the **channel banner**: window open?
3. In the customer panel: is there a **possible existing lead**? If yes, check the details and **Link conversation**; if it is truly a new person, **Link or create lead**.
4. Fill the **Trip** gaps. **Ask about …** drops the next question into the box.
5. When Copilot finds a trip, review the **offer card**: price, seats, inclusions, "Be aware".
6. **Draft reply** (or **Draft with Copilot**), **read it**, edit it, send.
7. Add an **internal note** if a colleague must follow up.

### B. The customer asks "how much?"

1. Check the **offer card** is not red ("Human review required").
2. **Create quote** → a **draft quote** is made on the lead; nothing is sent.
3. Draft a reply with the price from the offer card, edit and send. Follow your agency's normal process in **Leads** for sending the formal quote.

### C. The customer wants a discount

Copilot makes no discount promise and **Create quote** applies none. Take the chat (**Take control**), tell the customer a colleague will confirm, and follow your agency's discount approval. Leave an internal note.

### D. "I have paid" with a slip

1. A **blocking review** appears: *The customer says they paid, but no payment is recorded.* The slip shows a **Not verified** receipt card.
2. Click **Send acknowledgement**, edit it ("We received your slip and our team will confirm"), send. **Do not write "payment received".**
3. Finance/Admin/CEO: **Copy to Finance** and **Open Finance review**. Marketing/Operations: leave a **note and mention** Finance.
4. Finance checks the bank, records the payment in Finance, then **resolves the review with a note**.
5. Only after that confirm payment to the customer.

### E. A passport arrives

1. The thread shows the photo and an **Attachment review**.
2. Open the original. Choose the **traveller** if asked. Compare each field, especially any marked **Check this field**.
3. **Review fields** → fix → **Save to traveller record**.
4. **Assign visa officer** if needed. **Save to Documents**.
5. If a **passport may not be valid long enough** review appears, ask for a renewed passport.
6. **Resolve** the review with a note when done.

### F. A voice note arrives

Press **Play**. Listen fully. If a transcript appears, treat it as a hint. Repeat important numbers back **in writing** and ask the customer to confirm.

### G. The WhatsApp window is about to close

1. The banner turns red: **Reply window closes in 0h 40m**.
2. Click **Draft reply** in the banner or reply directly. Send **now**.
3. If it already closed: **Choose approved template**, fill values, check preview and charge, **Send approved template**.

### H. Messenger customer wrote 3 days ago and is now complaining

1. The window has closed. If the complaint flagged an open review (**complaint, distressed, fraud, medical, refund**) **and a person owns the chat**, the banner says **Human support reply allowed for …**. Write it yourself.
2. If not, you cannot reply — add a note and wait, or use another channel the customer agreed to.

### I. Instagram customer wants to send a PDF

Instagram only carries **photos**. Ask for a photo, or move the conversation to WhatsApp or email.

### J. The same person appears on two channels

Open the chat that has no lead. If **Possible existing lead found** appears, read the **reasons**. **Very likely** is still a suggestion. Click **Link conversation** only when you are sure. Use **Create separate lead** if they are different people.

### K. Two colleagues open the same chat

You see *"Name is writing a reply. Please coordinate before sending."* Add an **internal note** ("I'm taking this") and use **Assign owner** so the owner is clear. Remember it is a warning, not a lock.

### L. The customer is angry or distressed

1. A red review appears (**complaint** or **distressed**), the queue shows **Urgent** or **Complaints**, and **How they feel** says Angry/Distressed.
2. **Take control**, click **I am on it**.
3. Reply personally and kindly. Do not argue and do not promise a refund.
4. **Open complaint case** (§15) — note it needs a traveller record.
5. Resolve the review with a note when the matter is handled.

### M. The customer asks for a refund or to cancel

A **blocking** refund review opens for Finance. Say a colleague will come back, do not promise or refuse, add a note and mention Finance. Only Finance or an Admin can close that review.

### N. The customer asks a religious question

Do not give a ruling. Say kindly that a qualified scholar or the group's Ustaz can help.

### O. A customer is ready to book

1. Confirm the lead is linked, the phone number is present and the group is **selected**.
2. **Select departure group** if not yet selected (it checks seats).
3. **Create booking**. It starts as **Deposit pending** and **holds seats**.
4. If you need only a temporary reservation: **Hold seats** (§15) instead.
5. Schedule a **follow-up** for the deposit.

### P. A confirmed booking moves to Operations

**Booking** section → **Operations handoff**. Read the sheet. Operations acknowledges; the sheet will show that.

### Q. You must hand your chats to a colleague (end of shift or leave)

1. **Select conversations** in **Assigned to me** → tick them (maximum 50) → **Give to…** → choose the colleague. Each chat gets an owner-change record, and they get one notification: "<You> gave you N conversations."
2. Or change a single chat with its owner drop-down.

### R. A chat is waiting on you but you are off

An administrator can reassign in bulk (above) or remove your owner (**Unassigned**), which turns each into **Staff action needed** so it is visible in **Unassigned**.

### S. Cleaning junk

**Select conversations** → tick junk → **Mark as spam** → confirm. A wrong choice is fixed in the **Spam** queue with **Not spam**.

### T. A message failed

Under the message you see **Not sent** or **Failed**. Click **Retry**. It will not send twice. If it keeps failing, read the red reason (closed window, channel disconnected, test agency).

### U. A file will not attach

Read the chip's red message. Usual reasons: wrong type (not JPG/PNG/PDF/Word/Excel/PowerPoint), too big (photo > 5 MB, document > 10 MB), contains macros or scripts, Instagram + document, or the upload dropped. Remove and attach again.

### V. You need to send a brochure

Click **+** → **Choose from vault** → pick the document → add a caption → send. (WhatsApp, Messenger and Email only; Instagram needs a photo.)

### W. You need a customer's old messages

Use **search** (name, phone, email or lead reference — it searches **all** conversations, not just the loaded page). Open the chat and scroll up. If the customer's chat was **closed**, search still finds it.

### X. A closed chat comes back

The customer wrote again. It reappears in **Needs a reply** and keeps its previous owner.

### Y. A colleague asks you to look at a chat

They may send you a link ending in `?conversation=…`. Open it; the Inbox opens on that chat. A **mention** in an internal note also notifies you.

### Z. Daily wrap-up

Check **Assigned to me**, **Urgent**, **Payments**, **Overdue**, **Nearing deadline**, and **Unassigned**. Nothing should be overdue under your name. Leave notes on unresolved payment, document, visa, complaint and booking matters. Close finished chats.

---

## 22. When something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| **Failed / Not delivered** under a message | The customer did not receive it. | Read the reason. **Retry** (safe, no duplicate). |
| **Not sent** with **Retry / Dismiss** | The CRM could not queue it. | **Retry**. |
| *Outside the 24h WhatsApp service window — only an approved template can be sent now.* | Free typing is refused. | Use **Choose approved template**. |
| *Outside the 24h Messenger/Instagram reply window — … Wait for them to write again.* | No template exists for these. | Add a note; wait. |
| *Outside the allowed … support window…* | The seven-day exception does not apply. | Re-engage on another channel the customer agreed to, or wait. |
| *Messenger only lets you reply after the customer has messaged you.* | You cannot start Messenger/Instagram chats. | Notes only until they write. |
| *Replying on this channel isn't available yet.* | The channel can read but has no sender. | Reply on another channel. |
| *This conversation is closed.* | Cannot reply to a closed chat. | The customer writing again reopens it. |
| *Not permitted.* / "Your role cannot…" | Your role does not allow it. | Ask an administrator. Do not look for a workaround. |
| Reply refused because of a review | A **blocking review** guards those words. | Resolve the review with a note, or rephrase without confirming. |
| *Could not check whether a review is open on this conversation. Try again in a moment.* | The safety check could not read reviews, so nothing was sent. | Wait and try again. |
| *This is a test agency. Test agencies never send to real customers.* | You are in a test setup. | Use a production agency. |
| *Someone else changed this conversation just now.* | Two people acted at once. | Refresh and retry. |
| *That person cannot take Inbox conversations.* | The chosen colleague is inactive or has no Inbox rights. | Choose someone else. |
| **Search failed** | The search could not run. | **Try again**. |
| "Copilot is reading…" for a long time | Reading still running. | Work manually. Do not wait. |
| Copilot reading missing | Switched off, skipped, failed or not in your plan. | Work manually from the messages and CRM. |
| *Inbox autonomy is at L0 Observe…* | Drafts are off. | Ask an administrator for **Draft replies**. |
| **Draft with Copilot** missing | Your role has no Copilot (Operations, Finance, Visa, CEO) or the setting is off. | Reply by hand or ask a colleague. |
| "Link a lead before …" | Many actions need a lead. | **Link or create lead** first (Admin/Marketing). |
| Create booking / quote button missing | Your role cannot (Operations cannot) or a lead is missing. | Ask Marketing/Admin. |
| A button is missing | Your role may not allow it, or the thing is not available. | Hover or read the note beside it; ask an administrator. |
| **Loading photo…** for several minutes | File still arriving, failed, or expired under retention. | Refresh the page; ask the customer to resend. |
| Customer says they sent a video / location / sticker | Those types are not accepted. | The customer was told automatically. Ask for text, image, document or voice. |
| Passport has no **Save to Documents** | Not read as a passport, no traveller found, no passport item on the booking, file expired, or you lack Documents/sensitive-data permission. | Open the original and handle in Documents. |
| *Only Finance or an Admin can close this review.* | Money reviews are Finance-owned. | Leave a note and mention Finance. |
| *Choose between 1 and 50 conversations.* | Too many selected. | Select 50 or fewer. |
| An **Outcomes** card says **Could not be read** | A source failed. | Try again. It is not zero. |
| A conversation looks assigned to you but you did not choose it | Sending a reply, taking control, or starting a chat with that contact makes you the owner. | Reassign it with the owner drop-down. |
| A closed chat reappeared | The customer wrote again. | Normal. |

---

## 23. Golden rules

**Do**

- Read the **channel banner** and any **red review** before you type.
- Read Copilot's evidence (**Why?**), not just its confidence.
- Check price, currency, inclusions and **live seats** before sending a draft.
- Leave an **internal note** whenever someone else must act, and **mention** them.
- Confirm numbers, names and dates from voice notes **in writing**.
- Ask Finance before saying a payment arrived.
- Use **Retry** once for failed sends; do not copy and paste the message again.
- Search before starting a new chat with a number or email that may already exist.

**Do not**

- Promise a price, seat, discount, refund, visa result, bank detail or religious ruling that the CRM or the right team has not confirmed.
- Treat "I have paid" or a slip as money received.
- Copy a low-confidence Copilot fact into the CRM unchecked.
- Forward or repeat passport or bank details in a chat.
- Assume the thing on screen is the whole story — the server re-checks everything when you press send.
- Delete a conversation unless you are sure; it cannot be undone.
- Bulk-close chats you have not looked at; there is no undo.

---

## 24. What each role can do

(Exactly as the code computes it today. An administrator can change it only by changing roles in code and permissions; ask them if something looks wrong.)

| Ability | Admin | CEO | Marketing | Operations | Finance | Visa | Guide |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| Open the Inbox and read chats | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✖ |
| Reply, add notes, start chats, saved drafts | ✔ | ✖ | ✔ | ✔ | ✖ | ✖ | ✖ |
| Take control / hand back to AI | ✔ | ✖ | ✔ | ✔ | ✖ | ✖ | ✖ |
| Give a chat to someone (single or bulk) | ✔ | ✖ | ✔ | ✔ | ✖ | ✖ | ✖ |
| Close, mark spam, restore from spam | ✔ | ✖ | ✔ | ✔ | ✖ | ✖ | ✖ |
| Create task or case from a chat | ✔ | ✖ | ✔ | ✔ | ✖ | ✖ | ✖ |
| Create saved replies | ✔ | ✖ | ✔ | ✔ | ✖ | ✖ | ✖ |
| **Delete** a conversation | ✔ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ |
| Retry failed background jobs | ✔ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ |
| Create lead, select group, create booking, draft quote, schedule follow-up | ✔ | ✖ | ✔ | ✖ | ✖ | ✖ | ✖ |
| Use Copilot (drafts, offer card, handoff) | ✔ | ✖* | ✔ | ✖ | ✖ | ✖ | ✖ |
| Save passport to Documents, review (confirm) passport fields, assign visa officer | ✔ | ✖ | ✖ | ✔ | ✖ | ✔ | ✖ |
| Copy a receipt to Finance / open Finance review | ✔ | ✔ | ✖ | ✖ | ✔ | ✖ | ✖ |
| Save brochure/file to the Document Vault | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✖ |
| Close money reviews (payment, bank, refund, fraud) | ✔ | ✖ | ✖ | ✖ | ✔ | ✖ | ✖ |
| Close other reviews | ✔ | ✖ | ✔ | ✔ | ✔ | ✖ | ✖ |
| See Outcomes | ✔ (all) | ✔ (all) | ✔ | ✔ | ✔ (+payments) | ✔ | ✖ |

\* The CEO can see Copilot's reading but cannot send anything.

Even if a button is visible, **the server checks your role, your agency and the owning module again** every time. Hiding a button is never the only protection.

---

*Related documents: [Practical usage guide](usage-guide.md) (more technical), [staff guide](../../inbox/staff-guide.md), [admin guide](../../inbox/admin-guide.md), [Finance evidence guide](../../inbox/finance-evidence-guide.md), [spam contract](../../inbox/spam-state-contract.md), [channels and AI agent guide](../../inbox/channels-and-ai-agent-guide.md).*
