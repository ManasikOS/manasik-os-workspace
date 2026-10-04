-- Agency self-onboarding, Slice 1 (docs/onboarding/plan.md §7.1 M3).
-- Fixes D6 (wildcard email match), D8 (pending signups never expire) and adds
-- the storage the abuse controls for D7 need. Additive: no existing column or
-- index is dropped or rewritten. Existing agencies are untouched.

-- ─────────────────────────────────────────────────────────────────────────────
-- A. pending_agency_signups
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.pending_agency_signups
  add column if not exists expires_at timestamptz not null default now() + interval '7 days',
  add column if not exists country_code text,
  -- The agency this signup produced. Lets provision_agency_from_signup() answer
  -- a repeat call (second tab, refresh, retry) with the same agency instead of
  -- creating another one.
  add column if not exists agency_id uuid references public.agencies(id) on delete set null;

-- Emails are compared exactly from now on (`=`), never with `ilike`, so `_` and
-- `%` in an address can no longer act as wildcards. That only works if every
-- stored address is already lower-case.
update public.pending_agency_signups set email = lower(email) where email <> lower(email);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'pending_agency_signups_email_lowercase'
      and conrelid = 'public.pending_agency_signups'::regclass
  ) then
    alter table public.pending_agency_signups
      add constraint pending_agency_signups_email_lowercase check (email = lower(email));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'pending_agency_signups_country_code_format'
      and conrelid = 'public.pending_agency_signups'::regclass
  ) then
    alter table public.pending_agency_signups
      add constraint pending_agency_signups_country_code_format
      check (country_code is null or country_code ~ '^[A-Z]{2}$');
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- B. signup_attempts — one row per signup or resend request, for rate limiting.
--    Holds only SHA-256 hashes of the email and network address, never the raw
--    values. Service-role only: the signup form runs before any session exists.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.signup_attempts (
  id          uuid primary key default gen_random_uuid(),
  email_hash  text not null,
  ip_hash     text not null,
  created_at  timestamptz not null default now()
);

comment on table public.signup_attempts is
  'Rate-limit ledger for self-serve signup and resend (docs/onboarding/plan.md D7). Hashed identifiers only. Service-role only; rows older than a day are safe to delete.';

create index if not exists signup_attempts_email_recent
  on public.signup_attempts (email_hash, created_at desc);
create index if not exists signup_attempts_ip_recent
  on public.signup_attempts (ip_hash, created_at desc);

alter table public.signup_attempts enable row level security;
-- No policies on purpose: nothing but the service role may read or write it.
revoke all on public.signup_attempts from public, anon, authenticated;
