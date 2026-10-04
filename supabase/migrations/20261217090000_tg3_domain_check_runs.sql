create table public.agency_email_domain_check_runs (
  id uuid primary key default gen_random_uuid(), agency_id uuid not null references public.agencies(id) on delete cascade,
  sender_domain text not null, dkim_selector text, spf_state text not null, dkim_state text not null, dmarc_state text not null,
  checked_at timestamptz not null default now(),
  check (spf_state in ('PASS','MISSING','MULTIPLE_SPF','MALFORMED','LOOKUP_FAILED','SELECTOR_MISMATCH')),
  check (dkim_state in ('PASS','MISSING','MULTIPLE_SPF','MALFORMED','LOOKUP_FAILED','SELECTOR_MISMATCH')),
  check (dmarc_state in ('PASS','MISSING','MULTIPLE_SPF','MALFORMED','LOOKUP_FAILED','SELECTOR_MISMATCH'))
);
create index agency_email_domain_check_runs_agency_checked_idx on public.agency_email_domain_check_runs (agency_id, checked_at desc);
alter table public.agency_email_domain_check_runs enable row level security;
revoke all on public.agency_email_domain_check_runs from anon;
grant select, insert on public.agency_email_domain_check_runs to authenticated;
create policy "staff manage own email domain check runs" on public.agency_email_domain_check_runs for all to authenticated using (agency_id = public.current_agency_id()) with check (agency_id = public.current_agency_id());
