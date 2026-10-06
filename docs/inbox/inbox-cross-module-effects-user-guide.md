# When a Chat Does More Than Chat — A Simple Guide

> **Who this is for:** everyone who uses the Inbox. No technical knowledge needed.
>
> **The big idea:** the Inbox is not only for messages. When a customer sends a **payment slip**, a **passport**, or a **brochure**, or when you press **Create booking**, things happen in **other parts of the CRM** — Finance, Documents, Visa, Leads, Bookings, Operations. This guide explains **what happens, who does it, and what you should do.**
>
> Looking for the basics (reading, replying, queues)? See [`inbox-user-guide.md`](./inbox-user-guide.md). Engineers: [`inbox-cross-module-effects-technical.md`](./inbox-cross-module-effects-technical.md).
>
> *Checked against the system on 5 October 2026. If your screen differs, trust your screen and tell your administrator.*

## What is in this guide

1. [The golden rule: the system suggests, you decide](#1-the-golden-rule-the-system-suggests-you-decide)
2. [What happens by itself, and what needs your click](#2-what-happens-by-itself-and-what-needs-your-click)
3. [A customer sends a payment slip](#3-a-customer-sends-a-payment-slip)
4. [A customer sends a passport](#4-a-customer-sends-a-passport)
5. [A customer sends a brochure or other file](#5-a-customer-sends-a-brochure-or-other-file)
6. [A customer sends a voice message](#6-a-customer-sends-a-voice-message)
7. [Turning a chat into a lead](#7-turning-a-chat-into-a-lead)
8. [Choosing a trip and creating a booking](#8-choosing-a-trip-and-creating-a-booking)
9. [Quotes and follow-ups](#9-quotes-and-follow-ups)
10. [Creating tasks and cases from a chat](#10-creating-tasks-and-cases-from-a-chat)
11. [Handing a confirmed booking to Operations](#11-handing-a-confirmed-booking-to-operations)
12. [The customer's trail: where everything is recorded](#12-the-customers-trail-where-everything-is-recorded)
13. [Who can do what](#13-who-can-do-what)
14. [Real situations, step by step](#14-real-situations-step-by-step)
15. [Problems and what they mean](#15-problems-and-what-they-mean)
16. [One-page cheat sheet](#16-one-page-cheat-sheet)

---

## 1. The golden rule: the system suggests, you decide

The Inbox has a built-in reader (an AI) that looks at files customers send. It can **read** a passport or a payment slip and **show you** what it found. It **never**:

- ❌ records a payment,
- ❌ changes a traveller's passport details,
- ❌ confirms a booking,
- ❌ sends anything to the customer on its own.

Every one of those happens **only when a person presses a button**, and the system checks again that you are allowed to.

> **The reader can make mistakes.** Always open the original photo and check it yourself before you confirm anything.

---

## 2. What happens by itself, and what needs your click

### Happens by itself (in the background, within moments)

| When this arrives… | The Inbox automatically… |
|---|---|
| **A payment slip or receipt** | Keeps a private copy, reads the amount / reference / date, shows an **Attachment review** card, and opens a red **“Payment proof requires verification”** review marked **Do not confirm yet**. The chat moves into **Payments** and **Urgent**. |
| **A passport** | Keeps a private copy, reads the number / expiry / name, tries to find which traveller on the booking it belongs to, shows an **Attachment review** card, and — if something looks wrong (expired, expires too soon for the trip, unsure reading, no traveller found) — opens a red **passport review** for Operations. |
| **A brochure or other file** | Keeps a private copy and shows a short summary with **“Choose where to keep this file.”** |
| **A voice message** | Keeps the audio so you can play it, and (if switched on) writes a staff-only text version. |

### Needs a person to press a button

| You want to… | Press… | What it does |
|---|---|---|
| Send a slip to Finance | **Copy to Finance** | Puts a copy in Finance's list to be checked. **Creates no payment.** |
| Thank the customer for the slip | **Send acknowledgement** | Puts a polite message in your reply box. **You** still press Send. |
| Fix the passport details | **Review fields** → **Save to traveller record** | Writes the number and expiry you confirmed to the traveller. |
| Keep the passport with the booking | **Save to Documents** | Adds it to the traveller's document checklist as **submitted**. |
| Give the visa file to a colleague | **Assign visa officer** | Assigns it in the Visa section. |
| Keep a brochure | **Save as proposal collateral / Save to Documents** | Saves it to the shared Document Vault. |
| Make a customer record | **Link or create lead** | Links or creates the lead. |
| Reserve a trip | **Select departure group**, then **Create booking** | Creates a booking and holds seats. |

---

## 3. A customer sends a payment slip

### What you will see (without doing anything)

1. A new message with the photo/PDF appears.
2. A moment later a card appears under it called **Attachment review**, showing:
   - a possible **amount**, **reference** and **date**,
   - the label **“Not verified — a payment counts only after Finance has checked it against the booking.”**
3. In the customer panel on the right, a **red card**: **“Payment proof requires verification”** with **Do not confirm yet**.
4. The chat appears in the **Payments** queue (and often **Urgent**).

> A slip is **proof of a claim**, not money received.

### What you should do

**If you are Finance, Administrator or CEO:**
1. Click **Send acknowledgement** → edit if you like → **Send**. (*“Thank you, we have received your payment proof. Our finance team will check it against your booking and let you know once it has been verified.”*)
2. Click **Copy to Finance**. You will see *“Receipt copied for Finance review. No payment was created or verified.”* A link **Open Finance evidence** appears.
3. Click **Open Finance review** to go to **Finance → Payments**.

**If you are Marketing or Operations** (the usual case):
1. Click **Send acknowledgement** → **Send**.
2. You will usually not see an active **Copy to Finance** (it needs Finance access). Write an **Internal note** and **mention a Finance colleague**: “Slip received for LD-1042, please check.”

### What Finance does next (so you understand the chain)

1. In **Finance → Payments → receipt evidence** they see your slip, with suggested matching payments and **why** each was suggested (same reference, same amount, same booking, same day…).
2. They check the **bank statement themselves**, then either:
   - **Match to this payment**, or
   - **Dismiss receipt** with a reason (for example “not a payment proof”).
3. They record or confirm the payment in Finance as usual.
4. Back in the Inbox, they **Resolve** the red review **with a note**.
5. **Only now** may anyone tell the customer “payment received.”

### Important

- ⚠️ **Copying to Finance does *not* close the red review.** A person must resolve it with a note.
- ⚠️ While the red review is open, the system **refuses** to send words that confirm payment (like “we have received your payment”). That is on purpose. Resolve the review or rephrase.
- The slip is **never** saved in the shared Documents area. It goes to Finance only.
- A matched or dismissed slip **cannot be re-opened** from the screen. If a mistake is made, tell an administrator.

---

## 4. A customer sends a passport

### What you will see automatically

An **Attachment review** card listing what the reader found — **passport number, expiry date, name** — each with a confidence like *“LLM · 85% confidence”*. Anything under **90%** is outlined in red: **“Check this field.”**

It also tries to find **which traveller** the passport belongs to (from the customer's booking). Then one of these happens:

| Situation | What you see |
|---|---|
| One traveller clearly matches | That traveller is selected for you. |
| Several could match | “Choose the traveller above…” — you must choose. |
| The chat has **no booking yet** | No traveller can be matched. (Create the booking first — see §8.) |
| Passport expired, or expires too soon for the trip | A red review: **“Passport expiry requires review”**. |
| Reading unsure, or name/number differs from the record | A red review: **“Passport requires review”**, given to Operations. |

### What you should do, in this order

1. **Open the original** and compare it with the fields. **Never trust the fields alone.**
2. If asked, pick the correct **Traveller**.
3. **Review fields** (Administrator, Operations, Visa). Correct the **passport number** and **expiry date**, then **Save to traveller record**.
   - Only this click writes to the traveller's record.
   - The record refuses an expiry that is before the departure date.
4. **Save to Documents** (Administrator, Operations, Visa).
   - Copies the passport into that traveller's passport slot in **Documents**.
   - It is marked **submitted**, **not verified**. Someone must still verify it in the Documents section.
   - The badge changes from **“Not saved to Documents — the Inbox copy is temporary and expires”** to **“Saved to Documents — This copy is kept with the booking documents.”**
5. **Assign visa officer** (if your role allows). Pick a colleague; the traveller's visa file is assigned to them in the **Visa** section, and shows there exactly as if it was assigned there.
6. **Resolve** the passport review with a note when you have dealt with it. If the passport is too close to expiry, **ask the customer for a renewed passport** first.

### Important

- If you **never** press **Save to Documents**, the Inbox copy **expires** on the date shown (your agency's retention rule, 90 days unless changed). **Save it before then.**
- Double-clicking is safe: the second click is told it is already being saved.
- If your role may not see passports, you will see a **restricted** note and no link. That is on purpose.
- **Passports are never saved to the shared Document Vault**, which every staff role can read.
- **Do not repeat passport details in the chat.**

---

## 5. A customer sends a brochure or other file

The card says **“Choose where to keep this file. Nothing is sent to the customer.”**

| It looks like… | Button |
|---|---|
| A brochure | **Save as proposal collateral** |
| Any other file | **Save to Documents** (the shared Document Vault) |
| Either | **Download the original** |

Rules:
- Allowed: PDF, JPG, PNG, Word, Excel, PowerPoint — **up to 10 MB**.
- If it can't be saved the card says why (for example *“This file is too large to save to Documents (10 MB limit). Download it instead.”*).
- After saving, a **Saved to Documents** badge appears. Repeated clicks do not make duplicates.
- Word/Excel/text files are kept and shown, but the reader can't open them: *“This file type cannot be read automatically. Download it to open it.”*

**The other direction:** to send **your** brochure to a customer, click **+ → Choose from vault** in the reply box.

---

## 6. A customer sends a voice message

- You can **play** it right away (Play/Pause, progress bar, speed button).
- If your agency has transcripts switched on, a **“Staff only”** box shows the typed words. **It can be wrong — listen to the audio.** Confirm names, numbers, dates and amounts **in writing** with the customer.
- Nothing from a voice message goes into any other part of the CRM by itself. If it contains something important, **type it into the right place yourself** (the lead, a note, a task).

---

## 7. Turning a chat into a lead

A **lead** is the customer's record in the CRM. Many things below (bookings, quotes, tasks) need one.

**When the contact is new**, the customer panel may show **“Possible existing lead found”** — *“This may be someone you already know. Nothing has been linked yet.”*

| Button | Meaning |
|---|---|
| **Link conversation** | “Yes, this is that person.” Use only when sure (a phone number match is the strongest sign; similar names alone are not enough). |
| **Create separate lead** | “These are different people.” The system will not suggest the pair again. |
| **Link or create lead** | Links to the lead with the exact same phone number, or creates a new lead. |

If more than one lead uses the same number, the system **will not guess** — link the right one from the **Leads** page.

**Who can:** Administrator and Marketing.

**What it records:** a new lead says “Lead captured from WhatsApp Inbox conversation.” in the lead's activity list, and remembers which chat it came from.

---

## 8. Choosing a trip and creating a booking

### Step 1 — Select departure group (records interest only)

In **Booking** → **Select departure group**. The list only shows trips that are on sale, not full, the right journey type, and with **enough seats for the party**.

- It adds “Selected <trip> as the departure group” to the lead's activity.
- ⚠️ **It does not hold seats.**

### Step 2 — Create booking

**What you need:** a linked lead · a selected trip · the customer's **phone number** on the lead · enough lead details (travellers, room). If something is missing the system tells you exactly what.

Click **Create booking**. The system:
1. Creates the booking as **Deposit pending** and **holds the seats**.
2. Links the booking to the lead and moves the lead to **Booked**.
3. Adds “Booking LD-… created; N seat(s) held” to the lead's activity.
4. Remembers which chat the booking came from.

Safe to know:
- **If you click twice**, or the first attempt half-worked, the system **links the existing booking instead of making a second one**.
- If the booking was made but could not be linked, you are told its reference — just press again; it will link, not duplicate.
- If a booking under that reference is cancelled or in a different trip, the system stops and asks a person to look.

**Who can:** Administrator and Marketing. **Operations cannot create bookings from the Inbox.**

**Why bookings matter for the rest of this guide:** once a booking exists, the Inbox can match **passports** to travellers, show the **balance**, and offer **Operations handoff**.

### Temporary hold only

Use **Turn into work → Hold seats** if the customer is not ready for a booking. It is a time-limited hold that **releases itself** when it expires.

---

## 9. Quotes and follow-ups

### Create quote
On the **offer card** or **recommended next action**: **Create quote**.
- Makes a **draft** quote on the lead, using the **live** price, seats and what's included. **No discount** is applied.
- It expires in 7 days.
- ⚠️ **Nothing is sent to the customer.** Send the formal quote from the **Leads** page.
- It needs a linked lead, a known room type and a known number of travellers. If the price or seats changed, it refuses and tells you.

### Schedule a follow-up
**Follow-up** section → choose date and time → **Schedule WhatsApp follow-up**.
- The time must be in the future.
- **You** become the follow-up owner, and it shows in the lead's follow-ups.

---

## 10. Creating tasks and cases from a chat

**Turn into work → Create task or case** (Administrator, Marketing, Operations). Most items need a **linked lead** and a **selected departure group**; the menu shows **why** an item is greyed out.

| Item | What is created | Who gets it |
|---|---|---|
| **Request documents** | Task to ask for travel documents | Operations |
| **Create visa task** | Task about the visa | Visa team |
| **Follow up on payment** | Task | Finance |
| **Rooming request** | Task | Operations |
| **Transport requirement** | Task | Operations |
| **Escalate to guide** | Task | The group's guide |
| **Open complaint case** | A support case | Support |
| **Create traveller profile** | Traveller profile from the lead | — |
| **Record family or mahram link** | How two travellers are related | — |
| **Hold seats** | Time-limited seat hold | — |
| **Recommend a package** | A recommendation on the lead | — |
| **Request post-trip feedback** | Task to send a survey | Operations |

**The safety check (always two steps):**
1. Choose the item, fill the small form, add an optional **Note for the team** (up to 300 letters), click **Review**.
2. A sheet says **“Check before creating — Nothing has been created yet”** and shows exactly what will be made. Click **Create**, or **Cancel** to withdraw it.

**What happens after Create:** the task is due **in 24 hours**, assigned to the right person, includes a link back to your chat and your note, and the assignee gets an **in-app notification**. If the trip changes between the preview and your click, the request is **cancelled instead of run**, so nothing stale is created.

---

## 11. Handing a confirmed booking to Operations

**Booking** section → **Operations handoff** (Administrator and Marketing). It needs a **confirmed booking** linked to the chat.

1. The system builds a **snapshot**: customer and booking facts, **what the customer expects** (written by the helper from the chat), and **open items**.
2. **Operations and administrators are notified** (not you).
3. Operations acknowledges it on their own page. The sheet then changes from **“Waiting for Operations to acknowledge.”** to **“Operations acknowledged this on <date>.”**

Good to know:
- It's a **photograph of that moment**. Later edits do not change what Sales handed over.
- If the helper could not write the “expectations” part, the handoff is still created; press the button again to complete it.

---

## 12. The customer's trail: where everything is recorded

Every important step leaves a mark **in the module that owns it**, so you can answer “what happened with this customer?”.

| What happened | Where to see it | What it says |
|---|---|---|
| Lead created from the chat | **Leads → the lead → Activity** | “Lead captured from WhatsApp Inbox conversation.” |
| Trip chosen | Lead → Activity | “Selected <trip> as the departure group.” |
| Booking created | Lead → Activity; **Bookings** | “Booking LD-… created; N seat(s) held.” Lead is now **Booked**. |
| Follow-up scheduled | Lead → Activity; follow-ups | “Next follow-up scheduled.” |
| Quote drafted | Lead → Quotes | Draft quote, linked to the chat |
| Slip copied to Finance | **Finance → Payments → receipt evidence** | Waiting for review |
| Slip matched / dismissed | Finance audit trail | “Receipt evidence matched to payment … No payment was verified, allocated, or changed.” or the reason it was dismissed |
| Passport saved | **Documents** (traveller's passport item) and its history | “Saved from an Inbox conversation.” — status **Submitted** |
| Passport details confirmed | The traveller's record history | New number and expiry |
| Visa officer assigned | **Visa** history | “Assigned” with who and when |
| Task or case created | **Tasks / Support** | Title, owner, due time, link back to the chat |
| Handoff | **Operations** | Snapshot and acknowledgement |
| Review resolved or dismissed | The chat's red card | Who, when, and the required note |
| Chat owner changes | The chat's **History** section | Who gave it to whom |

**Going back to the chat from another page:** records made from the Inbox remember their chat. Task descriptions include a link, and Finance evidence has an **Open in Inbox** link. Records created **outside** the Inbox have no chat to go back to.

**Deleting a chat** (administrators only) removes the messages and files, but the **lead, booking, tasks, finance evidence, documents and visa records stay**. They just lose the link back to the chat.

---

## 13. Who can do what

| Action | Admin | CEO | Marketing | Operations | Finance | Visa |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| See chats, cards and reviews | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| **Copy to Finance** | ✔ | ✔ | ✖* | ✖* | ✔ | ✖ |
| **Match / dismiss** a receipt (in Finance) | ✔ | ✖ (view only) | ✖ | ✖ | ✔ | ✖ |
| **Review fields** → traveller record | ✔ | ✖ | ✖ | ✔ | ✖ | ✔ |
| **Save passport to Documents** | ✔ | ✖ | ✖ | ✔ | ✖ | ✔ |
| **Assign visa officer** | ✔ | ✖ | ✖ | ✔ | ✖ | ✔ |
| Save brochure/file to the Document Vault | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| Link / create lead, select trip, **create booking**, quote, follow-up | ✔ | ✖ | ✔ | ✖ | ✖ | ✖ |
| **Turn into work** (tasks and cases) | ✔ | ✖ | ✔ | ✔ | ✖ | ✖ |
| **Operations handoff** | ✔ | ✖ | ✔ | ✔ | ✖ | ✖ |
| Close money reviews (payment, bank, refund, fraud) | ✔ | ✖ | ✖ | ✖ | ✔ | ✖ |
| Close other reviews | ✔ | ✖ | ✔ | ✔ | ✔ | ✖ |

\* Unless your administrator has given that role Finance ledger access *and* you own the chat.

If a button is missing, your role probably cannot use it. Do not look for a workaround — ask an administrator. **Even a visible button is checked again by the system when you press it.**

---

## 14. Real situations, step by step

### A. “I have paid” — slip arrives, you are Marketing
1. Open the chat. See **Attachment review** and the red **Payment proof requires verification**.
2. **Send acknowledgement**, edit, **Send**. Do **not** write “payment received.”
3. **Internal note**, **mention Finance**: “Slip for Amina, LD-1042, Rs 150,000, ref 88412.”
4. Leave the red card for Finance. Check later; do not tell the customer it is confirmed until Finance has resolved it.

### B. Same slip, you are Finance
1. Open the chat → **Copy to Finance**.
2. **Open Finance review** → find it in the receipt evidence list.
3. Check the **bank statement** yourself. Look at why each suggested payment was proposed.
4. **Match to this payment** (or **Dismiss receipt** with a reason).
5. Record/confirm the payment in Finance as normal.
6. Back in the Inbox: **Resolve** the red review with a note (“Matched to PAY-3345, bank statement checked 5 Oct”).
7. Now reply to the customer that the payment is confirmed.

### C. A passport arrives and the booking exists
1. Open the original. Compare number, expiry and name.
2. Check the selected **Traveller**.
3. **Review fields** → fix → **Save to traveller record**.
4. **Save to Documents**.
5. **Assign visa officer** if needed.
6. If a review is open, **Resolve** it with a note.
7. Ask the customer for any missing page, **in writing**, without repeating passport details back.

### D. A passport arrives but there is no booking yet
The reader finds no traveller. Do the booking steps first (**Link lead → Select departure group → Create booking**), then come back to the passport: the card will now find the travellers. Do not lose time — the Inbox copy **expires**.

### E. The passport is almost expired
You see **Passport expiry requires review**. Ask the customer for a **renewed passport**. Do not save the old one to the traveller record as valid. Resolve the review with a note once handled.

### F. Two travellers sent passports in the same chat
For each passport, **choose the correct traveller** before saving. Check the name against the passport photo.

### G. Customer is ready to book
Link lead → check phone number on the lead → **Select departure group** → **Create booking** → schedule a follow-up for the deposit → (later) when confirmed: **Operations handoff**.

### H. The customer wants a price
Check the **offer card** is not red → **Create quote** (draft) → **Draft reply** with the price → edit → send. Send the formal quote from **Leads**.

### I. A brochure arrives and you want it for later
**Save as proposal collateral** (brochure) or **Save to Documents**. Never send it to anyone by mistake — saving sends nothing.

### J. You need to send the customer a form from the vault
In the reply box: **+ → Choose from vault** → pick it → add a caption → **Send**.

### K. The customer asks for a document to be arranged (e.g. transport)
**Turn into work → Transport requirement** → fill → **Review** → read the sheet → **Create**. The assigned person is notified and the task links back to this chat.

### L. A booking is confirmed
**Booking → Operations handoff** → read the snapshot → leave it. Operations acknowledges.

### M. I pressed Create booking twice
No problem. The system links the booking that already exists instead of creating a second one.

### N. I saved the wrong thing
- **Wrong receipt matched or dismissed in Finance:** it cannot be undone from the screen. Tell an administrator. Do not try to match it again.
- **Wrong traveller chosen for a passport:** tell Operations/Admin; correct it in the traveller's own record and note why.
- **A lead linked to the wrong person:** the Inbox has an **unlink** action, but who may use it depends on your role. Tell your team lead or an administrator.

### O. Whose job is it? (quick guide)
| Customer sent… | First, do this | Then |
|---|---|---|
| Payment slip | Acknowledge only | Finance checks and resolves the review |
| Passport | Check the original | Save to traveller record → Documents → visa officer |
| Brochure | Save to collateral | Done |
| “Please change my room” | Turn into work → Rooming request | Operations |
| “I want to cancel / refund” | Do **not** promise | Note and mention Finance; a refund review opens |
| “Where is my visa?” | Check the Visa section | Create visa task if needed |

---

## 15. Problems and what they mean

| You see | What it means | What to do |
|---|---|---|
| *“Attachment review” never appears* | The AI reading is off for your plan, still working, or the file type can't be read | Open the original and handle by hand. Don't wait. |
| *“Loading photo…”* for minutes | The file is still arriving, failed or expired | Refresh; ask the customer to resend |
| *“This receipt is unavailable or is not ready for Finance review.”* | The original is not stored yet | Wait a moment; if it persists, ask the customer to resend |
| *“Finance cannot review this file type. Download it instead.”* | Finance accepts PDF, JPG, PNG, WebP, HEIC only | Download it and ask Finance by note |
| *“You cannot copy this receipt to Finance.”* | Your role has no Finance access | Note + mention Finance |
| Red review still open after Finance matched the slip | **Matching does not close it** | Finance/Admin: **Resolve** with a note |
| Reply refused while a review is open | The review protects those words | Resolve it with a note, or rephrase without confirming |
| *“Choose the traveller above…”* | More than one possible traveller | Pick the right one |
| No travellers appear | The lead has no **booking** yet | Create the booking first |
| *“That file is not a passport.”* | The reader decided it is something else | Open the original; handle by hand |
| *“Your role cannot save passports to Documents.”* / *“…review passports.”* | Needs Documents + sensitive-data access | Ask Operations, Visa or an administrator |
| *“This passport is already being saved. Check Documents in a moment.”* | Someone just clicked it | Wait, then check Documents |
| *“The Inbox copy of this file is no longer available.”* | It expired (retention) | Ask the customer to resend |
| Passport has no **Save to Documents** | No traveller, no passport slot on the checklist, expired copy, or no permission | Handle in the Documents page |
| *“That person cannot take visa files.”* | The chosen colleague is inactive or not a visa role | Pick someone else |
| *“Link a lead before creating a booking.”* | No lead on this chat | **Link or create lead** first |
| *“Add the customer's phone number to the lead before creating a booking.”* | Messenger/Instagram leads often have no number | Add it on the lead |
| *“Booking … exists, but it could not be linked to the lead. Try again.”* | The booking is made; the link failed once | Press again — it links, not duplicates |
| *“That departure group is no longer available for this lead.”* | Full, closed or wrong journey type | Choose another trip |
| Quote button greyed | No linked lead, unknown room/travellers, or price/seats changed | Fix what the note says |
| *“Nothing has been created yet”* | The review step of Turn into work | Check, then **Create** (or **Cancel**) |
| *“A confirmed booking linked to this conversation is required before handoff.”* | The booking isn't confirmed yet | Wait until it is confirmed |
| Task not showing for the assignee | In-app notifications are best-effort | Tell them directly; the task exists in Tasks |

---

## 16. One-page cheat sheet

**Slip arrives** → red review (*Do not confirm yet*) → **Send acknowledgement** → Finance: **Copy to Finance** → check bank → **Match / Dismiss** → record payment → **Resolve** the red review with a note → *then* tell the customer.

**Passport arrives** → open original → check traveller → **Review fields** → **Save to traveller record** → **Save to Documents** (marked *submitted*, verify in Documents) → **Assign visa officer** → **Resolve** the review. *Needs a booking to find travellers. Save before the Inbox copy expires.*

**Brochure arrives** → **Save as proposal collateral / Save to Documents**. Nothing is sent.

**Customer ready** → **Link lead** → **Select departure group** (interest only) → **Create booking** (holds seats, lead → Booked) → **Follow-up** → **Operations handoff** when confirmed.

**Price asked** → check offer card → **Create quote** (draft, no discount, nothing sent) → send formally from Leads.

**Anything else** → **Turn into work** → *Review* → *Create*.

**Remember:** the system **suggests**; **you** confirm · a slip is **not** money · passports are **not** put in the shared vault · a booking holds seats, selecting a trip does **not** · ask a colleague (note + mention) when your role can't do the next step.
