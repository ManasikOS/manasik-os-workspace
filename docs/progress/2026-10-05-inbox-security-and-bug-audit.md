# Inbox security and bug audit — 5 October 2026

A point-in-time record. It lists security weaknesses and functional bugs found by reading the Inbox
code, its Server Actions, its database policies and its webhook/cron/OAuth routes. **Nothing was fixed
here**; each finding needs an owner's decision. It complements
[`2026-10-05-inbox-usage-review.md`](2026-10-05-inbox-usage-review.md), which covers screen-versus-guide
mismatches and small UI defects (its B2–B10 are not repeated below).

## How this was checked, and what was not

**Read in full:** `app/inbox/actions.ts`, `dialog-actions.ts`, `conversion-actions.ts`, `vault-actions.ts`,
`outcome-actions.ts`, `page.tsx`, `layout.tsx`, `lib/access/inbox-access.ts`,
`lib/validations/inbox.ts`, `lib/inbox/start-conversation-guard.ts`, `assignment.ts`, `bulk-actions.ts`,
`attachments/staged-file.ts`, `attachments/staff-attachment.ts`, `outbound/authorize-provider-send.ts`,
`search-query.ts`, the five `app/api/cron/inbox-*` routes, both `app/api/oauth/whatsapp/*` routes, the
WhatsApp webhook entry and the top of its shared handler, `lib/channels/attachment-download.ts`.
**Read in part:** `lib/data/inbox-repository.ts` (list, search, attachment signing), `leads-repository.ts`
(store load/persist), and the RLS/RPC SQL in `20260825090000_whatsapp_channel.sql`,
`20260916073247_unified_inbox_core.sql` and `20261214090000_em3_email_subject_cc_bcc.sql`.
**Searched, not read line by line:** the ~75 components in `app/inbox/components/` (grep for
`dangerouslySetInnerHTML`, `innerHTML`, `localStorage`, raw `href`/`target`).

**Not done:** the app was not run; no test suite was run; no live database was queried (policies were
read from migration files, so a later manual change in Supabase would not show); the Messenger and
Instagram webhook routes, the IMAP poller, the AI surfaces under `lib/ai/surfaces/inbox/`, and the
settings forms under `app/(main)/management/` were not reviewed. Absence of a finding in those areas is
**not** a clean bill of health.

## Summary

No finding lets an **unauthenticated** caller read or change data: webhooks verify a signature, cron
routes verify a timing-safe bearer secret, and every Server Action starts with `requireUser()`. The
weaknesses are all **authenticated-insider** or **robustness** problems. The most important one is that
the database rules are looser than the application rules, so the application rules can be sidestepped.

| ID | Severity | Area | One-line finding |
|---|---|---|---|
| SEC-1 | **High** | RLS | `conversations` write policy is `FOR ALL` with no column limits: Marketing/Operations can bypass admin-only delete, the 24h window and the ownership send-gate |
| SEC-2 | **Medium** | RLS | Staff can insert any `conversation_messages` row, including forged customer or colleague messages |
| SEC-3 | **Medium** | Privacy | Passport image links and AI-read passport numbers are returned to Marketing and Finance |
| SEC-4 | **Medium** | Authorisation | `selectPassportMediaTravellerAction` needs only "can view Inbox" and writes with the service key |
| SEC-5 | **Medium** | Authorisation | `updateInterventionAction` ignores Inbox capabilities; Finance can close complaints and medical-urgency reviews |
| SEC-6 | **Medium** | Abuse / cost | No rate limit or per-user cap on billable WhatsApp sends or AI calls; start-chat has no consent check |
| SEC-7 | Low | Availability | Unsigned webhook requests each write a database row |
| SEC-8 | Low | Files | Outbound-file safety check is a byte search that is easy to evade; upload size cap unverified |
| SEC-9 | Low | Defence in depth | Several actions read or write by id without `agency_id`, against `AGENTS.md` |
| SEC-10 | Low | Injection | OAuth callback shows attacker-supplied `error_description` text on the Integrations page |
| SEC-11 | Low | Authorisation | Note mentions accept any active staff member, including roles with no Inbox access |
| BUG-1 | **Medium** | Ownership | Take control / template send / close / release still override a colleague's chat silently (the earlier fix covered only "start chat") |
| BUG-2 | **Medium** | Protection gate | Review gate checks only the message body, not email subject, cc/bcc or file name |
| BUG-3 | **Medium** | Billing / duplicates | Paid template sends have no idempotency key and call Meta before any database write |
| BUG-4 | **Medium** | Data loss | Saving a passport to Documents can delete its own file when clicked twice |
| BUG-5 | Medium | Performance + lost updates | Booking, group-select and follow-up load and rewrite the whole leads store |
| BUG-6 | Low | Partial failure | Create-booking can leave a booking that the lead does not know about |
| BUG-7 | Low | Partial failure | "Create separate lead" rejects matches permanently before it knows the lead can be created |
| BUG-8 | Low | Race | Start-chat guard checks then upserts non-atomically, and a closed chat of another owner is still reassigned |
| BUG-9 | Low | Audit | Close (single and bulk) writes no history row and skips the open-review check that spam has |
| BUG-10 | Low | Correctness | Visa-officer picker truncates to 100 staff **before** filtering to officers |
| BUG-11 | Low | Scalability | SLA and retention crons loop every agency with no time budget |

