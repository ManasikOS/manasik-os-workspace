# Leads Module — Security & Hardening Audit and Remediation Plan

| | |
|---|---|
| **Scope** | `/leads`, `/leads/new`, the Lead Drawer, Manasik Decision (copilot) actions, CSV import/export, quote and booking-conversion flow, lead-consent, `lead-followups` cron sweep, WhatsApp-agent lead tools, and the `leads*` / `lead_*` database objects |
| **Method** | Static review of the code and migrations at branch `UI-update` (commit `d4ef4ac7`). Threat-model first (trust boundaries → assets → STRIDE), then a line-level read of every Server Action, repository function, mutator, RLS migration and UI entry point. |
| **Not done** | No live exploitation, no live database inspection (`pg_policies` / grants were read from migrations only), no dependency audit run. Items marked **Verify** need a check against the real database or a running instance. |
| **Date** | 2026-10-12 |

---

## 1. Executive summary

The Leads module has a **sound architectural core**: every Server Action calls `requireUser()` and checks a role capability; the copilot actions validate input with Zod and re-read prices from live data; the booking conversion re-validates price against the published rate; the cron route uses a constant-time bearer compare; CSV export defuses formula injection; and RLS is tenant- and role-scoped at the database.

The weaknesses cluster in **five themes**:

1. **Controls enforced only in the application, not the database** — the same role that is denied "delete" or "approve discount" in the UI can do it directly through PostgREST, because the write policy is `FOR ALL` on every column.
2. **Over-fetching to the browser** — "converted-only" roles (Finance, Operations, Visa) receive every lead's notes, quotes, activity and money fields; the helper functions the access file's header claims exist (`filterLeadsForRole`, `nullPipelineValueForRole`) do not.
3. **Unvalidated Server Action inputs on the older actions** — `actions.ts` trusts TypeScript types at a network boundary. The newer `copilot-actions.ts` is the model to copy.
4. **Business-rule bypasses** — a quote held for discount approval can be released by anyone with `sendQuote`; the CSV import is a second, unvalidated create path; stage can be set to `BOOKED` with no booking.
5. **Weak concurrency and audit integrity** — whole-store read-modify-write with no compare-and-swap (`changeOneLead` exists but is not used), read-then-write reference numbering, and an "immutable" audit trail that is not.

### Findings at a glance

| ID | Sev | Title | Area |
|---|---|---|---|
| **LD-01** | **High** | Quote discount-approval gate can be bypassed by `updateQuoteStatusAction` | Business logic |
| **LD-02** | **High** | RLS write policy is `FOR ALL`/any column — delete, audit tampering and quote edits bypass app rules | Authorization (DB) |
| **LD-03** | **High** | Converted-only roles receive all leads' notes/quotes/activity and money fields | Info disclosure |
| **LD-04** | **High** | `importLeadsAction` accepts unvalidated `CreateLeadInput[]` (no schema, no cap, spoofable owner/stage/actor) | Input validation |
| **LD-05** | **High** | `sendQuoteAction` trusts browser-supplied prices and totals | Integrity |
| **LD-06** | Medium | Lost updates: every action loads and upserts the whole store with no version check | Concurrency |
| **LD-07** | Medium | Stage can be set to `BOOKED`/`DUPLICATE`/`SPAM` etc. arbitrarily; no transition rules | Business logic |
| **LD-08** | Medium | `logContact` / `setFollowUp` / `selectDepartureGroup` accept unvalidated, spoofable fields | Input validation |
| **LD-09** | Medium | `convertLeadToBookingAction`: no state guards, client-supplied contact/count, non-atomic two-step | Integrity |
| **LD-10** | Medium | Lead and quote reference numbers are generated read-then-write (collision → raw DB error) | Concurrency |
| **LD-11** | Medium | Actor identity is a free-text display name; audit trail has no user id | Repudiation |
| **LD-12** | Medium | CSV export has no capability gate or audit event; exports money and notes | Info disclosure |
| **LD-13** | Medium | Import dialog tells users "nothing is uploaded"; data is in fact sent to the server | Integrity / trust |
| **LD-14** | Medium | Leads actions use static role capabilities, ignoring custom-role overrides used elsewhere | Authorization |
| **LD-15** | Medium | WhatsApp agent writes unbounded, customer-influenced text into leads/notes later fed to an LLM | Prompt injection |
| **LD-16** | Medium | Raw database/persistence error strings returned to the client | Info disclosure |
| **LD-17** | Low | Consent changes: unvalidated enums/channels, swallowed audit-insert failure, no DNC guard on manual contact | Privacy |
| **LD-18** | Low | Duplicate detection: `ilike` wildcard `*`, Sri-Lanka-only mobile normalisation, no DB uniqueness | Data integrity |
| **LD-19** | Low | `upsertLeadSourceAction` accepts client `id`, unbounded `code`, returns DB error text | Input validation |
| **LD-20** | Low | `viewAllOwners` never enforced; every viewer sees every owner's PII (decide: intentional?) | Authorization |
| **LD-21** | Low | No rate limiting or size caps on Server Actions / copilot LLM calls | Availability / cost |
| **LD-22** | Low | CSP allows `'unsafe-inline'` scripts (known, tracked P0-7) | Config |
| **LD-23** | Info | PII sent to third-party LLM provider with no redaction or consent record | Privacy |

Severity uses impact × likelihood **for an authenticated-staff threat model** (a compromised or malicious low-privilege staff account, or an over-privileged role) — there is no unauthenticated attack surface in this module other than the cron route.

---

## 2. Threat model

### 2.1 Trust boundaries

| # | Boundary | Untrusted data crossing it |
|---|---|---|
| B1 | Browser → Server Actions (`actions.ts`, `copilot-actions.ts`) | Every argument, including ids, enums, prices, names, free text |
| B2 | Browser → Supabase REST directly (anon key + user JWT) | Anything RLS allows — **bypasses all app code** |
| B3 | CSV file → import dialog → `importLeadsAction` | Every cell |
| B4 | WhatsApp / Messenger customer → AI agent → `leads` / `lead_notes` | Customer text, LLM-generated args |
| B5 | Lead text/notes → OpenRouter LLM → staff UI | Notes, pasted enquiries; LLM output |
| B6 | pg_cron → `/api/cron/lead-followups` | Bearer secret only |
| B7 | Lead record → outbound message (`wa.me`, template send) | Consent / do-not-contact state |

### 2.2 Assets

