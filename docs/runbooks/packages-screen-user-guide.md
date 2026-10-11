# Packages — User Guide

A plain-language guide to the **Packages** screen. No technical knowledge is
needed. It explains what a package is, who can do what, and walks through
every task and every "what if…" situation you are likely to meet.

> **Engineers:** the technical reference is
> [`../modules/packages-screen-technical-reference.md`](../modules/packages-screen-technical-reference.md).
> **Testers:** see [`packages-screen-test-plan.md`](packages-screen-test-plan.md).

**In this guide**

1. [What is a package?](#1-what-is-a-package)
2. [What you can do depends on your role](#2-what-you-can-do-depends-on-your-role)
3. [The package life story (statuses)](#3-the-package-life-story-statuses)
4. [The Packages list — a tour](#4-the-packages-list--a-tour)
5. [Everyday tasks](#5-everyday-tasks)
6. [Creating a package, step by step](#6-creating-a-package-step-by-step)
7. [Changing a package that is already on sale](#7-changing-a-package-that-is-already-on-sale)
8. [Approving or rejecting a change](#8-approving-or-rejecting-a-change)
9. [Stopping, archiving, restoring, deleting](#9-stopping-archiving-restoring-deleting)
10. [Exporting the list](#10-exporting-the-list)
11. ["What if…" — every situation](#11-what-if--every-situation)
12. [Messages you may see, and what to do](#12-messages-you-may-see-and-what-to-do)
13. [Pre-publish checklist](#13-pre-publish-checklist)
14. [Quick reference by role](#14-quick-reference-by-role)

---

## 1. What is a package?

A **package** is a *reusable recipe* for a trip. It says what you are selling
(for example "14-Day Standard Umrah Package"), how long it is, how customers
pay, what is included, what documents travellers need, and what to prepare.

A package is **not** a trip on a particular date. The real, dated trip is a
**Departure Group**, and you create one *from* a package.

| Think of it like… | In the CRM |
| --- | --- |
| A recipe | **Package** — what, how long, what's included, how to pay |
| A meal cooked from the recipe | **Departure Group** — real dates, flights, hotels, real prices, real people |

Three things to remember:

1. **Prices are not on the package.** Room prices are set on each Departure
   Group. The package holds the *payment schedule* and *policies* only.
2. **Changing a package does not change trips that already exist.** Each
   Departure Group keeps its own copy from the day it was created. A change
   only affects groups you create *afterwards* (and what sales staff quote).
3. **A package must be "published" before it can be sold.** Until then it is a
   private draft.

---

## 2. What you can do depends on your role

You only see the buttons your role allows. If a button is missing, it is
because your role does not include it — it is not a fault.

| Task | Admin | Operations | Marketing | Finance | CEO | Visa | Guide |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| See the Packages screen | ✓ | ✓ | ✓ (limited) | ✓ | ✓ | ✓ | ✗ |
| Create / edit a package | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Publish, stop sales, reopen | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Duplicate a package | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| Feature / unfeature | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| Archive / restore | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Change payment & booking terms of a live package | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Approve or reject such a change | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Create a Departure Group from a package | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Export the list | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✗ |
| Delete a package | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |

**Marketing** only sees packages that are *Open for Sale*, plus the drafts they
created themselves.

**Guides** do not see the Packages screen at all (a "page not found" message
appears if they try).

> Your agency's administrator can create **custom roles** with different
> permissions. If yours is custom, this table is a starting point — ask your
> administrator what your role can do.

---

## 3. The package life story (statuses)

Every package is in exactly one status. The coloured badge shows it.

| Status | Meaning | Can be sold? |
| --- | --- | --- |
| **Draft** | Being prepared. Only staff with edit rights see it as unfinished. | No |
| **Open for Sale** | Published. Sales staff, Leads and Departure Groups can use it. | **Yes** |
| **Sales Closed** | Taken off sale for now, but kept. Existing groups are unaffected. | No (reopen to sell again) |
| **Archived** | Filed away, read-only. Can be restored. | No |

```
Draft ──Publish──▶ Open for Sale ──Unpublish──▶ Sales Closed
                        ▲                             │
                        └────────Reopen for Sale──────┘

Any of Draft / Open for Sale / Sales Closed ──Archive──▶ Archived
Archived ──Restore──▶ (back to the status it had before)
```

Other labels you will see:

- **Featured** (a star) — highlighted package. It does not change whether it can
  be sold.
- **Visibility** — *Internal Only*, *Pilgrim Portal* or *Website & Portal*.
  Shown for information.
- **Change awaiting approval** — a change to a live package is waiting for an
  administrator (see [section 7](#7-changing-a-package-that-is-already-on-sale)).

---

## 4. The Packages list — a tour

Open **Packages** from the main menu.

### 4.1 Top bar

- **Create Package** — starts a new package (only if your role allows).
- **Awaiting approval** (with a number) — appears only when changes are waiting
  for approval. Click to see them.
- **⋮ More actions** — **Export Packages** (CSV or Excel) and **View Archived
  Packages**.

### 4.2 The four summary cards

They describe **what is currently on your screen** (they update when you search
or filter):

| Card | What it tells you |
| --- | --- |
| **Open for sale** | How many shown packages are on sale |
| **Drafts in progress** | How many are still drafts |
| **Live departure groups** | Trips currently running from these packages |
| **Seats sold** | Seats booked out of total seats, and the % filled |

### 4.3 Quick views (the row of pills)

| View | Shows |
| --- | --- |
| **All Packages** | Everything (except archived) |
| **Open for Sale** | Packages that are on sale |
| **My Drafts** | Drafts that *you* created |
| **Featured** | Starred packages |
| **Needs Attention** | Packages that are **not 100% complete**, **or** are on sale but have **no live departure group** |

### 4.4 Search and filters

- **Search** (box above the table: "Search title, code…") — type part of a
  name, code, branch or category. Not case-sensitive.
- **Filters** (next to search): **Journey** (Umrah / Hajj / Early
  Registration), **Category** (Economy / Standard / Premium / VIP / Custom),
  **Status** (Draft / Open for Sale / Sales Closed), **Branch**.
- Quick view + search + filters work **together** — each one narrows the list
  further. Use **Clear** in the filter menu to reset the filters.

### 4.5 The table

| Column | What it shows |
| --- | --- |
| **Package** | Name, code, ★ if featured, and "Change awaiting approval" if applicable |
| **Journey** | Umrah, Hajj or Early Registration |
| **Duration** | e.g. `12D / 11N` and how many itinerary days are written |
| **Status** | Status badge and visibility |
| **Groups** | Live groups and seats, e.g. `2 live · 18/40 seats`, with a bar |
| **Completeness** | % of the six setup steps finished, with a bar |

- Click a **column title** to sort; click again to reverse.
- Click **anywhere on a row** to open the package.
- Click the **⋯** on the right (or right-click the row) for the action menu.
- At the bottom: **Rows** (how many per page) and **next/previous** page
  buttons. The line `1–10 of 25` tells you where you are.

### 4.6 The row menu

| Menu item | When you see it |
| --- | --- |
| **Open Package** | Always |
| **Edit Details** | You can edit packages |
| **Duplicate** | You can duplicate |
| **Create Departure Group** | Package is Open for Sale and you can create groups |
| **Publish** | Package is a Draft and you can publish |
| **Unpublish** | Package is Open for Sale |
| **Reopen for Sale** | Package is Sales Closed |
| **Feature / Unfeature** | You can feature |
| **Archive** | You can archive |
| **Delete Package** | Administrator only; Draft or Archived only; not used by any group |

A greyed-out delete line tells you why: **"Delete (used by 2)"** or
**"Delete (archive it first)"**.

---

## 5. Everyday tasks

### 5.1 Find a package

1. Open **Packages**.
2. Type part of the name or code into **Search**, *or* click a quick view such
   as **Open for Sale**, *or* use **Filters**.
3. Click the row to open it.

> **Tip:** to find unfinished work, click **My Drafts** or **Needs
> Attention**.

### 5.2 Read a package's details

Click a row. At the top you see the name, code, status badges, duration, live
groups and seats. Under that are tabs:

| Tab | What it shows |
| --- | --- |
| **Overview** | Identity, overview text, **Price from**, group counts, duration |
| **Pricing & Payments** | The payment schedule and the cancellation, late-payment and price-change policies. *(No room prices — those are on each Departure Group.)* |
| **Journey** | The day-by-day itinerary |
| **Services & Accommodation** | What is promised: services, hotels' standard, transport, what's included / excluded |
| **Traveller Requirements** | Documents each traveller must provide, seat reservation rule, automatic messages |
| **Group Defaults** | Default capacity, minimum group size, readiness checklist |
| **Departure Groups** | Every trip created from this package, with status, seats and revenue (revenue is shown only to roles allowed to see finance figures). Filter: All / Live / Completed / Cancelled / Archived |
| **Activity** | Who published, closed, reopened, archived or changed the package, when, and why |

> **"Price from"** is the cheapest 4-sharing room price among this package's
> *live* groups. It shows **—** when no live group has a price yet.

### 5.3 Create a Departure Group from a package

1. The package must be **Open for Sale**.
2. In the row menu (or the detail page ⋯ menu) choose **Create Departure
   Group**.
3. The Departure Groups screen opens with this package already chosen. Carry
   on there (dates, flights, prices).

If the option is missing: the package is not Open for Sale, or your role cannot
create groups.

### 5.4 Duplicate a package

Use this when a new season opens and you want a similar package.

1. Row menu → **Duplicate**.
2. A **new Draft** appears, named **"<name> (Copy)"** with code
   **"<code>-COPY"** (a second copy becomes `-COPY-2`, and so on).
3. The copy belongs to **you**, is not featured and is not on sale.
4. Open it, rename it, adjust it, and publish when ready.

The original is untouched.

> You can duplicate **at most 20 packages an hour**.

### 5.5 Feature or unfeature

Row menu → **Feature** (adds a ★) or **Unfeature**. This takes effect
immediately and does not need approval.

---

## 6. Creating a package, step by step

1. Click **Create Package**.
2. A page opens with **seven steps** along the top. Work left to right.
3. Use **Continue** to move on, **Back** to go back, **Save draft** to keep
   your work, **Cancel** to leave.

> ⚠️ **Nothing saves by itself.** Your work stays in your browser until you
> press **Save draft**, **Save changes** or **Publish**. The footer tells you:
> *"Not saved yet"*, *"Unsaved changes"* or *"All changes saved"*.

> ⚠️ **A new package starts pre-filled with sample Umrah content** (name,
> overview, three itinerary days, services, etc.). **Replace everything with
> your real details** — don't publish sample text by accident.

A red star **\*** means the field is required.

### Step 1 — Commercial Identity

*"What you are selling, and how sales staff and customers see it."*

| Field | What to enter | Example |
| --- | --- | --- |
| **Package Name \*** | The name customers and staff will see | `14-Day Standard Umrah Package 2026` |
| **Package Code \*** | **Created for you** (e.g. `PKG-2026-0007`); you cannot type here | — |
| **Short Package Overview \*** | A clear commercial summary | "Guided Umrah with 4-star hotels near the Haram…" |
| **Journey Type** | Umrah, Hajj or Early Registration | Umrah |
| **Days \*** | Total days of the journey | `14` |
| **Nights \*** | Always **one less than Days** (filled automatically) | `13` |
| **Package Category \*** | Economy, Standard, Premium, VIP or Custom | Standard |
| **Default Group Capacity \*** | Target pilgrims per group | `40` |
| **Min Viable Group \*** | Fewest bookings needed to run a group | `15` |
| **Seat Hold Expiry** | Fixed at 24 hours (read-only) | — |
| **Guide Ratio** | "1 guide per N pilgrims" | `40` |

Good to know:

- The **status badge** on this step is for information. You change status with
  Publish / Unpublish / Archive, not here.
- If the generated code gets taken by someone else in the meantime, you'll see
  *"Another package already uses this code"* and a one-click
  **Use `<CODE>-2`** suggestion.
- Setting the capacity also sets the group default and the maximum pilgrims.
- Branch, visibility and waitlist are **not** editable in this form; new
  packages use the agency defaults.

### Step 2 — Sales Pricing Policy

*"The reusable payment schedule and the terms customers see."*

**Payment schedule** — the instalments a customer pays, in order.

- Quick start: **Umrah Preset** or **Hajj Preset** (replaces the whole list).
- **Add Payment Milestone** adds a row. Each milestone has:

| Field | Options / meaning |
| --- | --- |
| **Milestone Label \*** | e.g. "Booking Deposit" |
| **Amount Type** | **Fixed Amount**, **Percentage**, or **Remaining Balance** (whatever is left) |
| **Amount** | The number (not needed for Remaining Balance) |
| **Due Rule** | **On Booking**, **Fixed Date**, or **Days Before Departure** (then enter the days) |
| Refundable / Notes | Optional |

- Use the up/down arrows to reorder, the bin to remove.

**Rules the schedule must follow:**

- At least **one** milestone.
- **Only one** "Remaining Balance".
- Percentages must **not add up to more than 100%**.
- No negative amounts.

**Customer-facing terms**

| Field | Required? |
| --- | --- |
| **Cancellation & Refund Policy** | **Yes** |
| **Late Payment Policy** | No |
| **Price Change Disclaimer** | No |

> There are **no room prices** here by design — they are set per Departure
> Group.

### Step 3 — Journey Template

*"The standard pilgrim journey. Exact dates and flights are set later, in
Departure Groups."*

- Shortcuts depend on the journey type: **Standard Umrah** and **Ramadan
  Umrah**, **Generate Hajj Itinerary**, or **Add Indicative Itinerary** (Early
  Registration). They fill a ready-made itinerary you then edit.
- **Add Day** adds one more day. Each day has a **Title**, **Location**,
  **category** (Flight, Arrival, Hotel, Transfer, Ritual, Ziyarah, Meal, Free
  Time, Departure, Other) and a **pilgrim-facing description**.
- Up/down arrows reorder days (day numbers renumber automatically).

**Rules:** at least **one** day, and every day number must be within the
package's length (a 10-day package cannot have a "Day 12").

The header shows how many of your days are written, e.g. *"9 of 14 days
configured"*. You may publish with fewer days written than the package length,
but the review step will warn you.

### Step 4 — Service Standards

*"What the package promises, and what each Departure Group must later
confirm."*

- **Included services** — tick everything the package promises (return air
  ticket, visa support, insurance, accommodation, transfers, meals, ziyarah
  tours, guide, Zamzam, welcome kit, SIM, laundry, other).
- **Accommodation standards** — for **Makkah** and **Madinah**: standard
  rating (Economy, 3-star, 4-star, 5-star, Custom), number of nights,
  customer-facing wording, target distance from the Haram (within 250 m /
  500 m / 1 km / other), meal plan (Room Only, Breakfast, Half Board, Full
  Board), and optionally the exact hotel and display name.
- **Default transport requirements** — **Add Transport Route**: label, start,
  destination and vehicle (Bus, Private Car, Train, Other).
- **Customer-facing inclusions / exclusions** — what customers are told is, and
  is not, included in the price. Tick presets or add your own.

**Rules:** at least one service, a Makkah and a Madinah standard, one
transport route, one inclusion and one exclusion. **Makkah nights + Madinah
nights cannot exceed the package's total nights.**

### Step 5 — Traveller Requirements

*"Requirements applied automatically when a customer books."*

- **Document requirements** — **Add Requirement**: name, category (Passport,
  Identity, Visa, Medical, Finance, Travel, Other), the stage by which it is
  needed (On Booking, Before Visa Submission, Before Final Payment, Before
  Departure), who verifies it, and whether it shows in the pilgrim portal.
- **Seat reservation rule \*** — when a customer's seat is secured, e.g.
  "Deposit must be received before a group seat is reserved".
- **Automated communication templates** — tick the messages travellers should
  receive (Booking Confirmation, Missing Document Reminder, Payment Due
  Reminder, 7-Day Pre-Departure Briefing, Guide & Emergency Contact).

**Rules:** at least one document requirement and a seat reservation rule.

### Step 6 — Group Creation Defaults

*"What is copied into every Departure Group created from this package."*

- **Capacity**, **Min Group Size**, **Default Status**, **Guide Ratio**.
- **Departure group readiness checklist** — **Add Readiness Requirement**:
  label, responsible role (Operations, Visa, Finance, Guide, Admin) and due
  timing (e.g. "21 days before departure").

**Rules:** capacity above zero and at least one checklist item. Capacity
cannot exceed the "maximum pilgrims", and the minimum group size cannot exceed
the capacity.

### Step 7 — Review & Publish

A summary card for each earlier step with an **Edit** link, plus
**Readiness Checks** (ticks and warnings, e.g. *"3 of 14 itinerary days are
not configured yet"*). Use **Edit** to jump back and fix anything.

- On a **Draft**: press **Publish package**.
- On a package that is **already on sale**: only **Save changes** appears (see
  [section 7](#7-changing-a-package-that-is-already-on-sale)).

### Saving a draft and coming back later

1. Press **Save draft** (works even when steps are incomplete — an incomplete
   draft is fine).
2. You see *"Draft saved"* and the footer reads *"All changes saved"*.
3. Come back any time from **Packages → My Drafts → Edit Details**.

### Publishing

1. Make sure steps 1–6 are complete. A step is complete when it has no red
   messages.
2. On step 7 press **Publish package**.
3. You are taken to the package page and the status becomes **Open for Sale**.
   It is now available to sales staff, Leads and the Create Departure Group
   screen.

If something is missing, nothing is published; the editor jumps to the first
problem step and shows what to fix (see [section 11](#11-what-if--every-situation)).

---

## 7. Changing a package that is already on sale

Editing a live package is controlled, because changes affect new groups,
quotes and what agents see. **Edit Details** opens the same editor; the footer
button says **Save changes**.

What happens depends on **what** you changed:

| What you changed | What happens |
| --- | --- |
| **Wording only** — name, overview, branch, package class, duration label, itinerary wording, customer wording of hotels, hotel names | Saved **straight away**. |
| **Money & contract** — payment milestones, payment terms, cancellation / late-payment policy, price-change disclaimer | **Review sheet** → give a reason → usually **sent to an administrator for approval**. |
| **Bookings & operations** — capacities, nights, services, transport, documents, seat rule, readiness checklist, itinerary *structure* (days added/removed/re-numbered), journey type, code | **Review sheet** → give a reason → usually **sent for approval**. |

### How to do it

1. Open the package → **Edit** (or row menu → **Edit Details**).
2. Make your changes, then press **Save changes**.
3. If anything sensitive changed, a side panel **"Review changes to
   <package>"** opens. It lists every change as **before → after**, grouped as
   *Money & contract* and *Bookings & operations*, and tells you if approval is
   needed.
4. Type the **Reason for this change** (required), e.g. *"The airline changed
   its cancellation terms."*
5. Press **Send for approval** (or **Confirm and apply** if your agency has
   turned approval off for that kind of change). **Keep editing** returns to
   the form.
6. You see either:
   - **"Sent for approval"** — wording changes (if any) are saved; the rest
     waits. **The package stays exactly as it is until someone approves.**
   - **"Changes applied"** — approval is switched off; recorded with your name
     and reason.
   - **"Changes saved"** — only wording changed.

### While a change is waiting

- The package shows a **"Change awaiting approval"** card with who asked, when,
  the reason, the before/after, and **how many days are left** (a request
  expires after **14 days**).
- Only **one** change per package can wait at a time. If you try a second, the
  review sheet offers a tick-box to **replace** the waiting one — or ask the
  person to **Withdraw** it first.
- Editing the form shows the values saved *today*, not the waiting ones.

---

## 8. Approving or rejecting a change

*(Administrators — you cannot approve your own request.)*

1. Click **Awaiting approval** on the Packages list, or open the package.
2. Read the **Reason** and the before/after for each field.
3. Choose:
   - **Approve** — the change applies to the package immediately.
   - **Reject** — you **must** type why; the package stays as it is and the
     requester sees your note on the Activity tab.
4. The requester (or an administrator) can also press **Withdraw** to cancel a
   request.

If you see *"You asked for this change, so someone else has to approve it"*,
ask another administrator. If a request shows *"That request had expired"*,
ask for it to be submitted again.

---

## 9. Stopping, archiving, restoring, deleting

### 9.1 Stop selling (Unpublish)

Row menu → **Unpublish** → confirm. The package becomes **Sales Closed**: it
disappears from sales staff, Leads and the group picker. **Existing departure
groups are not affected.**

### 9.2 Start selling again (Reopen for Sale)

Row menu → **Reopen for Sale** on a Sales Closed package. The package is
re-checked; if it was edited into an incomplete state you'll be told which
step to fix.

### 9.3 Archive (file it away)

Use for packages you no longer sell. It is **always reversible**.

1. Row menu → **Archive** → confirm.
2. The package moves out of the main list into **⋮ → View Archived Packages**.

**If the package still has live departure groups:** the first attempt is
refused ("…has N live departure group(s). Close sales instead, or
force-archive with a reason."). Then:

- **Administrators** get **"Archive despite live departure groups?"** — type a
  **reason** and press **Force Archive**. The groups themselves are untouched;
  the package just stops appearing for new groups. The reason is saved in the
  Activity tab.
- **Everyone else** cannot force it. Use **Unpublish** instead, or ask an
  administrator.

### 9.4 Restore

⋮ **More actions → View Archived Packages → Restore**. The package returns to
the status it had **before** it was archived (for example Open for Sale).
*(The pop-up message may say "as a draft" — it is returned to its previous
status.)*

### 9.5 Delete (permanent)

Only **administrators**, and only for a **Draft** or **Archived** package that
nothing refers to.

1. Open the package → **⋯ → Delete Package** (it must be a Draft or archived;
   otherwise archive it first).
2. A panel shows what deleting would touch.
3. Type the **package code** exactly and a **reason**, then **Delete package**.

A permanent record of the package and its history is kept for administrators,
but the package cannot be brought back. **When in doubt, Archive instead.**

Delete is **blocked** while any departure group, lead quote or agent booking
submission refers to the package — the panel says which.

---

## 10. Exporting the list

1. ⋮ **More actions → Export Packages → CSV** or **Excel (.xlsx)**.
2. The file contains **exactly what you are looking at** — the current quick
   view, search, filters and sort — across **all pages**, not just the visible
   one.
3. Columns: Code, Title, Journey Type, Category, Branch, Status, Visibility,
   Featured, Duration, Completeness %, Live Groups, Seats Booked, Seats
   Capacity, Updated.

Notes:

- If nothing matches your filters you get *"Nothing to export"*.
- Each export is **recorded** (who, when, how many rows, filters).
- Limit: **10 exports per hour** per person.
- Archived packages are not included.
- The Export option is visible only to Admin, Operations, Finance, CEO and
  Visa roles.

---

## 11. "What if…" — every situation

### Access and visibility

| Situation | What it means / what to do |
| --- | --- |
| **I see "page not found" on Packages** | Your role does not include this screen (e.g. Guide), or the link is wrong. Ask your administrator. |
| **I can't see a package a colleague mentioned** | If you are in Marketing you only see packages that are Open for Sale and your own drafts. Ask the owner to publish it or duplicate it for you. |
| **There is no Create Package / Edit / Publish button** | Your role doesn't include it ([section 2](#2-what-you-can-do-depends-on-your-role)). |
| **A package link says "not found"** | It was deleted, the link is mistyped, or you may not see it. |
| **Old bookmark `/packages/create-package`** | Still works — it forwards you to the new editor. |

### Creating and editing

| Situation | What to do |
| --- | --- |
| **The form is already full of text** | That's sample content. Replace it with your own before publishing. |
| **I can't type the Package Code** | By design — it's generated (`PKG-year-number`). |
| **"Another package already uses this code"** | Click **Use `<CODE>-2`**. |
| **I can't open step 4 (locked 🔒)** | Hover the step — it names the earlier step to finish first. |
| **Continue doesn't move me on** | The current step has a problem. A red note by the buttons names it, and the page scrolls to the first field to fix. |
| **Nights is different from Days − 1** | Publishing is blocked: *"Nights must be exactly one less than Days."* |
| **"Makkah + Madinah nights cannot exceed…"** | Reduce the nights in Step 4 so they fit within the total. |
| **"Itinerary day 12 is outside the package's 10-day length"** | Renumber or delete the extra day in Step 3, or increase Days in Step 1. |
| **"Minimum group size cannot exceed the default capacity"** | Lower Min Viable Group or raise capacity (Step 1 / 6). |
| **"Only one payment milestone can be 'Remaining Balance'"** | Change the extra one to Fixed Amount or Percentage. |
| **"Percentages add up to more than 100%"** | Reduce milestone percentages (Step 2). |
| **List says 100% complete, but publish refuses** | The list only checks that each section has *something*. Publishing also checks rules *across* steps (nights, capacities, percentages, day numbers). Follow the message. |
| **I want to change Branch or Visibility** | Not editable in this form today; ask your administrator/developer. |
| **I closed the tab by mistake** | If you had unsaved changes, the browser warns you first. If you confirmed, unsaved work is lost — only saved drafts survive. |

### Leaving the editor

| Situation | What happens |
| --- | --- |
| **Cancel with no changes** | Leaves immediately. |
| **Cancel / click another menu item / press Back with unsaved changes** | A box **"You have unsaved changes"** appears: **Keep editing**, **Discard changes**, or **Save draft and leave** (on a live package: **Review and save changes**). |
| **I pressed Esc or clicked outside the box** | That means **Keep editing** — nothing is lost. |
| **Ctrl-click a link (new tab)** | Opens without asking; your form is untouched. |

### Saving problems

| Situation | What to do |
| --- | --- |
| **"This package changed elsewhere. Reload and try again."** | Someone else (or you in another tab) saved first. Reload the page, re-apply your edits, save again. Nothing was overwritten. |
| **"Another change is already waiting for approval"** | Tick **replace it** in the review sheet, or ask for the other to be withdrawn. |
| **"An archived package cannot be edited. Restore it first."** | Restore, then edit. |
| **"Your role cannot change payment or booking terms…"** | On a live package you can only edit wording. Undo the sensitive changes or ask someone allowed. |
| **"You can only … 30 times an hour…"** | Hourly limit reached (create 30, duplicate 20, publish 30). The message says how many minutes to wait. |

### Lifecycle

| Situation | What to do |
| --- | --- |
| **I want to retire a package that has live groups** | **Unpublish** it (safe), or ask an administrator to **force archive** with a reason. |
| **I archived the wrong package** | **View Archived Packages → Restore**. |
| **I restored a package and it came back On Sale** | Expected — restore returns the previous status. |
| **Delete is greyed out: "used by N"** | Groups, quotes or submissions use it. Archive instead. |
| **Delete is greyed out: "archive it first"** | Only Draft or Archived packages can be deleted. Archive, then delete. |
| **I deleted by mistake** | It cannot be undone. Ask an administrator — a record of the package is kept. |
| **Two people clicked Publish and Archive at once** | One wins; the other sees "changed elsewhere". Reload and check the status. |
| **A package I published isn't in Departure Groups / Leads** | Refresh the page. Only **Open for Sale** packages appear there. |

### Reading the list

| Situation | What it means |
| --- | --- |
| **Package shows `Untitled package`** | The draft was saved with no name. Open it and add one. |
| **Code is 8 odd characters** | The draft was saved without a code; the system shows part of its id. Open it and set a name/code. |
| **Groups column shows `0 live · 0/0 seats`** | No live departure groups use it yet. |
| **KPIs changed after I searched** | Normal — they describe what is currently on screen. |
| **The Branch filter has few options** | It lists only branches that appear on your packages. |
| **My search finds nothing** | You'll see *No results matching "…"*. Clear the search or filters. |
| **Empty list on a new account** | "No packages yet. Create your first package template to start selling." |
| **Page is slow to load** | A grey skeleton shows while loading. If an error page appears, press **Try again** or reload. |

### Approvals

| Situation | What to do |
| --- | --- |
| **My change is "awaiting approval" and nothing happens** | Ask an administrator to open **Awaiting approval**. It expires after 14 days. |
| **I asked for it and can't approve it** | Rules require a different person. |
| **The administrator rejected it** | Read their note on the package's **Activity** tab, adjust, and submit again. |
| **"This package changed since the request was made"** | The package was edited after you asked. Submit your change again. |
| **I want to cancel my request** | Press **Withdraw** on the request card. |

---

## 12. Messages you may see, and what to do

| Message | Meaning | What to do |
| --- | --- | --- |
| *You do not have permission to do that.* | Your role can't do this. | Ask an administrator. |
| *That package no longer exists.* | It was deleted or the page is old. | Go back to the list. |
| *Step 4 (Service Standards) is incomplete.* | Required items missing in that step. | Open the step and fill the red items. |
| *Cannot publish — step N (…) is incomplete.* | Same, from the row menu. | Edit Details → fix the step. |
| *Cannot reopen — …* | The Sales Closed package no longer meets the rules. | Edit it, then Reopen. |
| *This package has N live departure group(s). Close sales instead, or force-archive with a reason.* | Archive blocked. | Unpublish, or ask an admin to force archive. |
| *Only an administrator can archive a package that still has live departure groups.* | You are not an admin. | Ask an admin. |
| *A reason is required…* | A reason box was left empty. | Type a reason. |
| *This package cannot be deleted — …* | Something still uses it, or it isn't a draft/archived. | Archive instead. |
| *The confirmation text does not match the package code.* | Typed code differs. | Type it exactly as shown. |
| *The package code "X" is already used by another package.* | Duplicate code. | Choose another in Step 1. |
| *… has a value that is not allowed.* | A number/option is out of range. | The editor jumps to the step; correct the field. |
| *Preparing export… / Export ready* | Export in progress / done. | — |
| *You have reached the limit of 10 exports an hour.* | Hourly cap. | Wait the minutes shown. |

---

## 13. Pre-publish checklist

Before pressing **Publish package**, check:

- [ ] Name and overview are **your real text**, not the sample.
- [ ] Journey type is correct; **Days / Nights** are right (nights = days − 1).
- [ ] Capacity and minimum group size make sense (minimum ≤ capacity).
- [ ] Payment milestones add up logically (percentages ≤ 100%, one Remaining
      Balance).
- [ ] Cancellation policy is written.
- [ ] Itinerary has all days you promise, with correct day numbers.
- [ ] Makkah and Madinah standards and nights are set.
- [ ] Inclusions and exclusions are accurate (customers see these).
- [ ] Required documents and the seat reservation rule are set.
- [ ] Group readiness checklist matches how you actually prepare a trip.
- [ ] Step 7 **Readiness Checks** show no surprise warnings.

---

## 14. Quick reference by role

**Admin** — everything: create, edit, publish, archive (including force with a
reason), delete drafts/archived unused packages, approve or reject changes,
export, create groups.

**Operations** — create, edit, publish/unpublish/reopen, duplicate, feature,
archive/restore, change live payment & booking terms (they go to an Admin for
approval), create groups, export. *Cannot* delete, approve, or force-archive.

**Marketing** — sees Open for Sale packages and own drafts; can duplicate and
feature. *Cannot* edit, publish, archive or export.

**Finance / CEO** — view everything, see revenue per group, export. *Cannot*
change packages.

**Visa** — view and export. *Cannot* change packages.

**Guide** — no access to Packages.

---

*Last verified against the application on 2026-10-11 (branch `UI-update`). If
a button or message differs from this guide, the screen has changed — please
tell the documentation owner so this guide can be corrected.*