Severity is a judgement for a travel agency handling passports and customer money; "High" means it
defeats a control the architecture documents promise.

---

## Security findings

### SEC-1 — High — The database lets Marketing/Operations rewrite any conversation column

**Where:** `supabase/migrations/20260825090000_whatsapp_channel.sql:278-282`

```sql
create policy "staff write conversations" on public.conversations
  for all to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN','MARKETING','OPERATIONS'))
  with check (… same …);
```

No later migration revokes or narrows this (searched for `grant`/`revoke` on `conversations`; only
triggers were added). The Server Actions are described as the guard (`inbox-access.ts`), but the table
accepts a direct PostgREST `PATCH`/`DELETE` from any browser holding the user's session token and the
public anon key. Several controls are keyed on columns a staff member can therefore rewrite:

- **Admin-only delete is bypassable.** `deleteConversation` is `false` for Marketing/Operations
  (`inbox-access.ts:76,91`), but `FOR ALL` includes `DELETE`. They can delete a conversation row
  directly. The delete helper's cleanup of stored files and send-queue rows
  (`delete-conversation.ts`) is skipped; what happens to dependent rows then depends on the foreign keys (not checked).
- **The Meta 24-hour window can be extended.** The send gate reads `service_window_expires_at` and
  `human_agent_window_expires_at` from the same row (`actions.ts:2163,2196-2199`,
  `authorize-provider-send.ts`). A staff member can set both into the future and send outside the
  window, which risks the agency's WhatsApp quality rating.
