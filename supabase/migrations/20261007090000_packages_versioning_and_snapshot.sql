-- Packages Phase 2 (part 1) — real version history, and a group snapshot
-- that actually freezes what the pilgrim bought.
--
-- See docs/modules/packages-production-readiness-plan.md, Phase 2 items 1, 4 and 9.
--
-- Deliberately scoped narrower than Phase 2's original item 1/2 write-up:
-- this ships a real, append-only `package_versions` history — written
-- automatically on every successful publish — and uses it to make template
-- comparison (item 9) actually compare against something that doesn't
-- silently change out from under it. It does NOT implement item 2's
-- "editing a published package edits a separate working copy, with a
-- has_unpublished_changes banner" — that changes the runtime behaviour of
-- every edit path (draft autosave, patch autosave, the wizard) in ways
-- that need a live database to verify are correct, not a blind migration.
-- Publishing today still edits `packages` directly, exactly as before this
-- migration; the only new thing is that publishing now ALSO durably
-- records what was published, and when.

-- ─────────────────────────────────────────────────────────────────────────────
-- A. package_versions — append-only history, one row per publish.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.package_versions (
  id                 uuid primary key default gen_random_uuid(),
  package_id         uuid not null references public.packages (id) on delete cascade,
  agency_id          uuid not null default public.current_agency_id()
                       references public.agencies (id),
  version_number     integer not null check (version_number > 0),
  -- A full copy of the `packages` row's content at the moment it was
  -- published (`to_jsonb`, computed application-side from the exact row
  -- just written — see `package_versions_create()`'s comment for why this
  -- is a plain jsonb blob rather than a hand-picked column list). Never
  -- updated after insert.
  snapshot           jsonb not null,
  published_at       timestamptz not null default now(),
  published_by       uuid references auth.users (id) on delete set null,
  published_by_name  text not null default 'Staff',
  unique (package_id, version_number)
);

comment on table public.package_versions is
  'Append-only publish history for a package template. One row per successful publish, holding a full jsonb copy of what was published. Written by package_versions_create(), never updated. See docs/modules/packages-production-readiness-plan.md, Phase 2 item 1.';

create index if not exists package_versions_package_idx
  on public.package_versions (package_id, version_number desc);
create index if not exists package_versions_agency_idx
  on public.package_versions (agency_id);

alter table public.package_versions enable row level security;

drop policy if exists "staff read package versions" on public.package_versions;
create policy "staff read package versions" on public.package_versions
  for select to authenticated
  using (
    agency_id = public.current_agency_id()
    and public.staff_role_in('ADMIN', 'CEO', 'OPERATIONS', 'FINANCE', 'MARKETING', 'VISA')
  );

-- No insert/update/delete policy for `authenticated` — every write goes
-- through the SECURITY DEFINER function below.

alter table public.packages
  add column if not exists published_version_id uuid
    references public.package_versions (id) on delete set null;

comment on column public.packages.published_version_id is
  'The most recent package_versions row for this package, or null if it has never been published. Set only by package_versions_create().';

-- ─────────────────────────────────────────────────────────────────────────────
-- B. package_versions_create() — the only way a version is written.
--
-- Locks the `packages` row first so two concurrent publishes of the same
-- package cannot both compute the same next `version_number` and collide
-- on the unique constraint.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.package_versions_create(
  p_package_id uuid,
  p_snapshot jsonb
) returns public.package_versions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agency uuid := public.current_agency_id();
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_next_version integer;
  v_row public.package_versions;
begin
  if public.current_staff_role() not in ('ADMIN', 'OPERATIONS') then
    raise exception 'Your role cannot publish packages.' using errcode = '42501';
  end if;
  if v_agency is null then
    raise exception 'Your session has no active agency.' using errcode = '28000';
  end if;

  perform 1 from public.packages
    where id = p_package_id and agency_id = v_agency
    for update;
  if not found then
    raise exception 'That package no longer exists.' using errcode = 'P0002';
  end if;

  select full_name into v_actor_name from public.staff_profiles where id = v_actor;

  select coalesce(max(version_number), 0) + 1 into v_next_version
    from public.package_versions
    where package_id = p_package_id;

  insert into public.package_versions
    (package_id, agency_id, version_number, snapshot, published_by, published_by_name)
  values
    (p_package_id, v_agency, v_next_version, p_snapshot, v_actor, coalesce(v_actor_name, 'Staff'))
  returning * into v_row;

  update public.packages set published_version_id = v_row.id where id = p_package_id;

  return v_row;
end;
$$;

comment on function public.package_versions_create(uuid, jsonb) is
  'Records one publish as an immutable package_versions row and points packages.published_version_id at it. Called from the application layer after a publish''s content write has already succeeded — this function does not itself validate or write package content, only the version record. See docs/modules/packages-production-readiness-plan.md, Phase 2 item 1.';

revoke all on function public.package_versions_create(uuid, jsonb) from public;
grant execute on function public.package_versions_create(uuid, jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- C. Complete the departure-group snapshot (Phase 2 item 4).
--
-- `departure_group_package_snapshots` already freezes itinerary,
-- inclusions/exclusions, accommodation standards, transport requirements,
-- traveller requirements, readiness requirements and the payment schedule
-- STRUCTURE. It never froze the contractual TERMS a pilgrim actually
-- booked under (cancellation policy, payment terms, late-payment policy,
-- price-change disclaimer), the included-services list, the template's
-- own day/night length, or the traveller-facing seat-reservation rule and
-- communication-template selection — all of which a later template edit
-- could silently change out from under an already-selling group. See
-- finding C5.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.departure_group_package_snapshots
  add column if not exists package_version_id uuid
    references public.package_versions (id) on delete set null,
  add column if not exists policy_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists included_services_snapshot jsonb not null default '[]'::jsonb,
  add column if not exists duration_days_snapshot integer,
  add column if not exists duration_nights_snapshot integer,
  add column if not exists seat_reservation_rule_snapshot text not null default '',
  add column if not exists communication_templates_snapshot jsonb not null default '[]'::jsonb;

comment on column public.departure_group_package_snapshots.package_version_id is
  'The package_versions row this group was actually created from, when the template had been published at least once at creation time. Null for a group created from a template with no publish history yet, or created before this column existed. Template comparison (see the group detail''s "Compare with Package Template" dialog) uses this — comparing against the CURRENT published_version_id, not the live (possibly since-edited) packages row — so the "live" side of that comparison can never show a draft edit nobody has published yet.';
comment on column public.departure_group_package_snapshots.policy_snapshot is
  'Frozen copy of {cancellationPolicy, paymentTerms, latePaymentPolicy, priceChangeDisclaimer} as they stood when this group was created — the contractual terms a pilgrim actually booked under, previously not frozen at all (finding C5).';
comment on column public.departure_group_package_snapshots.included_services_snapshot is
  'Frozen copy of the template''s included_services list at creation time.';
comment on column public.departure_group_package_snapshots.duration_days_snapshot is
  'The TEMPLATE''s own days/nights at creation time — not the group''s real departure/return dates (those live on departure_groups itself), but what the template promised, for comparing against a group whose actual span has since diverged (see the create sheet''s duration-mismatch warning, Phase 2 item 6).';

notify pgrst, 'reload schema';
