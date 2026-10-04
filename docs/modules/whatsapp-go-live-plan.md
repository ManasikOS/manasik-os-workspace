# WhatsApp — Tech Provider Go-Live & Remaining Features Plan

**Implementation plan. Nothing here is built yet; this document is the contract for building it.**
Companion to the two existing WhatsApp docs, which this plan does not repeat or supersede:

- [`whatsapp-meta-connection-implementation-plan.md`](whatsapp-meta-connection-implementation-plan.md)
  — the connection layer (Mode A / Mode B, webhooks, token lifecycle, templates, billing tracker).
  Its own status table marks **E1–E11 code-complete**; only the Meta-side track (M1–M4) was open.
- [`whatsapp-ai-agent-implementation-plan.md`](whatsapp-ai-agent-implementation-plan.md) — the
  channel + AI agent (tenancy, tools, booking, handoff, knowledge base, voice, analytics). Phases
  0–7 and 9 are built; Phases 8, 10, 11 are not (§2 below).

This plan exists because the situation changed: **the Meta-side gate is now open.** You report a
verified business and Tech Provider status with full access. That turns what was previously "gated,
not code" into "flip the switch and verify," and it re-opens the question the two docs above
deliberately left alone — what of "all the WhatsApp features" still doesn't exist. Both are answered
below. **No code changes are proposed here** — only the plan for them, per the ask.

---

## 0. What changed, and what it unlocks

Per the connection plan's Track M (§4), Tech Provider status is the output of a sequence:
Basic Setup → evidence pack → App Review (Advanced Access on both permissions) → Tech Provider
enrolment → Access Verification. Reaching Tech Provider with full access means M3 and M4 are
functionally done. What is **not yet confirmed from the code side** — because it lives entirely in
the Meta App Dashboard, not this repo — is the last leaf of M4:

> Build the Embedded Signup configuration (App Dashboard → WhatsApp → Embedded Signup Builder →
> Facebook Login for Business configuration), request only WhatsApp Business Account + phone number
> as assets, and record the `config_id`.

This is the one piece of §1 that has to happen before anything else here is useful, because
`META_CONFIG_ID` is empty in every environment today (`.env.example:72`, confirmed unset) and
`WHATSAPP_CONNECT_MODE=own_app` is still the default (`.env.example:82`). Everything downstream —
one-click connect for other agencies, the second half of the CRM's multi-tenant SaaS story — is
already-written code waiting on this one config value.

---

## 1. Immediate: confirm and flip (Meta-side, then a two-line config change)

**Status: verified live in the App Dashboard on 2026-09-18. All six items pass.**

1. **2FA on the Business Portfolio** — ✅ confirmed in Business Settings → Security Centre: *"0 out
   of 1 people need to turn on two-factor authentication before they access this portfolio."*
   Business Verification for Royal Al-Fathima Travels shows **Verified** (originally verified
   2026-09-08).
2. **Access Verification completed**, not just Tech Provider enrolment — ✅ confirmed. The
   Embedded Signup Builder's own status panel states it explicitly and separately from Tech
   Provider enrolment: *"App Review & Access Verification — You can use this app in production now.
   You don't need to manually add users to the App for testing."* Tech Provider enrolment itself
   shows **"Congratulations! You are now a Tech Provider — 2 of 2 steps complete,"** with Business
   Verification and App Review both marked **Approved**. The Integrity panel additionally shows
   *"Your business has been cleared to continue with integration."*
3. **Embedded Signup Builder configuration created** — ✅ confirmed. Three Facebook Login for
   Business configurations exist on the ManasikOS app (`2163697914178462`):
   - `Manasik OS` (`1445928547588597`) — flagged *"Some permissions have been restricted and won't
     be requested from users of this app"*; not the one this plan uses (see note below).
   - **`WhatsApp embedded sign-up configuration with 60-day expiry token` (`1537741184768448`)** —
     this is the one built for our own site's `FB.login()` call (E4/E2 of the connection plan), as
     opposed to Meta's hosted landing page.
   - `Tech Provider Meta-hosted Embedded Signup config` (`1956775441955921`) — backs the
     zero-integration hosted landing page under Partner Tools; a separate, simpler onboarding path
     Meta hosts entirely (worth knowing about as a fallback/manual-onboarding option, not wired into
     this app's own connect card).
4. **`config_id` = `1537741184768448`** — copied from #3. **Already set** as `META_CONFIG_ID` in
   this machine's `.env.local`.
5. **Allowed Domains + Valid OAuth Redirect URIs** — ✅ confirmed on the app's Facebook Login for
   Business → Settings page: both `https://hajj-umrah-crm.vercel.app/` and
   `https://workspace.manasikos.com/` are listed in both the Valid OAuth Redirect URIs and the
   Allowed Domains for the JavaScript SDK. Toggles confirmed: Client OAuth login **Yes**, Web OAuth
   login **Yes**, Enforce HTTPS **Yes**, Use Strict Mode for redirect URIs **Yes**, Login with the
   JavaScript SDK **Yes**. (Force Web OAuth reauthentication and Embedded browser OAuth login are
   **No** — correct, neither is needed here.)
6. **`META_GRAPH_VERSION`** — this machine's `.env.local` already has `META_GRAPH_VERSION=v26.0`,
   ahead of the `v25.0` floor Embedded Signup v4 requires (F6, F11). **Still open: confirm the same
   value is set in the production deployment's environment variables (Vercel or wherever this app is
   hosted) — that's outside the Meta dashboard and outside what this session can see.** Embedded
   Signup v2 deprecates 15 October 2026 (four weeks out); this repo is already on v4, so this is a
   verification step, not a migration.

