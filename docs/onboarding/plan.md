# Agency Self-Onboarding — Spec & Implementation Plan

**Status:** proposed, awaiting review · **Prepared:** 2026-09-26 · **Branch:** `building-onboarding`

> Location note: `AGENTS.md` normally puts module plans in `docs/modules/`. This one lives in
> `docs/onboarding/` because the request named that path. It is a deliberate, documented exception.

## 1. Objective

An agency owner starts at the **login screen**, creates their own workspace, and configures everything
themselves (branding, team, channels/connectors, payments, first package) **without contacting us**.
**Nothing beyond the account and agency name is required.** Every other step can be skipped, resumed
later, and finished in any order.

Success looks like:
- A stranger goes from "Create workspace" to a working dashboard in **under 2 minutes** with zero
  connectors configured.
- Any connector can be connected during setup or weeks later, from the same guided place.
- A deployment that lacks a connector's platform credentials shows an honest "not available yet"
  instead of a broken button.
- No tenant is ever created from an unverified email; no tenant can see another's data.

## 2. What already exists (verified in code)

| Piece | Where | State |
|---|---|---|
| Signup form + action | `app/(auth)/signup/**`, `signupAction` in `app/(auth)/actions.ts` | Works only if `SIGNUP_MODE=open` (default `invite_only`). **No link to it from the login page.** |
| Staging table | `pending_agency_signups` (`20260831090000_agency_signup.sql`) | Service-role only, RLS on. No expiry. |
| Provisioning | `provision_agency()` SQL (`20260829090000_agency_membership.sql`) + `app/(auth)/onboarding/page.tsx` | Seeds settings, HQ branch, lead sources, integration rows, add-ons, `ai_settings`, ADMIN owner. |
| Checklist | `getOnboardingChecklist()` in `lib/tenancy.ts` | 4 items, derived from real data. **Commented out** in `app/(main)/dashboard/page.tsx:195`. |
| Connectors | `app/(main)/management/settings/integrations/**`, `app/api/oauth/*` | Working WhatsApp Embedded Signup, Messenger, Instagram, Meta Ads, Google Ads, SMTP. All OAuth callbacks hard-redirect to the integrations page. |
| Plans/entitlements | `20261202092700_mi6_4_plans_entitlements.sql`, `lib/billing/entitlements.ts` | STARTER/GROWTH/PROFESSIONAL/ENTERPRISE. Only *existing* agencies were back-filled. |
| Operator console | `app/platform/agencies/**` | Operators can create agencies by hand. |

So this is **not greenfield**. The work is: fix the defects in the existing path, add a guided setup
experience on top, and make connectors first-class in it.

## 3. Defects found in the existing path (fix before building UX)

| # | Defect | Evidence | Impact |
|---|---|---|---|
| D1 | **Owner may never reach provisioning.** Signup invites with `redirectTo: /onboarding`, but the documented Invite email template hard-codes `next=/login?mode=setup` (`app/(auth)/README.md` §3). The owner sets a password, lands on `/dashboard` with no agency, and provisioning never runs. | `actions.ts` `signupAction`; README §3 | Self-serve silently fails. **Must be confirmed on a real environment.** |
| D2 | **Provisioning is a side effect of a page render and is not atomic.** `provision_agency` is called, then `consumed_at` is set in a separate call. Two tabs or a retry can create two agencies. | `app/(auth)/onboarding/page.tsx` | Duplicate tenants. |
| D3 | **Slug collisions and empty slugs throw.** `agencies.slug` is unique; two "Al-Noor Travels" fail, and a non-Latin name yields `''`. | `onboarding/page.tsx` slug regex | Owner sees a crash page. |
| D4 | **New agencies get no subscription row.** `provision_agency` never inserts `agency_subscriptions`; `resolveEntitlements()` returns `null`. | `lib/billing/entitlements.ts` | AI budget/autonomy behaviour is undefined for every self-serve agency. |
| D5 | **Seeded defaults are Sri Lankan.** Add-ons are priced in LKR (Qurbani 28000, etc.); `agency_settings` defaults to `LK`/`LKR`/`Asia/Colombo`/`en,si,ta`. | `provision_agency`, `agency_settings` migration | A UK/US/UAE agency starts with nonsense prices and timezone. |
| D6 | **`ilike` used for exact email match.** `_` and `%` are wildcards. | `signupAction`, `onboarding/page.tsx` | Wrong pending row can match. Low likelihood, real defect. |
| D7 | **No abuse controls.** `signupAction` has no rate limit or bot check; each call sends a Supabase invite email. | `signupAction` | Email-bombing vector; open signup on a system holding passport scans. |
| D8 | **Pending signups never expire.** | migration | Table grows; stale rows claimable. |
| D9 | **Connector callbacks can't return to setup.** They redirect to `INTEGRATIONS_PATH` unconditionally. | `app/api/oauth/whatsapp/callback/route.ts:27` | Connecting mid-wizard dumps the user out of the flow. |
| D10 | **Connector availability is decided ad hoc in a page.** `messengerConfigured` etc. live inside `integrations/page.tsx`. | that file | Setup can't reuse it. |

