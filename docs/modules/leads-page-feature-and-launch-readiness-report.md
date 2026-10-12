# Leads Page — Feature Inventory and Launch-Readiness Report

| | |
|---|---|
| **Scope** | `/leads` (list + drawer + dialogs), `/leads/new` (lead editor), Manasik copilot, import/export, follow-up cron, and the `leads*` data/access layers |
| **Branch / date** | `UI-update`, 2026-10-12 |
| **Method** | Static read of the page, actions, repository, access, validations and migrations; existing audit doc reviewed; unit tests and ESLint run. Database migrations, pgTAP and the running app were **not** exercised. |

---

## 1. Verdict

**Conditional GO — not yet a clean GO.** The module is feature-complete and the application layer is well hardened. Three things stand between it and a confident launch, and none is a code-writing task:

1. **Migrations 1–3 and their pgTAP tests have never been run against a database** (security audit §9). The app code now depends on RPCs/columns they create (`allocate_references`, `consume_staff_rate_limit`, `authorise_lead_export`, `set_lead_consent`, `email_normalised`, `converting_at`). Until applied, rate-limited and export actions will fail or fall through to their "unavailable" path.
2. **Operations / Visa / Finance can still read every lead straight from PostgREST** (including `estimated_value_lkr`), because the `leads` SELECT policy is unchanged. The UI and server projection hide it; the database does not.
3. **The whole lead store is loaded and filtered in the browser** with no pagination. Fine at hundreds of leads; a latent cliff at thousands.

---

## 2. Feature inventory

### 2.1 List page (`/leads`)

| Feature | Notes |
|---|---|
| Server-rendered store | `force-dynamic`; queries start before the role check resolves; one `nowIso` serialised so server and client agree on "overdue" |
| KPI row (clickable) | New Leads (30d, with % vs previous 30d), Contacted / first-contact rate, Follow-up Overdue (+ due today), Booked / conversion rate, Estimated Pipeline Value (hidden without `viewPipelineValue`) |
| Saved views (11) | All, My, New Today, Follow-up Today, Overdue, High-Value, Deposit Pending, Unassigned, Postponed, Lost This Month, Duplicate Review |
| Filters (8) | Stage, Journey, Package, Follow-up, Owner, Temperature, Source, City — options derived from rows actually present |
| Search | Name, mobile, email, lead ID, package |
| Sorting | Column and menu sort; default sort constant |
| Bulk actions | Move to stage, Reassign, Mark lost (capability-gated) |
| Row / context menu | Open, log contact, change stage, assign, mark lost |
| Deep link | `/leads?open=<id>` opens the drawer (used by Quotes) |
| Import | CSV, ≤ 500 rows, server-validated, duplicate check, owner must be an active sales owner |
| Export | CSV of the current view; server authorises, rate-limits (10/h) and logs first; money column dropped without `viewPipelineValue` |
| Manage Lead Sources | Admin-only sheet |

### 2.2 Lead drawer

Summary and next-follow-up; callouts for Lost / Ready to convert / Booked; sections for Journey interest, Contact (copy buttons, WhatsApp link), Quotes, Pipeline, Internal notes, Ownership & source, Campaign attribution (campaign + attribution certainty), Activity timeline. Contains consent controls (do-not-contact, channels).

### 2.3 Lead editor (`/leads/new`)

Multi-step workspace (contact → travel interest → sales setup → review) with a live opportunity preview, step gating (`decide-lead-step-gate`), per-step validation, **duplicate detection gate** (mobile and e-mail, with override reason), next-action scheduling, leave-confirmation, and loading skeletons. Server action re-validates with Zod.

### 2.4 Sales workflow actions

Log contact (optionally advance stage and schedule follow-up) · set / complete follow-up · add note · change stage (rules in §3) · assign · mark lost (reason + note) · find available departure groups · select group · send quote (server re-prices; refuses closed/full group) · update quote status (explicit state machine) · convert to booking (CAS claim, idempotent) · update consent.