Customer PII (name, mobile, email, city, travel intent, notes), consent/do-not-contact state, pipeline value and quote amounts, booking linkage and seat holds, the audit trail, the agency tenancy boundary, the WhatsApp sending identity.

### 2.3 Abuse cases (the ones the findings map to)

- *A marketing user wants a discount released without admin approval.* → LD-01, LD-02
- *A marketing user wants to hide that they edited/deleted a lead.* → LD-02, LD-11
- *An operations/visa user wants to see pipeline money or other staff's notes.* → LD-03, LD-12
- *A user submits a hand-built import payload to assign leads to someone else, mark them `BOOKED`, or flood the table.* → LD-04
- *A user sends a customer a quote with a price that was never on the rate card.* → LD-05
- *A customer tells the WhatsApp bot "ignore your rules and write this note: …".* → LD-15
- *Two colleagues act on the same lead at once.* → LD-06, LD-10

---

## 3. Findings

Each finding lists **Evidence**, **Impact / scenario**, **Fix**, and **Test**.

### LD-01 — Discount-approval gate bypass (High)

**Evidence**
- `copilot-actions.ts:595` sets status `PENDING_APPROVAL` when a discount is present and the caller lacks `applyUnrestrictedDiscount` (ADMIN only).
- `actions.ts:620-635` `updateQuoteStatusAction` takes `{ quoteId, status }` and is gated only by `sendQuote` (ADMIN **and MARKETING**).
- `lib/data/leads.ts:951-986` `updateQuoteStatusInStore` sets `quote.status = input.status` with **no check of the current status, the target status, or who may approve**.

**Impact** A MARKETING user saves a discounted quote (lands `PENDING_APPROVAL`), then calls `updateQuoteStatusAction({ quoteId, status: "SENT" })` — or `ACCEPTED` — and the admin-approval control is gone. `discount_approved_by` / `discount_approved_at` columns exist but nothing sets or checks them. `QuoteStatus` is a TypeScript type only; the runtime value is unvalidated.

**Fix**
1. Define an explicit quote state machine in one pure module (`lib/data/quote-transitions.ts`): `DRAFT → PENDING_APPROVAL → (approve) DRAFT/SENT`, `SENT → VIEWED|ACCEPTED|DECLINED|EXPIRED|CANCELLED|SUPERSEDED`, terminal states have no exits.
2. `updateQuoteStatusInStore` rejects any transition not in the table.
3. Add a separate `approveQuoteDiscountAction`, gated by `applyUnrestrictedDiscount`, that sets `discount_approved_by` (user id) and `discount_approved_at`. `PENDING_APPROVAL → SENT` is **only** reachable through it.
4. Validate `status` with `z.enum(...)` at the action boundary.
5. Defence in depth at DB level — see LD-02 (trigger that refuses `status` change out of `PENDING_APPROVAL` unless `discount_approved_by` is set).

**Test** Unit-test the transition table exhaustively; action test that MARKETING cannot move `PENDING_APPROVAL → SENT`; ADMIN can via the approve action.

---

### LD-02 — RLS write policy allows everything to ADMIN and MARKETING (High)

**Evidence** `20260822090000_rls_hardening.sql:98-125` — for `leads`, `lead_activity`, `lead_notes`, `lead_quotes`, `lead_sources` the write policy is `FOR ALL … USING/WITH CHECK (staff_role_in('ADMIN','MARKETING'))`, later wrapped with `agency_id = current_agency_id()` by `20260824090000_tenancy.sql`. The three Sales-Intelligence tables use `FOR ALL` for any authenticated user in the agency (`20260930090000_leads_sales_intelligence.sql` §E, no role check at all). No later migration narrows these (searched `supabase/migrations`).

**Impact** The browser holds the anon key and the user's JWT (`utils/supabase/client.ts`), so any MARKETING user can issue `DELETE`/`UPDATE` directly against PostgREST:
- `DELETE FROM leads` — `deleteLead` is an ADMIN-only capability, but the database lets MARKETING do it.
- `UPDATE/DELETE lead_activity` — the migration comment says "immutable"; it is not. The audit trail can be rewritten or erased.
- `UPDATE lead_quotes SET total_lkr = …, status = 'ACCEPTED', discount_approved_by = …` — bypasses LD-01 and all quote validation.
- Any authenticated user (including CEO/GUIDE if they have a staff row) can write `lead_copilot_context`, `lead_communication_drafts`.
- `leads.stage`, `assigned_to_id`, `consent_status`, `do_not_contact` can be set to anything the CHECK constraints permit.

**Fix** (new migration, e.g. `2027…_leads_rls_least_privilege.sql`)
1. **Split `FOR ALL` into per-command policies.**
   - `lead_activity`, `lead_notes`, `lead_copilot_dismissals`: `INSERT` for ADMIN/MARKETING; **no** UPDATE/DELETE policy at all.
   - `leads`: `INSERT`/`UPDATE` for ADMIN/MARKETING; `DELETE` for ADMIN only.
   - `lead_quotes`: `INSERT`/`UPDATE` for ADMIN/MARKETING; `DELETE` ADMIN only.
   - `lead_sources`: write ADMIN only (matches `manageSourcesAndAutomation`).
   - Sales-Intelligence tables: add the same role check as `leads`.
2. **Immutability triggers** on `lead_activity` and `lead_notes`: `BEFORE UPDATE OR DELETE … RAISE EXCEPTION` (allow service-role / cascade from lead delete explicitly).
3. **Guard triggers** on `lead_quotes` for money and approval columns: reject changes to `total_lkr`, `deposit_lkr`, `discount_amount`, `discount_approved_*`, and `status` transitions out of `PENDING_APPROVAL` unless the actor is ADMIN.
4. Consider revoking table `UPDATE` on sensitive columns (`REVOKE UPDATE (col) … FROM authenticated`) and exposing mutations through `SECURITY DEFINER` RPCs (the repo already does this for `touch_own_activity`).
5. **Verify** with `select * from pg_policies where tablename like 'lead%'` on production — the migrations are the source here, not the live state.

**Test** pgTAP / SQL tests running as a MARKETING JWT: `delete from leads` fails; `update lead_activity` fails; `update lead_quotes set status='SENT' where status='PENDING_APPROVAL'` fails.

---

### LD-03 — Converted-only roles receive everything (High)

