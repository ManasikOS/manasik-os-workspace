-- Departure Group costing — per-departure cost estimate and a margin view.
--
-- Context: docs/architecture/package-departure-architecture-master-plan.md, Phase 4 (F6).
--
-- `packages.finance_estimate` is a per-pilgrim cost MODEL on the template —
-- useful for pricing a new program, useless for knowing whether a specific,
-- dated departure actually makes money. Two things the template's number can
-- never answer: fixed costs (a coach, a guide, ground handling) do not shrink
-- when the group is smaller, so every empty seat raises the real per-pilgrim
-- cost of those lines; and actual supplier cost (what accommodation and
-- transport were really booked at) can and does differ from the estimate.
--
-- `departure_group_cost_estimates` is the group's own, editable cost sheet —
-- seeded from the template's per-pilgrim estimate at creation, plus a
-- `fixed_cost_per_departure` line the template has no equivalent of yet.
-- `departure_group_costing` is a read-only view that turns that sheet, the
-- group's live price and seat count, and the ACTUAL supplier costs already on
-- `departure_group_accommodations` / `departure_group_transports` into the
-- numbers Finance actually asks for: cost per pilgrim, break-even headcount,
-- and current margin.

-- ─────────────────────────────────────────────────────────────────────────────
-- A. departure_group_cost_estimates
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.departure_group_cost_estimates (
  departure_group_id                 uuid primary key
                                        references public.departure_groups (id) on delete cascade,
  agency_id                           uuid,

  flight_cost_per_pilgrim             numeric(14, 2) check (flight_cost_per_pilgrim             is null or flight_cost_per_pilgrim             >= 0),
  accommodation_cost_per_pilgrim      numeric(14, 2) check (accommodation_cost_per_pilgrim      is null or accommodation_cost_per_pilgrim      >= 0),
  transport_cost_per_pilgrim          numeric(14, 2) check (transport_cost_per_pilgrim          is null or transport_cost_per_pilgrim          >= 0),
  visa_insurance_cost_per_pilgrim     numeric(14, 2) check (visa_insurance_cost_per_pilgrim     is null or visa_insurance_cost_per_pilgrim     >= 0),
  catering_cost_per_pilgrim           numeric(14, 2) check (catering_cost_per_pilgrim           is null or catering_cost_per_pilgrim           >= 0),
  guide_operations_cost_per_pilgrim   numeric(14, 2) check (guide_operations_cost_per_pilgrim   is null or guide_operations_cost_per_pilgrim   >= 0),
  contingency_cost_per_pilgrim        numeric(14, 2) check (contingency_cost_per_pilgrim        is null or contingency_cost_per_pilgrim        >= 0),

  -- Costs that do NOT scale with headcount: a coach, a guide's fee, ground
  -- handling. The template has no equivalent field yet — this starts at 0
  -- and is a group-level, Finance-entered figure.
  fixed_cost_per_departure            numeric(14, 2) not null default 0
                                        check (fixed_cost_per_departure >= 0),

  updated_at                          timestamptz not null default now(),
  updated_by                          uuid references auth.users (id) on delete set null
);

comment on table public.departure_group_cost_estimates is
  'Per-departure cost sheet: per-pilgrim lines seeded from packages.finance_estimate, plus a fixed-cost-per-departure line the template has no equivalent of. Source for the departure_group_costing view.';

create index if not exists departure_group_cost_estimates_agency_idx
  on public.departure_group_cost_estimates (agency_id);

drop trigger if exists departure_group_cost_estimates_set_updated_at on public.departure_group_cost_estimates;
create trigger departure_group_cost_estimates_set_updated_at
  before update on public.departure_group_cost_estimates
  for each row execute function public.set_updated_at();

-- Backfill one row per existing group from its package template's finance
-- estimate. Idempotent.
insert into public.departure_group_cost_estimates (
  departure_group_id, agency_id,
  flight_cost_per_pilgrim, accommodation_cost_per_pilgrim, transport_cost_per_pilgrim,
  visa_insurance_cost_per_pilgrim, catering_cost_per_pilgrim,
  guide_operations_cost_per_pilgrim, contingency_cost_per_pilgrim
)
select
  g.id,
  g.agency_id,
  nullif(p.finance_estimate ->> 'flightCostPerPilgrim', '')::numeric,
  nullif(p.finance_estimate ->> 'accommodationCostPerPilgrim', '')::numeric,
  nullif(p.finance_estimate ->> 'transportCostPerPilgrim', '')::numeric,
  nullif(p.finance_estimate ->> 'visaInsuranceCostPerPilgrim', '')::numeric,
  nullif(p.finance_estimate ->> 'cateringCostPerPilgrim', '')::numeric,
  nullif(p.finance_estimate ->> 'guideOperationsCostPerPilgrim', '')::numeric,
  nullif(p.finance_estimate ->> 'contingencyCostPerPilgrim', '')::numeric
from public.departure_groups g
left join public.packages p on p.id = g.package_template_id
on conflict (departure_group_id) do nothing;

alter table public.departure_group_cost_estimates enable row level security;

drop policy if exists "staff read departure_group_cost_estimates"  on public.departure_group_cost_estimates;
drop policy if exists "staff write departure_group_cost_estimates" on public.departure_group_cost_estimates;