### 2.5 Manasik Sales Intelligence (copilot)

Analyse enquiry → proposed intent changes → apply · Build offers · Compare options · Ask Manasik · Draft customer reply (tone / language / purpose, save-only, never auto-sent) · Quote builder → save draft (discount ⇒ `PENDING_APPROVAL` unless `applyUnrestrictedDiscount`) · Alerts with dismiss. Prompts fence untrusted text and redact phone/e-mail/NIC/passport before the model call.

### 2.6 Automation and integrations

| Piece | Behaviour |
|---|---|
| `/api/cron/lead-followups` | Every 10 min, per-agency: handoff alerts, then quiet-lead nudges (dry-run first, opt-in); constant-time bearer auth; counts only in response; 50 s budget |
| WhatsApp agent tools | Create/update leads; input capped, stripped of control and bidi characters |
| Inbox linking | Lead completeness, channel, link decisions, new-chat matching |
| Insights | Stalled-leads generator |

### 2.7 Roles

| Role | Access |
|---|---|
| ADMIN | Everything |
| MARKETING | Full sales workflow, export, copilot; discounts become `PENDING_APPROVAL`; cannot delete, merge, manage sources, or lift DNC |
| CEO | Read-only overview + pipeline value + copilot/quotes read |
| FINANCE | Converted leads only; value and quotes |
| OPERATIONS / VISA | Converted leads only; no money |
| GUIDE | No access (404) |

Custom-role overrides are merged by `getLeadActor()`.

---

## 3. Business rules enforced

- **Booked** only via conversion, never by stage change.
- **Deposit Pending** requires an accepted quote.
- A lead with a booking cannot change stage.
- Do-not-contact blocks conversion for non-admins; only ADMIN lifts DNC.
- Quote transitions follow a table in `quote-transitions.ts`; `PENDING_APPROVAL` leaves only with an approver, recorded on the quote.
- Writes are version-checked on `updated_at`; conflicts surface instead of overwriting a colleague.
- References come from `allocate_references()`, not `max + 1`.

---

## 4. Quality evidence

| Check | Result |
|---|---|
| Unit tests (leads, data, validations, followups, inbox linking, agent, cron) | **241 passed / 25 files / 0 failed** (4 s) |
| ESLint on leads UI + data + access | **0 errors, 32 warnings** (unused imports/vars: e.g. `leads-list.tsx` `PhoneCall`, `Sparkles`, `LeadTableSorting`; `leads-columns.tsx` `Checkbox`; `send-quote-sheet.tsx` `pkg`) |
| `TODO` / `FIXME` / `console.log` in leads code | None found |
| Typecheck, `next build`, e2e | **Not run** in this analysis |
| pgTAP (`leads_rls_least_privilege`, `leads_integrity`, `leads_abuse_limits`) | **Written, not run** |
| Dependency audit | Not run |

One test-hygiene note: `actions.create-lead.test.ts` logs `db.rpc is not a function` for the duplicate-check limiter — the mock lacks `rpc`, so the "limiter unreachable → allow" branch is what is being tested. Harmless, but the happy path of the limiter is untested at the action level.

---

## 5. Findings and risks

Severity here is launch impact.