**Evidence**
- `app/(main)/leads/page.tsx:52-56,59-69`: `leads` is filtered to `booking_id !== null` for `convertedOnly`, but the provider receives `{ ...store, leads }` — `activity`, `notes`, `quotes`, `copilotContexts`, `copilotDismissals`, `communicationDrafts` for **all** leads are serialised into the RSC payload.
- `lib/access/leads-access.ts:9-11` says `filterLeadsForRole` and `nullPipelineValueForRole` "are applied in the repository". **They do not exist** (`grep` finds only the comment). `estimated_value_lkr` is therefore sent to OPERATIONS and VISA, which are documented as "never see money" (`leads-access.ts:28`).
- `loadLeadStore` selects `*` from every table (`leads-repository.ts:84-91,334-347`). RLS read allows ADMIN/CEO/MARKETING/FINANCE/OPERATIONS/VISA on every row (`rls_hardening.sql`), so the restriction exists only in `page.tsx`.

**Impact** An OPERATIONS or VISA user opens DevTools → network → the RSC payload and reads every prospect's notes, quote totals, deposits, consent state, and the copilot's saved intents — data their role is meant not to have. Also reachable directly via PostgREST (RLS allows the read).

**Fix**
1. Implement the missing pure functions and apply them **in the repository** before anything is returned: `projectStoreForRole(store, capabilities)` that (a) filters leads, (b) drops `activity/notes/quotes/copilot*` rows whose `lead_id` is not in the surviving set, (c) nulls `estimated_value_lkr` and quote amounts when `!viewPipelineValue`, (d) empties `quotes` when `!viewQuotes`.
2. Use **column-level projection** in the query for roles with reduced access instead of `select("*")`.
3. Make the database agree: replace the single read policy with `USING (staff_role_in('ADMIN','CEO','MARKETING') OR (staff_role_in('FINANCE','OPERATIONS','VISA') AND booking_id IS NOT NULL))`, and gate `lead_quotes` read on `viewQuotes` roles.
4. Add a unit test that serialises the provider props for each role and asserts forbidden keys are absent.
5. Fix the stale header comment in `leads-access.ts`.

---

### LD-04 — `importLeadsAction` is an unvalidated second create path (High)

**Evidence** `actions.ts:181-209`: `rows: CreateLeadInput[]` is a TypeScript type only. It bypasses `createLeadSchema`, the duplicate gate, and the staff lookup that `createLeadAction` performs. `createLeadInStore` (`leads.ts:488-629`) only checks name/mobile/adults/owner/follow-up presence. Also: no maximum row count, `loadLeadStore` of the whole table per call, and `nextLeadReference` scans the store per row (O(n²)).

**Impact**
- `assignedToId`/`assignedToName`/`followUpOwnerName` are taken from the payload: a user can create leads "owned by" and attributed to any person (the activity row is written with `input.assignedToName` as actor — `leads.ts:591-616`).
- `stage` can be `BOOKED`, `DUPLICATE`, `SPAM`; `estimated_value_lkr` is server-computed but `adults`/`children` are unbounded (`adults: 1e9` → bogus pipeline value, and `numeric`/`bigint` overflow errors).
- No server-side duplicate check → bypasses the gate that `createLeadAction` calls "the real gate".
- `email`, `city`, `notes`, `campaignReference` unbounded.
- Large payload + O(n²) → CPU DoS on the server; a single failing row aborts nothing but a DB error on persist fails the entire batch after partial in-memory work.

**Fix**
1. Introduce `importLeadRowSchema` (Zod) reusing `createLeadSchema`'s enums, with length caps (name ≤ 120, notes ≤ 2000, email ≤ 254, etc.), `adults ≤ 60`, `children ≤ 60`.
2. Validate `rows` as `z.array(importLeadRowSchema).max(500)`; reject otherwise.
3. **Resolve owner server-side**: ignore `assignedToId/Name` from the client; look up `loadAssignableStaff()` and verify the id; derive names from the DB, never the payload.
4. Force `stage = NEW_LEAD` unless the actor has `changeStage`, and never allow `BOOKED`/`DUPLICATE`/`SPAM` on import.
5. Run the same server duplicate check per row (batched with one `IN` query on normalised mobiles), reporting skips.
6. Allocate references through a DB sequence/RPC (LD-10) so a 500-row import is one round-trip, not 500 scans.
7. Record an `IMPORTED` audit event with count and file hash; rate-limit (LD-21).

---

### LD-05 — `sendQuoteAction` trusts browser-supplied money (High)

**Evidence** `actions.ts:537-611`: `roomPricePerPerson`, `depositPerPerson`, `adults`, `children`, `currency`, `packageName`, `groupLabel`, `departureGroupId` all come from the caller; `totalLkr = roomPricePerPerson * travellers` (`:544-546`). Nothing is validated and nothing is re-read from `departure_group_pricing`. By contrast `saveQuoteDraftAction` (`copilot-actions.ts:564-593`) explicitly re-reads the live group and its header comment says "never taken from the browser".

**Impact** A marketing user (or a tampered client) can issue a recorded, customer-facing quote at LKR 1 per person, a negative price, `NaN`, or a fractional adult count, for any group id, with no seat-availability or sellability check, and with `currency` free text. The quote is recorded as `SENT` and drives the lead to `PROPOSAL_SENT`. This is a financial-integrity and reputational risk (customers hold a "valid" quote at a wrong price).

**Fix**
1. Make `sendQuoteAction` take only `{ quoteId, sentVia }` and **send an existing server-built draft**, or take `{ leadId, departureGroupId, occupancyType, adults, children, infants, discountAmount, … }` and reuse the exact server pipeline of `saveQuoteDraftAction` (live price, seat check, `calculateQuote`, approval rule).
2. Zod-validate everything; `adults 1–60`, integers only, `currency` from the group, strings capped.
3. Delete the second pricing path rather than keeping two.

---

### LD-06 — Lost updates: no version check on the main write path (Medium)

**Evidence** `actions.ts:62-77` `mutate()` loads the **entire** store (`loadLeadStore(supabase)` — all leads, notes, activity, quotes) and `persistLeadStore` upserts whole changed rows (`leads-repository.ts:445-487`). Compare-and-swap exists — `persistSingleLeadChange` / `changeOneLead` (`:503-557`, using `updated_at`) — but `actions.ts` does not use it (only its own tests reference it).

**Impact** Two staff open the same lead; A sets the stage, B (page loaded earlier) logs contact; B's whole-row upsert silently reverts A's stage. Because `persistLeadStore` upserts the **entire row**, every column of the lead is overwritten, including consent columns another action just changed. It also makes every click read every lead in the agency (cost grows with data, and a large agency makes each action a full table scan).