create policy "staff read departure_group_cost_estimates"
  on public.departure_group_cost_estimates for select
  to authenticated
  using (agency_id = public.current_agency_id());

create policy "staff write departure_group_cost_estimates"
  on public.departure_group_cost_estimates for all
  to authenticated
  using (agency_id = public.current_agency_id())
  with check (agency_id = public.current_agency_id());

-- ─────────────────────────────────────────────────────────────────────────────
-- B. departure_group_costing — the derived margin view
--
-- "Confirmed pax" (the divisor for actual cost) is booked + held seats on
-- non-cancelled bookings — the same population the group's own seat columns
-- already count, so this never disagrees with the Overview tab's seat KPI.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace view public.departure_group_costing as
select
  g.id as departure_group_id,
  g.agency_id,

  coalesce(pr.quad_price, 0) as list_price,
  greatest(g.booked_seats + g.held_seats, 0) as confirmed_pax,

  coalesce(ce.flight_cost_per_pilgrim, 0)
    + coalesce(ce.accommodation_cost_per_pilgrim, 0)
    + coalesce(ce.transport_cost_per_pilgrim, 0)
    + coalesce(ce.visa_insurance_cost_per_pilgrim, 0)
    + coalesce(ce.catering_cost_per_pilgrim, 0)
    + coalesce(ce.guide_operations_cost_per_pilgrim, 0)
    + coalesce(ce.contingency_cost_per_pilgrim, 0) as estimated_variable_cost_per_pax,

  coalesce(ce.fixed_cost_per_departure, 0) as fixed_cost_per_departure,

  coalesce(a.hotel_cost, 0) + coalesce(t.transport_cost, 0) as actual_supplier_cost,

  -- Break-even headcount: how many seats must sell to cover the fixed cost
  -- at today's price and estimated variable cost. Null (undefined) when the
  -- margin per seat is not positive — no headcount ever breaks even.
  case
    when coalesce(pr.quad_price, 0)
         - (coalesce(ce.flight_cost_per_pilgrim, 0)
            + coalesce(ce.accommodation_cost_per_pilgrim, 0)
            + coalesce(ce.transport_cost_per_pilgrim, 0)
            + coalesce(ce.visa_insurance_cost_per_pilgrim, 0)
            + coalesce(ce.catering_cost_per_pilgrim, 0)
            + coalesce(ce.guide_operations_cost_per_pilgrim, 0)
            + coalesce(ce.contingency_cost_per_pilgrim, 0)) > 0
    then ceil(
      coalesce(ce.fixed_cost_per_departure, 0)
      / (coalesce(pr.quad_price, 0)
         - (coalesce(ce.flight_cost_per_pilgrim, 0)
            + coalesce(ce.accommodation_cost_per_pilgrim, 0)
            + coalesce(ce.transport_cost_per_pilgrim, 0)
            + coalesce(ce.visa_insurance_cost_per_pilgrim, 0)
            + coalesce(ce.catering_cost_per_pilgrim, 0)
            + coalesce(ce.guide_operations_cost_per_pilgrim, 0)
            + coalesce(ce.contingency_cost_per_pilgrim, 0)))
    )
    else null
  end as break_even_headcount,

  -- Estimated margin at the group's CURRENT confirmed headcount, using the
  -- estimated (not actual) variable cost — this is "what we expect", not a
  -- reconciled actual. `actual_supplier_cost` above is separate so a Finance
  -- view can compare the two rather than have them silently blended.
  (coalesce(pr.quad_price, 0) - (
      coalesce(ce.flight_cost_per_pilgrim, 0)
      + coalesce(ce.accommodation_cost_per_pilgrim, 0)
      + coalesce(ce.transport_cost_per_pilgrim, 0)
      + coalesce(ce.visa_insurance_cost_per_pilgrim, 0)
      + coalesce(ce.catering_cost_per_pilgrim, 0)
      + coalesce(ce.guide_operations_cost_per_pilgrim, 0)
      + coalesce(ce.contingency_cost_per_pilgrim, 0)
    )) * greatest(g.booked_seats + g.held_seats, 0)
    - coalesce(ce.fixed_cost_per_departure, 0) as estimated_gross_margin

from public.departure_groups g
left join public.departure_group_pricing pr on pr.departure_group_id = g.id
left join public.departure_group_cost_estimates ce on ce.departure_group_id = g.id
left join lateral (
  select sum(internal_cost) as hotel_cost
  from public.departure_group_accommodations
  where departure_group_id = g.id and status in ('REQUESTED', 'CONFIRMED')
) a on true
left join lateral (
  select sum(internal_cost) as transport_cost
  from public.departure_group_transports
  where departure_group_id = g.id and status in ('REQUESTED', 'CONFIRMED')
) t on true;

comment on view public.departure_group_costing is
  'Per-departure margin: list price, confirmed pax, estimated variable cost/pax, fixed cost/departure, actual supplier cost booked so far, break-even headcount and estimated gross margin at the current confirmed headcount. Finance-only in the application layer — see lib/access/departure-groups-access.ts viewFinance.';

notify pgrst, 'reload schema';
