-- Packages module v2: list-screen performance + catalogue lifecycle.
--
-- This migration is additive and non-breaking:
--   1. `itinerary_days` lets the list page report itinerary length without
--      selecting the `itinerary` JSONB column for every row.
--   2. `archived_at` / `duplicated_from` support an archive-first lifecycle
--      (see lib/access/packages-access.ts) instead of the previous hard
--      delete being the only terminal state.
--   3. `package_usage` is a view over departure_groups so the packages list
--      can show "N live groups / N seats booked" without a client-side join.
--   4. Trigram indexes back the list page's free-text search.
--
-- Run with `supabase db push` (or your usual migration pipeline) against
-- each environment before the Packages v2 UI ships to it. The application
-- code treats every new column/view as optional so it keeps working against
-- a database this migration has not yet reached.

-- ── 1. Cheap array lengths ───────────────────────────────────────────────────
-- Lets the list screen compute a completeness score and itinerary length
-- straight from scalar columns, without selecting any of the underlying
-- JSONB bodies for every row.
alter table public.packages
  add column if not exists itinerary_days integer
    generated always as (jsonb_array_length(coalesce(itinerary, '[]'::jsonb))) stored,
  add column if not exists payment_milestones_count integer
    generated always as (jsonb_array_length(coalesce(payment_milestones, '[]'::jsonb))) stored,
  add column if not exists transport_requirements_count integer
    generated always as (jsonb_array_length(coalesce(transport_requirements, '[]'::jsonb))) stored,
  add column if not exists inclusions_count integer
    generated always as (jsonb_array_length(coalesce(inclusions, '[]'::jsonb))) stored,
  add column if not exists exclusions_count integer
    generated always as (jsonb_array_length(coalesce(exclusions, '[]'::jsonb))) stored,
  add column if not exists included_services_count integer
    generated always as (jsonb_array_length(coalesce(included_services, '[]'::jsonb))) stored,
  add column if not exists document_requirements_count integer
    generated always as (jsonb_array_length(coalesce(document_requirements, '[]'::jsonb))) stored,
  add column if not exists group_readiness_checklist_count integer
    generated always as (jsonb_array_length(coalesce(group_readiness_checklist, '[]'::jsonb))) stored;

-- ── 2. Archive lifecycle metadata ────────────────────────────────────────────
alter table public.packages
  add column if not exists archived_at     timestamptz,
  add column if not exists duplicated_from uuid references public.packages (id) on delete set null;

create index if not exists packages_duplicated_from_idx
  on public.packages (duplicated_from);

-- ── 3. Catalogue usage — how each package is actually being used ───────────
create or replace view public.package_usage as
  select package_template_id                                   as package_id,
         count(*)                                               as group_count,
         count(*) filter (where archived = false
                            and group_status <> 'CANCELLED')    as live_group_count,
         coalesce(sum(booked_seats), 0)                         as seats_booked,
         coalesce(sum(capacity), 0)                             as seats_capacity
    from public.departure_groups
   where package_template_id is not null
   group by package_template_id;

comment on view public.package_usage is
  'One row per package template with departure-group counts and seat totals. Used by the packages list and detail screens to show operational usage without a client-side join, and by deletePackageAction to refuse deleting a package that groups depend on.';

-- ── 4. Search support ────────────────────────────────────────────────────────
create extension if not exists pg_trgm;

create index if not exists packages_title_trgm_idx
  on public.packages using gin (title gin_trgm_ops);
create index if not exists packages_code_trgm_idx
  on public.packages using gin (internal_code gin_trgm_ops);

create index if not exists packages_season_idx      on public.packages (season);
create index if not exists packages_branch_idx      on public.packages (branch);
create index if not exists packages_cat_status_idx  on public.packages (category, status, updated_at desc);
create index if not exists packages_archived_idx    on public.packages (archived_at)
  where archived_at is not null;
