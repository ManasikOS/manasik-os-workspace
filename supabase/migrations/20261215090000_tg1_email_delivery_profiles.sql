create table public.agency_email_delivery_profiles (
  agency_id uuid primary key references public.agencies(id) on delete cascade,
  provider_code text not null check (provider_code in ('HOSTINGER', 'GOOGLE_WORKSPACE', 'MICROSOFT_365', 'GENERIC')),
  sender_domain text not null,
  smtp_check_code text not null default 'NOT_CONFIGURED',
  imap_check_code text not null default 'NOT_CONFIGURED',
  smtp_checked_at timestamptz,
  imap_checked_at timestamptz,
  updated_at timestamptz not null default now(),
  check (smtp_check_code in ('PASS', 'AUTH_FAILED', 'CONNECTION_FAILED', 'TEST_SEND_FAILED', 'NOT_CONFIGURED')),
  check (imap_check_code in ('PASS', 'AUTH_FAILED', 'CONNECTION_FAILED', 'TEST_SEND_FAILED', 'NOT_CONFIGURED'))
);
create index agency_email_delivery_profiles_agency_idx on public.agency_email_delivery_profiles (agency_id);
alter table public.agency_email_delivery_profiles enable row level security;
revoke all on public.agency_email_delivery_profiles from anon;
grant select, insert, update on public.agency_email_delivery_profiles to authenticated;
create policy "staff manage own email delivery profile" on public.agency_email_delivery_profiles for all to authenticated using (agency_id = public.current_agency_id()) with check (agency_id = public.current_agency_id());
