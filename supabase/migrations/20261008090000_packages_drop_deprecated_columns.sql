-- Packages Phase 3 (part 2) — drop the deprecated/dead columns.
--
-- See docs/modules/packages-production-readiness-plan.md, Phase 3 item 5 (finding
-- B8). This is the second of the two steps that finding calls for: the
-- first ("confirm zero readers") was done by grepping every file under
-- `app/(main)/packages/**`, `lib/data/packages*.ts`,
-- `lib/copilot/sales/**` and every `.from("packages")` call site in the
-- repository for a read of any column below — none were found. The only
-- application code that referenced any of them
-- (`app/(main)/packages/[packageId]/components/tabs/overview-tab.tsx`'s
-- Season field and quad-price display, and `getPackageDetail()`'s
-- `finance_estimate` masking) was already updated in this same pass to
-- stop doing so before this migration was written.
--
-- This is a genuinely irreversible operation — DROP COLUMN discards
-- whatever historical values these columns still held. It is safe here
-- specifically because every one of them was already made optional and
-- explicitly marked deprecated/dead in an EARLIER migration
-- (`20260914090000_package_template_field_realignment.sql` for the
-- per-departure fields moved to `departure_group_pricing` /
-- `departure_group_cost_estimates` / flight-routing intent; the wizard
-- itself for the Bucket-C fields it never collected — see
-- docs/modules/bucket-c-dead-fields-removal-plan.md), giving every environment
-- running this migration weeks of prior notice that these columns were on
-- their way out, not a surprise drop.
--
-- Three groups:
--
--   A. Per-departure commercial facts — pricing and the internal cost
--      estimate moved to `departure_group_pricing` /
--      `departure_group_cost_estimates` at group-creation time; a
--      template's price is not what every departure actually sells at.
--   B. Flight routing intent — which airport/gateway/airline a departure
--      actually flies is decided per departure
--      (`GroupFlightRoutingInput` in lib/data/departure-groups-copy.ts),
--      never baked into the template.
--   C. Bucket-C dead fields — collected nowhere in the create-package
--      wizard, ever; every existing row's value is either the wizard's
--      fixed sample default or an abandoned draft's empty default, never
--      anything a user actually entered.

alter table public.packages
  -- A. Per-departure commercial facts.
  drop column if exists season,
  drop column if exists currency,
  drop column if exists quad_price,
  drop column if exists triple_price,
  drop column if exists double_price,
  drop column if exists single_price,
  drop column if exists child_price,
  drop column if exists infant_price,
  drop column if exists early_bird_price,
  drop column if exists early_bird_valid_until,
  drop column if exists price_valid_until,
  drop column if exists advance_deposit,
  drop column if exists finance_estimate,
  -- B. Flight routing intent.
  drop column if exists departure_origin,
  drop column if exists arrival_gateway,
  drop column if exists return_gateway,
  drop column if exists flights_included,
  drop column if exists outbound_route,
  drop column if exists return_route,
  drop column if exists preferred_airlines,
  drop column if exists routing_preference,
  drop column if exists cabin_class,
  -- C. Bucket-C dead fields — flights.
  drop column if exists flight_type,
  drop column if exists airline,
  drop column if exists departure_airport,
  drop column if exists arrival_airport,
  drop column if exists departure_time,
  drop column if exists arrival_time,
  drop column if exists transit_airport,
  drop column if exists transit_arrival_time,
  drop column if exists transit_departure_time,
  drop column if exists flight_legs,
  drop column if exists flight_routes,
  drop column if exists flight_options,
  -- C. Bucket-C dead fields — accommodation.
  drop column if exists makkah_hotel_rating,
  drop column if exists makkah_distance,
  drop column if exists makkah_exact_notes,
  drop column if exists madinah_hotel_rating,
  drop column if exists madinah_distance,
  drop column if exists madinah_exact_notes;

notify pgrst, 'reload schema';