**Fix**
1. Switch every single-lead action to `changeOneLead()` (already written and tested): load one lead, patch only changed columns, CAS on `updated_at`, bounded retry.
2. For bulk actions, loop with `changeOneLead` per id, capped (≤ 100) with per-id results.
3. Remove the `persistLeadStore` whole-store path from user actions; keep it only for create flows that insert.
4. Add `loadLeadStore({ leadId })` everywhere it is currently called without options.

---

### LD-07 — No stage-transition rules (Medium)

**Evidence** `changeLeadStageInStore` (`leads.ts:640-701`) accepts any `LeadStage` for any lead without a booking. `changeStageAction` (`actions.ts:256-291`) does not validate `stage`/`lostReason`/`postponedUntil` at runtime and accepts an unbounded `leadIds` array. `logContactInStore` additionally honours a client-supplied `advanceToStage` (`:743,777-785`).

**Impact** A lead can be marked `BOOKED` or `DEPOSIT_PENDING` with no booking or quote; `BOOKED` removes the lead from follow-up queues and closes sweeps. Reports and pipeline value are corrupted; `SPAM`/`DUPLICATE` can be used to hide leads. A user can submit 50 000 ids.

**Fix**
- Single `LEAD_STAGE_TRANSITIONS` table; `BOOKED` reachable **only** through `markLeadBookedInStore`; `DEPOSIT_PENDING` requires an accepted quote.
- Zod: `leadIds: z.array(z.uuid()).min(1).max(100)`, `stage: z.enum(...)`, `lostNote ≤ 500`, `postponedUntil` ISO date and ≥ today.
- Drop `advanceToStage` from the public action input.

---

### LD-08 — Weak input handling on follow-up / contact / group actions (Medium)

**Evidence**
- `logContactAction` (`actions.ts:326-340`) spreads the caller's object into `logContactInStore`; `followUpOwnerId` / `followUpOwnerName` are never checked against staff. `logContactSchema` exists in `lib/validations/leads.ts:105` but is **not used**.
- `setFollowUpAction` (`:342-366`) falls back to `owner?.name ?? actorName` — an unknown `followUpOwnerId` is stored with the actor's name.
- `selectDepartureGroupAction` (`:398-414`) stores any `departureGroupId` and a client-supplied `groupLabel` straight into the activity message; it never checks the group exists, is sellable or in the lead's agency (an FK violation surfaces as a raw error).
- `addNoteAction` — note length unbounded; `summary` unbounded.

**Fix** Zod-parse every action input; verify owner ids against `loadAssignableStaff`; for group selection load the group server-side and derive the label (never accept `groupLabel`); cap text (`note ≤ 2000`, `summary ≤ 1000`). Wire the existing `logContactSchema` / `addNoteSchema` / `markLostSchema`.

---

### LD-09 — Convert-to-booking: guards and atomicity (Medium)

**Evidence** `actions.ts:723-774`.
- Price is **not** the issue — `checkBookingCommercialTerms` (`departure-groups-booking-terms.ts:60-130`) rejects a price that is not the published tier/early-bird for non-admins. Good.
- `primaryContactName`, `primaryContactPhone`, `adults`, `children`, `roomOccupancyPreference` come from the browser and are unvalidated (no length/range; they are not taken from the lead or the accepted quote). `depositAmount` is accepted and ignored.
- No guard on lead stage: a `LOST`/`SPAM`/`DUPLICATE` lead can be converted; no check that the lead's consent is not do-not-contact; no requirement that a quote was accepted or that the group matches `selected_departure_group_id`.
- Two non-atomic steps: `createGroupBooking` commits (seats held, pilgrim records, milestones), then the lead is updated. If `persistLeadStore` throws, the booking exists but the lead is unlinked, and a retry fails with "Booking reference LD-… is already in use". If `markLeadBookedInStore` returns not-ok, the function still returns `ok: true` (`:767-773`).
- `lead.booking_id` check (`:736`) is read-then-write; the reference uniqueness check is the only thing preventing a double booking under concurrency (verify a DB unique index exists on `(agency_id, booking_reference)`).

**Fix**
1. Zod-validate input; derive contact, headcount and room from the lead (or accepted quote) server-side and only allow overrides with `editLead`.
2. Require stage ∈ {`QUALIFIED`, `PROPOSAL_SENT`, `NEGOTIATION`, `DEPOSIT_PENDING`} and `!do_not_contact`.
3. Make the link idempotent and atomic: a single `SECURITY DEFINER` RPC `convert_lead_to_booking(lead_id, …)` that takes `SELECT … FOR UPDATE` on the lead, creates the booking and sets `booking_id`/`stage` in one transaction. Short of that, on link failure compensate (cancel the booking) or make retry detect an existing booking with `lead_id = this lead` and finish the link instead of failing.
4. Return `ok:false` when the link step fails.
5. Add a partial unique index: `unique (lead_id) where lead_id is not null` on `departure_group_bookings`.

---

### LD-10 — Reference-number races (Medium)

**Evidence** `nextLeadReference` (`leads.ts:434-445`), `nextQuoteReference` (`actions.ts:503-512`, `leads-copilot.ts`), and `nextLeadReferenceForAgency` (`lead-capture.ts:36-51`, used by the WhatsApp agent) all compute `max+1` from rows already read. Unique constraints exist `(agency_id, reference)` (`20260824090000_tenancy.sql:268-272`).

**Impact** Two concurrent creates (including bot + staff, or two agent turns) compute the same number; the second insert fails on the unique constraint. In `actions.ts` that error surfaces as a thrown `LeadPersistenceError` with a Postgres message (LD-16), and for imports the whole batch fails. The quote reference is customer-visible, so a retry loop in the app is not enough.

**Fix** Allocate with a per-agency, per-year counter table and an `INSERT … ON CONFLICT DO UPDATE … RETURNING` (or a Postgres sequence per agency) inside the same RPC that inserts the row. Remove the three duplicated `max+1` implementations.

---

### LD-11 — Actor identity is a display name (Medium)

**Evidence** `lead_activity.actor_name`, `lead_notes.author_name`, `lead_quotes.created_by_name`, `consent_events.actor_name` are text. `getCurrentStaffRole()` returns `name ?? "Staff"` (`actions.ts:66-67`). `createLeadInStore` writes the **assigned owner's** name as the actor of "Lead captured" (`leads.ts:591-598`), not the creator. Only `lead_communication_drafts` and quotes have `created_by_user_id`.

**Impact** Two staff with the same name are indistinguishable; a renamed or removed account rewrites history; imports can attribute creation to anyone (LD-04); there is no reliable "who did this" for a dispute or consent investigation (repudiation).