## 4. Assumptions (correct me now or I proceed with these)

1. Signup stays **email-verified via the existing invite mechanism** (Supabase public sign-ups stay disabled). We fix it, not replace it.
2. The owner becomes `ADMIN` (existing behaviour). Only `ADMIN` can see setup.
3. Self-serve agencies start on a **STARTER trial**. Trial length and plan are open questions (§13).
4. Connectors keep using **our single Meta app / Google app** (per `docs/architecture/whatsapp-multi-tenant-connection.md`). Agencies never see tokens or app IDs.
5. "Everything optional" means the dashboard is **never gated** on setup. Only the account and agency name are needed to exist.
6. A "second agency for an existing user" flow is out of scope (multi-tenancy plan Phase 5 item 2).
7. UI follows `AGENTS.md`: shadcn only, `InputGroup` for inputs, existing design tokens, unique component names.

## 5. UX design

### 5.1 Principles
1. **Value first.** Two fast steps, then the product. Connectors come after the owner has seen it.
2. **Skippable everywhere, resumable always.** Skip never shows a warning; the step just stays open in the guide.
3. **Truth over hope.** "Done" is derived from real data, never from a click. A connector is done only when it is `CONNECTED`.
4. **Say what it costs.** Each connector card states time needed, what you must have (e.g. "admin access to your Facebook Business account"), and what you get.
5. **Nothing is a dead end.** A failed or unavailable connector shows the reason and a way forward.

### 5.2 Journey

```
Login screen
  └─ "New here? Create your agency workspace"  ──►  /signup
        agency name · your name · work email  (+ country, prefilled)
        ──►  "Check your inbox"
              ──►  click-to-confirm email link (existing anti-prefetch page)
                    ──►  /onboarding  (provision once, atomically; trial starts)
                          ──►  /setup   ← the guided setup, full screen
                                ├─ 1 Secure your account   (set password)
                                ├─ 2 Your agency           (country, currency, timezone, language, logo)
                                ├─ 3 Invite your team      (skippable)
                                ├─ 4 Connect your channels (WhatsApp · Instagram · Messenger · Email · Ads)
                                ├─ 5 Get paid              (bank / payment accounts, invoice prefix)
                                └─ 6 Add your first package (skippable)
                          ──►  "Go to dashboard" at ANY point
  Dashboard ── "Setup guide" card (progress ring) ── reopens /setup at the next open step
```

Steps 1–2 are the "fast start": both take seconds because everything is pre-filled (timezone from the
browser, country from timezone, currency from country). Steps 3–6 are optional.

### 5.3 The setup screen
- A **step rail** on the left (top on mobile) showing each step's state: *Done*, *Skipped*, *Not started*. The user may jump to any step; it is not a forced sequence.
- Each step has one primary action and a plain **"Do this later"** text button. No confirmation dialog.
- Step 4 is a grid of connector cards, each independent:
  - **WhatsApp** — "Receive and reply to pilgrim messages in one inbox." Needs: a Facebook Business login. ~5 min. Button → existing Embedded Signup.
  - **Instagram / Messenger** — same pattern.
  - **Email (SMTP)** — inline form with a **Send test email** button.
  - **Ads (Meta / Google)** — collapsed under "Advanced".
  - Card states: *Not connected* · *Connecting…* · *Connected ✓ (account name)* · *Needs attention (reason + retry)* · *Not available on this deployment yet* (env missing; no button).
- After a connector callback, the user **returns to `/setup` step 4** with that card updated and a success toast.
- Finish screen is not a gate: a summary ("2 of 6 done — you can finish the rest any time") and one button.

### 5.4 After setup
- The dashboard shows a **Setup guide** card (re-enabling the existing, currently commented-out `OnboardingChecklist`) with progress, the next open item, and a "Dismiss" action. Dismissal is stored; it stays reachable from Settings → "Setup guide".
- Non-admin roles never see it.

