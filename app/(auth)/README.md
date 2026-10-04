# Authentication

Supabase auth wired through Server Actions, with Zod validating every input in
the browser *and* again on the server.

## Files

| File | Role |
| --- | --- |
| `app/(auth)/actions.ts` | Server Actions: sign in, magic link, reset request, password update, link confirmation, sign out |
| `lib/validations/auth.ts` | Zod schemas + the shared form-state shape |
| `app/auth/confirm/page.tsx` | Click-to-confirm landing page for every email link (`token_hash` or PKCE `code`) — see "Click-to-confirm" below |
| `app/auth/confirm/components/confirm-link-card.tsx` | The actual confirm button; calls `confirmAuthLinkAction` on click |
| `app/auth/callback/route.ts` | PKCE callback for OAuth / stock templates — not on any of this app's 3 email flows today (no OAuth provider is wired up); left as a route handler |
| `proxy.ts` | Refreshes the session on every request and guards routes |
| `lib/dal.ts` | `getUser()` / `requireUser()` for Server Components and Actions |
| `lib/auth-cookie.ts` | Name of the "keep me signed in" marker cookie |
| `app/(auth)/onboarding/page.tsx` | Where a confirmed self-serve signup is provisioned (once, atomically) |
| `lib/onboarding/*` | Provisioning call, signup rate limit, no-agency routing, spike detection |

## Flows

**Password sign in** — `login-form.tsx` → `signInAction` → `/dashboard` (or the
`next` path the proxy remembered).

**Magic link** — "Continue with a secure email link" validates the email in the
form, calls `sendMagicLinkAction`, then shows `secure-email-dialog.tsx`.
`shouldCreateUser: false`, so links are only sent to existing staff accounts;
an unknown address still reports success so the form cannot be used to discover
who has an account. The emailed link lands on `/auth/confirm`; the person
clicks **Confirm and sign in** there, which lands on `/dashboard`.

**Password reset** — "Forgot Password ?" opens `forgot-password-dialog.tsx` →
`sendPasswordResetAction`. The emailed link lands on `/auth/confirm`; the
person clicks **Confirm and continue** there, which creates a recovery session
and lands on `/login?mode=reset`; that renders `reset-password-dialog.tsx`,
which calls `updatePasswordAction` and continues to the dashboard.

**Team invitation** — an Admin invites someone from `/management/team`
(`inviteStaff()` in `lib/data/team-repository.ts`, via
`admin.auth.admin.inviteUserByEmail()`). The emailed link, like every other
Supabase auth email in this app, lands on `/auth/confirm`; the person clicks
**Confirm and continue** there, which verifies the invite, creates a session,
and lands on `/login?mode=setup`; that renders `reset-password-dialog.tsx` in
its "setup" copy, which calls the same `updatePasswordAction` reset uses and
continues to the dashboard. See `docs/modules/team-module-remediation-plan.md` B1 for
why the link must go through `/auth/confirm` rather than a bare `redirectTo`.

**Self-serve agency signup** — gated by `SIGNUP_MODE=open` (default
`invite_only`); the login page shows "Create your agency workspace" only when it
is open. `/signup` → `signupAction` validates with `signupSchema`, is rate
limited (3 requests per email and 10 per network address per hour, kept as
hashes in `signup_attempts`), stages the agency name, owner name and optional
country in `pending_agency_signups` (email matched exactly, valid for 7 days),
and sends the same Supabase *invite* email a team invitation uses. It never
calls `signUp()`, so public sign-ups stay disabled. "Send the link again" on the
confirmation screen calls `resendSignupLinkAction`.

The owner confirms the email and lands on `/onboarding`, which is the only place
an agency is created: `provisionAgencyForSignup()` calls the
`provision_agency_from_signup` Postgres function, which locks the staged row,
creates the agency (unique slug, locale-aware defaults, 14-day `STARTER` trial)
and marks the row consumed in one transaction. A refresh, a second tab or a
retry returns the same agency. Expired, unknown and failed cases render a screen
with a way forward. Provisioning then continues to `/setup` (the guided setup;
see `docs/onboarding/plan.md`).

Because the Invite template sends the link to `/login?mode=setup`, a signup owner
can arrive on the dashboard before provisioning has run. `app/(main)/layout.tsx`
therefore sends any signed-in user with no agency to `/onboarding`
(`needsAgencyProvisioning()`), so this works whichever template is configured.
Verify on a real project with
`docs/runbooks/onboarding-invite-template-verification.md`.

**Keep me signed in** — when unticked, `signInAction` and `proxy.ts` strip
`maxAge`/`expires` from the Supabase cookies, so the session ends when the
browser closes. The choice is remembered in the `rf.remember` cookie.