**Fix** Add `actor_id uuid` (references `auth.users`/`staff_profiles`) to `lead_activity`, `lead_notes`, `consent_events`, `lead_quotes`; populate from `getSessionUser()`; keep the name as a denormalised snapshot. Add `created_by_id` to `leads`. Backfill best-effort by name match.

---

### LD-12 — CSV export has no capability gate or audit (Medium)

**Evidence** `leads-list.tsx:305-320` exports `sorted` (the on-screen set) for anyone who can see the page. `csv.ts:45-97` includes Mobile, Email, **Estimated Value**, and **Notes** joined across the lead.

**Impact** Any viewer (including OPERATIONS/VISA, once LD-03 is fixed they will see only converted leads, but still money/notes unless projected) can drop a full PII + notes file to disk with no trace. This is the cheapest data-exfiltration route for a leaving employee. The formula-injection defence in `lib/csv.ts` is good and should be kept.

**Fix**
- Add an `exportLeads` capability (ADMIN, MARKETING; not Ops/Visa); build the CSV columns from the same projection as LD-03 (no value column without `viewPipelineValue`).
- Move export to a Server Action that returns the file and writes an `EXPORTED` audit row (who, filter, row count).
- Optionally cap rows per export and warn about PII in the UI.

---

### LD-13 — Misleading import notice (Medium)

**Evidence** `import-leads-dialog.tsx:119-122` — "Nothing is uploaded anywhere — the file is read in your browser." In fact `leads-store.tsx:270` posts the parsed rows to `importLeadsAction`. The dedupe check is also client-only, built from the leads the page already holds (`:84-86`), so it is stale and silently incomplete for large agencies.

**Fix** Change the copy to "Rows are validated in your browser and then saved to the CRM." Move the authoritative checks server-side (LD-04) and show the server's result (created / skipped / failed with reasons).

---

### LD-14 — Static capabilities vs custom roles (Medium)

**Evidence** Every Leads action uses `capabilitiesForLeads(role)` (`leads-access.ts:164-166`) from the **base role**. Departure Groups uses `loadDynamicCapabilities(...)` with `role_permissions` overrides (`departure-groups.ts:564-575`), and `lib/access/module-capability-keys.ts:45` registers a `leads` key set — so an admin can configure custom-role overrides for leads that the module never reads.

**Impact** Silent privilege drift: a custom role created by removing `convertToBooking` or `sendQuote` from a MARKETING-based role keeps the base role's powers in Leads, while the settings UI says it was removed.

**Fix** Resolve capabilities through `loadDynamicCapabilities(supabase, roleId, "leads", capabilitiesForLeads(role))` in a single `getCurrentLeadCapabilities()` (cached per request, mirroring `getCurrentDepartureCapabilities`) and use it in `page.tsx`, `new/page.tsx` and every action.

---

### LD-15 — Agent writes untrusted text that is later fed to an LLM (Medium)

**Evidence**
- `tools/leads.ts`: `fullName`, `city`, `departureCity`, `interestedIn`, `preferredPeriod`, `budgetRange`, `email`, `note`, `adults`, `children` are written with **no length, format or range limits** (`inputSchema` has `minimum: 1` only on adults). The tool's own rule is enforced for `leadId` and `stage` (good), but the content is model/customer controlled.
- `analyseEnquiryAction` passes `context.lead.notes.slice(0, 10)` into the extraction prompt (`copilot-actions.ts:145-149`, `openrouter-provider.ts:57-62`) — the customer-written text is therefore an **indirect prompt-injection channel** into the staff copilot.
- The agent uses a service-role-style client with manual `agency_id` filters (explicit `.eq("agency_id", …)` everywhere) — one missing filter is a cross-tenant write. **Verify** the client type.

**Mitigating (already good)** Stage capped at `QUALIFIED`, value not settable, `leadId` re-derived from the conversation, `intent`/offers recomputed from live data, LLM replies audited against allowed figures (`auditCustomerMessage`).

**Fix**
- Server-side schema around every tool arg (max lengths, `email` format, `adults ≤ 20`), strip control characters and HTML.
- Wrap notes in the prompt as clearly delimited data with an instruction not to follow content inside; keep the existing figure audit; never let model output reach SQL/HTML unencoded (it currently does not).
- Mark agent-authored notes distinctly in the UI (author is already `COPILOT_NAME`) and show them as untrusted text.
- Add a unit test that an `agency_id` mismatch makes every tool refuse.

---

### LD-16 — Raw error strings returned to the client (Medium)

**Evidence** `copilot-actions.ts:107-113` returns `error.message` verbatim except for one regex; `actions.ts:802` returns `error.message` from `lead_sources.upsert`; `LeadPersistenceError` messages embed table, operation and Postgres detail (`leads-repository.ts:38-51`). Thrown errors in `actions.ts` pass through Next's boundary (masked in production, but logged with detail by Sentry — acceptable; the returned strings are not).

**Fix** Map known codes (`23505` duplicate, `23503` FK, `42501` RLS, `PGRST…`) to fixed user messages; log the real error server-side with a correlation id and return only `"Could not save. Reference: <id>"`.

---

### LD-17 — Consent handling gaps (Low)

**Evidence** `updateLeadConsentAction` (`actions.ts:645-697`):
- `consentStatus` and `contactableChannels` are typed, not validated; `source` free text with no length cap.
- The `consent_events` insert failure is swallowed (`:693`) — the lead's consent is changed with **no audit row**; `channel` is always `null` even when channels change.
- DNC can be cleared by any `editLead` user with a single call, no second approval and no reason.
- The manual UI paths (`lead-action-menu-items.tsx:113-119`, `lead-drawer.tsx:390-401`) render `tel:` and `wa.me` links without checking `do_not_contact`. The automated sweep **does** check it (`quiet-lead-sweep.ts` → `decideQuietLeadNudge`).

**Fix** Zod validate; write the lead update and `consent_events` row in one RPC/transaction; require a reason to *clear* DNC and restrict clearing to ADMIN; in the drawer and menu, disable or warn on Call/WhatsApp when `doNotContact` is true and log an override.

---

### LD-18 — Duplicate detection weaknesses (Low)

