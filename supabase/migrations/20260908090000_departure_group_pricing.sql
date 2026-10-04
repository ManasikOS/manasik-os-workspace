-- Departure Group pricing — gives each departure its own, editable price.
--
-- Context: docs/architecture/package-departure-architecture-master-plan.md, Phase 2 (F2/F5).
--
-- Before this migration, a group's selling price lived only inside
-- `departure_group_package_snapshots.pricing_snapshot`, a column that is
-- documented and enforced everywhere else in this schema as an IMMUTABLE
-- audit freeze of the template at sale time. That made "reprice this
-- departure" and "never rewrite the sale-time record" the same column,
-- which is not resolvable — so repricing a single departure independently
-- of the package it was created from, or of any other departure off the
-- same package, was not possible.
--
-- `departure_group_pricing` is the one-row-per-group table that becomes the
-- new source of truth for a group's CURRENT price. The snapshot is
-- untouched and keeps doing its original job: recording what the template
-- said at creation time, for the template-comparison dialog and the audit
-- trail. `price_source` records whether the current price still matches
-- what was copied in, or has since been overridden by an operator.

create table if not exists public.departure_group_pricing (
  departure_group_id     uuid primary key
                            references public.departure_groups (id) on delete cascade,
  agency_id               uuid,

  currency                text    not null default 'LKR',
  quad_price              numeric(14, 2) check (quad_price        is null or quad_price        >= 0),
  triple_price            numeric(14, 2) check (triple_price      is null or triple_price      >= 0),
  double_price            numeric(14, 2) check (double_price      is null or double_price      >= 0),
  single_price            numeric(14, 2) check (single_price      is null or single_price      >= 0),
  child_price             numeric(14, 2) check (child_price       is null or child_price       >= 0),
  infant_price            numeric(14, 2) check (infant_price      is null or infant_price      >= 0),
  early_bird_price        numeric(14, 2) check (early_bird_price  is null or early_bird_price  >= 0),
  early_bird_valid_until  date,
  advance_deposit         numeric(14, 2) check (advance_deposit   is null or advance_deposit   >= 0),
  payment_milestones      jsonb   not null default '[]'::jsonb,

  price_source            text    not null default 'TEMPLATE'
                            check (price_source in ('TEMPLATE', 'OVERRIDDEN')),
  priced_by               uuid references auth.users (id) on delete set null,
  priced_at               timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

comment on table public.departure_group_pricing is
  'Current, editable selling price for one departure group. Seeded from the package template at group creation (price_source = TEMPLATE); flips to OVERRIDDEN on the first manual reprice. Every price read in the departure-groups module should come from here, never from the immutable pricing_snapshot.';

create index if not exists departure_group_pricing_agency_idx
  on public.departure_group_pricing (agency_id);

-- ── updated_at maintenance — reuses the trigger function from the packages migration ──
drop trigger if exists departure_group_pricing_set_updated_at on public.departure_group_pricing;
create trigger departure_group_pricing_set_updated_at
  before update on public.departure_group_pricing
  for each row execute function public.set_updated_at();

-- ── Backfill: one pricing row per existing group, copied from its own snapshot ──
-- Idempotent — `on conflict do nothing` means re-running this migration never
-- clobbers a price an operator has already edited since it first ran.
insert into public.departure_group_pricing (
  departure_group_id, agency_id, currency,
  quad_price, triple_price, double_price, single_price,
  child_price, infant_price, advance_deposit, payment_milestones,
  price_source
)
select
  s.departure_group_id,
  g.agency_id,
  coalesce(s.pricing_snapshot ->> 'currency', 'LKR'),
  (s.pricing_snapshot ->> 'quad_price')::numeric,
  (s.pricing_snapshot ->> 'triple_price')::numeric,
  (s.pricing_snapshot ->> 'double_price')::numeric,
  (s.pricing_snapshot ->> 'single_price')::numeric,
  (s.pricing_snapshot ->> 'child_price')::numeric,
  (s.pricing_snapshot ->> 'infant_price')::numeric,
  (s.pricing_snapshot ->> 'advance_deposit')::numeric,
  coalesce(s.payment_schedule_snapshot, '[]'::jsonb),
  'TEMPLATE'
from public.departure_group_package_snapshots s
join public.departure_groups g on g.id = s.departure_group_id
on conflict (departure_group_id) do nothing;

-- ── Row Level Security — same tenant + staff-write posture as every other
--    departure_group_* table (see 20260809090000, folded through
--    20260824090000's agency_id retrofit).
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.departure_group_pricing enable row level security;

drop policy if exists "staff read departure_group_pricing"  on public.departure_group_pricing;
drop policy if exists "staff write departure_group_pricing" on public.departure_group_pricing;

create policy "staff read departure_group_pricing"
  on public.departure_group_pricing for select
  to authenticated
  using (agency_id = public.current_agency_id());

create policy "staff write departure_group_pricing"
  on public.departure_group_pricing for all
  to authenticated
  using (agency_id = public.current_agency_id())
  with check (agency_id = public.current_agency_id());

notify pgrst, 'reload schema';
