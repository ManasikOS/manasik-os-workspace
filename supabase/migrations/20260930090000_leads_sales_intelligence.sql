-- Manasik Sales Intelligence Engine — storage for the Lead Drawer's
-- "Manasik Decision" workflows (see lib/copilot/sales/).
--
-- Only human-approved facts are stored. Offer matches, strategies, alerts and
-- Ask Manasik answers are recomputed on demand from live Package / Departure
-- Group data, so they can never go stale and never need a backfill:
--
--   * lead_copilot_context      — the staff-approved TravelIntent and the
--                                 offer staff explicitly selected (snapshot).
--   * lead_copilot_dismissals   — which cross-system alert a staff member
--                                 dismissed. Keyed by a fingerprint of the
--                                 underlying facts, so a genuinely new finding
--                                 can surface again.
--   * lead_communication_drafts — customer reply drafts. Never sent from here.
--   * lead_quotes (extended)    — quote drafts with status, discount and a
--                                 staged payment plan. A quote never creates a
--                                 booking, holds seats or changes lead stage.
--
-- Tenancy follows 20260824090000_tenancy.sql: agency_id defaults to
-- current_agency_id() and every policy is scoped to it.

-- ── A. Approved travel intent + selected offer ─────────────────────────────
create table if not exists public.lead_copilot_context (
  lead_id             uuid primary key references public.leads (id) on delete cascade,
  agency_id           uuid not null default public.current_agency_id() references public.agencies (id),
  travel_intent       jsonb,
  intent_source       text check (intent_source is null or intent_source in ('RULES', 'LLM')),
  intent_applied_at   timestamptz,
  selected_offer      jsonb,
  selected_offer_at   timestamptz,
  updated_by_name     text not null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists lead_copilot_context_agency_idx on public.lead_copilot_context (agency_id);

-- ── B. Dismissed alerts ─────────────────────────────────────────────────────
create table if not exists public.lead_copilot_dismissals (
  id                  uuid primary key default gen_random_uuid(),
  agency_id           uuid not null default public.current_agency_id() references public.agencies (id),
  lead_id             uuid not null references public.leads (id) on delete cascade,
  suggestion_type     text not null check (suggestion_type in (
                        'DATE_MISMATCH', 'CAPACITY_MISMATCH', 'ROOM_MISMATCH',
                        'BUDGET_MISMATCH', 'BETTER_GROUP_MATCH')),
  fingerprint         text not null,
  dismissed_by_name   text not null,
  dismissed_at        timestamptz not null default now(),
  unique (lead_id, fingerprint)
);

create index if not exists lead_copilot_dismissals_lead_idx on public.lead_copilot_dismissals (lead_id);

-- ── C. Customer communication drafts ────────────────────────────────────────
create table if not exists public.lead_communication_drafts (
  id                  uuid primary key default gen_random_uuid(),
  agency_id           uuid not null default public.current_agency_id() references public.agencies (id),
  lead_id             uuid not null references public.leads (id) on delete cascade,
  purpose             text not null,
  tone                text not null,
  language            text not null check (language in ('EN', 'SI', 'TA')),
  body                text not null,
  offer_id            text,
  status              text not null default 'DRAFT' check (status in ('DRAFT')),
  created_by_name     text not null,
  created_by_user_id  uuid,
  created_at          timestamptz not null default now()
);

create index if not exists lead_communication_drafts_lead_idx
  on public.lead_communication_drafts (lead_id, created_at desc);

-- ── D. Quote drafts on the existing lead_quotes table ───────────────────────
-- Money moves from whole-rupee bigint to the numeric(14,2) every other money
-- column uses, so a discounted or child-priced total is never truncated.
alter table public.lead_quotes
  alter column total_lkr   type numeric(14, 2) using total_lkr::numeric(14, 2),
  alter column deposit_lkr type numeric(14, 2) using deposit_lkr::numeric(14, 2);

alter table public.lead_quotes
  add column if not exists status             text not null default 'SENT',
  add column if not exists occupancy_type     text,
  add column if not exists infants            integer not null default 0,
  add column if not exists price_per_person   numeric(14, 2),
  add column if not exists discount_amount    numeric(14, 2) not null default 0,
  add column if not exists discount_reason    text,
  add column if not exists payment_milestones jsonb not null default '[]'::jsonb,
  add column if not exists inclusions         jsonb not null default '[]'::jsonb,
  add column if not exists exclusions         jsonb not null default '[]'::jsonb,
  add column if not exists created_by_user_id uuid;

alter table public.lead_quotes drop constraint if exists lead_quotes_status_check;
alter table public.lead_quotes add constraint lead_quotes_status_check
  check (status in ('DRAFT', 'PENDING_APPROVAL', 'SENT', 'EXPIRED', 'ACCEPTED', 'DECLINED'));

alter table public.lead_quotes drop constraint if exists lead_quotes_occupancy_type_check;
alter table public.lead_quotes add constraint lead_quotes_occupancy_type_check
  check (occupancy_type is null or occupancy_type in ('QUAD', 'TRIPLE', 'DOUBLE', 'SINGLE'));

alter table public.lead_quotes drop constraint if exists lead_quotes_infants_check;
alter table public.lead_quotes add constraint lead_quotes_infants_check check (infants >= 0);

-- ── E. Row Level Security — tenant-scoped, same posture as the leads tables ─
alter table public.lead_copilot_context      enable row level security;
alter table public.lead_copilot_dismissals   enable row level security;
alter table public.lead_communication_drafts enable row level security;

do $$
declare
  tbl text;
begin
  foreach tbl in array array['lead_copilot_context', 'lead_copilot_dismissals', 'lead_communication_drafts']
  loop
    execute format('drop policy if exists "staff read %s"  on public.%I', tbl, tbl);
    execute format('drop policy if exists "staff write %s" on public.%I', tbl, tbl);
    execute format(
      'create policy "staff read %s" on public.%I for select to authenticated using (agency_id = public.current_agency_id())',
      tbl, tbl);
    execute format(
      'create policy "staff write %s" on public.%I for all to authenticated using (agency_id = public.current_agency_id()) with check (agency_id = public.current_agency_id())',
      tbl, tbl);
  end loop;
end $$;

drop trigger if exists lead_copilot_context_set_updated_at on public.lead_copilot_context;
create trigger lead_copilot_context_set_updated_at
  before update on public.lead_copilot_context
  for each row execute function public.set_updated_at();

notify pgrst, 'reload schema';
