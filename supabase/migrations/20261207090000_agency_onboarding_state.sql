-- Agency self-onboarding, Slice 3 (docs/onboarding/plan.md §7.1 M1).
--
-- Stores only what cannot be derived: which steps the owner skipped, that they
-- confirmed their basics / set a password, and whether they dismissed the guide.
-- Whether WhatsApp is connected, a package exists or a teammate was invited is
-- read live from the real tables, so the guide cannot drift from reality.
--
-- Rows are created lazily by the setup actions (an absent row means "nothing
-- skipped or dismissed yet"), so no change to provisioning is needed.

create table if not exists public.agency_onboarding_state (
  agency_id           uuid primary key references public.agencies(id) on delete cascade,
  steps               jsonb not null default '{}'::jsonb,
  basics_confirmed_at timestamptz,
  password_set_at     timestamptz,
  guide_dismissed_at  timestamptz,
  last_step           text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table public.agency_onboarding_state is
  'Non-derivable setup-guide state per agency: skipped steps, confirmations, dismissal. Everything else about setup progress is read live (docs/onboarding/plan.md M1).';

alter table public.agency_onboarding_state enable row level security;

revoke all on public.agency_onboarding_state from public, anon;
grant select, insert, update on public.agency_onboarding_state to authenticated;

-- Any member of the agency may read its state (the dashboard card resolves it).
create policy agency_onboarding_state_select on public.agency_onboarding_state
  for select to authenticated
  using (agency_id = (select public.current_agency_id()));

-- Only the agency's ADMIN may create or change it.
create policy agency_onboarding_state_insert on public.agency_onboarding_state
  for insert to authenticated
  with check (
    agency_id = (select public.current_agency_id())
    and (select public.current_staff_role()) = 'ADMIN'
  );

create policy agency_onboarding_state_update on public.agency_onboarding_state
  for update to authenticated
  using (
    agency_id = (select public.current_agency_id())
    and (select public.current_staff_role()) = 'ADMIN'
  )
  with check (
    agency_id = (select public.current_agency_id())
    and (select public.current_staff_role()) = 'ADMIN'
  );

drop trigger if exists agency_onboarding_state_set_updated_at on public.agency_onboarding_state;
create trigger agency_onboarding_state_set_updated_at
  before update on public.agency_onboarding_state
  for each row execute function public.set_updated_at();
