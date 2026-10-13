# Task list: Quick Chat popup

Plan: [`tasks/quick-chat-plan.md`](./quick-chat-plan.md) · Spec: `docs/inbox/quick-chat-popup-spec.md`
Sizes: XS 1 file · S 1–2 · M 3–5. One task = one PR unless marked (ops).
Standing verification for code tasks: `npm run lint`, `npm run typecheck`, `npm run test`, plus `npm run build` at checkpoints.

## Phase 0: Decide and record

- [ ] **T0 (XS, ops) Audit approved WhatsApp templates.** List approved templates and note which fit proposal/quote, receipt/invoice, document request.
  - Accept: a table "message type → template id or MISSING" in `docs/progress/2026-10-xx-quick-chat-templates.md` (no secrets).
  - Verify: you review it.
  - Depends: none · Files: docs/progress note
- [x] **T1 (S) Record decisions and add the feature flag.** Add a Quick Chat section to `docs/inbox/architecture.md`; add flag `quick_chat` (same mechanism as other inbox flags, found via `lib/inbox/feature-availability.ts`).
  - Accept: architecture note present; flag defaults off; a unit test proves off means the provider renders nothing.
  - Verify: test, lint, typecheck.
  - Depends: none · Files: architecture.md, feature-availability.ts (+test)
  - Status 2026-10-12: done, with one change: the flag is the env var `QUICK_CHAT_ENABLED` (`lib/inbox/quick-chat/flag.ts`, same style as `INBOX_WORKER_ACTIVE`), not a plan entitlement, because human messaging is deliberately never a billable switch. Global, not per agency. Recorded as R10 in `docs/inbox/architecture.md`.

### Checkpoint 0
- [ ] T0 answered · you approve starting code

## Phase 1: Walking skeleton

- [x] **T2 (M) Event bus, provider, launcher.** `open-quick-chat-event.ts`, `quick-chat-provider.tsx` mounted in `app/(main)/layout.tsx`, a bottom-left launcher with minimise/close and "Open in Inbox". No sending yet.
  - Accept: `openQuickChat()` from the console opens an empty panel with recipient name; hidden when flag off, when role lacks viewModule/sendFromRecord, and on `/inbox`; does not cover the sidebar footer at 1280 and 1024 px; Esc closes and returns focus.
  - Verify: event contract unit test; browser check (golden, denied, narrow); lint/typecheck.
  - Depends: T1 · Files: lib/inbox/quick-chat/open-quick-chat-event.ts(+test), components/quick-chat/quick-chat-provider.tsx, quick-chat-panel.tsx, app/(main)/layout.tsx
- [~] **T3 (M) Resolve target and send text (Leads quote only).** Pure `resolve-target` + `quick-chat-state` with tests; `quick-chat-actions.ts` (resolve, trimmed thread); composer sends via `sendStaffMessage` with idempotency key; Leads `send-quote-sheet` uses `openQuickChat` with `onSent` marking the quote sent.
  - Accept: existing-conversation-in-window sends and appears in `/inbox`; failed send leaves quote unmarked; double click sends once.
  - Verify: unit tests for every branch of the two pure modules; action test for agency scoping; manual send on staging number.
  - Depends: T2 · Files: lib/inbox/quick-chat/resolve-target.ts, quick-chat-state.ts (+tests), app/inbox/quick-chat-actions.ts (+test), components/quick-chat/quick-chat-composer.tsx, leads/components/send-quote-sheet.tsx
  - Status 2026-10-12: code and tests done (5,413 tests pass, tsc clean, 0 lint errors); **not yet exercised in a browser or with a real WhatsApp send**. Notes: (a) T2 shipped as provider + panel (no separate launcher; the popup appears when a page opens it), (b) the composer lives in `quick-chat-panel.tsx`, (c) `quick-chat-state.ts` was not needed yet and is folded into `resolve-target.ts`, (d) Leads needed two small additions to keep "sent" honest: `deferSend` on `sendQuoteAction` (quote stored as DRAFT, no sent entry, no stage move) and `markQuoteSentAction` (idempotent), (e) a number with no open window currently shows an explanation, not a template picker (T6), and leaves the quote as a DRAFT.

### Checkpoint A
- [ ] Real message delivered from the popup and visible in Inbox · build green · you review

## Phase 2: Complete the WhatsApp experience (T4, T5, T6 can run in parallel)

