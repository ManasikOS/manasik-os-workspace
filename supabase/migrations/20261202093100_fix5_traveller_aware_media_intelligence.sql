-- FIX5 keeps model-extracted document values separate from the booking's
-- canonical traveller data. A staff member may select a traveller from the
-- bounded booking list, but this analysis never writes a pilgrim or payment.
create unique index if not exists departure_group_pilgrims_id_agency_unique
  on public.departure_group_pilgrims (id, agency_id);

alter table public.message_media_analyses
  add column if not exists review_fields jsonb not null default '{}'::jsonb,
  add column if not exists candidate_traveller_ids uuid[] not null default '{}',
  add column if not exists selected_traveller_id uuid;

alter table public.message_media_analyses
  drop constraint if exists message_media_analyses_selected_traveller_agency_fk,
  add constraint message_media_analyses_selected_traveller_agency_fk
    foreign key (selected_traveller_id, agency_id)
    references public.departure_group_pilgrims (id, agency_id);

create index if not exists message_media_analyses_selected_traveller_idx
  on public.message_media_analyses (agency_id, selected_traveller_id)
  where selected_traveller_id is not null;