### 5.5 Copy rules
Plain language, no jargon: "Connect WhatsApp", not "Configure WABA". Errors name the cause and the fix. Every skippable step says *what you lose by waiting* (e.g. "Until WhatsApp is connected, messages won't appear in your inbox").

### 5.6 Accessibility & responsive
Keyboard-operable stepper, visible focus, `aria-current="step"`, status conveyed by text and icon, not colour alone. Rail collapses to a top progress bar at phone width.

## 6. Capability map (build order)

| Module id | Responsibility | Depends on |
|---|---|---|
| `onboarding-entry` | Login link, signup hardening, atomic provisioning, no-membership redirect, D1–D3, D6–D8 | — |
| `onboarding-defaults` | Locale/currency-aware seeding, trial subscription (D4, D5) | `onboarding-entry` |
| `setup-shell` | `/setup` route, step rail, persisted state, derived completion, dashboard guide | `onboarding-entry` |
| `setup-connectors` | Availability helper, return-to flow, connector cards in setup (D9, D10) | `setup-shell` |
| `setup-essentials-steps` | Steps 1, 2, 3, 5, 6 (reuse existing settings/team/package actions) | `setup-shell`, `onboarding-defaults` |
| `onboarding-observability` | Funnel events, operator visibility, abuse metrics | `setup-shell` |

Build order: `onboarding-entry` → `onboarding-defaults` → `setup-shell` → `setup-connectors` ‖ `setup-essentials-steps` → `onboarding-observability`.

## 7. Backend changes

### 7.1 Migrations (each with RLS in the same file)

