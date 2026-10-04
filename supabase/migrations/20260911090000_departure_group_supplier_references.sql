-- Supplier references on Departure Groups — links hotel, transport and guide
-- rows to the Supplier Directory instead of leaving them as free text.
--
-- Context: docs/architecture/package-departure-architecture-master-plan.md, Phase 4 (F7).
--
-- `departure_group_accommodations.supplier_name` and
-- `departure_group_transports.supplier_name` have always been plain text —
-- there was no way to ask "how many departures does this hotel actually
-- serve" or "what does this transport supplier's rate history look like"
-- without a client-side string match against a directory that itself already
-- exists (`public.suppliers`, `20260817090000_supplier_directory.sql`). This
-- adds nullable FKs alongside the text columns; the text stays as the
-- printable snapshot (a supplier's name can change, or the row can name a
-- supplier not yet in the directory), the FK is what lets reporting and
-- supplier-performance screens join back to the real record.
--
-- `primary_guide_supplier_id` covers the case a template's
-- `suggested_guide_ratio` exists to plan for: a guide sourced from an
-- external `GUIDE_PARTNER` supplier rather than an internal staff member
-- (`departure_groups.primary_guide_id` already covers the staff case).

alter table public.departure_group_accommodations
  add column if not exists supplier_id uuid references public.suppliers (id) on delete set null;

alter table public.departure_group_transports
  add column if not exists supplier_id uuid references public.suppliers (id) on delete set null;

alter table public.departure_groups
  add column if not exists primary_guide_supplier_id uuid references public.suppliers (id) on delete set null;

comment on column public.departure_group_accommodations.supplier_id is
  'FK into public.suppliers. supplier_name stays the printable snapshot — a supplier''s name can change, or this can name a supplier not yet in the directory.';
comment on column public.departure_group_transports.supplier_id is
  'FK into public.suppliers. supplier_name stays the printable snapshot, same rule as departure_group_accommodations.supplier_id.';
comment on column public.departure_groups.primary_guide_supplier_id is
  'FK into public.suppliers, for a guide sourced externally (a GUIDE_PARTNER supplier) rather than an internal staff member (see primary_guide_id).';

create index if not exists departure_group_accommodations_supplier_idx
  on public.departure_group_accommodations (supplier_id);
create index if not exists departure_group_transports_supplier_idx
  on public.departure_group_transports (supplier_id);
create index if not exists departure_groups_guide_supplier_idx
  on public.departure_groups (primary_guide_supplier_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Supplier performance — how many departures each supplier is actually
-- booked on, and the value of their confirmed bookings. Mirrors the shape of
-- public.package_usage (20260812090000_packages_module_v2.sql): a view over
-- the departure-group tables, not a table of its own, so it can never drift
-- from the bookings it summarizes.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace view public.supplier_departure_usage as
select
  s.id                                                           as supplier_id,
  count(distinct a.departure_group_id)
    filter (where a.id is not null)                               as accommodation_group_count,
  count(distinct t.departure_group_id)
    filter (where t.id is not null)                               as transport_group_count,
  count(distinct g.id)
    filter (where g.id is not null)                               as guide_group_count,
  coalesce(sum(a.internal_cost) filter (where a.status in ('REQUESTED', 'CONFIRMED')), 0)
    + coalesce(sum(t.internal_cost) filter (where t.status in ('REQUESTED', 'CONFIRMED')), 0)
                                                                   as total_committed_cost
from public.suppliers s
left join public.departure_group_accommodations a on a.supplier_id = s.id
left join public.departure_group_transports t on t.supplier_id = s.id
left join public.departure_groups g
  on g.primary_guide_supplier_id = s.id and g.archived = false
group by s.id;

comment on view public.supplier_departure_usage is
  'Per-supplier count of departure groups they are booked on (hotel, transport, or guide) and the value of their committed (requested/confirmed) cost. Used by the Suppliers module to show real usage instead of a name match.';

notify pgrst, 'reload schema';