**Evidence**
- `findDuplicateLeadSummary` (`leads-repository.ts:306`) uses `.ilike("email", escapeLikePattern(email))`. PostgREST treats `*` as a wildcard in `like/ilike`; `escapeLikePattern` escapes `\ % _` but not `*`. An email of `*` matches the first lead, so the gate can be forced to a false positive, and its response leaks that lead's summary.
- `normaliseMobile` (`leads.ts:221-227`) is Sri-Lanka-only; foreign numbers are rejected (`length !== 9`) and the agent hint tells it to hand over to staff. Different countries can share nine trailing digits → false duplicates if relaxed carelessly.
- There is **no** unique constraint on `(agency_id, mobile)`; the gate is a check-then-insert (TOCTOU) and the agent's `maybeSingle()` throws on duplicates, causing yet another duplicate.
- Phone-less leads store `''` as mobile (`20261129090200_…`); a unique index must be partial.

**Fix** Compare with `.eq("email_normalised", lower(email))` (generated column + index) instead of `ilike`; store E.164 (`+94…`) with a `country_code`; add `unique (agency_id, mobile) where mobile <> '' and stage not in ('DUPLICATE','SPAM')`, handling `23505` as "duplicate" in both the action and the agent.

---

### LD-19 — `upsertLeadSourceAction` (Low)

