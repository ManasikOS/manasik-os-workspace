# Runbook: verify self-serve signup end to end (defect D1)

**Why this exists.** Self-serve signup sends the owner a Supabase *invite* email. The documented
Invite template (`app/(auth)/README.md` §3) sends the link to `/auth/confirm` with
`next=/login?mode=setup`, while signup asks for `redirectTo: /onboarding`. Which one wins depends on
the project's email template, which no code in this repo can see. Defect D1 in
[`docs/onboarding/plan.md`](../onboarding/plan.md) is "the owner sets a password, lands on the
dashboard with no agency, and provisioning never runs".

The code no longer depends on the answer: `app/(main)/layout.tsx` sends any signed-in user with no agency
to `/onboarding`, which provisions the workspace and continues to `/setup`. **This runbook proves that on
a real project.** Run it before turning `SIGNUP_MODE=open` on anywhere real people can reach.

## Before you start

- A Supabase project with every onboarding migration applied
  (`20261205090000` through `20261208090000`).
- `SIGNUP_MODE=open` and `NEXT_PUBLIC_SITE_URL` set on the deployment you are testing.
- A mailbox you control that is **not** already a user on the project. A `+alias` address works
  (`you+onboard1@yourdomain.com`).
- Access to the Supabase dashboard: *Authentication → Email Templates* and *Authentication → Users*.

## 1. Check the Invite template

1. Supabase dashboard → *Authentication → Email Templates → Invite user*.
2. Confirm the link is exactly the token-hash form, not `{{ .ConfirmationURL }}`:
   ```
   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next=%2Flogin%3Fmode%3Dsetup
   ```
3. Note what you found. Either form is acceptable for the checks below, but the token-hash form is the
   one that survives email link scanners (see `app/(auth)/README.md`, "Click-to-confirm").

## 2. Run the golden path

| # | Do this | Expect |
|---|---|---|
| 1 | Open `/login`. | "New here? Create your agency workspace" is visible. |
| 2 | Follow it, fill in agency name, your name and the test email, submit. | "Check your inbox" screen with a "Send the link again" button. |
| 3 | Open the email, click the link, then **Confirm** on the landing page. | You are signed in. Depending on the template you land on the password screen or straight in the app. |
| 4 | If asked, set a password. | You end up on `/onboarding`, then `/setup`, **not** an empty dashboard. |
| 5 | Look at Supabase *Table Editor*: `agencies`, `agency_members`, `agency_subscriptions`, `pending_agency_signups`. | Exactly one new agency; you are its ADMIN member; a `TRIAL` `STARTER` subscription; the pending row has `consumed_at` and `agency_id` set. |
| 6 | Open `/setup`, skip every step. | Each skip persists after a page reload; you can reach the dashboard at any point. |

**Record the result of step 4.** If you landed on an empty dashboard and were *not* redirected, the
no-membership redirect is not running: stop and treat it as a release blocker.

## 3. Run the failure paths

- **Two tabs.** Repeat step 3, but open `/onboarding` in two tabs at once (or refresh repeatedly).
  Expect one agency, not two.
- **Resend.** On the "Check your inbox" screen click "Send the link again". Expect a new email. If the
  project returns an error instead, note the message: the resend fallback in `sendSignupLink()`
  (`app/(auth)/actions.ts`) is not yet confirmed on a live project.
- **Rate limit.** Submit the signup form four times for the same email within an hour. Expect the
  fourth to be refused with "Too many attempts".
- **Expired link.** In the SQL editor set `expires_at = now() - interval '1 minute'` on an unconsumed
  `pending_agency_signups` row, then open its link. Expect the "That signup link has expired" screen with a
  "Start again" button.
- **Signed in with no signup.** Sign in as a user with no agency and no pending row. Expect "No workspace
  set up yet" (not a redirect loop).

## 4. Clean up

Delete the test agency and its auth user from the Supabase dashboard, and any `pending_agency_signups` and
`signup_attempts` rows created for the test email.

## What to report back

The Invite template shape you found (step 1), the result of step 4, whether resend worked, and anything
that differed from the "Expect" column.
