# Onboarding: security checklist run (Slices 1–6)

**Date:** 2026-09-26 · **Branch:** `building-onboarding` · **Checklist:**
[`docs/security/security-guidelines.md` §10](../security/security-guidelines.md#10-before-merging-a-feature-that-touches-any-of-the-above)

A point-in-time record, not a living spec. It records what was checked against the code and, just as
important, what was **not** checked. Nothing in it was run against a live database.

## Result by checklist item

| Item | Result | Evidence |
|---|---|---|
| New tables have RLS | Pass (code) | `signup_attempts`, `country_locale_defaults`, `agency_onboarding_state`, `onboarding_events` each enable RLS in the migration that creates them. `pending_agency_signups` already had RLS. Migration tests assert this. |
| New actions/handlers call `requireUser()` | Pass, one note | Every setup Server Action calls `requireUser()` then `requireSetupAdmin()`. `signupAction`, `resendSignupLinkAction` are pre-session by design. `/api/setup/connect/[provider]` uses `getSessionUser()` and redirects when signed out rather than calling `requireUser()`; behaviour is equivalent. The cron route checks a bearer secret. |
| Queries are agency-scoped | Pass (code) | Session-client reads rely on RLS. Service-role reads name the agency: the SMTP status read filters `agency_id`; operator loaders use `.in("agency_id", ids)`; `recordOnboardingEvent` takes an explicit agency id. |
| New `security definer` functions | Partly met | `provision_agency` (rewritten) and `provision_agency_from_signup` pin `search_path = public` and `revoke ... from public, anon, authenticated`, granting only `service_role`, so the REST API cannot call them. Neither checks the JWT role *inside* the function (the pattern `20261202092700` uses), so there is no second line of defence if that grant is ever loosened. **Recommended follow-up.** |
| New views use `security_invoker` | N/A | No views added. |
| New input validated with Zod | Pass | `signupSchema`, `setupStepSkipSchema`, `agencyBasicsSchema`, `setupTeamInviteSchema`, `setupPasswordSchema`; the `?step=` query goes through `setupStepViewSchema`; the connector `[provider]` segment is checked against an allow-list. |
| No secret reachable from client code | Pass | `SETUP_RETURN_SECRET` / `META_APP_SECRET` are read only in `lib/setup/setup-return-server.ts`. The WhatsApp app id and config id sent to the page are not secrets (they travel in the OAuth URL). SMTP passwords go through the existing Settings action. Connector status selects list no secret column. |
| Supabase advisors show no new warnings | **Not run** | The migrations are not applied to any project, so `get_advisors` would not see them. Run it after applying. |

## Specific properties from the plan (§7.3)

- **Provision only after email confirmation, only via M2.** Met: the page calls
  `provision_agency_from_signup` after `requireUser()`; no other path calls `provision_agency` for signups.
- **Return cookie signed, 15 minutes, resolves only to `/setup`.** Met and unit-tested (bound to user and
  provider, tamper and expiry cases). The cookie is deleted on every callback.
- **No connector secret in the setup UI.** Met.
- **Funnel events hold no personal data.** Met by construction: closed vocabularies, no free-text or JSON
  column, asserted by a migration test.

## Known residual risks (not fixed)

1. **Rate limit trusts `x-forwarded-for`.** Behind a proxy that does not overwrite it, a caller can rotate
   the header to dodge the per-IP limit. The per-email limit is unaffected.
2. **Rate limit is check-then-insert**, so a burst of parallel requests can slightly exceed the limit.
3. **Signup still reveals when an email already has an account** ("That email already has an account").
   Removing it would make the form less helpful; a decision for the product owner.
4. **Trial expiry is not enforced.** A `TRIAL` subscription is created with `trial_ends_at`, but nothing
   reads it. Plan §13 Q1 is unanswered.
5. **Seat limits are enforced only on the setup invite path**, not the normal Team invite dialog.
6. **The password step can show "not started" for an owner who already set a password** on the
   `/login?mode=setup` screen (invite template), because that path does not record `password_set_at`.
7. **`signup_attempts` and `onboarding_events` have no retention job.**

## Not verified

Everything that needs a running environment: the migrations themselves, RLS behaviour under two agencies,
the OAuth round-trips, email delivery, and the browser flows. See
[`docs/runbooks/onboarding-invite-template-verification.md`](../runbooks/onboarding-invite-template-verification.md).