- **The ownership send-gate is bypassable.** The final check refuses a send when
  `assigned_to_id` is another person (`authorize-provider-send.ts`, "assigned to another staff
  member"). Setting `assigned_to_id` to oneself first removes the refusal, with no `OWNER_CHANGED`
  history row.
- Also writable: `state`, `handling_mode`, `lifecycle_status` (hide a chat in Spam), `lead_id` (link a
  chat to any lead), `unread_count`, `channel`, `external_conversation_id`.

**Scenario:** an Operations user opens DevTools, takes the `sb-…-auth-token` cookie and the anon key, and
issues `PATCH /rest/v1/conversations?id=eq.<id>` with `{"service_window_expires_at":"2099-01-01"}`.

**Fix:** treat the table as server-owned. Either revoke `UPDATE`/`DELETE` from `authenticated` and move
every mutation to `SECURITY DEFINER` RPCs that carry the same checks as the actions, or grant `UPDATE`
on a short column list only (`unread_count`) and split `DELETE` to `ADMIN`. Add a trigger that rejects
changes to the window, owner and lifecycle columns unless `auth.role() = 'service_role'`.
**Verify live first:** `select polname, polcmd, pg_get_expr(polqual, polrelid) from pg_policy where
polrelid = 'public.conversations'::regclass;` and `select grantee, privilege_type from
information_schema.column_privileges where table_name = 'conversations' and grantee = 'authenticated';`

### SEC-2 — Medium — Any Marketing/Operations user can insert a forged message

**Where:** `20260825090000_whatsapp_channel.sql:290-293` — `staff insert conversation_messages` checks
only agency and role. It does not require `actor_id = auth.uid()`, `role = 'staff'`, `direction`, or a
`delivery_status`. The application relies on this open insert: `startWhatsAppChat`
(`actions.ts:1048-1066`) and `sendConversationTemplateAction` (`actions.ts:1206-1224`) insert straight
from the session client.

**Impact:** a message that looks like it came from the customer, or from a named colleague, can be
planted in a thread that is later used as evidence in a dispute or complaint. It also feeds the
Copilot context, the intent reading and the unread counters.

**Fix:** route those two inserts through an RPC (like `enqueue_inbox_text_message`, which already sets
`actor_id = auth.uid()`), then drop the insert policy or add `with check (actor_id = auth.uid() and
actor_kind = 'STAFF' and role = 'staff')`.

### SEC-3 — Medium — Passport images and numbers are shown to roles that may not see traveller documents

**Where:** `lib/data/inbox-repository.ts:276-350` (`loadMessageArtifacts`), rendered by
`app/inbox/components/message-media-reviews.tsx:42-52`.

The read path returns, for every role that can open the Inbox, a five-minute signed URL to each
attachment and the model's `candidate_fields` (passport number, expiry, full name). The write
paths correctly require `viewSensitiveTravellerData` (`inbox-access.ts:104-108`), and
`departure-groups-access.ts:162-169` documents Marketing as "no visa data, no traveller documents".
Finance (`147-157`) has the same denial. Both still receive the passport photo link and the extracted
number in the thread. The model-extracted numbers also sit unencrypted in `message_media_analyses`.

**Fix:** in `loadMessageArtifacts`, when the role lacks `viewSensitiveTravellerData`, blank
`candidate_fields` for `kind = 'PASSPORT'` and withhold the signed URL (show "Passport — restricted").
Decide separately whether the stored candidate fields need a shorter retention than the chat.

### SEC-4 — Medium — Choosing a passport's traveller needs no sensitive-data right

**Where:** `actions.ts:194-264`. The gate is `capabilitiesForInbox(role).viewModule`, which is true for
CEO, Finance and Visa, and the work runs on the **service-role client**. The sibling actions use
`reviewPassportFields` or `saveAttachmentToDocuments`. A Finance user can call this action to choose a
traveller, flip the analysis to `READY`/`REVIEW_REQUIRED` and open a `PASSPORT_EXPIRY` review assigned to
Operations.

**Fix:** require `capabilitiesForInbox(role).reviewPassportFields` (plus `sendMessage`), matching
`applyPassportDetailsAction` (`actions.ts:429`).

### SEC-5 — Medium — Closing a review ignores the Inbox permission system

**Where:** `actions.ts:1865-1888`, `lib/inbox/risk/interventions.ts:143-148`.
`updateInterventionAction` checks only the hard-coded list `INBOX_RESOLVERS = ADMIN, MARKETING,
OPERATIONS, FINANCE`. It never reads `capabilitiesForInbox` or the dynamic role capabilities that
other actions use (`loadDynamicCapabilities`). Consequences: Finance (no `sendMessage`, no `takeControl`)
can resolve or dismiss a complaint, distressed-customer or **medical-urgency** review; a custom role
granted or denied Inbox rights in Roles & Permissions has no effect here. The `acknowledgeIntervention`
result (`:1882`) is also not checked, so a failed write reports success.

**Fix:** call `resolveCapability(role, roleId, "inbox", "sendMessage", …)` first, then apply
`canCloseIntervention`; limit Finance to the money kinds; return the failure when acknowledge fails.

### SEC-6 — Medium — Nothing limits how much money or AI a staff account can spend

A search for rate limiting finds it only in onboarding and model routing. Not limited:
`startWhatsAppChat` (`actions.ts:973`), `sendConversationTemplateAction` (`:1176`),
`startEmailConversation`, `suggestConversationReplyAction` (`:1762`, an LLM call; metering is once per
conversation per month, not per call), `translateInboxTextAction` (`:174`, an LLM call open to every
role with `viewModule`, including CEO, Finance and Visa, with no entitlement or metering check in the
action) and `prepareOfferMessageAction`. The only spend control is the marketing budget check inside
`sendApprovedTemplate`.

`startWhatsAppChat` also accepts **any** 8–15 digit number and sends a template with no consent or
opt-out check, while the Copilot draft path does check consent (`actions.ts:1786-1804`). A stolen staff
session could message arbitrary numbers from the agency's verified WhatsApp number, which risks a Meta
quality downgrade.

**Fix:** a shared per-user, per-agency limiter for these actions (a database counter or Redis, not
in-memory, because the app runs on several instances); a consent/opt-out check in start-chat; and the
same entitlement gate on translate as on draft.

### SEC-7 — Low — Unauthenticated writes on the WhatsApp webhook

**Where:** `lib/whatsapp/webhook-handler.ts` (invalid-signature branch). Each request with a bad
signature inserts a `whatsapp_webhook_events` stub (size only, 30-day purge). The body is capped and
the stub is small, but nothing throttles it, so a flood grows the table and costs one database write per
request.

**Fix:** drop the insert (log and count instead), or cap rows per minute for unsigned traffic.

### SEC-8 — Low — The outbound-file check is easy to evade, and the upload size cap is unconfirmed

**Where:** `lib/inbox/attachments/staff-attachment.ts` (`verifyStagedBytes`). The PDF test searches the
raw bytes for the literal `/JavaScript` and `/Launch`. A PDF that stores its dictionaries in an
object stream, writes `/Java#53cript`, or uses `/JS`, `/OpenAction` or `/EmbeddedFile` passes. The
Office test looks for `vbaProject.bin` only. The file header says it is not a scanner and records
`PENDING`, but nothing in this review shows a later scan that moves it to `CLEAN`.
Separately, `createSignedUploadUrl` does not itself cap the upload and **no `inbox-attachments`
bucket definition with `file_size_limit` was found in the migrations**. If the bucket has no limit, a
large upload is then downloaded whole into server memory by `verifyStagedAttachment`
(`staged-file.ts`, `download` → `arrayBuffer`).

**Fix:** state in the UI/docs that this is a policy filter; add a real scan step before `CLEAN`; set and
test `file_size_limit` on the bucket; check `byteSize` from `storage.objects` metadata before download.

### SEC-9 — Low — Reads and writes by id alone

`AGENTS.md` requires every read and write to be agency-scoped. These rely on RLS only:
`captureConversationLead` (`actions.ts:892-896`, then passes the **admin** client to
`linkConversationToLead`), `sendStaffMessage` (`:2163`), `addInternalNote` (`:1460`, the insert names no
`agency_id`), `saveConversationDraft` (`:1537`), `createBookingFromConversation` (`:1629-1633`),
`selectConversationDepartureGroup` (`:1695`). RLS currently protects each, so this is not exploitable
today; it becomes so if a policy is loosened (see SEC-1).

**Fix:** add `.eq("agency_id", agencyId)` to each.

### SEC-10 — Low — Attacker text shown on the Integrations page

**Where:** `app/api/oauth/whatsapp/callback/route.ts:44`. For `?error=…` the route skips the state check
and redirects with up to 200 characters of `error_description`. A link sent to a signed-in admin can
display "Your account is locked — call +94…" inside the real Settings page.

**Fix:** show a fixed message for the error branch and log the description.

### SEC-11 — Low — Mentions are not limited to people who can open the Inbox

**Where:** `actions.ts:1445-1458`. Mentioned ids need only be `ACTIVE` in the agency. A mention of a
Guide, who has no Inbox access, should be refused. The validated `uniqueMentionedUserIds` is built from
the raw argument instead of `parsedNote.data.mentionedUserIds`. Whether the resulting notification
shows note text was not checked.

---

## Functional and robustness bugs

### BUG-1 — Medium — Several actions still override a colleague's conversation silently

The earlier fix (`1962452`, "stop starting a chat from taking over a colleague's conversation") covers
only the two start-chat actions. The same overwrite remains in:

- `takeControl` (`actions.ts:1260-1277`): sets `HUMAN_ACTIVE` and the caller as owner with no check of
  the current owner, no compare-and-swap and no `OWNER_CHANGED` row. It also works on a **CLOSED** chat,
  reopening it.
- `sendConversationTemplateAction` (`:1227-1231`): after sending, sets `assigned_to_id = sender`
  unconditionally.
- `sendStaffMessage` (`:2231-2234`) calls `takeControl` for any non-`HUMAN_ACTIVE` state, including a
  chat that still has an owner (for example one a colleague released to the assistant: `releaseToAi`
  keeps `assigned_to_id`).
- `releaseToAi` (`:1361-1373`) hands a chat to the assistant even with an open complaint or
  medical-urgency review, and leaves the old `assigned_to_id` in place.
- `closeConversation` (`:1375-1387`): no audit row (assign and spam write one) and no check for an
  open review.

**Fix:** one shared "change ownership" helper that does a compare-and-swap on `state` and
`assigned_to_id`, refuses a different owner unless the caller used the Assign action, writes
`OWNER_CHANGED`, and refuses `releaseToAi`/close while a blocking review is open.

### BUG-2 — Medium — The protection gate does not see the whole message

`sendStaffMessage` passes only `trimmedBody` to `evaluateProtection` (`actions.ts:2182`), and the final
check in `authorize-provider-send.ts` does the same with `input.text`. For email the **subject** is stored
and sent separately (`emailSendFields.subject`), as are cc/bcc, and an attachment has a **file name**.
With a payment-claim review open, a subject of "Payment received — thank you" is delivered. (The usage
review's B6 notes template sends skip the gate too.)

**Fix:** evaluate `subject + "\n" + body + "\n" + caption + filename`, and run the gate in
`sendConversationTemplateAction`/`startWhatsAppChat` on the rendered text.

### BUG-3 — Medium — Billable template sends are not idempotent

`startWhatsAppChat` (`:1000-1008`) and `sendConversationTemplateAction` (`:1196-1203`) call Meta, then
write to the database. The free-text path carries a `clientIdempotencyKey`; these do not. A double click,
a retried network call or a second tab sends the template twice and bills twice. If the database
write fails afterwards the customer was messaged and the CRM has no record (the error text says
"Refresh before retrying", which invites a third send).

**Fix:** generate a key in the dialog, record the intended send in `outbox_messages` first, and send from
the outbox like text; or insert a PENDING message row before calling Meta and update it after.

### BUG-4 — Medium — Double-clicking "Save to Documents" can delete the saved passport

`savePassportToDocumentsAction` (`actions.ts:317-414`) reads the checklist item, uploads with
`upsert: true` to a **deterministic** path (`<documentId>.<ext>`, `promote-passport-plan.ts`), then calls
`submitGroupPilgrimDocument`. Two overlapping calls both pass the early `promoted_document_id` check,
both upload to the same path; the second `submitGroupPilgrimDocument` fails because the item is now
`SUBMITTED`, and the failure branch (`:381-385`) **removes that same path**, deleting the first call's
file. The document row then points at a missing object.

**Fix:** claim the attachment first with a conditional update (as `saveInboxMediaToVaultAction` does), or
on failure remove the object only if this call created it (upload with `upsert: false`).

### BUG-5 — Medium — Whole-store reads and writes for single-lead actions

`createBookingFromConversation` (`:1636`), `selectConversationDepartureGroup` (`:1697`) and
`scheduleConversationFollowUp` (`:2069`) call `loadLeadStore(supabase)`, which selects **all** leads,
activity, notes, quotes, Copilot contexts, drafts, packages and sources for the agency
(`leads-repository.ts:247-278`; the `only` option exists but is not used). The latency grows with the
agency's lead count on every click. `persistLeadStore` then upserts each changed **whole row** from the
stale snapshot (`:376-401`), so if a colleague edits the same lead between read and write, their change
is overwritten.

**Fix:** load only the one lead and its needed collections (`only`, plus a `where id`), and write
with a version/updated-at compare-and-swap.

### BUG-6 — Low — Create-booking can leave an unlinked booking

`createBookingFromConversation` (`:1644-1672`): the booking is created, then the lead is marked booked
and persisted. If `markLeadBookedInStore` or `persistLeadStore` fails, the booking exists but the lead has
no `booking_id`. The next attempt derives the same reference `LD-…`, hits the
`unique (agency_id, booking_reference)` constraint and shows an unhelpful error. There is no
compensation or transaction.

### BUG-7 — Low — "Create separate lead" rejects matches before it can succeed

`keepIdentitySeparateAction` (`:1916-1927`) calls `rejectIdentityLinks` ("never proposed again") and only
then `captureConversationLead`. If capture fails (several leads share the number, role cannot link) the
suggestions are permanently closed and no lead exists.

### BUG-8 — Low — Start-chat race and the closed-chat reassignment

The existing-conversation check (`:995`) and the upsert (`:1013`) are separate calls, so a customer
message creating the conversation in between is overwritten. Also `decideStartOnExistingConversation`
allows a **closed** chat owned by someone else (`start-conversation-guard.ts:25`) and the upsert then
reassigns it to the sender and reopens it, with no history row. The comment in that file says an owned
chat is never taken away; a closed one is, silently.

### BUG-9 — Low — Close has no audit row and fewer safety checks than spam

Bulk Close (`bulk-actions.ts:60-63`) and `closeConversation` skip the open-review and booking checks
that `planSpamChange` makes, and neither records a history event (`actions.ts:699-716` records one for
assign and spam only). Closing a chat with a live complaint leaves the review attached to a closed chat.

### BUG-10 — Low — Visa-officer list is cut before it is filtered

`loadVisaOfficersAction` (`actions.ts:472-484`) orders by name and `.limit(100)` on **all** active staff,
and only then filters to visa roles in JavaScript. In an agency with more than 100 active staff, an
officer whose name sorts late never appears.

**Fix:** filter by role in the query, then limit.

### BUG-11 — Low — Crons loop every agency without a deadline

`inbox-sla/route.ts` and `inbox-retention/route.ts` iterate all agencies sequentially. The email poll has
a 45-second budget; these do not, so growth in agencies will eventually hit the function timeout, fail the
run (they return 500) and starve the later agencies every time (the order is fixed).

**Fix:** a deadline plus a rotating start offset, as the email poll does.

---

## Controls that were checked and held up

- Every Server Action and Route Handler starts with `requireUser()`; inputs go through Zod, mostly
  `.strict()`; ids are UUID-checked before queries.
- Webhook: raw-body signature check, bounded body size, tenant resolved from the phone-number id,
  duplicate-event handling. Cron routes use `timingSafeEqual` on hashed values; `CRON_SECRET` missing → 500.
- Search text is reduced to letters/digits/`+-.@#` before it enters a PostgREST `or` filter
  (`search-query.ts`), so filter injection is closed. The `%` wildcard is stripped too.
- Outbound staged-file path is built from ids and a new UUID, never the file name, and re-validated with a
  GUID check before use in a regex (`isStagedPathFor`).
- Meta attachment downloads are limited to Meta CDN hosts over HTTPS with manual, hop-limited redirects and a
  size cap (`attachment-download.ts`).
- No `dangerouslySetInnerHTML`/`innerHTML` in `app/inbox`; `localStorage` holds only layout preferences;
  external links use `rel="noreferrer"`.
- The final provider-send gate (`authorize-provider-send.ts`) re-runs the protection and channel-policy
  checks at drain time, so a direct call to `enqueue_inbox_text_message` does not skip the review gate
  (but see SEC-1 for the columns that gate reads).
- Database errors are logged and replaced by plain messages in the browser (`inboxFailure`).
- Realtime channels are private and agency-scoped.

## Suggested order of work

1. **SEC-1 and SEC-2** together (one migration): they decide whether the app-level rules mean anything.
   Confirm the live policies with the queries in SEC-1 first.
2. **BUG-1, BUG-3, BUG-4** — they affect customers or money directly and are small, local fixes.
3. **SEC-3, SEC-4, SEC-5** — one afternoon: tighten reads and the two authorisation checks.
4. **SEC-6** — decide the limits and the consent rule with the owner.
5. **BUG-2** — extend the gate input; add a Vitest case per field.
6. The rest as ordinary backlog. Add a Vitest case for each fixed business rule (ownership
   compare-and-swap, double-submit save, gate over subject/filename).

## Open questions for the module owner

- Is Marketing meant to see passport images in the Inbox (SEC-3), given the departure-groups matrix says no?
- Should Finance close non-money reviews (SEC-5)?
- Is `inbox-attachments` created in the dashboard with a size limit? (SEC-8: not found in migrations.)
- Are `CLEAN`/`PENDING` scan results ever updated by a job? (SEC-8)
