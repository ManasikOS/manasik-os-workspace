-- Package ↔ Departure Group field realignment.
--
-- Context: user request to make packages.actually reusable templates by
-- moving per-departure commercial facts off the template:
--
--   * Room-occupancy pricing (quad/triple/double/single/child/infant,
--     early-bird price + date, advance deposit) — a template's price is not
--     the same thing every departure sells at (see
--     docs/architecture/package-departure-architecture-master-plan.md Phase 2, already
--     wired at the group level via `departure_group_pricing`). Package
--     pricing POLICY (payment milestones, payment terms, cancellation
--     policy, late payment policy, price change disclaimer) stays — those
--     ARE reusable across departures.
--   * The internal finance/cost estimate (`finance_estimate`) and the gross
--     margin check built from it — costing is a per-departure question (see
--     Phase 4, `departure_group_cost_estimates` / `departure_group_costing`)
--     because fixed costs (a coach, a guide) don't scale with headcount.
--   * `season` — a template that is genuinely reusable is not tied to one
--     season; which season a specific run falls in is a fact about the
--     departure, not the program.
--   * Flight routing intent (`departure_origin`, `arrival_gateway`,
--     `return_gateway`, `flights_included`, `outbound_route`,
--     `return_route`, `preferred_airlines`, `routing_preference`,
--     `cabin_class`) — the airport/gateway/airline a departure actually
--     flies is decided per departure, not baked into the template.
--
-- `days` / `nights` / `duration` are KEPT — they move UI position (from the
-- Journey Template step to Package Classification) but stay real,
-- meaningful template columns; a template's length is genuinely reusable.
--
-- Every column below is made OPTIONAL, not dropped — same posture as
-- `20260913090000`'s Bucket-C cleanup: the wizard stops reading/writing
-- them, existing rows keep whatever value they already have (frozen, not
-- reset), and the columns can be dropped later once confirmed unused. This
-- keeps the change reversible and never breaks a package row that already
-- has real data in these fields.

alter table public.packages
  alter column season               drop not null,
  alter column quad_price           drop not null,
  alter column currency             drop not null,
  alter column advance_deposit      drop not null,
  alter column departure_origin     drop not null,
  alter column arrival_gateway      drop not null,
  alter column return_gateway       drop not null,
  alter column outbound_route       drop not null,
  alter column return_route         drop not null,
  alter column routing_preference   drop not null,
  alter column cabin_class          drop not null;

-- (`triple_price`, `double_price`, `single_price`, `child_price`,
-- `infant_price`, `early_bird_price`, `finance_estimate`, `flights_included`,
-- `preferred_airlines` were already nullable/have defaults that make them
-- optional in practice — nothing to alter structurally there. The
-- application layer, not the schema, is what stops collecting them; see
-- `create-package/types.ts` and `create-package/mappers.ts`.)

comment on column public.packages.season is
  'Deprecated — a season is a fact about a departure (see docs/architecture/package-departure-architecture-master-plan.md), not a reusable template. No longer collected by the wizard.';
comment on column public.packages.quad_price is
  'Deprecated — per-departure pricing lives on departure_group_pricing. No longer collected by the wizard.';
comment on column public.packages.finance_estimate is
  'Deprecated — per-departure cost estimate lives on departure_group_cost_estimates. No longer collected by the wizard.';
comment on column public.packages.departure_origin is
  'Deprecated — flight routing is decided per departure, not per template. No longer collected by the wizard.';

notify pgrst, 'reload schema';
