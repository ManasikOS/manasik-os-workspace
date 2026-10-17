# Inbox page analysis and launch-readiness report — 17 October 2026

Branch `UI-update`. Scope: the full-page Inbox at `/inbox` and everything behind it.

## How this was checked

**Done in this pass**
- Read the page, layout, access table, view and queue definitions, the workspace controller, the shortcut registry, the quick-chat actions, the webhook invalid-signature branch, and the inbox CI workflow.
- Read the existing technical documentation and the 5 Oct security and bug audit, then checked each audit finding against current code and git history.
- Ran the Inbox unit tests: `npx vitest run app/inbox lib/inbox lib/access/inbox-access` gave **241 files, 2,864 tests, all passed**.
- Ran the CI lint ratchet over the Inbox paths: **0 errors, 13 warnings**, equal to the ceiling in `.github/workflows/inbox-ci.yml` (`--max-warnings=13`).

**Not done (so these are open, not clean)**
- `npm run typecheck`, `next build`, the Playwright specs (`e2e/inbox-*.spec.ts`) and `npm audit` were not run.
- No live database was queried, so RLS policies and bucket settings are judged from migration files only.
- The app was not opened in a browser, so layout, accessibility and realtime behaviour are judged from code and tests, not seen.
- The ~66 UI components were skimmed, not read line by line.

## 1. What the Inbox page is

A standalone, full-screen workspace (`app/inbox/layout.tsx` removes the CRM header and sidebar) that unifies **WhatsApp, Messenger, Instagram and Email** conversations and ties each to the CRM (lead, booking, departure group, follow-up, finance, documents). The same workspace also powers the header overlay. The page itself adds no data access.

| Layer | Size | Where |
|---|---|---|
| Page, layout, error boundary | 3 files | `app/inbox/` |
| UI components | 66 files, ~11.7k lines | `app/inbox/components/` |
| Server actions | `actions.ts` ~2,650 lines, plus dialog, conversion, outcome, vault, quick-chat | `app/inbox/*.ts` |
| Domain logic | ~177 entries in `lib/inbox/` | pure rules, pipeline, risk, SLA, routing, outbox, retention, worker |
| Cron routes | 5 | `app/api/cron/inbox-{email-poll,health,lanes,retention,sla}` |
| Webhooks | 4 | `app/api/webhooks/{whatsapp,messenger,instagram,meta}` |
| Tests | 252 unit test files, 12 Playwright specs | beside code, `e2e/` |

## 2. Request flow and access

1. `layout.tsx`: requires a session (else `/login`), records session activity, shows the suspended-agency page if the agency is suspended.
2. `page.tsx`: `capabilitiesForInbox(role).viewModule` must be true, else `notFound()`. `force-dynamic`.
3. `?conversation=` must match a UUID and `?view=` must be a known view; anything else is ignored (`lib/inbox/page-request.ts`). Deep links to one chat work from tasks and notifications.
4. `InboxWorkspaceController` loads in independent steps (list, conversation, intelligence, lead context) through scoped server actions, and keeps in sync through realtime invalidation plus delta reads.

**Role matrix (`lib/access/inbox-access.ts`)**

| Role | Opens Inbox | Reply / take control / release / close / assign / convert / saved replies | Delete conversation |
|---|---|---|---|
| ADMIN | yes | yes | **yes** |
| MARKETING | yes | yes | no |
| OPERATIONS | yes | yes | no |
| CEO, FINANCE, VISA | yes, **read-only** | no | no |
| GUIDE | no | no | no |

Extra capabilities (save passport to Documents, open Finance review, assign visa officer, review passport fields, save to vault) are derived from the Documents, Finance, Visa and Vault access tables and need sensitive-data rights.

## 3. Feature inventory

**Conversation list and views.** 23 views, each backed by a SQL-computed queue (`conversation_queue_membership`): all, unassigned, mine, four channels, closed, spam, needs reply, waiting on customer or team, payments, documents, visa, complaints, escalations, nearing deadline, SLA overdue, new enquiries, qualified, ready to book, quote sent. Search, saved views, cursor paging, unread counts, a compact queue bar, and a collapsible layout.

