-- MI3.3 — the cross-channel identity graph (Architecture §5.5, G5). docs/inbox/implementation-plan.md MI3.3.
--
-- contact_identity_links is one EDGE per "this conversation's contact may be that existing lead's customer". It never
-- merges anything: a link only points an identity at a lead once a person confirms it, and every state change is
-- reversible (UNLINK restores the previous lead) and audited in identity_match_events.
--
-- Deviation from §5.5, on purpose: the edge is (subject identity → candidate LEAD), not (identity ↔ identity). Most leads
-- predate the Inbox and have no contact_identities row at all, so an identity-to-identity edge could not express "this
-- Instagram contact looks like lead LD-2026-0042". candidate_identity_id is kept, nullable, for when the lead has one.
--
--   status  PROPOSED  waiting for a person (the "Possible existing lead found" card)
--           CONFIRMED a person linked it; the subject identity now points at the lead
--           REJECTED  a person said no (or later unlinked); it is never proposed again for this pair
--
-- Only an exact normalized phone/email may link without a person (that path already exists and does not write here).
-- Cross-agency links are impossible at the database: both identity foreign keys carry agency_id, and the lead is checked
-- by a trigger, so a link can only ever join rows of one agency.
-- RLS in this same migration.

create table if not exists public.contact_identity_links (
  id                     uuid primary key default gen_random_uuid(),
  agency_id              uuid not null default public.current_agency_id() references public.agencies (id) on delete cascade,
  subject_identity_id    uuid not null,
  candidate_identity_id  uuid,
  candidate_lead_id      uuid not null references public.leads (id) on delete cascade,
  link_type              text not null default 'SAME_PERSON' check (link_type in ('SAME_PERSON', 'SAME_HOUSEHOLD', 'FAMILY_MEMBER')),
  evidence               jsonb not null default '{}'::jsonb,
  confidence             numeric(3, 2) not null check (confidence >= 0 and confidence <= 1),
  status                 text not null default 'PROPOSED' check (status in ('PROPOSED', 'CONFIRMED', 'REJECTED')),
  proposed_by            text not null default 'SYSTEM' check (proposed_by in ('SYSTEM', 'STAFF')),
  -- The lead the subject identity pointed at before a confirm, so an unlink can put it back exactly.
  previous_lead_id       uuid,
  decided_by             uuid references auth.users (id) on delete set null,
  created_at             timestamptz not null default now(),
  decided_at             timestamptz,
  constraint contact_identity_links_subject_fkey
    foreign key (subject_identity_id, agency_id) references public.contact_identities (id, agency_id) on delete cascade,
  constraint contact_identity_links_candidate_identity_fkey
    foreign key (candidate_identity_id, agency_id) references public.contact_identities (id, agency_id) on delete cascade,
  constraint contact_identity_links_one_per_pair unique (agency_id, subject_identity_id, candidate_lead_id),
  constraint contact_identity_links_decided_consistent check ((status = 'PROPOSED') = (decided_at is null))
);

comment on table public.contact_identity_links is
  'Cross-channel identity edges (Architecture §5.5). PROPOSED until a person decides; REJECTED pairs are never re-proposed; CONFIRMED points the subject identity at the lead without merging any lead record.';

create index if not exists contact_identity_links_subject_idx on public.contact_identity_links (subject_identity_id);
create index if not exists contact_identity_links_candidate_identity_idx on public.contact_identity_links (candidate_identity_id) where candidate_identity_id is not null;
create index if not exists contact_identity_links_agency_status_idx on public.contact_identity_links (agency_id, status);

-- A lead of another agency can never be a candidate.
create or replace function public.contact_identity_links_same_agency()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (select 1 from public.leads l where l.id = new.candidate_lead_id and l.agency_id = new.agency_id) then
    raise exception 'A contact identity link can only point at a lead of the same agency.';
  end if;
  return new;
end;
$$;

drop trigger if exists contact_identity_links_same_agency on public.contact_identity_links;
create trigger contact_identity_links_same_agency
  before insert or update of candidate_lead_id, agency_id on public.contact_identity_links
  for each row execute function public.contact_identity_links_same_agency();

alter table public.contact_identity_links enable row level security;

drop policy if exists "staff read contact_identity_links" on public.contact_identity_links;
create policy "staff read contact_identity_links" on public.contact_identity_links
  for select to authenticated
  using (agency_id = (select public.current_agency_id())
         and (select public.staff_role_in('ADMIN', 'CEO', 'MARKETING', 'OPERATIONS')));

drop policy if exists "inbox staff decide contact_identity_links" on public.contact_identity_links;
create policy "inbox staff decide contact_identity_links" on public.contact_identity_links
  for update to authenticated
  using (agency_id = (select public.current_agency_id()) and (select public.staff_role_in('ADMIN', 'MARKETING', 'OPERATIONS')))
  with check (agency_id = (select public.current_agency_id()) and (select public.staff_role_in('ADMIN', 'MARKETING', 'OPERATIONS')));

-- No insert or delete policy for staff: links are proposed by the server (service role) and are never deleted, only decided.

notify pgrst, 'reload schema';

-- Rollback (commented — not applied automatically):
-- drop table if exists public.contact_identity_links;
-- drop function if exists public.contact_identity_links_same_agency();