- [~] **T4 (S) Access: `sendFromRecord` for FINANCE and VISA.** Add capability in `lib/access/inbox-access.ts`; the popup path checks `sendMessage || sendFromRecord`; server action honours it only when the caller identifies the quick-chat path.
  - Accept: FINANCE/VISA can send via popup, still cannot see `/inbox` send controls; CEO/GUIDE cannot send; tests per role.
  - Verify: access matrix test (style of existing inbox-access tests); action protection test.
  - Depends: T3 · **Needs your sign-off before merge** · Files: inbox-access.ts (+test), quick-chat-actions.ts, sendStaffMessage guard
  - Status 2026-10-12: **BLOCKED on a decision; no code changed.** Investigation shows the plan's "no migration" assumption does not hold for this task. Sending is gated in the database, not only in the app: `enqueue_inbox_text_message` and `enqueue_inbox_media_message` raise "not permitted" unless `staff_role_in('ADMIN','MARKETING','OPERATIONS')` (latest definitions: `20261214090000_em3_email_subject_cc_bcc.sql`); the `conversations` insert/update policies in `20270111090000_inbox_conversation_write_hardening.sql` are limited to the same three roles; and `takeControl` needs `capabilitiesForInbox(role).takeControl`. A client-side flag cannot bypass this and must not be attempted. Enabling FINANCE/VISA therefore needs a migration, which is an "Ask first" item in the spec. Options are recorded in the conversation of 2026-10-12.
  - Decision 2026-10-12: **dedicated record-send RPC** (not widening the Inbox gates). Built, **migration written and NOT applied**: `supabase/migrations/20270215090000_quick_chat_record_send.sql` adds `enqueue_record_text_message` (FINANCE/VISA only; WhatsApp text only; open reply window only; never closed or colleague-owned; takes ownership like the Inbox's take-control and logs OWNER_CHANGED; idempotent). App side: `sendQuickChatRecordMessageAction` (role check, ownership/window pre-check, payment-protection gate, then the RPC), `quickChatSendMode()` (INBOX/RECORD/none) replaces `canUseQuickChat` in the layout and actions, popup sends through the record action for RECORD roles, no mark-read and no template step for them. Tests: 23 action tests, 7 migration-contract tests, 7 access tests. **Before the popup works for Finance/Visa: review and apply the migration** (dry-run in a rolled-back transaction first, as with T3a/T3 of the scheduling work). **Also: `lib/ops/gate/schema-baseline.test.ts` fails until the schema fingerprint is regenerated** (`bash scripts/local/write-schema-fingerprint.sh` against a local database built from the migrations; needs a local DB, not available in this session), as was done in `3667f466` for the Leads migrations. Until applied, their send fails with "The message could not be sent" and nothing is sent. Not done (follow-up T4b): templates for Finance/Visa (a new number or a closed window), which needs the same narrow treatment for `startWhatsAppChat`/`sendConversationTemplateAction`; they are told to ask Operations.
- [~] **T5 (M) Live thread and unread badge.** Subscribe to the open conversation topic and a count-only signal; render delivery ticks; badge on launcher; clears on view (`markConversationRead`).
  - Accept: inbound reply shows without reload; ticks update; hidden tab reconciles once on show; unmount removes channels.
  - Verify: reuse merge/single-flight unit tests; manual with a second device.
  - Depends: T3 · Files: components/quick-chat/use-quick-chat-thread.ts, thread view, launcher
  - Status 2026-10-12: code and tests done (not browser-tested, no live second-device check). `use-quick-chat-live.ts` subscribes to the open conversation's private topic only; events go through `shouldRefreshThread` (contract-parsed, unknown payload = one catch-up, never trusted); reads are single-flight; a hidden tab reads once on show; unmount removes the channel. A customer reply while waiting on a template re-resolves the screen automatically, so "Check again" is now only a fallback. Unread: customer messages that arrive while minimised show as "N new messages" in words; expanding marks the conversation read in the Inbox (`markConversationRead`). Deviation: no agency-wide list topic, because the popup watches one chat; a launcher badge for chats not currently open is not built (the Inbox's own badge covers them).
- [~] **T6 (M) Window closed, templates, consent, ownership.** Template step reusing `InboxConversationTemplatePicker` and charge label; new-number start via `startWhatsAppChat`; plain-language states for opted-out, owned-by-colleague, closed, no template, rate-limited.
  - Accept: each spec criterion 3 and 5 state has its own message and no send occurs; a template send opens the conversation.
  - Verify: state-machine unit tests; staging send of one template.
  - Depends: T3, T0 · Files: quick-chat-state.ts, template step component
  - Status 2026-10-12: code and tests done (not browser-tested, no real template sent). Template step (`quick-chat-template-step.tsx`) reuses `startWhatsAppChat` for new/closed chats and `sendConversationTemplateAction` for a closed window; templates and charges come from `loadQuickChatTemplatesAction`. After a template goes out the popup says free text opens only when the customer replies, keeps the draft, and offers "Check again" (live arrival is T5). `onSent` fires only for free text, so a quote stays DRAFT until its message really goes. Blocked states (opted out, owned by colleague, unreadable) show the server's own sentence. Not done: pre-filling template values from the page (needs T0 template list), a rate-limit-specific message (the action's own error is shown).

