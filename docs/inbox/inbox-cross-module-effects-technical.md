# Inbox — Effects Beyond Messaging (Technical Documentation)

> **Audience:** engineers.
> **Scope:** everything the Inbox does *outside* the chat itself — what happens in Finance, Documents, Visa, Leads, Bookings, Operations, Tasks, Notifications and the customer's record when a message or file arrives or when staff press a button.
> **Written:** 5 October 2026 from the code on branch `inbox-conversation-writing-hardening`.
> **Companions:** [`inbox-technical-documentation.md`](./inbox-technical-documentation.md) (the Inbox itself) · [`inbox-cross-module-effects-user-guide.md`](./inbox-cross-module-effects-user-guide.md) (the same story in plain words for staff).

## Contents

1. [The one idea to remember](#1-the-one-idea-to-remember)
2. [The map: every effect on one page](#2-the-map-every-effect-on-one-page)
3. [The shared machinery](#3-the-shared-machinery)
4. [Flow A — A receipt arrives → Attachment review → Finance](#4-flow-a--a-receipt-arrives--attachment-review--finance)
5. [Flow B — A passport arrives → Attachment review → Documents, traveller record, Visa](#5-flow-b--a-passport-arrives--attachment-review--documents-traveller-record-visa)
6. [Flow C — A brochure or other file → the Document Vault](#6-flow-c--a-brochure-or-other-file--the-document-vault)
7. [Flow D — Voice notes](#7-flow-d--voice-notes)
8. [Flow E — Chat → Lead (link or create)](#8-flow-e--chat--lead-link-or-create)
9. [Flow F — Chat → Departure group → Booking](#9-flow-f--chat--departure-group--booking)
10. [Flow G — Chat → Quote and follow-up](#10-flow-g--chat--quote-and-follow-up)
11. [Flow H — Chat → Task, case, hold, profile (the conversion kernel)](#11-flow-h--chat--task-case-hold-profile-the-conversion-kernel)
12. [Flow I — Booking → Operations handoff](#12-flow-i--booking--operations-handoff)
13. [Flow J — Reviews, notifications and the dashboard](#13-flow-j--reviews-notifications-and-the-dashboard)
14. [The customer trail: what each module records](#14-the-customer-trail-what-each-module-records)
15. [Who may trigger what](#15-who-may-trigger-what)
16. [Safety rules shared by every flow](#16-safety-rules-shared-by-every-flow)
17. [Retention and what survives deleting a chat](#17-retention-and-what-survives-deleting-a-chat)
18. [Failure and recovery behaviour](#18-failure-and-recovery-behaviour)
19. [Known gaps and caveats](#19-known-gaps-and-caveats)
20. [Testing and where to extend](#20-testing-and-where-to-extend)

---

## 1. The one idea to remember

The Inbox does **two kinds** of cross-module work, and they are deliberately different:

| Kind | Who triggers it | What it may do | Example |
|---|---|---|---|
| **Automatic reading** | The system, in the background, when a message arrives | Read, label, **propose**, open a *review card*. **Never writes business records.** | A receipt photo → "Attachment review" card + blocking "Payment proof requires verification" review. |
| **Staff-triggered effects** | A person pressing a button | Create or change records in other modules, through **that module's own rules**, after server re-checks. | **Copy to Finance**, **Save to Documents**, **Create booking**. |

> **Nothing a model read is written into the traveller record, the payments ledger or a booking without a person confirming it.** This is the same rule as *deterministic core, LLM at the edges* ([`architecture.md`](./architecture.md) §1). Routing code returns the literal `sendsOrPublishesAutomatically: false` (`lib/inbox/media/routing.ts`).

So when staff say "I sent a receipt and the Finance section appeared automatically" — what is automatic is the **review card, the review and the buttons**; the **copy into Finance is one click away**, never silent.

---

## 2. The map: every effect on one page

```
                                    INBOX CHAT
                                        │
   ┌────────────────────────────────────┼──────────────────────────────────────────────┐
   │ AUTOMATIC (background job)         │ STAFF-TRIGGERED (server action, re-checked)  │
   │                                    │                                               │
   │ file arrives                       │  Copy to Finance ──────▶ finance_evidence_intake ─▶ Finance › Payments
   │  └▶ media job (BULK lane)          │  Save to Documents ────▶ pilgrim-documents + checklist item = SUBMITTED
   │      ├ keep original (private)     │  Save to traveller rec ▶ Documents/Travellers record (number, expiry)
   │      ├ AI reads (if plan allows)   │  Assign visa officer ──▶ Visa module field + visa event
   │      ├ message_media_analyses      │  Save to Vault ────────▶ Document Vault (brochures/other only)
   │      └ opens review card:          │  Link / Create lead ───▶ Leads (+ activity entry)
   │         • PAYMENT_CLAIM (BLOCK)    │  Select group ─────────▶ Lead (+ activity entry)
   │         • PASSPORT_EXPIRY (REVIEW) │  Create booking ───────▶ Bookings (seats held) + Lead → BOOKED
   │                                    │  Create quote ─────────▶ Leads › Quotes (draft)
   │ message arrives                    │  Schedule follow-up ───▶ Lead follow-up fields
   │  └▶ risk detectors / triage        │  Turn into work ───────▶ Tasks / Support case / Seat hold / Profile …
   │      └ opens review cards          │  Operations handoff ───▶ Operations + notification
   └────────────────────────────────────┴──────────────────────────────────────────────┘
        every created row can carry source_conversation_id / source_message_id  → "came from this chat"
```

| Trigger | Automatic effect | Staff-triggered effect | Lands in | Code |
|---|---|---|---|---|
| Receipt / slip arrives | Reading → `RECEIPT` card; **blocking** `PAYMENT_CLAIM` review | **Copy to Finance**; **Send acknowledgement** (draft only) | `finance_evidence_intake` → Finance › Payments | `media/handlers.ts`, `finance-evidence-repository.ts` |
| Passport arrives | Reading → `PASSPORT` card; traveller match; `PASSPORT_EXPIRY` review if risky | **Review fields**, **Save to traveller record**, **Save to Documents**, **Assign visa officer** | Documents checklist, traveller record, Visa | `actions.ts` passport actions |
| Brochure / other file | Reading → `BROCHURE` / `OTHER` | **Save as proposal collateral / to Documents** | Document Vault | `media/media-to-vault.ts` |
| Voice note | Retention + (optional) transcript | none (copy transcript text by hand) | Staff-only transcript table | `media/voice-transcript*` |
| Chat with a new contact | Identity candidates, "Possible existing lead" | **Link / Create lead** | Leads | `identity/graph.ts`, `lead-linking.ts` |
| Trip chosen | — | **Select departure group** | Lead (`selected_departure_group_id`) | `selectConversationDepartureGroup` |
| Ready to book | — | **Create booking** | Bookings + Lead → `BOOKED` + seats held | `createBookingFromConversation` |
| Price asked | Offer match (no model) | **Create quote** (draft) | Leads › Quotes | `createQuoteFromConversation` |
| Needs follow-up | — | **Schedule follow-up** | Lead follow-up | `scheduleConversationFollowUp` |
| Any workflow need | Next-best-action card | **Turn into work** (12 kinds) | Tasks, support cases, seat holds, profiles… | `lib/inbox/conversions/*` |
| Confirmed booking | — | **Operations handoff** | Operations + notification | `createConversationHandoffAction` |

---

## 3. The shared machinery

### 3.1 Media pipeline (`lib/inbox/media/*`)

```
webhook ingest ─▶ message_attachments row (label only, no model yet)
                └▶ channel_jobs: READ_DOCUMENT / EXTRACT_RECEIPT / TRANSCRIBE_VOICE  (BULK lane)
                         │
          createMediaJobHandler (handlers.ts)
            1 loadAndRetainOriginal  – download from provider, store in `inbox-attachments` bucket,
                                       sha256, mime, expires_at (agency retention), scan_status="CLEAN" *
            2 feature gate           – resolveInboxFeatureAvailability(...).mediaIntelligence
            3 type gate              – only pdf, jpeg, png, webp, gif are sent to the reading model
            4 extractDocument        – generateStructured(tier "classify"): kind + candidate fields
            5 per-kind handling      – PASSPORT / RECEIPT / BROCHURE / OTHER (below)
            6 updateAnalysis         – message_media_analyses row (status, fields, confidence, uncertainty, intervention_id)
```

\* `"CLEAN"` means *fetched, stored and type-checked*. **No virus scan runs** (SEC-8, [`../runbooks/inbox-attachment-checks.md`](../runbooks/inbox-attachment-checks.md)); the UI must not claim a scan.

Important properties:

- **The original is kept first.** If AI reading is switched off for the agency's plan, or the type is not readable (Word, Excel, text), the analysis row is set to `READY` with empty fields so the card never shows "pending" forever; staff still get the original.
- The model prompt forbids confirming: *"Extract candidates only. Never confirm identity, passport validity, or payment."* Output is schema-validated (`extractedMediaSchema`): `kind ∈ PASSPORT|RECEIPT|BROCHURE|OTHER`, `confidence 0..1`, nullable candidate fields.
- `status = REVIEW_REQUIRED` when `confidence < 0.9`; any field under 0.9 (or missing, or an unreadable date) is listed in `uncertainty` and rendered "Check this field".
- Failure policy: errors retry; on the **final attempt** the row is set `FAILED` with a truncated message, and the job still throws so it dead-letters visibly. Voice transcription failure never fails the voice note itself.
- Cost/usage is metered under surface `inbox_media_intelligence`.

### 3.2 The review card and the attachment analysis

Table `message_media_analyses` (one per attachment) holds `kind`, `status`, `candidate_fields`, `confidence`, `uncertainty`, `review_fields`, `candidate_traveller_ids`, `selected_traveller_id`, `intervention_id`, `source_model`. The UI component is `attachment-intelligence-card.tsx`; destinations come from the **pure routing table** `mediaRoutingOptions()` (kind × viewer rights × file state → options with `AVAILABLE | DONE | DENIED | UNAVAILABLE` and a plain reason).

### 3.3 Interventions (red review cards)

`openIntervention` / `recordSignals` (`lib/data/conversation-intelligence-repository.ts`) write `conversation_signals` + `conversation_interventions`. Media-originated ones:

| From | Kind | Severity | Headline | Assigned |
|---|---|---|---|---|
| Receipt | `PAYMENT_CLAIM` | **BLOCK** | "Payment proof requires verification" | Finance-owned (money review) |
| Passport with expiry risk (expired or too soon for departure) | `PASSPORT_EXPIRY` (signal `PASSPORT_EXPIRY_RISK`) | REVIEW | "Passport expiry requires review" | — |
| Passport needing review for another reason (low confidence, mismatch, no traveller chosen) | `PASSPORT_EXPIRY` | REVIEW | "Passport requires review" (`requiredActionCode: REQUEST_DOCUMENTS`) | `OPERATIONS` |

A **blocking** open review activates the *protection gate* on every send to that customer ([`inbox-technical-documentation.md`](./inbox-technical-documentation.md) §9.3): staff cannot send "payment received" until the review is resolved with a note.

### 3.4 The context loader

`loadInboxMediaContext` (`media/context.ts`) is how a chat finds its CRM neighbours, **always `agency_id`-scoped**:

```
conversation.lead_id
   └▶ leads.booking_id, leads.selected_departure_group_id
         ├▶ departure_group_bookings.departure_group_id
         ├▶ departure_group_pilgrims  (travellers of THAT booking: id, full_name_snapshot, passport_number_snapshot)
         └▶ departure_groups.departure_date   (+ agency_settings.passport_validity_months, default 6)
```

Consequence worth knowing: **travellers come only from the lead's *booking***. A chat with no linked lead, or a lead with no booking yet, has no candidate travellers, so passport matching and **Save to Documents** cannot proceed until the booking exists.

### 3.5 Source links ("this record came from that chat")

Migration `20261202092000_mi4_6_conversation_source_links.sql` adds `source_conversation_id` and `source_message_id` to `leads`, `lead_quotes`, `departure_group_bookings`, `departure_group_tasks`, `pilgrim_support_requests` (message pointer requires conversation pointer; composite same-agency FKs; indexes). Deleting a conversation or message **clears the pointer only**; the lead/booking/task survives.

- New conversion menu writes the columns **in the same insert** as the object.
- Older buttons (capture lead, create quote, create booking) use `stampConversationSource` (`conversions/source-link.ts`): runs *after* the object exists, on the trusted client naming the agency, and **only fills an empty link** (never re-points). A failure is logged and never undoes the object; running again repairs it.
- Tasks also embed a back-link in their description (`conversionBackLink`), and `inboxPageHref({ conversationId })` (`lib/inbox/page-request.ts`) produces `/inbox?conversation=<id>`, which Finance evidence and tasks use to reopen the chat.

### 3.6 Server-action pattern for every cross-module write

```
requireUser() → Zod parse (.strict()) → getCurrentStaffRole() → capabilitiesForInbox(role)
 → (re-derive everything from the attachment/conversation id; browser supplies ids only)
 → module-specific permission (documents / finance / visa / leads)
 → agency-scoped read → idempotent claim → write via the OWNING module's function
 → audit/history entry → revalidatePath(...) → typed { ok } result
```

Privileged (service-role) clients are used only where a role legitimately needs a cross-module write that RLS would block (for example the CEO or an assigned capable staff member copying a receipt), and only **after** authenticate → authorise → agency-scope.

---

## 4. Flow A — A receipt arrives → Attachment review → Finance

### 4.1 Automatic part

1. Customer sends a photo/PDF of a transfer slip. `ingest` stores the message + attachment and queues the media job (§3.1).
2. The reader classifies it `RECEIPT`, extracting `amount`, `reference`, `paidAt` (all nullable candidates).
3. The handler calls `receiptReview(...)` (`media/receipt.ts`) whose contract is explicit: `{ paymentStateMutation: null, intervention: { kind: "PAYMENT_CLAIM", severity: "BLOCK", … } }` — **no payment is created, changed or verified**.
4. `openMediaReview(... "PAYMENT_CLAIM_UNVERIFIED")` records a `MODEL`-detector signal ("Payment proof attachment requires Finance verification.") and opens the **blocking** intervention. The analysis row gets `status = REVIEW_REQUIRED`, `uncertainty = ["paymentVerification"]`, `intervention_id`.
5. Realtime invalidation → the chat shows the **Attachment review** card (`Not verified` badge, amount/reference/date) and a **Finance evidence** card. The chat joins the **Payments** and **Urgent** queues (queue membership is recomputed in SQL).

### 4.2 Staff-triggered part

| Button | Action | Effect |
|---|---|---|
| **Send acknowledgement** | none server-side | Inserts fixed text into the composer ("we have received your payment proof… finance team will check"). Staff still press Send; it passes the protection gate because it does **not** confirm payment (`receipt-finance-action.tsx`, `payment-acknowledgement.ts`). |
| **Copy to Finance** | `copyReceiptToFinanceAction` | See below. |
| **Open Finance review** / **Open Finance evidence** | link | Navigates to `/finance/payments` (evidence item href from `financeEvidenceItemHref`). |

`copyReceiptToFinanceAction` (`app/inbox/actions.ts`):

1. `requireUser` → `copyReceiptToFinanceSchema` (`{ attachmentId }` strict).
2. `repository.loadReceiptSource(agencyId, attachmentId)` — returns the `FinanceEvidenceSource` (conversation, message, attachment, analysis ids; lead/booking/departure group/customer ids; storage path, mime, size, checksum; candidate fields; confidence; retention days) or null (unavailable / not ready).
3. Permission: `canCopyReceiptToFinance({ role, staffId, assignedToId, openFinanceReview })` where `openFinanceReview = inbox.viewModule && finance.viewLedger` (both loaded as *dynamic* capabilities for the role). Admin, CEO and Finance always pass. Anyone else passes only if they are the chat's **assigned owner** *and* their role has been granted both Inbox view and Finance ledger access (dynamic capabilities); with the default role table Marketing and Operations have no ledger access, so they are refused.
4. `copyReceiptEvidence(...)` copies the stored file to Finance's own storage and inserts a row in **`finance_evidence_intake`** (migration `20261220090000_finance_evidence_intake.sql`) with status `PENDING_REVIEW`, the source ids, candidate fields marked `MODEL_CANDIDATE` (attribution says *a model proposed it*), checksum, and `retention_expires_at` derived from the agency's `inbox_attachment_retention_days` (default 90).
5. `revalidatePath("/inbox")` and `("/finance/payments")`. Returns "Receipt copied for Finance review. No payment was created or verified."

Supported evidence types: PDF, JPEG, PNG, WebP, HEIC (`FINANCE_EVIDENCE_EXTENSIONS`). A type outside this list yields `UNAVAILABLE` ("Finance cannot review this file type. Download it instead.").

The migration's own comment is the contract: *"This migration is deliberately additive: it never inserts into or updates the payments ledger."* Composite `(id, agency_id)` unique indexes let every foreign key prove same-agency.

### 4.3 Finance side (`app/(main)/finance/payments/*`, `lib/finance/evidence-matching.ts`)

- `loadFinanceEvidenceIntakeAction` — needs `viewLedger` and `canReviewFinanceEvidence(role)`; returns pending items each with **deterministic payment candidates**.
- **Matching is pure code** (`matchFinanceEvidenceToPayments`). Reason codes: `REFERENCE_EXACT`, `AMOUNT_EXACT`, `BOOKING_LINKED`, `DEPARTURE_GROUP_LINKED`, `DATE_SAME_DAY`, `DATE_WITHIN_WINDOW` (≤ 7 days); strength `STRONG | POSSIBLE`. It reports `autoApplied: false`, never matches on a *close* amount, never across agencies; the model's fields are untrusted signals to compare against.
- `matchFinanceEvidenceAction` → `matchEvidenceToPayment`: only roles with `canDecideFinanceEvidence` (Finance, Admin; **CEO view-only**); the payment must be a valid candidate and not already linked to another receipt (`PAYMENT_ALREADY_LINKED`); a previously decided item cannot be re-decided (`ALREADY_REVIEWED`; first decision wins).
- `dismissFinanceEvidence` — mandatory reason (≤ `REVIEW_REASON_MAX_LENGTH`), audited.
- Both write an audit event `NOTE_ADDED` on the payment/booking trail: *"Receipt evidence matched to payment … No payment was verified, allocated, or changed."* / *"…dismissed by Finance review: <reason>. No payment was created or changed."*

### 4.4 What is **not** automatic (read this)

- Copying to Finance does **not** resolve the Inbox's red `PAYMENT_CLAIM` review. Nothing in the Finance code touches `conversation_interventions`. A person (Finance/Admin) must **Resolve** that card **with a note** after recording/matching the payment. Until then, the protection gate keeps blocking "payment received" wording.
- Matching a receipt does **not** verify, allocate or edit the payment. Recording the real payment is a separate Finance action.
- No customer message is sent by any of this.

### 4.5 Sequence

```
Customer      Webhook/ingest     BULK lane job        Postgres            Inbox UI            Finance UI
   │ slip.jpg ──▶ store msg+att ──▶ queue READ_DOC       │                    │                    │
   │              ack 200          │ download+retain ──▶ storage             │                    │
   │                               │ AI reads (RECEIPT)                      │                    │
   │                               │ receiptReview: no payment mutation      │                    │
   │                               │ openIntervention PAYMENT_CLAIM (BLOCK) ▶ interventions       │
   │                               │ analysis: REVIEW_REQUIRED ───────────▶ analyses              │
   │                               │                        realtime ping ──▶ card appears        │
   │                               │                                         │ staff: Copy to Finance
   │                               │                                         ├──▶ finance_evidence_intake (PENDING_REVIEW)
   │                               │                                         │                    │ list + candidates
   │                               │                                         │                    │ Match / Dismiss (audited)
   │                               │                                         │ Finance resolves the red review with a note (manual)
```

---

## 5. Flow B — A passport arrives → Attachment review → Documents, traveller record, Visa

### 5.1 Automatic part

1. Reader classifies `PASSPORT`, extracting `passportNumber`, `expiryDate` (YYYY-MM-DD when legible), `fullName`.
2. `loadInboxMediaContext` → travellers of the lead's booking, departure date, validity months (§3.4).
3. `reviewPassportCandidate(candidate, context, now)` (`media/passport.ts`, **pure**) returns:
   `uncertainFields`, `fieldMismatches`, `expired`, `insufficientValidityAtDeparture` (expiry < departure + validity months), `candidateTravellerIds`, `matchedTravellerId`, `travellerSelectionRequired`, `reviewRequired`, and `signal: "PASSPORT_EXPIRY_RISK" | null`.
   Traveller matching: exact normalised passport number **or** exact normalised name; a single match is auto-selected, several → `travellerSelectionRequired`; an unreadable date is "cannot be judged", never guessed.
4. If `signal` → open the `PASSPORT_EXPIRY` review (§3.3). Else if `reviewRequired` → open "Passport requires review" (assigned role `OPERATIONS`). Else no review.
5. The analysis row stores candidate fields, `review_fields` (mismatches, expired, validity, departure date, months, traveller selection), `candidate_traveller_ids`, `selected_traveller_id`, and `intervention_id`.

The detector `PASSPORT_EXPIRY_RISK` for conversation-level risk (`risk/detectors/passport-expiry-risk.ts`) uses the same validity rule against stored traveller data; the media path covers the *just-arrived* file.

### 5.2 Staff-triggered part

All server actions re-derive the traveller from the **attachment id alone** (`resolvePassportPilgrim`): the analysis must be a `PASSPORT`; the traveller is the one staff selected (or the only candidate) via `resolvePassportTraveller` and **must be on the conversation's booking**; the pilgrim row is read agency-scoped from `departure_group_pilgrims`.

| Step | Action | Permission (`InboxCapabilities`) | Writes |
|---|---|---|---|
| Choose traveller | `selectPassportMediaTravellerAction` | `reviewPassportFields` | `message_media_analyses.selected_traveller_id`, recomputed `review_fields`/`status`; may open the passport review. Chosen id must be in `candidate_traveller_ids` **and** on the booking. |
| Confirm fields | `applyPassportDetailsAction` | `reviewPassportFields` (= manage documents/visa **and** view sensitive traveller data) | `updateGroupPilgrimRecord({ passportNumber, passportExpiry })` — the traveller record's **own updater**, which refuses an expiry before departure and keeps its own history. Input re-parsed by `parsePassportDetails`. **Nothing the model read is saved without this click.** |
| Save to Documents | `savePassportToDocumentsAction` | `saveAttachmentToDocuments` (= Documents `uploadOnBehalf` **and** sensitive data) | See 5.3. |
| Assign visa officer | `loadVisaOfficersAction` + `assignVisaOfficerForPassportAction` | `assignVisaOfficer` (= visa `assignOfficer` **and** sensitive data) | `updateVisaFields(visa_assigned_to, _name, _at)` + `insertVisaEvent(action: "ASSIGNED", …)` — **shows in Visa exactly as one made there**. Officer must be an active staff whose role does visa work (`canBeVisaOfficer`); passing `null` unassigns. |

### 5.3 Save to Documents (the careful one)

`savePassportToDocumentsAction`:

1. Read the attachment (agency-scoped). If `promoted_document_id` is already set → return `ok` (idempotent). No `storage_path` → "Inbox copy no longer available".
2. Resolve the traveller (above); re-check Documents upload + sensitive-data rights.
3. Load the traveller's checklist (`departure_group_pilgrim_documents`) and `choosePassportChecklistItem` picks the passport item (errors if none/ambiguous).
4. **Claim**: `claimInboxAttachmentForPromotion` sets `promoted_document_id` only if it was null. A double-click or second tab loses here and is told *"already being saved"*. While held, the retention sweep also treats the file as saved.
5. Download from `inbox-attachments`, `checkPassportFileForPromotion` (mime/size), compute `passportDocumentPath` (`agency/group/pilgrim/document.ext`), upload to the **`pilgrim-documents`** bucket (`upsert`).
6. `submitGroupPilgrimDocument(...)` — Documents' own submit function → checklist item becomes **`SUBMITTED`**, with note "Saved from an Inbox conversation." **Saving is never verifying**: verification stays a separate Documents action.
7. `insertReviewEvent(... action "UPLOADED", from_status → "SUBMITTED")` into the document review history under the *staff user's* session client.
8. `markInboxAttachmentPromoted`. If only this marker fails, the passport **is** in Documents; a retry finishes it without a second copy.
9. `finally`: if the document never reached Documents, **release the claim** so the file can be saved again and retention sees it as unsaved. On a failed submit the copy is removed *only if nothing else points at that path* (`mayRemoveUnsubmittedCopy`).
10. `revalidatePath("/inbox")`, `("/documents")`.

### 5.4 Role map

`capabilitiesForInbox` composes (`lib/access/inbox-access.ts`): `saveAttachmentToDocuments`, `reviewPassportFields`, `assignVisaOfficer` all require Inbox view **plus** another module's right **plus** `viewSensitiveTravellerData`. A role without sensitive-data access sees a **restricted** attachment — no link, no file name (`media/passport-visibility.ts`, `InboxAttachment.restricted`).

---

## 6. Flow C — A brochure or other file → the Document Vault

- Reader classifies `BROCHURE` or `OTHER`; only a short `summary` is stored. Card text: "Choose where to keep this file. Nothing is sent to the customer."
- Options via `mediaRoutingOptions`: BROCHURE → *Save as proposal collateral*; OTHER → *Save to Documents*; both + *Download the original*. Allowed types are the `content-vault` bucket's (PDF, JPG, PNG, Word, Excel, PowerPoint), ≤ `INBOX_MEDIA_VAULT_MAX_BYTES` (10 MiB).
- `saveInboxMediaToVaultAction` → `media-to-vault.ts`: **destination re-derived on the server from the file's own kind**, so a crafted request cannot push a passport or receipt into the vault (readable by every staff role). Concurrent/repeated saves converge on one document through `claim` / `currentPromoted`; failures clean up with `removeDocument` / `removeObject`.
- Permission: `saveMediaToVault` = Inbox view + vault `manageVault`.
- Reverse direction: `stageVaultDocumentForComposerAction` (`vault-actions.ts`) lets staff **attach a vault document to a reply** ("Choose from vault").

---

## 7. Flow D — Voice notes

`TRANSCRIBE_VOICE` job (BULK): retain the original first (OGG/Opus streams are finalised by `finalizeOggOpusStream` so they play), set analysis `kind: VOICE, status: READY`, then — optional extra — transcribe into its **own table** (`voice-transcript-worker.ts`), never into the message. Retention for audio uses `voice_audio_retention_days` (default 180) rather than the attachment setting. The transcript is **staff-only**, flagged low-confidence when unsure, and never sent to the customer. No cross-module record is written; staff copy text by hand.

---

## 8. Flow E — Chat → Lead (link or create)

- **At ingest** (`lib/inbox/ingest.ts` → `linkConversationToLead`, `lead-linking.ts`): an exact provider/phone match links automatically; ambiguity is never resolved silently. For a *new* contact the system does not auto-merge; it raises candidates (`identity/graph.ts`, weights in the main technical doc §16).
- **Staff**: `captureConversationLead` (Admin/Marketing: `sendMessage` + `createLead`) → `linkConversationToLead(... createIfMissing: true, owner: staff)`. Outcomes: `PROPOSED` (must use the identity card), no lead (multiple matches → link from Leads), `CREATED` (new lead, stage `NEW_LEAD`, owner = staff, channel-default source and follow-up). On `CREATED` it inserts a **`lead_activity`** row "Lead captured from <CHANNEL> Inbox conversation." (actor "Inbox") and stamps `leads.source_conversation_id`.
- `confirmIdentityLinkAction` / `keepIdentitySeparateAction` (remembers the "different people" decision) / `unlinkIdentityLinkAction`.
- **Lead completeness** (`lead-completeness.ts`) tells staff what the lead still lacks; **Ask about …** only drops text into the composer.
- A new-chat start (`startWhatsAppChat`) previews which lead a number belongs to (`lookUpLeadForNumberAction`: names/references only, max two rows) and links on exact phone match.

---

## 9. Flow F — Chat → Departure group → Booking

### 9.1 Select departure group — `selectConversationDepartureGroup`

Needs `sendMessage` + leads `findGroups`. Re-validates on the server: same `journey_type`, `sales_status ∈ {SELLING, LIMITED_AVAILABILITY}`, not cancelled/completed/closed/archived, `available_seats ≥ adults + children`, and the lead's desired package when set. Then `changeOneLead(... selectDepartureGroupInStore)`: sets `selected_departure_group_id` and appends **`lead_activity: GROUP_SELECTED`** ("Selected <group> as the departure group."). **Interest only — no seat is held.**

### 9.2 Create booking — `createBookingFromConversation`

Needs `sendMessage` + leads `convertToBooking`; a linked lead; a derived booking (`deriveBookingFromLead`: travellers, room), and a **non-empty phone** ("a booking with nobody to call is not useful").

1. Reference = `LD-…` from the lead reference.
2. **Adopt-or-create**: `findBookingForLeadReference` + `decideExistingBookingForLead` — a booking already under that reference from an earlier half-finished attempt is *linked*, unless it is cancelled or in another group (then `BLOCKED` for a person to look at). Unreadable → refuse.
3. `createGroupBooking({ departureGroupId, leadId, bookingReference, bookingStatus: "DEPOSIT_PENDING", primaryContact*, travellerCount, roomOccupancyPreference, packagePricePerPerson, amountPaid: 0 })` — **this is where seats are held**. On failure it re-checks for a racing identical booking and adopts it.
4. `stampConversationSource` on `departure_group_bookings`.
5. `changeOneLead(... markLeadBookedInStore)` — compare-and-swap on the lead so a colleague's concurrent edit isn't overwritten: sets `booking_id`, **`stage = BOOKED`**, clears the follow-up, and appends **`lead_activity: BOOKING_CREATED`** ("Booking LD-… created; N seat(s) held."). If the lead link fails after the booking exists, the message says so and a retry will *link, not duplicate*.
6. `revalidatePath("/leads")`, `("/bookings")`.

**Downstream effects of the booking** (read by Inbox features): the booking provides the travellers and departure date used by passport review (§3.4), the Booking section of the customer panel, the `STALE_PRICE` / `GROUP_FULL` detectors, Finance candidate linking (`BOOKING_LINKED`), and the Operations handoff (§12). A **seat hold** is released automatically by the hourly `release-seat-holds` cron when it expires.

---

## 10. Flow G — Chat → Quote and follow-up

- **Quote** — `createQuoteFromConversation`: requires leads `createQuoteDraft`; the stored offer must be quotable (`canQuoteOffer`, live-checked: price/seats/open); room type and party known; a linked lead; the group's facts re-read from live data (`loadCopilotKnowledgeContext`). Calls the Leads module's `saveQuoteDraftAction` with **`discountAmount: 0`**, `expiresInDays: 7`, live inclusions/exclusions. Stamps `lead_quotes.source_conversation_id`. **Nothing is sent to the customer**; sending the formal quote stays in Leads.
- **Follow-up** — `scheduleConversationFollowUp`: leads `logContact`; future time only; `setFollowUpInStore` sets `next_follow_up_at`, `follow_up_type`, owner = the caller, and appends **`lead_activity: FOLLOW_UP_SCHEDULED`** ("Next follow-up scheduled.").

---

## 11. Flow H — Chat → Task, case, hold, profile (the conversion kernel)

`app/inbox/conversion-actions.ts` + `lib/inbox/conversions/*` + `lib/agent/kernel/proposals/kinds/conversation-*.ts`.

```
loadConversationConversionsAction  → catalogue.ts: which kinds, and a plain "why not" for each unavailable one
loadConversionChoicesAction        → choices.ts: server-supplied options for typed fields (never trusted from the form)
previewConversationConversionAction→ creates a PROPOSAL; returns humanDiff ("Nothing has been created yet")
confirmConversationConversionAction→ kernel approval → executor runs → row(s) created
dismissConversationConversionAction→ withdraws the proposal (also on Cancel)
```

Each kind is a **proposal kind in the agent kernel**, so approval, audit, supersession and execution are inherited. A proposal's `dependencySnapshot` (for tasks: the departure group) means if the group changes between preview and approval, the proposal is **superseded, not run**. TTL 24 h.

| Kind | Creates | Table | Needs |
|---|---|---|---|
| Request documents / Visa task / Payment follow-up / Rooming / Transport / Guide escalation | A task (due **24 h** ahead, status `OPEN`, owner via `taskAssignee`, category `OPERATIONS` / `VISA` / `FINANCE` / `GUIDE`) with title prefix + customer + lead ref, description = note + back-link | `departure_group_tasks` (+ source columns) | Selected departure group |
| Open complaint case | Support case | `pilgrim_support_requests` | A traveller record |
| Create traveller profile | Traveller profile from the lead | pilgrims | Lead, no profile |
| Record family / mahram link | Relationship between two travellers | relationships | Booking with ≥ 2 travellers |
| Hold seats | Time-limited hold | seat-hold executor | Lead + group + phone + no booking/hold |
| Recommend a package | Recommendation on the lead | lead | Lead |
| Request post-trip feedback | Survey task | `departure_group_tasks` | Selected group |

The assignee is notified in-app (`notifyWorkflowCreated` → `notifyConversationWaiting`, kind `WORKFLOW_CREATED`). Needs: `convertConversation` capability (Admin, Marketing, Operations) — the server re-checks. Requests are rate-checked and validated by the kind's own Zod schema.

---

## 12. Flow I — Booking → Operations handoff

`createConversationHandoffAction` (needs `sendMessage`):

1. `buildHandoffForConversation` — pure facts (`handoff/build.ts`): customer, booking, open items; **requires a *confirmed* booking** linked to the chat.
2. If a handoff exists for the same booking and is complete → return it (`created: false`). If it exists without its prose → try the narration again and attach.
3. `narrateHandoffExpectations` (AI surface `handoff-narrate`, reads only the customer's messages + facts) → `customer_expectations` with source/confidence/note and a `sentiment`. A failed narration still creates the handoff, with empty expectations that a later click can fill.
4. `createConversationHandoff` stores the **point-in-time snapshot** (`conversation_handoffs`); later edits never change it.
5. `notifyOperationsOfHandoff`: in-app notification `HANDOFF_ESCALATED` to active **OPERATIONS and ADMIN** staff except the sender. Best effort: failure never undoes the handoff.
6. `revalidatePath("/operations")`. Operations (or an Admin) acknowledges via `acknowledgeConversationHandoffAction`; the Inbox sheet then shows "Operations acknowledged this on <date>".

---

## 13. Flow J — Reviews, notifications and the dashboard

- **Reviews** are the Inbox's own bridge to other teams: each kind has an owning team and a closer set (`risk/interventions.ts`): money reviews (payment, bank, refund, fraud) → Finance/Admin only; others → Admin, Marketing, Operations, Finance. CEO and Visa cannot close.
- **Notifications** (`lib/data/staff-notifications.ts`): `WORKFLOW_CREATED`, `HANDOFF_ESCALATED`, owner assignment ("<You> gave you N conversations"), mentions in notes (only colleagues who can open the Inbox), reply-window reminders (`reply-window-sweep`). All best-effort and in-app; none messages the customer.
- **Dashboard**: `inbox-intelligence-panel.tsx` shows ten counts (e.g. *Payment claims needing verification*, *Document and visa escalations*) and links to the exact queue behind each; the Inbox **Outcomes** panel (`lib/metrics/inbox-outcomes.ts`) reports the same sources with honest states.
- **Queues** that the effects feed: Payments (PAYMENT_DISCUSSIONS), Documents, Visa questions, Urgent (ESCALATIONS), Waiting for our team, Ready to book, Quote sent — all derived in SQL from conversation facts and open interventions.

---

## 14. The customer trail: what each module records

"The customer trail" = the set of append-only histories across modules that together tell the story of one customer. The Inbox does not keep one master timeline table; it writes to each module's own history and links them with `source_conversation_id`.

| Event | Recorded where | Entry |
|---|---|---|
| First contact creates a lead | `lead_activity` | "Lead captured from <CHANNEL> Inbox conversation." (actor *Inbox*) |
| Departure group chosen | `lead_activity` `GROUP_SELECTED` | "Selected <group> as the departure group." |
| Booking created | `lead_activity` `BOOKING_CREATED` (+ lead stage → `BOOKED`) | "Booking LD-… created; N seat(s) held." |
| Follow-up scheduled | lead follow-up fields + `lead_activity` `FOLLOW_UP_SCHEDULED` | "Next follow-up scheduled." (type, due, owner on the lead) |
| Quote drafted | `lead_quotes` (+ source link) | reference, expiry, inclusions |
| Receipt copied to Finance | `finance_evidence_intake` (`PENDING_REVIEW`, source ids) | status history |
| Receipt matched / dismissed | finance audit event `NOTE_ADDED` on payment/booking | "…matched to payment … No payment was verified, allocated, or changed." / reason |
| Passport saved to Documents | document review history `UPLOADED` (`→ SUBMITTED`) + `promoted_document_id` on the attachment | "Saved from an Inbox conversation." |
| Passport details confirmed | traveller record's own history (via `updateGroupPilgrimRecord`) | number/expiry change |
| Visa officer assigned | visa module `insertVisaEvent` `ASSIGNED` | actor, role, officer |
| Task / case created | `departure_group_tasks` / `pilgrim_support_requests` with `source_conversation_id`, back-link text | title, owner, due |
| Owner changes in the chat | conversation history (`loadInboxHistoryAction`) | who gave it to whom |
| Operations handoff | `conversation_handoffs` | snapshot + acknowledgement |
| Review resolved / dismissed | `conversation_interventions` | status, actor, mandatory note |
| Spam change | conversation history | recorded |

The reverse link (from the lead, booking, task or Finance item **back to the chat**) uses `source_conversation_id` + `inboxPageHref`. Rows created *outside* the Inbox have no source.

---

## 15. Who may trigger what

| Effect | Capability needed (all re-checked on the server) | Roles that qualify today |
|---|---|---|
| Read the chat & cards | `viewModule` | Admin, CEO, Marketing, Operations, Finance, Visa |
| Copy receipt to Finance / open Finance review | Copy: role Admin/CEO/Finance, **or** the chat's assigned owner holding `openFinanceReview` (= viewModule + Finance `viewLedger`). Open review: `openFinanceReview` | Admin, CEO, Finance (others only via granted ledger access) |
| Match or dismiss receipt evidence (in Finance) | `canDecideFinanceEvidence` | Admin, Finance (CEO view-only) |
| Confirm passport number/expiry | `reviewPassportFields` | Admin, Operations, Visa |
| Save passport to Documents | `saveAttachmentToDocuments` | Admin, Operations, Visa |
| Assign visa officer | `assignVisaOfficer` | Admin, Operations, Visa (per module rights) |
| Save brochure/file to Vault | `saveMediaToVault` | every role with vault manage (not Guide) |
| Link / create lead, select group, create booking, quote, follow-up | Inbox `sendMessage` + the matching `capabilitiesForLeads` right | Admin, Marketing |
| Turn into work | `convertConversation` | Admin, Marketing, Operations |
| Operations handoff | `sendMessage` | Admin, Marketing, Operations |
| Close a money review | intervention rules | Admin, Finance |

(See `lib/access/inbox-access.ts`; the exact role set follows each owning module's access file and dynamic capabilities, so treat the table as a snapshot.)

---

## 16. Safety rules shared by every flow

1. **Suggest ≠ do.** Models read; humans confirm. Routing has no "auto-send/auto-publish" path.
2. **Derive, don't trust.** The browser sends an attachment/conversation id. Traveller, destination, kind, group, quote facts and permissions are re-derived server-side.
3. **Agency scope everywhere**, plus composite same-agency foreign keys on new tables.
4. **Idempotent, claim-based writes** (`promoted_document_id` claim, adopt-or-create booking, proposal supersession, `ALREADY_REVIEWED` first-wins, evidence payment-already-linked guard).
5. **Compare-and-swap on shared rows** (`changeOneLead` rereads and applies only if unchanged) so a colleague's edit is never overwritten.
6. **Sensitive data separation:** passports and receipts never go to the shared Document Vault; role without sensitive-data access sees no link/name.
7. **Best-effort extras never undo the real work** (notifications, activity feed, source stamps log and continue).
8. **Honest labels:** receipts say *Not verified*; saved passports say *submitted, not verified*; clean means *stored and type-checked*, not scanned.
9. **Money truth stays in Finance.** The Inbox never writes `payments`.

---

## 17. Retention and what survives deleting a chat

- Inbox copies of files expire at `expires_at` (`inbox_attachment_retention_days` default 90; voice `voice_audio_retention_days` default 180; max 365 each). Nightly `inbox-retention` sweep; files with a `promoted_document_id` (claimed or saved) are **left alone**. Finance evidence keeps its **own** copy with its own `retention_expires_at` (source ids are nullable on purpose so the Inbox message graph can be deleted first).
- **Deleting a conversation** (admin only) removes messages, notes, drafts, attachments (and stored files), assistant runs and send queue. Leads, bookings, tasks, quotes, finance evidence, documents and visa data **remain**; their `source_conversation_id` / `source_message_id` are set null.
- Meta data-deletion callbacks reuse the same destructive primitive ([`../runbooks/inbox-retention-and-deletion.md`](../runbooks/inbox-retention-and-deletion.md)).

---

## 18. Failure and recovery behaviour

| Situation | Behaviour |
|---|---|
| AI reading fails | Retries; final attempt → analysis `FAILED` (message truncated to 300 chars); original still kept and openable. |
| AI reading off / type unreadable | `READY`, no fields; staff work from the original. |
| Original not downloaded | A repair sweep re-queues downloads for recent attachments with no stored original (`jobs/repair.ts`). UI: "Loading…", then "not available". |
| Copy to Finance fails | Error "Could not copy the receipt to Finance. Try again."; nothing partial is reported as success. |
| Save to Documents mid-failure | Claim released; copy removed only if unreferenced; retry safe. If only the Inbox marker fails, retry completes it without a second copy. |
| Booking exists but lead link fails | Message names the booking; retry links, never duplicates. |
| Two people click | First wins; second gets "already being saved" / "already decided" / "Someone else changed…". |
| Notification fails | Logged; action stands. |
| Source stamp fails | Logged; rerun repairs. |

---

## 19. Known gaps and caveats

- **Finance match ≠ resolve the red review.** Staff must resolve the Inbox review manually; consider this when measuring "payment review time".
- **No virus scan.** `scan_status = CLEAN` only means stored and type-checked.
- **Passports need a booking.** No booking → no candidate travellers → no match, no Save to Documents.
- **Receipt reading depends on the model.** A receipt the model labels `OTHER` gets no payment review (then the **Payments** queue relies on text detectors and staff judgement). Conversely a non-receipt labelled `RECEIPT` opens a blocking review that staff must resolve.
- **Receipt types for Finance** are PDF/JPEG/PNG/WebP/HEIC; the *reader* accepts PDF/JPEG/PNG/WebP/GIF — GIF and HEIC differ between the two lists.
- **Single-passport checklist item**: if the traveller's checklist has no suitable passport item, Save to Documents refuses with the reason.
- **Customer trail is distributed**, not one table: to show a single timeline across modules you must join the sources in §14.
- **Messenger/Instagram** carry fewer file types; Instagram photos only (outbound).
- The unsupported WhatsApp message types (video, location, stickers…) never reach any of these flows.

---

## 20. Testing and where to extend

| Area | Tests / files |
|---|---|
| Media handler | `lib/inbox/media/*.test.ts` (receipt, passport, routing, vault, voice) |
| Finance evidence | `lib/finance/finance-evidence*.test.ts`, `evidence-matching.test.ts`, `lib/data/…`, `app/(main)/finance/payments/actions.evidence.test.ts` |
| Passport & documents | `app/inbox/save-passport-to-documents.test.ts`, `load-visa-officers-action.test.ts` |
| Booking | `app/inbox/create-booking-from-conversation.test.ts`, `lib/inbox/conversation-booking.test.ts` |
| Conversions | `app/inbox/conversion-actions.test.ts`, `lib/inbox/conversions/*.test.ts`, kernel `conversation-conversions.test.ts` |
| Vault | `app/inbox/vault-actions.test.ts` |
| Source links | `lib/inbox/conversions/source-link.test.ts` |

To add a new outside effect: (1) put the **decision** in a pure function; (2) add a capability to `InboxCapabilities` that composes the owning module's right; (3) write the action with the pattern in §3.6 and a **claim/idempotency** guard; (4) write through the owning module's function and **its** history; (5) stamp `source_conversation_id` if the new row should be traceable; (6) add a routing option with a plain "why not" reason; (7) add the effect to §2 and §14 here and to the user guide.

---

## Related documents

[`inbox-technical-documentation.md`](./inbox-technical-documentation.md) · [`finance-evidence-guide.md`](./finance-evidence-guide.md) · [`../runbooks/inbox-attachment-checks.md`](../runbooks/inbox-attachment-checks.md) · [`../runbooks/inbox-retention-and-deletion.md`](../runbooks/inbox-retention-and-deletion.md) · [`architecture.md`](./architecture.md) §11.3 (conversation → workflow)