**Thread and composer.** Messages across four channels, media with voice player and transcripts, translation, internal notes with mentions, saved replies and templates, drafts, composer-presence ("someone is writing"), idempotent sends with attachments, reply-window notices and a closing-window draft button, and an email compose dialog with subject, cc and bcc.

**Ownership and workflow.** Take control, release to AI, assign (with availability-based routing), close, delete (admin only), bulk assign, close and spam (max 50, compare-and-swap), and handoff summaries with acknowledgement.

**Customer context rail.** Identity match, confirm, keep separate or unlink; lead capture and completeness; linked records; departure-group status and selection; offer card with match reasons; booking creation; quote creation; follow-up scheduling; passport review, save to Documents and visa-officer assignment; receipt copy to Finance evidence; Document Vault.

**Copilot intelligence.** Triage, travel intent, offer matching, risk detectors, a protection gate that blocks sends while a review is open, next-best-action card, suggested replies, interventions, and an opt-in autonomy ladder for limited automatic replies.

**Operations around the page.** SLA policies and sweeps, retention and deletion sweeps, a health cron with alert runbook, rate limits and spend caps per staff and agency, an always-on worker, and a Quick Chat popup (new, behind a feature flag). Keyboard shortcuts come from one registry and the help overlay lists only wired keys. The dashboard has an inbox queue block and an inbox SLA block.

## 4. Verdict on the 5 Oct audit

All of the audit's 22 findings (SEC-1 to SEC-11, BUG-1 to BUG-11) have been actioned since. Their fix commits are on this branch or its history (for example SEC-1/2 in `20270111090000_inbox_conversation_write_hardening.sql`, SEC-7 as a per-minute cap on unsigned webhook stubs in `lib/whatsapp/webhook-handler.ts`, SEC-10 in `63288aec`). I verified these in code: SEC-1, SEC-2, SEC-7, SEC-8's bucket limit (`inbox-attachments` is created with a 10 MB limit), SEC-10. The rest I matched to commit titles and did not re-read. Treat them as **fixed per history, not independently re-proved here**; the live RLS state still needs the query in the audit's SEC-1 section.

## 5. Strengths

- **Defence in depth.** Every action re-checks role and agency; RLS is the second line; a DB trigger now blocks direct edits to reply-window, channel, agency and lead columns.
- **Deterministic core.** Queues, SLA, ownership, window rules and send gating are plain tested functions; the model only reads.
- **Fail closed.** An unreadable review check or rate-limit counter refuses the send instead of allowing it.
- **Concurrency safety.** Idempotency keys on sends, compare-and-swap on bulk updates, job coalescing.
- **Honest data states.** "No data yet / Not measurable yet" instead of fake zeros.
- **Test depth.** 2,864 passing unit tests in 14 s, plus a CI gate on typecheck, lint ratchet and the full suite on every PR.
- **Documentation and runbooks** are unusually complete (technical doc, user guides, 7 runbooks).

## 6. Findings and risks (ranked)