**Config already flipped locally** — `.env.local` on this machine already has:

```bash
META_CONFIG_ID=1537741184768448
WHATSAPP_CONNECT_MODE=both   # Embedded Signup primary, own-app (Mode A) stays as a fallback link — D8
META_GRAPH_VERSION=v26.0
```

**Two follow-ups this check surfaced, neither blocking:**

- **Confirm production env vars match** (§1.6) — the one item this session couldn't verify, since it
  requires the hosting provider's dashboard, not Meta's or this repo's.
- **Two unused legacy env vars in `.env.local`**: `WHATSAPP_TOKEN_MAIN` and `WHATSAPP_APP_SECRET`
  (plus `WHATSAPP_API_VERSION`, superseded by `META_GRAPH_VERSION`). Grepped the full codebase —
  nothing reads any of the three; the connection plan's actual signature-verification code reads
  `META_APP_SECRET`, not `WHATSAPP_APP_SECRET`. These look like leftovers from an earlier manual test
  against the API Setup permanent token (M1 step 2) predating the Vault-based token design (D4).
  Harmless left alone (local-only, not committed — `.env.local` is gitignored), but worth deleting
  next time this file is touched so a future reader doesn't wonder whether they're live.

**Then execute `whatsapp-connection-verification-runbook.md` in full against staging** before
onboarding a second real agency — it is written for exactly this moment and none of its five
sections need new infrastructure. Section 5 (burst load) is the one to not skip, since it is the
only section that exercises Embedded Signup live rather than by inspection.

**Definition of done for this section:** a second, real agency — not a developer/tester account —
completes the Embedded Signup popup, types nothing but its phone number, and its first inbound
customer message appears in the Inbox. This is §10's existing top-level Definition of Done in the
connection plan; every Meta-side precondition for it is now confirmed satisfied.

---

### 1.1 Production findings, 2026-09-18 (found while verifying, both fixed)

- **Every cron job had been silently 404ing since 2026-09-08.** The Vault secret `cron_http_base_url`
  pointed at `https://manasikos.com`; the app is served from `https://workspace.manasikos.com`.
  `pg_cron` reported "succeeded" throughout because `net.http_get` is fire-and-forget — the only
  place the failure showed was `net._http_response` (status 404). Health checks, billing sync,
  seat-hold release and departure-ops drains never ran. Fixed by `vault.update_secret` on that one
  secret; all five routes now return 200. **Lesson for `docs/runbooks`: after
  `set_cron_http_config()`, always confirm with `select status_code from net._http_response order by
  id desc limit 5` — a green `cron.job_run_details` row proves nothing.**
- **`whatsapp-billing-sync` threw "Invalid time value".** Meta's `pricing_analytics` returns bucket
  `start`/`end` as `YYYY-MM-DD` strings for DAILY granularity, not unix seconds. Fixed with
  `toUnixSeconds()` in `lib/whatsapp/client.ts` plus a regression test. **Takes effect only after the
  PR deploys**; then re-run the route and expect `synced: 1` and rows in `whatsapp_billing_daily`.

## 2. What "all the WhatsApp features" still means: the real gap

Everything below is genuinely unbuilt. Nothing here duplicates work already covered by the two
existing plans — it names precisely their unbuilt phases, plus two things neither plan scoped.