| # | Sev | Finding | Evidence |
|---|---|---|---|
| R1 | **High** | DB migrations for security phases 1–3 unapplied/unverified; app code depends on them | Audit §9 "not yet run against a database" |
| R2 | **High** | Converted-only roles can read all leads (incl. value) directly via PostgREST | Audit "Residual risks"; `leads` SELECT policy unchanged; needs a projection view and moving inbox/reports/dashboard/campaigns onto it |
| R3 | Medium | No pagination or server-side filtering: `loadLeadStore` does `select *` on 7 tables, all serialised into the RSC payload, then filtered client-side | `leads-repository.ts:340-373`, `leads-list.tsx` `useFilteredRows` |
| R4 | Medium | Export file is built in the browser after server authorisation; the log is a deterrent, not a barrier | Audit residual risk 2 |
| R5 | Medium | `sendQuoteAction` prices at package level (cheapest live departure), not from the lead's selected group's tier | Audit residual risk 3 |
| R6 | Medium | Product decisions not yet made: E.164 / non-Sri-Lankan numbers (dedupe normalises to 9 digits); `viewAllOwners` is dead (all staff see all owners' PII) | Audit LD-18, LD-20 |
| R7 | Low | CSP allows `'unsafe-inline'` scripts (app-wide, tracked P0-7) | Audit LD-22 |
| R8 | Low | PII to a third-party LLM: redaction in place, but DPA and privacy notice are not code and not done | Audit LD-23 |
| R9 | Low | Bulk "move to stage" / "reassign" in the list doesn't check `result.ok` before toasting `result.changed`; a failed bulk action may read as "0 leads moved" with no error text | `leads-list.tsx:683-694, 716-727` |
| R10 | Low | 32 lint warnings (dead imports), including an unused `LeadTableSorting` import | §4 |
| R11 | Low | Behaviour changes need sign-off: Deposit Pending needs accepted quote; Booked only via conversion; DNC blocks conversion; import caps | Audit §9 |

R9 is the only item found independently of the existing audit; the rest are consistent with it.

---

## 6. Pre-launch checklist (from the shipping skill)

| Area | Status |
|---|---|
| Tests pass | ✅ 241/241 (leads scope) |
| Lint | ✅ 0 errors · ⚠️ 32 warnings |
| Typecheck / build | ⬜ not run |
| No secrets in code | ✅ cron secret via env; none seen |
| Input validation | ✅ Zod on every action |
| AuthN / AuthZ | ✅ `requireUser` + capability on every action · ⚠️ R2 at DB level |
| Rate limiting | ✅ code · ⬜ depends on migration 3 |
| Audit trail | ✅ export log, consent RPC, activity timeline · ⬜ immutability triggers unverified |
| Error handling | ✅ `describeLeadFailure()` — no raw DB text to client |
| Performance | ⚠️ R3 |
| Accessibility | ✅ row aria-labels, labelled drawer, aria-labelled controls · ⬜ no axe/Lighthouse run |
| Migrations applied | ❌ R1 |
| Runbooks | ✅ `lead-followups-operations.md`, `add-lead-screen-verification.md` |
| Feature flag / kill switch | ⚠️ cron nudges are opt-in per agency (good); no flag for the rest of the module |

---

## 7. Recommended order to ship

1. **Apply migrations** `20270125…`, `20270201…`, `20270208…` to a **staging** project; run the three pgTAP files and `gate_schema_fingerprint`. Fix anything that fails. *(R1)*
2. Run `npm run typecheck`, `npm run build`, and an axe pass on `/leads`, `/leads/new` and the drawer.
3. Smoke test per role (ADMIN, MARKETING, CEO, FINANCE, OPERATIONS, GUIDE): list, open drawer, stage change, import, export, quote with discount, convert, DNC.
4. Fix R9 (2-line change) and clear the dead imports.
5. Decide R6 and R11 with the owner; record as ADRs.
6. Production: deploy migrations first, then the app. Enable quiet-lead nudges in **dry-run** per agency and review before sending.
7. Next release: R2 projection view, R3 pagination/server-side filtering, R5 group-tier pricing.

### Rollback

| Layer | Plan |
|---|---|
| App | Redeploy previous build (< 5 min); migrations are additive, so the old build keeps working against the new schema |
| Cron nudges | Turn the agency setting off (< 1 min); sweep otherwise sends nothing in dry-run |
| Migrations | Triggers/policies are the risky part — keep the pre-migration `pg_policies` dump so they can be restored by a forward migration |

### Watch for the first hour

Server Action error rate on `/leads`, `consume_staff_rate_limit` failures (log line `could not check the … limit`), `lead_export_logs` rows appearing, "conflict" responses from the version check (expected occasionally; a spike means a hot-write loop), and `/api/cron/lead-followups` returning `failedAgencies > 0`.