**M1 — `agency_onboarding_state`**
```sql
create table public.agency_onboarding_state (
  agency_id           uuid primary key references public.agencies(id) on delete cascade,
  steps               jsonb not null default '{}'::jsonb,   -- {"team":"SKIPPED","channels":"SKIPPED"}
  basics_confirmed_at timestamptz,
  password_set_at     timestamptz,
  guide_dismissed_at  timestamptz,
  last_step           text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
alter table public.agency_onboarding_state enable row level security;
-- select: members of the agency; insert/update: ADMIN of the agency only (via current_agency_id()).
```
Design choice: **only store what cannot be derived** (skips, dismissal, "you confirmed your
basics"). Whether WhatsApp is connected, a package exists, or a logo is set is read live, so the
guide can never drift from reality (the same principle `getOnboardingChecklist` already follows).

**M2 — `provision_agency_from_signup(p_pending_id, p_user_id, p_email)`** (service-role only)
Single transaction: `select … for update` the pending row, reject if consumed or expired, generate a
unique slug (suffix on collision, `agency-<short id>` if empty), call `provision_agency`, insert
`agency_onboarding_state`, insert the trial `agency_subscriptions`, mark `consumed_at`. Idempotent:
a second call returns the existing agency id. Fixes D2, D3, D4.

**M3 — `pending_agency_signups` hardening.** Add `expires_at default now() + interval '7 days'`; store
`email` lower-cased with a plain `lower(email)` unique index; add `country_code`. Fixes D6, D8.

**M4 — locale-aware seeding.** Replace the hard-coded LKR add-on prices in `provision_agency` with
currency-neutral seeds: `default_amount = 0` and a `needs_pricing` marker (or seed from a small
`currency_seed_prices` table). Accept `p_country`, `p_currency`, `p_timezone` and write them to
`agency_settings`. Fixes D5. Existing agencies are untouched.

### 7.2 Server code

| File | Change |
|---|---|
| `app/(auth)/actions.ts` | `signupAction`: rate limit per IP and per email, optional bot check, exact-match email, accept country. |
| `app/(auth)/onboarding/page.tsx` | Call M2 once; on failure show a recoverable error screen with retry, not a thrown 500. Redirect to `/setup`. |
| `app/(main)/layout.tsx` | If the user has no active membership, redirect to `/onboarding` (makes D1 impossible regardless of email template). |
| `lib/setup/setup-steps.ts` (new) | Pure step definitions and `deriveSetupProgress()` from live data + M1 row. Replaces `getOnboardingChecklist`. |
| `lib/setup/connector-availability.ts` (new) | Extracted from `integrations/page.tsx`: which connectors this deployment can offer, from env. |
| `lib/setup/setup-return.ts` (new) | Signed, short-lived `rf.setup_return` cookie; `safeRedirectPath`-style allow-list (`/setup` only). |
| `app/api/oauth/*/callback/route.ts` | If the return cookie is present and valid, redirect to `/setup?step=channels&connected=<provider>`; otherwise unchanged. |
| `app/(setup)/setup/actions.ts` (new) | `markSetupStepSkippedAction`, `confirmAgencyBasicsAction`, `dismissSetupGuideAction`. Each starts with `requireUser()`, checks ADMIN, validates with Zod. Steps that edit settings **reuse** existing actions (`updateOrganisationSettingsAction`, `updateBrandingSettingsAction`, `updateFinanceDefaultsAction`, invite via `inviteStaff`). |
| `lib/validations/setup.ts` (new) | Zod schemas for the above. |
| `lib/access/setup-access.ts` (new) | Capability: `viewSetup`, `editSetup` (ADMIN only). |
| `app/platform/agencies/**` | Add an onboarding-progress column for operators. |

### 7.3 Security requirements
- Provisioning only after email confirmation; only via M2 (no direct RPC from the page).
- All new tables: RLS in the same migration; service-role calls filter by `agency_id` explicitly.
- Rate limits on signup: per email (e.g. 3/hour) and per IP; generic success message to avoid enumeration where possible.
- Return-to cookie is signed, expires in 15 minutes, and only ever resolves to `/setup`.
- No connector secret ever reaches the setup UI (unchanged rule).
- Run the security checklist in `docs/security/security-guidelines.md` §10 before merge.

## 8. Frontend changes

New route group so setup has no app sidebar:
```
app/(setup)/layout.tsx              requireUser + ADMIN gate, minimal chrome, theme switch
app/(setup)/setup/page.tsx          server: loads derived progress, renders shell
app/(setup)/setup/components/
  setup-step-rail.tsx               stepper, states, jump-to-step
  setup-step-frame.tsx              title, benefit line, "Do this later"
  account-password-step.tsx         reuses updatePasswordAction (15-min recovery window applies)
  agency-basics-step.tsx            country/currency/timezone/language/logo, browser-detected defaults
  team-invite-step.tsx              reuses team invite; shows seat limit from plan
  connector-cards-step.tsx          grid of connector cards
  connector-setup-card.tsx          one card, all five states
  payments-step.tsx                 reuses payment-accounts card logic
  first-package-step.tsx            link-out or minimal quick-create
  setup-finish-panel.tsx
app/(main)/dashboard/components/setup-guide-card.tsx   replaces the commented-out checklist
app/(auth)/login/components/login-form.tsx             add "New here? Create your agency workspace"
app/(auth)/signup/**                                   add country; show real errors; resend link
```
All inputs use `InputGroup`/`InputGroupAddon align="block-start"`; components come from shadcn
(fetch via the shadcn MCP before adding any). Component names are specific (`SetupStepRail`,
not `Stepper`).

Also: **Settings → Setup guide** entry to reopen setup after dismissal.

## 9. Commands

```
Dev:        npm run dev            (https)   |  npm run dev:http
Typecheck:  npm run typecheck
Lint:       npm run lint
Unit tests: npm run test
E2E:        npm run test:e2e
```
Signup locally: set `SIGNUP_MODE=open` in `.env.local`.

## 10. Testing strategy

| Level | What |
|---|---|
| Vitest (pure) | `deriveSetupProgress` (each step done/skipped/open), slug generation & collision, `setup-return` cookie sign/verify/expiry/allow-list, `connector-availability` for every env combination, signup Zod + rate-limit logic. |
| Migration tests (existing pattern) | M2 idempotency, double-call, expired/consumed pending row, slug collision, subscription created, RLS: agency A cannot read/write agency B's `agency_onboarding_state`, non-admin cannot write. |
| Playwright e2e | Golden path: signup → confirm → `/setup` → skip everything → dashboard. Connector-unavailable state. Resume after leaving mid-step. Non-admin cannot open `/setup`. |
| Manual (per workflow §5) | Real invite email on a real Supabase project (D1), each connector round-trip returns to `/setup`, mobile width, keyboard-only pass. |

## 11. Boundaries

- **Always:** RLS with every table; `requireUser()` first in every action; Zod at boundaries; agency-scope every query; reuse existing settings actions instead of duplicating; tick nothing that is not merged.
- **Ask first:** trial length/plan; adding a bot-check provider or new dependency; changing Supabase email templates; changing seed pricing semantics.
- **Never:** provision before email confirmation; block the dashboard on setup; expose tokens/app IDs to agencies; store "done" state that can be derived; edit existing migrations (add new ones).

## 12. Tasks (vertical slices, one PR each)

**Slice 1 — `onboarding-entry`** (~5 files + 2 migrations)
- [ ] Task: M3 migration (expiry, lower-case email unique, country) + M2 `provision_agency_from_signup`
  - Acceptance: double call returns same agency; slug collision resolved; expired row rejected.
  - Verify: migration tests; `npm run test`.
- [ ] Task: Rewire `onboarding/page.tsx` to M2 with a recoverable error state
  - Acceptance: retry after failure works; no duplicate agency on refresh.
  - Verify: Vitest + manual double-tab.
- [ ] Task: `(main)/layout.tsx` no-membership → `/onboarding`
  - Acceptance: an invited signup owner who lands on `/dashboard` is routed to provisioning.
  - Verify: e2e.
- [ ] Task: Signup hardening (exact email, rate limit, resend link) + login-page entry link
  - Acceptance: 4th attempt/hour is refused with clear copy; link visible when `SIGNUP_MODE=open`.
  - Verify: unit + manual.

**Slice 2 — `onboarding-defaults`** (1 migration + tests)
- [ ] Task: Trial `agency_subscriptions` inside M2; locale params + neutral add-on seeds (M4)
  - Acceptance: new agency has an entitlement; UK agency has GBP/Europe/London defaults and no LKR add-on prices.
  - Verify: migration tests; `resolveEntitlements` returns non-null.

**Slice 3 — `setup-shell`** (M1 + ~6 files)
- [ ] Task: M1 table + RLS + `setup-access` + `deriveSetupProgress` (+ tests)
- [ ] Task: `(setup)` layout, page, step rail, frame, skip/resume actions
  - Acceptance: skip persists across reload; jump between steps; non-admin redirected.
- [ ] Task: Dashboard `SetupGuideCard` replaces commented checklist; dismiss + Settings re-entry
  - Verify: browser golden path + empty/denied/error states.

**Slice 4 — `setup-connectors`**
- [ ] Task: Extract `connector-availability`; refactor integrations page to use it (no behaviour change)
- [ ] Task: `setup-return` cookie + callback updates for WhatsApp, Messenger, Instagram, Meta Ads, Google Ads
  - Acceptance: connect from setup returns to `/setup?step=channels`; connect from Settings still returns to Settings.
- [ ] Task: `ConnectorSetupCard` (five states) + SMTP inline form with test email
  - Verify: each state rendered; unavailable connector shows no button.

**Slice 5 — `setup-essentials-steps`**
- [ ] Task: Password step; Agency basics step (browser-detected defaults, sets `basics_confirmed_at`)
- [ ] Task: Team invite step (seat-limit aware); Payments step; First-package step
  - Verify: each reuses the existing action; values appear in the normal Settings screens.

**Slice 6 — `onboarding-observability`**
- [ ] Task: Funnel events (step viewed/completed/skipped, connector started/succeeded/failed); operator progress column; alert on signup rate spikes
- [ ] Task: Docs — update `app/(auth)/README.md`, `docs/README.md` index, security checklist run; runbook for verifying the invite template (D1)

Per-slice gate: `npm run lint`, `npm run typecheck`, `npm run test` all pass; golden path and edge
cases exercised in the browser before the PR.

## 13. Risks and open questions

**Risks**
- Meta limits onboarding to ~10 customers per rolling 7 days until business verification. Setup must tolerate WhatsApp failing for that reason: show the real reason and a "try again later" path, never block.
- Connector platform credentials are per deployment; a deployment missing them must degrade to "not available".
- Email deliverability of the invite is the single point of failure for signup. Resend and a support contact must be visible.
- `hasRecentRecoveryAuth` allows password setting only within 15 minutes of the link. An owner who opens the link and returns later gets a fresh-link prompt; the copy must explain that.

**Open questions (need your decision)**
1. Trial: which plan and how long (proposal: STARTER, 14 days)? What happens at expiry: read-only, or prompt to upgrade?
2. Bot protection for signup: add Cloudflare Turnstile (new dependency), or rate limits only?
3. Add-on seed prices: neutral zero prices with a "set your prices" step, or a per-currency price table?
4. Should the owner's password be **mandatory** (step 1) or may they rely on email links only?
5. Is open signup intended for production, or stay operator-invited with this UX behind `SIGNUP_MODE`?
6. Do you want the first-package step to be a quick-create form or a link to the existing Packages flow?

## 14. Verification before implementation starts
- [ ] This spec reviewed and approved.
- [ ] Open questions 1–5 answered.
- [ ] D1 confirmed or ruled out on a real Supabase project.