| # | Feature | Source | Why it's still open | Priority |
|---|---|---|---|---|
| G1 | **Knowledge base** (agency policy Q&A grounded in uploaded docs) — 📝 planned, see [whatsapp-knowledge-base-implementation-plan.md](whatsapp-knowledge-base-implementation-plan.md) | ai-agent plan Phase 8 | No `knowledge/` route, no `knowledge_documents`/`knowledge_chunks` tables exist in any migration; `pgvector` never enabled | High — closes the largest gap between "answers booking questions" and "answers *any* question a pilgrim asks" |
| G2 | ✅ **(voice notes in — built, see [TASK-003](../tasks/TASK-003-whatsapp-voice-notes.md); voice replies deliberately not built)** **Voice notes in/out** | ai-agent plan Phase 10 (D12) | No transcription job kind, no `TRANSCRIBE_AUDIO` handling in `agent_jobs`, no media download wiring beyond what `client.ts` already exposes | Medium — real usage pattern for this audience (older pilgrims, voice-first), but depends on G1's runtime maturity first |
| G3 | **AI Agent analytics/overview screen** — ✅ built, see [TASK-002](../tasks/TASK-002-ai-agent-analytics-summary.md) (rate migration pending apply) | ai-agent plan §11/§14 | `app/(main)/management/ai-agent/` has a form and an activity feed (`ai-agent-activity.tsx`) but no dedicated resolution-rate, latency, token-cost, or tool-failure-rate view; `agent_runs`/`agent_tool_calls` already carry the data | Medium — the data exists and is unused; this is a read-only screen, not new instrumentation |
| G4 | **Marketing / broadcast sends to WhatsApp** | Connection plan E10 Layer 3 note: *"the guard exists and is correct but uncalled — no marketing-blast feature exists yet to invoke it from"* | Campaigns module (`campaigns-command-center-implementation-plan.md`) tracks ad-platform spend and attribution, but there is no feature that actually **sends** a WhatsApp template to a list (announcements dispatch is the closest analogue — `announcements_whatsapp_dispatch` migration — but that's operational, not marketing) | High if outbound marketing on WhatsApp is a product goal; otherwise this row can be dropped — see Q1 |
| G5 | **SMB history sync** for numbers migrating off the WhatsApp Business app | Connection plan F9, explicitly deferred as Open Question #1, recommendation "no for v1" | Still the right call — it's a one-way, 24-hour-window feature with real engineering cost. Most travel agencies' existing numbers are exactly this case (F9), so this decision blocks *those* agencies from a lossless migration, not from connecting at all | Revisit only when a specific agency asks — not a go-live blocker |
| G6 | **Business profile management** (`getBusinessProfile`/`updateBusinessProfile` on `client.ts`) | Connection plan §5 E3 lists these as additions to build; not confirmed wired into any UI | Low — a settings nicety (about text, address, description, profile photo on the WhatsApp side), not a functional gap | Low |
| G7 | ✅ **(buttons part built)** **Interactive messages in the agent's own replies** (buttons/lists, not just free text) | Neither plan scopes this explicitly; `client.ts` already supports sending interactive payloads per the connection plan's inventory (§1: "Send text/interactive/template") | The agent runtime (§8 of the ai-agent plan) only composes prose; giving it access to structured quick-reply buttons for common flows (e.g. "Yes / No" on `review_booking`, departure selection as a list) would materially reduce mistyped replies | Medium — a UX quality lever, not a coverage gap |

**Not gaps, despite sounding unfinished:** Mode A (own-app connect) staying available after Tech
Provider approval is a deliberate decision (D2), not a leftover. The billing tracker's Layer 3 guard
being "uncalled" is only a gap once G4 exists to call it — it isn't broken on its own.

---

## 3. Sequencing

```text
Week 0     §1 — confirm Meta dashboard state, get config_id, flip WHATSAPP_CONNECT_MODE=both,
              run the verification runbook against staging
Week 0-1   Onboard a second real agency through Embedded Signup; watch whatsapp_connection_events
              and the Billing screen for the first week of real multi-tenant traffic
Week 1-3   G3 (analytics screen) — fastest win, data already exists, read-only, no new tables
Week 2-5   G1 (knowledge base) — Phase 8 as written: extension guard, chunk/embed pipeline,
              search_knowledge_base tool, KB management screen
Week 4-6   G7 (interactive replies) — extend the agent's tool/reply layer to emit buttons/lists
              for the highest-value flows (booking review, departure selection)
Decide     G4 (marketing/broadcast) — do not start until Q1 below is answered; this is a product
              decision (does the agency want to send unsolicited marketing templates at all —
              Meta's own policy and the 24-hour-window/template-category rules apply in full)
Later      G2 (voice) once G1's runtime patterns (chunking, tool grounding) are proven in production
Backlog    G5 (SMB history sync), G6 (business profile UI) — revisit on a specific agency's request
```

The critical path to *more agencies on the platform* is entirely §1 — it is Meta dashboard
configuration and verification, not code. The critical path to *a materially more capable agent* is
G1, because it is the one gap that changes what the agent can answer, not just how well it's
observed or how it's reached.

---

## 4. Risks specific to this moment (Sept 2026)

1. **Embedded Signup v2 deprecates 15 October 2026** (confirmed against Meta's current docs, cited
   §1.6). This repo is already on v4 — no action beyond the `META_GRAPH_VERSION=v25.0` check in §1.
2. **The 1 October 2026 utility/authentication pricing change** (connection plan F13) lands two weeks
   after today. It requires no code change (D11 derives rates from Meta's own data nightly), but the
   Billing screen's *forecast*, if anyone builds one later, must be labelled with the rate date it
   used — noted in the connection plan's risk #8, restated here because it's now imminent rather than
   theoretical.
3. **First real second-tenant onboarding is the actual test of E4/E7**, which the connection plan
   itself flags as "code-complete... gated on M4 to actually exercise." Code review alone cannot
   close this — only a live popup with a real Business Portfolio can, which is exactly what §1's
   definition of done requires before calling the connection layer done.
4. **Access Verification vs. Tech Provider enrolment are easy to conflate.** If Access Verification
   turns out not to be complete, the ~10/week onboarding cap still applies — fine for a second or
   third agency, a real constraint for a launch cohort. Confirm this explicitly (§1 step 2) rather
   than assuming "Tech Provider" implies it.

---

## 5. Open questions (need an answer from the business, not the code)

1. **Is outbound WhatsApp marketing (G4) actually wanted?** It's a materially different risk and
   compliance surface from the current transactional/conversational use (opt-in rules, template
   category restrictions, Meta's own anti-spam enforcement against numbers that send unsolicited
   marketing). Confirm before scoping it, since it changes onboarding copy and possibly the
   App Review use-case description on file with Meta.
2. **Priority between G1 (knowledge base) and G2 (voice)** — both serve the same audience
   (pilgrims, often non-technical, often more comfortable in Sinhala/Tamil voice than typed English).
   Recommendation above is G1 first since it's the runtime dependency for grounded answers regardless
   of input modality, but this is a product call.
3. **Does Access Verification's ~200/week cap comfortably cover the onboarding pipeline** you expect
   in the first quarter after go-live? If more agencies are expected sooner, the only lever is
   Meta's Business Partner track (a heavier program, out of scope here) — worth knowing the ceiling
   now rather than at the 200th agency.

## G7 status — interactive replies (2026-09-18)

- **Built (G7a):** `lib/agent/whatsapp/quick-replies.ts` decides the buttons, deterministically from the tool that ran last
  and succeeded (never by the model): "Book Now" after departure details (already existed) and, new, "Confirm booking" /
  "Change details" right after the booking summary. Tested (`quick-replies.test.ts`).
- **Bug fixed on the way:** tools report ordinary failures as a JSON body starting `{"error"` without marking the call as
  failed, so a "Book Now" button could appear on a failed departure lookup. Buttons now require a real success.
- **Behaviour change:** the "Call now" phone line is added only on Book Now turns, not on every button turn, so it does not
  appear under the booking summary.
- A tap arrives as an ordinary message carrying the button title (existing behaviour), and `confirm_and_hold_booking`
  already accepts the customer's own confirming words, so no new inbound handling was needed.
- **Not built (G7b):** a WhatsApp list message for choosing between several departures. It needs a new list send in
  `lib/whatsapp/client.ts`, parsing of `list_reply` in the webhook, and a decision on how many departures to show (a list
  holds at most 10 rows). Worth doing once real conversations show customers mistyping departure names.
- **Not verified end to end:** no live WhatsApp conversation has been run with the new buttons; only the decision logic is
  tested.


## Conversation style, typing indicator and automatic leads (2026-09-19)

From the first real WhatsApp test:
- **Typing bubble.** The inbound job now tells WhatsApp to show "typing..." (and mark the message read) as soon as it
  starts, so the customer sees the assistant working. WhatsApp keeps it up for up to 25 s or until the reply is sent.
- **Speed.** Production functions ran in Vercel `iad1` (Washington) while the database is in Singapore
  (`ap-southeast-1`), so every database query paid an ocean round trip (a single insert took about 0.8 s inside a tool
  call). `vercel.json` now pins functions to `sin1`. A turn that used five tools took 20 s before; the model's own
  steps are the remaining cost, and the prompt now asks it to request independent tools together.
- **Automatic lead.** With lead capture on, the inbound job creates or links the CRM lead for the sender's number
  *before* the model runs (name from the WhatsApp profile, else "WhatsApp customer"), so a customer never chats without a
  lead even if the model forgets to ask for one. It is per phone number: a number that already has a lead is linked to it,
  not duplicated (the first test looked like "no lead" because that number already had lead LD-2026-0001).
  `update_lead` can now set the real name, city and interest once the customer types them.
- **Conversation style.** New settings on the Manasik Copilot screen (`ai_settings.behaviour`, validated in
  `lib/validations/ai-behaviour.ts`, rendered by `lib/agent/whatsapp/behaviour-prompt.ts`): reply length, emoji, message
  style, what a package enquiry shows (ask first / short summary / full details) and which details to include, which
  questions to ask and in what order, when a person takes over, greeting, closing and free-text rules. An empty setting
  reproduces the previous behaviour.