## Click-to-confirm

`/auth/confirm` does **not** verify anything on page load — it only reads the
link's params and renders a card with a **Confirm** button
(`confirm-link-card.tsx`). Verification (`verifyOtp` / `exchangeCodeForSession`)
happens only inside `confirmAuthLinkAction`, called from that button's click.

This exists because every Supabase auth token is single-use, and a plain GET
landing route (what `/auth/confirm` used to be) can be silently triggered by
something other than the person the email was sent to: Gmail's phishing
scanner, Outlook Safe Links, and most corporate mail-security gateways
automatically fetch links found in incoming email to check them for safety.
If that GET itself verifies the token, the scanner burns it before the real
person ever clicks — they open the email, click the button, and land on
"this link has expired," despite the link never having been used by them.
Gating verification behind an actual button click closes this: an automated
prefetch can still GET `/auth/confirm`, but that no longer does anything, so
the token survives until a real person clicks the real button.

**This protection only takes effect if the email template points directly at
`/auth/confirm` with `{{ .TokenHash }}`** (§3 below) — that is now a
requirement, not an optional nicety. The stock `{{ .ConfirmationURL }}`
template sends the link to Supabase's own `/auth/v1/verify` endpoint first,
which performs the actual verification itself before this app is ever
involved; no code on this side can protect a link that never reaches it.
`/auth/confirm` still accepts the `code` shape that stock templates send on a
project configured for the PKCE flow (backward compatible), but a link in
that shape can still be burned by a scanner hitting Supabase directly,
upstream of this app.

**A third shape exists too, and it is the one to watch for**: the stock
template on a project configured for the **implicit** Auth Flow Type (rather
than PKCE) redirects a successful verification back here as
`#access_token=...&refresh_token=...` in the URL **fragment**, not a query
param — a Server Component can never see this (fragments never reach the
server). `confirm-link-card.tsx` checks `window.location.hash` for this case
client-side and, if found, calls `setSession()` on the *browser* Supabase
client directly instead of `confirmAuthLinkAction`. This makes the current
configuration work end to end, but it is strictly worse than the token-hash
path: by the time this app's code runs, Supabase's own server has *already*
verified the token, so a scanner that reaches the email link first still
burns it exactly as before — switching the templates (§3) is still the fix,
not this fallback.

1. **Environment** — `.env.local` needs `NEXT_PUBLIC_SUPABASE_URL` and
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. In production also set
   `NEXT_PUBLIC_SITE_URL=https://your-domain` so email links point at the right
   host (locally the request headers are used).
2. **URL configuration** → *Authentication → URL Configuration*: set the Site
   URL and add these to *Redirect URLs*:
   - `http://localhost:3000/auth/confirm`
   - `http://localhost:3000/auth/callback`
   - the same two paths on your production domain.
3. **Email templates — required** → *Authentication → Email Templates*. Every
   stock template uses `{{ .ConfirmationURL }}`, which points at Supabase's own
   `/auth/v1/verify` and is vulnerable to being silently consumed by an email
   client's link-safety scanner before the real person clicks (see
   "Click-to-confirm" above). Replace `{{ .ConfirmationURL }}` in **each** of
   the three templates below with the token-hash form, which points directly
   at this app's `/auth/confirm` and gets the click-to-confirm protection:

   **Magic Link**
   ```
   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=magiclink&next=%2Fdashboard
   ```

   **Reset Password**
   ```
   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=%2Flogin%3Fmode%3Dreset
   ```

   **Invite user**
   ```
   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next=%2Flogin%3Fmode%3Dsetup
   ```

   The stock templates still *work* — `/auth/confirm` accepts the PKCE `code`
   they send, and the invited person still lands on `/login?mode=setup`
   because `inviteStaff()` passes that as `redirectTo` — but a link sent that
   way is verified at Supabase's server before this app is ever involved, so
   it keeps the original prefetch-consumes-the-token exposure. Do this step
   before relying on invitations or password resets in any environment real
   people use.
4. **Sign-ups** — accounts are meant to be created by an administrator, so
   disable public sign-ups under *Authentication → Sign In / Providers* and
   invite staff instead.

## Signing out

`signOutAction` is ready to use from any client component:

```tsx
import { signOutAction } from "@/app/(auth)/actions";

<form action={signOutAction}>
  <Button type="submit">Sign out</Button>
</form>;
```

## Protecting data

`proxy.ts` is an optimistic gate only. Anything that reads or writes agency data
should verify the session next to the data:

```tsx
import { requireUser } from "@/lib/dal";

export default async function Page() {
  const user = await requireUser();
  // ...
}
```