### Checkpoint B
- [ ] Window/new-number/opted-out/owned states verified · you review

## Phase 3: Breadth

- [~] **T7 (M) One PDF attachment.** Attach/preview a generated PDF via `prepareStaffAttachmentUpload` and `StagedAttachmentRef`; call sites pass a PDF source.
  - Accept: PDF delivered with caption; size/type refusals shown; no attachment on template sends unless supported.
  - Verify: unit tests for refusal copy; staging send.
  - Depends: T3 · Files: composer-attachment usage, open event detail (`attachment`)
  - Status 2026-10-12: code and tests done (not browser-tested, no real PDF sent). Pages pass `attachment: { file: Blob, filename }` to `openQuickChat` (the page builds the PDF, e.g. `buildInvoicePdf`). Once the chat is READY the popup uploads it through the Inbox's own `prepareStaffAttachmentUpload` (server-issued path, bytes judged at send time) and sends it with `sendStaffMessage` as the caption-plus-file message; the text is an optional caption. The send button stays disabled while the file uploads or after it failed, so a file is never left out silently; the person can retry or remove it. The file is never staged or sent twice across a re-check. Files are not attached to template sends (WhatsApp templates here are text only); the file waits, named in the popup, until free text opens. **Gap (T7b):** Finance and Visa cannot attach: `prepareStaffAttachmentUpload` and `enqueue_inbox_media_message` are Inbox-role-gated, and a media version of the record-send function is needed (a second migration, same narrow rules). Their popup says to remove the file to send the text. Only `application/pdf` is accepted in v1 (the server would allow images and Office files).
- [~] **T8 (M) Migrate call sites.** Finance/invoice (`invoice-preview-dialog`), Documents (`request-documents-sheet`, `documents-list`, `request-rework-dialog`), Pilgrims (`pilgrims-list`, `documents-tab`, `pilgrim-detail`), Visa (`application-sheet`). Keep `wa.me` fallback when flag is off or role cannot send. Split into 2 PRs if over 5 files.
  - Accept: each opens popup with right recipient and draft; record "sent" only on `onSent`; Suppliers/Team/Campaigns untouched.
  - Verify: per-page manual check + e2e in T10.
  - Depends: T4, T6 (T7 for PDFs) · Files: the pages above
  - Status 2026-10-12: **done for the Inbox roles** (ADMIN, MARKETING, OPERATIONS); not browser-tested. One helper, `sendViaWhatsApp` (`lib/inbox/quick-chat/send-via-whatsapp.ts`), hands the person and draft to the popup or, when it is unavailable, opens the same `wa.me` link as before, and says which way it went. Migrated: Finance invoice (`invoice-preview-dialog`: the built PDF is kept and attached; recorded as sent only in `onSent`), Documents (`request-documents-sheet`, `documents-list`, `request-rework-dialog`), Pilgrims (`pilgrims-list`, `pilgrim-detail`, `documents-tab`), Visa (`application-sheet`), plus Leads quote from T3. With the link, "logged/recorded" happens straight away as before; with the popup it happens in `onSent`. Sheets and dialogs close when the popup takes over (`onOpened`), so it is not left under their overlay. Rework: the document is still sent back for rework first; the popup only delivers the message. Suppliers, Team and Campaigns untouched. **Finance and Visa roles keep `wa.me`**: `RECORD_ROLES_USE_POPUP = false` in `access.ts` (one switch to turn on after T4 is applied and T4b/T7b land). Small additions: documents-tab now prefills "Assalamu Alaikum {name}. Please upload your {document}." (it had no text before).
- [ ] **T9 (M) Email.** Subject + body path via `startEmailConversation` / `sendStaffMessage` email fields; hidden unless mailbox ready.
  - Accept: email send and thread work; disabled with explanation when no mailbox.
  - Verify: unit + manual.
  - Depends: T3 · Files: composer email fields, mailbox readiness check

### Checkpoint C
- [ ] No `wa.me` opens for send-capable roles on migrated pages

## Phase 4: Harden and release

- [ ] **T10 (M) E2E, accessibility, docs, soak.** `e2e/quick-chat.spec.ts` (golden, window closed, opted out, absent on `/inbox`, keyboard/Esc/focus, 375 px); update inbox user guide and runbook; enable flag for one agency for a week; then remove dead `wa.me` code for migrated sites.
  - Accept: e2e green; docs updated; soak notes recorded.
  - Verify: `npm run test:e2e`, full standing checks.
  - Depends: T8 (T9 optional) · Files: e2e/quick-chat.spec.ts, docs/inbox/inbox-user-guide.md