| # | Severity | Finding | Evidence |
|---|---|---|---|
| 1 | **High, launch gate** | **Browser acceptance has never been demonstrated.** Checklist items for FIN-03, FIN-05, MED-03 and others are open "blocked until a signed-in non-production environment exists". | `docs/inbox/checklist.md` lines 128, 153, 197 |
| 2 | **High, launch gate** | **Live RLS tests not run.** `supabase/tests/database/inbox_voice_transcripts_rls.test.sql` (20 assertions) is written but never executed; voice transcripts are therefore unproven for cross-agency denial. | checklist line 169 |
| 3 | Medium | **Voice transcription provider call is unproven** (model audio support and request shape untested against a real provider). Checkpoint P4a blocks enabling by default. | checklist lines 183, 198 |
| 4 | Medium | **Bulk close has no confirmation and no undo.** A customer message reopens the chat, but a mis-click on up to 50 chats is silent. | tech doc §27 |
| 5 | Medium | **Spam does not stop the WhatsApp assistant** from replying to a later message from a spam-marked chat. | tech doc §27, `spam-state-contract.md` |
| 6 | Medium | **Read-only roles (CEO, FINANCE, VISA) can open every conversation.** Intended ("overview visibility"), but they see all customer messages. Confirm this is a deliberate privacy decision. | `inbox-access.ts` |
| 7 | Medium | **Outcome metrics are partly "not measurable yet"** (first-response time, within-target rate, conversion, draft acceptance). The panel is honest about it, but managers cannot judge Copilot value yet. AI cost excludes image and voice work. | tech doc §27 |
| 8 | Low | **`actions.ts` is a 2,650-line module** mixing ~45 actions. It makes review and merge conflicts harder (TASK-010 decomposition is a known item). | `app/inbox/actions.ts` |
| 9 | Low | **Outbound-file scan is a policy filter, not a scanner.** Files are recorded `PENDING` and the byte search is easy to evade. | audit SEC-8, `staff-attachment.ts` |
| 10 | Low | **Message-level deep links are missing.** Links open the conversation, not the message; Finance cannot jump to a receipt message. | checklist line 154 |
| 11 | Low | **Channel gaps.** Messenger and Instagram cannot be started by the business; Instagram is photos only; WhatsApp video and location are refused; "Departure changes" queues are hidden (no predicate). | tech doc §27 |
| 12 | Low | **"Someone is writing" is advisory**: two people can still send. | tech doc §27 |
| 13 | Low | **Lint ratchet at its ceiling (13 warnings)** — all unused `_`-prefixed parameters. No headroom, but no new debt. | eslint run |
| 14 | Info | **Docs drift.** Many dated plans exist; some are superseded (Inngest, removed). Two new untracked architecture docs are not committed. | `git status` |

No `dangerouslySetInnerHTML`/`innerHTML` use in `app/inbox`, and no stray TODO/FIXME. One `console.log` exists, in the worker's structured JSON logger (intentional).

## 7. Launch-readiness checklist (from the skill)

| Area | Status |
|---|---|
| Unit tests | **Pass** (2,864) |
| Lint | **Pass** (0 errors, ratchet met) |
| Typecheck, build, e2e | **Not run here** |
| Dependency audit | **Not run here** |
| Auth and authorisation | Strong in code; live RLS unproven for voice transcripts |
| Input validation | Zod on actions; URL params whitelisted |
| Rate limiting and spend caps | Present (per staff and per agency) |
| Webhook signature verification | Present; unsigned writes throttled |
| Secrets in code | None seen in the files read; no secret scan run |
| Accessibility | 149 `aria-*` uses, `sr-only` h1, keyboard shortcut registry, a11y and keyboard Playwright specs exist; **not run, no screen-reader pass** |
| Monitoring and health | Health cron, alert runbook, worker health port |
| Rollback | Worker/mode flags and migration rollback notes exist; no single rollback plan for the page itself |
| Feature flag | Quick Chat is flagged; the Inbox itself ships ungated |

## 8. Recommendation

**Conditional go for staff-assisted operation; no-go for enabling voice transcripts and any autonomous replies by default.**

1. Stand up the named non-production environment, then run the 12 Playwright specs and walk the open browser-acceptance items. (Findings 1–3)
2. Run the voice-transcript RLS test on a branch database and one staging provider call. (2, 3)
3. Run `npm run typecheck`, `npm run build` and `npm audit` and attach the results to this report.
4. Add a confirmation (and ideally an undo window) to bulk close. (4)
5. Decide on and document the spam versus assistant behaviour and the read-only-role visibility. (5, 6)
6. Rollout: keep the assistant autonomy ladder off, enable per agency, watch error rate, p95 latency and the inbox-health alerts at each step, with rollback by disabling the flag or reverting the release.

## 9. Rollback sketch

- Quick Chat: turn off its flag (under a minute).
- Reply automation: set autonomy off in `management/ai-agent`.
- Code: revert the release commit and redeploy (under 5 minutes).
- Database: the write-hardening migration documents its rollback (recreate the two policies, drop the trigger and function).
