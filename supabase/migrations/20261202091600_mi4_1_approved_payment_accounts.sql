-- MI4.1 — rule-based risk detectors (S4). docs/inbox/implementation-plan.md MI4.1.
--
--  1. agency_payment_accounts — the bank accounts the agency has approved to receive money. It is the locked source of truth
--     for BANK_DETAIL_MISMATCH: a bank-account-like number that is not in this list is flagged. Digits only, so "1234 5678" and
--     "12345678" are the same account. Readable by staff of the agency; only ADMIN and FINANCE can add or change one (RLS below).
--     Until an agency lists an account, every account number a customer mentions is unverified — the S0 gate's existing behaviour.
--  2. agency_settings.offer_snapshot_max_age_minutes (default 60) — R1's only time-based knob. It governs how a stored offer is
--     DISPLAYED (the card says "older than N minutes"), never whether a price may be sent: that is decided by change-detection.
--  3. INBOX_RISK — the surface that switches the detectors on, seeded SHADOW and DISABLED for every agency. Enabled in SHADOW the
--     detectors record signals but staff do not see them, so precision can be measured before anyone relies on them.
--
-- Additive and idempotent. RLS in this same migration.

create table if not exists public.agency_payment_accounts (
  id              uuid primary key default gen_random_uuid(),
  agency_id       uuid not null default public.current_agency_id() references public.agencies (id) on delete cascade,
  label           text not null check (char_length(label) between 1 and 120),
  bank_name       text not null default '',
  account_digits  text not null check (account_digits ~ '^[0-9]{6,20}$'),
  active          boolean not null default true,
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  constraint agency_payment_accounts_unique unique (agency_id, account_digits)
);

comment on table public.agency_payment_accounts is
  'Approved bank accounts (digits only). BANK_DETAIL_MISMATCH flags any account number in a customer message that is not listed here.';

alter table public.agency_payment_accounts enable row level security;

drop policy if exists "staff read agency_payment_accounts" on public.agency_payment_accounts;
create policy "staff read agency_payment_accounts" on public.agency_payment_accounts
  for select to authenticated
  using (agency_id = (select public.current_agency_id())
         and (select public.staff_role_in('ADMIN', 'CEO', 'FINANCE', 'MARKETING', 'OPERATIONS')));

drop policy if exists "finance manage agency_payment_accounts" on public.agency_payment_accounts;
create policy "finance manage agency_payment_accounts" on public.agency_payment_accounts
  for all to authenticated
  using (agency_id = (select public.current_agency_id()) and (select public.staff_role_in('ADMIN', 'FINANCE')))
  with check (agency_id = (select public.current_agency_id()) and (select public.staff_role_in('ADMIN', 'FINANCE')));

alter table public.agency_settings
  add column if not exists offer_snapshot_max_age_minutes integer not null default 60
    check (offer_snapshot_max_age_minutes between 1 and 1440);

comment on column public.agency_settings.offer_snapshot_max_age_minutes is
  'How old a stored offer may be before the card says so. Display only (Architecture 16 R1): whether a price may be sent is decided by change-detection on priced_at, never by age.';

insert into public.ai_surface_settings (agency_id, surface, enabled, mode)
select a.id, 'INBOX_RISK', false, 'SHADOW'
from public.agencies a
on conflict (agency_id, surface) do nothing;

notify pgrst, 'reload schema';

-- Rollback (commented — additive migration, not applied automatically):
-- alter table public.agency_settings drop column if exists offer_snapshot_max_age_minutes;
-- drop table if exists public.agency_payment_accounts;
-- delete from public.ai_surface_settings where surface = 'INBOX_RISK';
