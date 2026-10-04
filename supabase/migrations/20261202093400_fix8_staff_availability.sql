-- FIX8: individual availability is distinct from agency office hours. A person
-- is eligible for Inbox routing only during a current SHIFT and never during
-- an overlapping LEAVE.
create table public.staff_availability (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  staff_id uuid not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  kind text not null check (kind in ('SHIFT', 'LEAVE')),
  created_by uuid,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  foreign key (staff_id, agency_id) references public.staff_profiles (id, agency_id) on delete cascade,
  foreign key (created_by, agency_id) references public.staff_profiles (id, agency_id) on delete set null (created_by)
);

comment on table public.staff_availability is
  'Agency-scoped staff shifts and leave used by Inbox routing. SHIFT permits routing; an overlapping LEAVE wins.';

create index staff_availability_current_idx
  on public.staff_availability (agency_id, staff_id, starts_at, ends_at);

alter table public.staff_availability enable row level security;

create policy "staff read staff_availability" on public.staff_availability
  for select to authenticated
  using (agency_id = (select public.current_agency_id())
         and (select public.staff_role_in('ADMIN', 'CEO', 'MARKETING', 'OPERATIONS', 'FINANCE', 'VISA')));

create policy "operations manage staff_availability" on public.staff_availability
  for all to authenticated
  using (agency_id = (select public.current_agency_id())
         and (select public.staff_role_in('ADMIN', 'OPERATIONS')))
  with check (agency_id = (select public.current_agency_id())
              and (select public.staff_role_in('ADMIN', 'OPERATIONS')));

notify pgrst, 'reload schema';
