-- Multi-tenancy Phase 5 — self-serve signup's database piece. See
-- docs/architecture/multi-tenancy-implementation-plan.md Phase 5 (F4 end-to-end).
--
-- Design note: the app never calls `supabase.auth.signUp()`. This project's
-- Supabase Auth has public sign-ups disabled at the project level (see
-- app/(auth)/README.md §4 — "accounts are meant to be created by an
-- administrator"), which this migration cannot see or change from SQL, and
-- toggling it would also open the door to unrelated self-signup outside
-- this flow. Self-serve signup instead reuses the one account-creation
-- mechanism that already works regardless of that project setting —
-- `admin.auth.admin.inviteUserByEmail()`, the same call `inviteStaff()` and
-- `provisionAgencyAction()` already make — with the desired agency name
-- staged here until the email is confirmed. Provisioning only ever runs
-- after that confirmation, per D6.
--
-- Safe on a database with 20260808…20260830 applied.

create table if not exists public.pending_agency_signups (
  id                uuid primary key default gen_random_uuid(),
  email             text not null,
  agency_name       text not null,
  owner_full_name   text not null,
  created_at        timestamptz not null default now(),
  consumed_at       timestamptz
);

comment on table public.pending_agency_signups is
  'Staged self-serve signup: the agency name and owner name a visitor typed in, held until their invite email is confirmed. app/(auth)/onboarding/page.tsx consumes exactly one row per confirmed session, then calls provision_agency(). Service-role only — see RLS below.';

-- Only one open (unconsumed) signup per email — a second attempt with the
-- same address updates the pending name/owner rather than piling up rows.
create unique index if not exists pending_agency_signups_email_unique
  on public.pending_agency_signups (lower(email)) where consumed_at is null;

alter table public.pending_agency_signups enable row level security;
-- No policies for `authenticated` — the signup form runs before a session
-- exists (service-role writes it), and onboarding/page.tsx reads it with
-- the service-role client too, matched against the now-authenticated
-- user's own email. There is no legitimate reason for any signed-in
-- session to read another pending signup's row.