`actions.ts:778-805`: `id` is client-supplied with `onConflict: "code"` (an id/code mismatch updates a different row's id); `code` and `label` have no length cap; the returned error is the raw DB message; the table is independent of `leads.source`'s fixed CHECK, so a new source "works" in the UI but cannot be stored on a lead.

**Fix** Drop `id` from input, validate `code` with `/^[A-Z0-9_]{2,30}$/`, `label ≤ 60`, map errors (LD-16), and decide whether `lead_sources` or the CHECK is authoritative.

---

### LD-20 — `viewAllOwners` is dead (Low / decision)

The capability is `true` for every role that can view the module and is never read (grep). Every marketing user can open every colleague's leads and notes. If per-owner privacy is wanted, implement it in the repository query and RLS; if not, delete the capability so the access file stops promising it.

---

### LD-21 — No rate limits or size caps (Low)

No throttling on `importLeadsAction`, `checkLeadDuplicateAction` (an enumeration oracle for any `createLead` user: any mobile/email → name, mobile, email, owner, stage), `analyseEnquiryAction` (12 000 chars → paid LLM call), `askManasikAction`, `draftCustomerReplyAction`. Next's default Server Action body limit (1 MB) is the only cap — `next.config.ts` sets no `serverActions` options.

**Fix** Per-user sliding-window limiter (the project already has `lib/inbox/rate-limit/limiter.ts`) on the LLM actions, the duplicate check and import; daily LLM budget per agency; set `experimental.serverActions.bodySizeLimit` explicitly; set `allowedOrigins`.

---

### LD-22 — CSP `'unsafe-inline'` scripts (Low, known)

`next.config.ts` allows `'unsafe-inline'` for `script-src` (already tracked as P0-7). No `dangerouslySetInnerHTML`/`innerHTML` was found under `app/(main)/leads`, and React escapes all lead text, so there is no reachable XSS today; the CSP is the safety net if one is introduced. Implement the per-request nonce as planned. Other headers (nosniff, HSTS, frame-ancestors none, referrer policy, permissions policy) are present.

---

### LD-23 — PII to a third-party LLM (Info)

Pasted enquiries, lead notes (first 10), and a scoped lead context (name, intent, quotes) are sent to OpenRouter (`openrouter-provider.ts`). Confirm a DPA with the provider, add a data-processing disclosure in the privacy notice, redact mobile/email/passport patterns before sending, and record `intent_source: LLM` (already stored) as the evidence trail. Do not log prompts.

---

## 4. What is already done well (keep, and copy)

| Control | Where |
|---|---|
| `requireUser()` + role capability on **every** Server Action | `actions.ts`, `copilot-actions.ts` |
| Zod validation, strict bounds, live price re-read, discount cap, seat check, inclusion allow-list | `copilot-actions.ts` `saveQuoteDraftAction`, `lib/copilot/sales/schemas.ts` |
| LLM may only rephrase; any new figure discards the output | `draftCustomerReplyAction` + `auditCustomerMessage` |
| LLM never creates bookings, holds seats, or moves stage | `copilot-actions.ts` header |
| Booking price re-validated against the published tier unless admin override | `departure-groups-booking-terms.ts` |
| Constant-time cron secret compare, counts-only response, per-agency isolation | `app/api/cron/lead-followups/route.ts`, `lib/security/secure-compare.ts` |
| Nudge sweep: consent/DNC, working hours, claim-before-send ledger, re-check at send time, dry-run first | `lib/followups/quiet-lead-sweep.ts` |
| Agent cannot touch another lead; stage capped; no value writes | `lib/agent/whatsapp/tools/leads.ts` |
| CSV formula-injection prefixing; 2 MB file cap | `lib/csv.ts`, `import-leads-dialog.tsx` |
| Tenant column + `agency_id = current_agency_id()` on every policy; child tables joined to parent tenant | tenancy + `fix_child_table_tenant_isolation` migrations |
| Optimistic-concurrency mutator exists and is tested | `persistSingleLeadChange` / `changeOneLead` |
| Security headers present | `next.config.ts` |

---

## 5. Remediation plan

Ordered by risk reduction per unit of effort. Each phase ends with a release gate.

### Phase 0 — Stop the bleeding (≈ 1–2 days, no schema change)

| Task | Finding | Notes |
|---|---|---|
| Add runtime `z.enum` for `status` and block `PENDING_APPROVAL → *` in `updateQuoteStatusInStore` | LD-01 | Smallest possible fix; ship first |
| Remove `{ ...store, leads }` leakage: project store by role in `page.tsx` | LD-03 | Pure function + unit test |
| `exportLeads` capability + hide export for Ops/Visa/Finance | LD-12 | UI + guard |
| Validate `importLeadsAction` (schema, ≤ 500 rows, server-side owner lookup, force `NEW_LEAD`) | LD-04 | Mirror `createLeadSchema` |
| Make `sendQuoteAction` reuse the server-priced draft pipeline | LD-05 | Delete the duplicate path |
| Fix import dialog copy | LD-13 | Trivial |

### Phase 1 — Database enforcement (≈ 3–5 days, one migration + tests)

| Task | Finding |
|---|---|
| Per-command RLS policies; DELETE ADMIN-only; INSERT-only audit tables | LD-02 |
| Immutability triggers on `lead_activity`, `lead_notes` | LD-02, LD-11 |
| Guard trigger on `lead_quotes` money/approval/status | LD-01, LD-02 |
| Role-aware read policy for converted-only roles | LD-03 |
| Role check on Sales-Intelligence tables | LD-02 |
| `actor_id` columns + backfill | LD-11 |
| Partial unique indexes (`lead_id` on bookings; `(agency_id, mobile)` on leads) | LD-09, LD-18 |
| pgTAP/SQL tests under a MARKETING/OPERATIONS JWT | all |

### Phase 2 — Correctness and integrity (≈ 1 week)

| Task | Finding |
|---|---|
| Move all single-lead actions to `changeOneLead()` with CAS | LD-06 |
| Stage transition table; BOOKED only via conversion | LD-07 |
| Zod on every remaining action input; derive labels/owners server-side | LD-08, LD-19 |
| `convert_lead_to_booking` RPC (atomic, idempotent, guarded) | LD-09 |
| Reference allocation via counter table/RPC; remove three `max+1` copies | LD-10 |
| Consent: transactional write + audit, restrict DNC clearing, warn in UI | LD-17 |
| Error mapping + correlation id | LD-16 |
| Dynamic (custom-role) capabilities in Leads | LD-14 |

### Phase 3 — Hardening and operations (≈ 1 week, parallelisable)

| Task | Finding |
|---|---|
| Rate limits + LLM budget; `serverActions` config | LD-21 |
| Agent tool schemas + prompt-delimiting of notes; agency-filter tests | LD-15 |
| E.164 mobile, normalised email column | LD-18 |
| LLM redaction + DPA + privacy notice | LD-23 |
| CSP nonce | LD-22 |
| Decide `viewAllOwners` | LD-20 |
| Server-side audited export | LD-12 |

### Definition of done

- [ ] No finding of severity High open.
- [ ] A role-by-role test matrix (ADMIN, CEO, MARKETING, FINANCE, OPERATIONS, VISA, GUIDE) passes for: read, create, edit, delete, quote status, export — **at the database** and **at the Server Action**.
- [ ] Serialised page props for OPERATIONS/VISA contain no `estimated_value_lkr`, quote, note or non-converted lead.
- [ ] `lead_activity` cannot be updated or deleted by any authenticated role.
- [ ] `npm audit` (or the repo's lockfile-native audit) shows no reachable critical/high.
- [ ] Import of a 500-row file completes in one round-trip with correct duplicate/owner handling.

---

## 6. Test plan

| Layer | Cases |
|---|---|
| **Unit (pure)** | Quote transition table; stage transition table; `projectStoreForRole` per role; import schema accept/reject (overlong, `adults=1e9`, bad enums, spoofed owner); `normaliseMobile` + E.164; `escape`/email-compare |
| **Server Action** | Each action × each role (allowed / denied); malformed payloads (wrong types, arrays too long, unknown ids, other-agency ids); concurrent `changeStage` + `logContact` → no lost update; double `convertLeadToBooking` → one booking; unauthenticated call → redirect/deny |
| **Database (SQL/pgTAP)** | RLS matrix above; triggers fire; cross-agency id returns zero rows; `lead_activity` immutability; unique indexes |
| **Cron** | Missing/invalid bearer → 401; no secret configured → 500; DNC/OPT_OUT lead never nudged; dry-run sends nothing |
| **Agent** | Tool called with another conversation's `leadId` → refused; 10 000-char note → rejected; `stage: "BOOKED"` → schema reject |
| **E2E (Playwright)** | OPERATIONS login: no money/notes in DOM or RSC payload; MARKETING cannot release a discounted quote; export blocked for Ops |
| **Static** | `rg "select\(\"\*\"\)"` allow-list for leads tables; lint rule: no Server Action without a schema parse |

---

## 7. Open questions for the owner

1. Is every-marketer-sees-every-lead intentional (LD-20)? If not, we need owner-scoped RLS.
2. Should MARKETING be able to **delete** leads at all, or is soft-delete (`archived_at`) preferred?
3. Who approves discounts — only ADMIN, or a configurable approver role?
4. Are foreign (non-Sri-Lankan) customers in scope? That changes LD-18 materially.
5. Which Supabase project is production? Phase 1 needs a `pg_policies` / grants dump from it to confirm nothing diverges from the migrations.

---

## 8. Appendix — files reviewed

`app/(main)/leads/{actions.ts, copilot-actions.ts, csv.ts, page.tsx, new/page.tsx, leads-store.tsx, utils.ts}` ·
`app/(main)/leads/components/{import-leads-dialog, send-quote-sheet, lead-drawer, leads-list}.tsx`, `leads-table/lead-action-menu-items.tsx` ·
`lib/access/leads-access.ts` · `lib/data/{leads.ts, leads-repository.ts, leads-copilot.ts, lead-duplicate-gate.ts, departure-groups.ts (createGroupBooking), departure-groups-booking-terms.ts}` ·
`lib/validations/leads.ts`, `lib/copilot/sales/{schemas.ts, llm/openrouter-provider.ts}` · `lib/csv.ts`, `lib/security/secure-compare.ts` ·
`lib/agent/whatsapp/{lead-capture.ts, tools/leads.ts}` · `lib/followups/quiet-lead-sweep.ts`, `app/api/cron/lead-followups/route.ts` ·
`supabase/migrations/{20260812100000_create_leads, 20260822090000_rls_hardening, 20260824090000_tenancy, 20260930090000_leads_sales_intelligence, 20261012090000_consent_and_contactability, 20261231090000_fix_child_table_tenant_isolation}.sql` ·
`next.config.ts`, `proxy.ts`, `lib/dal.ts`.

---

## 9. Implementation status

| Phase | State | Where |
|---|---|---|
| **0** — stop the bleeding | Implemented; unit tests pass. LD-04 (import) was completed in Phase 2. Export became an audited, limited server step in Phase 3. | `lib/data/quote-transitions.ts`, `lib/data/leads-projection.ts`, `app/(main)/leads/actions.ts` |
| **1** — database enforcement | Written, **not yet run against a database**. | `20270125090000_leads_rls_least_privilege.sql`, `leads_rls_least_privilege.test.sql` |
| **2** — correctness and integrity | Written; unit tests pass; migration and pgTAP **not yet run against a database**. | `20270201090000_leads_integrity.sql`, `leads_integrity.test.sql`, `app/(main)/leads/actions.ts` |
| **3** — abuse limits and hardening | Implemented; unit tests pass; migration and pgTAP **not yet run against a database**. Five items deferred (below). | `20270208090000_leads_abuse_limits_and_export_audit.sql`, `leads_abuse_limits.test.sql`, `lead-rate-limits.ts`, `lead-input.ts`, `redact.ts` |

### Phase 2 — what changed

| Finding | Change |
|---|---|
| LD-06 | `persistLeadStore` inserts new leads and **patches** existing ones (changed columns only) under an `updated_at` version check, so every caller — including copilot and the quotes page — fails with a conflict instead of overwriting a colleague. Single-lead actions use `changeOneLead` (retry, scoped read). |
| LD-07 | `lead-stage-transitions.ts`: Booked only via conversion; Deposit Pending needs an accepted quote. Applied inside `changeLeadStageInStore`. |
| LD-08 / LD-19 | Every action parses its input with a Zod schema (`lib/validations/leads.ts`); owners, group labels and actor names are looked up server-side, never accepted. |
| LD-09 | Conversion claims the lead (`converting_at` CAS), reuses a booking already made from the lead, links under a version check, and reports a failed link as a failure. Guards: not Lost/Spam/Duplicate, not do-not-contact (admin may proceed). |
| LD-10 | `allocate_references()` counter; the three `max + 1` copies replaced (lead create, import, quote, WhatsApp agent). |
| LD-14 | `getLeadActor()` merges custom-role overrides; new `clearDoNotContact` capability (ADMIN). |
| LD-16 | `describeLeadFailure()`: fixed sentences for known codes, a logged reference for the rest. |
| LD-17 | `set_lead_consent()`: change + audit + timeline in one transaction, actor from the session; only ADMIN lifts do-not-contact. |

### Behaviour changes worth a product decision

1. **Deposit Pending now needs an accepted quote.** One constant to relax (`lead-stage-transitions.ts`).
2. **Booked cannot be set by moving the stage.** Only conversion does it.
3. **A do-not-contact lead cannot be converted** by a non-admin.
4. **Import:** at most 500 rows; owner must be an active sales owner; stage beyond Qualified resets to New Lead; duplicate mobiles are checked on the server.
5. `upsertLeadSourceAction` now conflicts on `(agency_id, code)`. The old `onConflict: "code"` named a constraint the tenancy migration had dropped.

### Phase 0 — what changed

| Finding | Change |
|---|---|
| LD-01 | `quote-transitions.ts`: an explicit status table. `PENDING_APPROVAL` leaves for `DRAFT`/`SENT` only with an approver's `approval`, which is recorded on the quote (`discount_approved_by/at`). Enforced in `updateQuoteStatusInStore`, so both the Leads action and the quote-detail action are covered; the database trigger (Phase 1) enforces it for everything else. |
| LD-03 | `projectLeadStoreForRole` runs on the server in `page.tsx`: converted-only roles receive only converted leads **and only those leads' notes, activity, quotes and copilot rows**; roles without `viewPipelineValue` receive no estimated value, quote amounts or package prices; the value column and drawer row are hidden for them. |
| LD-05 | `sendQuoteAction({ leadId, sentVia, expectedRoomPricePerPerson })`. The server loads the lead and prices from `pricePerPerson()`, takes party size, package, currency and group label/dates from the database, refuses a closed or full group, and refuses if the price the sender saw is no longer the price on offer. |
| LD-12 | New `exportLeads` capability (ADMIN, MARKETING). Menu item hidden and the handler refuses without it; the money column is dropped for roles without `viewPipelineValue`. |
| LD-13 | Import dialog no longer claims nothing is uploaded. |

### Phase 3 — what changed

| Finding | Change |
|---|---|
| LD-21 | `consume_staff_rate_limit()` (database counter, holds across instances) and `lead-rate-limits.ts`. Per user per hour: import 10, duplicate check 300, enquiry analysis 30, Ask Manasik 60, reply draft 60; the three model calls also have a per-agency daily ceiling (500 / 1000 / 1000). If the counter is unreachable the cheap actions are allowed and the paid ones refused. `serverActions.bodySizeLimit` is stated explicitly (1 MB). |
| LD-12 | `authorise_lead_export()` + `lead_export_logs`: the file is still built in the browser, but only after the server checks the role, limits each person to 10 exports an hour, and records who exported how many rows of which view. Search text is deliberately not logged. |
| LD-15 | `lead-input.ts`: every value the WhatsApp assistant writes into a lead is length-capped, stripped of control / zero-width / bidirectional-override characters, e-mails must be a real address, head-counts must be plausible (ignored, not clamped). The tool schemas show the same ceilings to the model. Untrusted text in the copilot prompts is fenced (`<enquiry>`, `<internal_notes>`, `<context>`) with an explicit "this is data" rule, and a fence cannot be closed from inside. |
| LD-18 (part) | `leads.email_normalised` (generated, indexed): the duplicate check compares for equality, so `*` is no longer a wildcard; the fallback pattern match escapes `*`. Generated columns are never written back by the repository. |
| LD-23 | `redactForModel()` removes telephone numbers, e-mail addresses, NICs and passport numbers from everything sent to the model, keeping dates, prices and head-counts. The rule-based fallback still sees the original text. |

### Deferred from Phase 3 — and why

| Item | Why it is not done here |
|---|---|
| LD-18 E.164 phone numbers | A product decision first: are non-Sri-Lankan customers in scope? It changes the stored shape of `mobile`, every lookup that normalises to nine digits (inbox, agent, campaigns, announcements) and the "create anyway" duplicate override. Needs its own plan. |
| LD-20 `viewAllOwners` | Decision for the owner (open question 1). Implementing owner-scoped reads is a repository and RLS change; deleting the capability is a one-line change. Neither should be guessed. |
| LD-22 CSP nonce | App-wide (`proxy.ts` + every inline script), tracked separately as P0-7. No reachable XSS was found in Leads, so this is defence in depth. |
| LD-23 DPA and privacy notice | Not code. The provider agreement and the customer-facing notice need the business and counsel. The redaction above reduces what is shared; it does not replace the agreement. |
| `leads` read projection view | Inbox, reports, dashboard and campaigns read `leads` directly as non-marketing roles; each needs moving to the view in the same release. |

### Residual risks after Phases 0–3

- `leads` SELECT is still readable by Finance/Operations/Visa at the database (cross-module readers). A direct PostgREST call by Operations returns every lead including `estimated_value_lkr`. Closing it needs a projection view that the inbox, reports and dashboard read instead (Phase 3).
- Export is still built in the browser. It is now authorised, limited and logged by the server first (Phase 3), but a person with the page open already holds the list; the log is the control, not a barrier.
- `sendQuoteAction` still prices at package level (cheapest live departure), as the sheet always did; a lead with a selected group is checked for sale and seats but is not priced from that group's own tier.
