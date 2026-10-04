-- Phase 1 (P1.6) — Invoices: immutability, atomic numbering, issued
-- snapshot. docs/modules/manasik-intelligence-build-roadmap.md §P1.6, plan §4.13.

-- ── Atomic per-agency reference numbering ───────────────────────────────────
-- `nextReferenceNumber()` in lib/data/finance-repository.ts used to compute
-- the next number as `(select count(*) ... ) + 1` — two invoices created in
-- the same instant can read the same count before either commits, and both
-- get the same number (the `invoices_number_unique` constraint only turns
-- that race into a 500 for the loser, it doesn't prevent the collision).
-- This table + function make the increment atomic: `for update` locks the
-- one counter row for the duration of the transaction, so a concurrent
-- caller waits rather than reading a stale count.
create table if not exists public.finance_reference_counters (
  agency_id    uuid not null references public.agencies (id),
  kind         text not null,
  prefix       text not null,
  year         integer not null,
  next_number  integer not null default 1,
  updated_at   timestamptz not null default now(),

  primary key (agency_id, kind, prefix, year)
);

alter table public.finance_reference_counters enable row level security;

drop policy if exists finance_reference_counters_select on public.finance_reference_counters;
create policy finance_reference_counters_select on public.finance_reference_counters
  for select to authenticated using (agency_id = public.current_agency_id());

drop policy if exists finance_reference_counters_write on public.finance_reference_counters;
create policy finance_reference_counters_write on public.finance_reference_counters
  for all to authenticated
  using (agency_id = public.current_agency_id())
  with check (agency_id = public.current_agency_id());

create or replace function public.next_finance_reference_number(p_kind text, p_prefix text, p_year integer)
returns text
language plpgsql
as $$
declare
  v_number integer;
  p_agency_id uuid := public.current_agency_id();
begin
  -- A fresh row is inserted already holding "2" as the *next* value to hand
  -- out, so `next_number - 1` (= 1) is correct on both the insert branch and
  -- every later conflict-update branch (which increments first, then the
  -- same `- 1` yields the value this call should use) — one formula, no
  -- special-casing which branch fired.
  insert into public.finance_reference_counters (agency_id, kind, prefix, year, next_number)
  values (p_agency_id, p_kind, p_prefix, p_year, 2)
  on conflict (agency_id, kind, prefix, year) do update
    set next_number = public.finance_reference_counters.next_number + 1,
        updated_at = now()
  returning next_number - 1 into v_number;

  return p_prefix || '-' || p_year || '-' || lpad(v_number::text, 5, '0');
end;
$$;

comment on function public.next_finance_reference_number is
  'Atomic per-(agency, kind, prefix, year) counter — replaces the racy select-count-then-insert lib/data/finance-repository.ts used to do in application code. Called once per invoice/receipt/payment number.';

-- ── Backfill: seed each counter from whatever numbers already exist ────────
-- Without this, the new atomic counter starts every sequence at 1 again and
-- the very next number issued collides with `invoices_number_unique` (or
-- the equivalent constraint on payments/refund_requests) the first time
-- an agency that already has invoices creates a new one.
do $$
declare
  r record;
  v_prefix text;
  v_year integer;
  v_number integer;
begin
  for r in
    select agency_id, 'payments:payment_reference' as kind, payment_reference as ref from public.payments where payment_reference is not null
    union all
    select agency_id, 'payments:receipt_number' as kind, receipt_number as ref from public.payments where receipt_number is not null
    union all
    select agency_id, 'refund_requests:reference' as kind, reference as ref from public.refund_requests where reference is not null
    union all
    select agency_id, 'invoices:invoice_number' as kind, invoice_number as ref from public.invoices where invoice_number is not null
  loop
    if r.ref !~ '^[A-Za-z0-9]+-\d{4}-\d+$' then
      continue;
    end if;
    v_prefix := split_part(r.ref, '-', 1);
    v_year := split_part(r.ref, '-', 2)::integer;
    v_number := split_part(r.ref, '-', 3)::integer;

    insert into public.finance_reference_counters (agency_id, kind, prefix, year, next_number)
    values (r.agency_id, r.kind, v_prefix, v_year, v_number + 1)
    on conflict (agency_id, kind, prefix, year) do update
      set next_number = greatest(public.finance_reference_counters.next_number, v_number + 1);
  end loop;
end $$;

-- ── Invoice lifecycle columns ────────────────────────────────────────────────
alter table public.invoices
  add column if not exists issued_snapshot   jsonb,
  add column if not exists viewed_at         timestamptz,
  add column if not exists void_approved_by  text;

-- ── Immutability after issue (plan §4.13 gap 3) ─────────────────────────────
-- Blocks changing the commercial facts of an invoice once it has left
-- DRAFT — status/issued_at/sent_*/void_*/viewed_at transitions stay
-- allowed (those ARE the lifecycle), only amount/currency/party/type/due
-- date are frozen. The DRAFT -> ISSUED transition itself is exempt (OLD.
-- status is still 'DRAFT' at that moment), which is exactly when
-- `issued_snapshot` gets written.
create or replace function public.enforce_invoice_immutability()
returns trigger
language plpgsql
as $$
begin
  if old.status <> 'DRAFT' and (
    new.amount is distinct from old.amount
    or new.currency is distinct from old.currency
    or new.party_name is distinct from old.party_name
    or new.invoice_type is distinct from old.invoice_type
    or new.due_at is distinct from old.due_at
    or new.booking_id is distinct from old.booking_id
    or new.supplier_commitment_id is distinct from old.supplier_commitment_id
  ) then
    raise exception 'Invoice % is no longer DRAFT — its commercial fields are immutable. Use a credit note instead.', old.invoice_number;
  end if;
  return new;
end;
$$;

drop trigger if exists invoices_immutability on public.invoices;
create trigger invoices_immutability
  before update on public.invoices
  for each row execute function public.enforce_invoice_immutability();

-- Line items are only ever written once, at creation (no code path updates
-- them) — this trigger makes that a DB-enforced guarantee, not just a
-- convention, once the parent invoice has left DRAFT.
create or replace function public.enforce_invoice_line_items_immutability()
returns trigger
language plpgsql
as $$
declare
  v_status text;
begin
  select status into v_status from public.invoices where id = coalesce(new.invoice_id, old.invoice_id);
  if v_status is not null and v_status <> 'DRAFT' then
    raise exception 'This invoice is no longer DRAFT — its line items are immutable.';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists invoice_line_items_immutability on public.invoice_line_items;
create trigger invoice_line_items_immutability
  before update or delete on public.invoice_line_items
  for each row execute function public.enforce_invoice_line_items_immutability();

-- `i.*` was expanded into a fixed column list when the view was first
-- created. Since the invoice columns changed, CREATE OR REPLACE cannot
-- preserve the old view's column names/order. Drop and recreate it while
-- retaining the RLS-aware security_invoker option.
drop view if exists public.finance_invoice_rows;
create view public.finance_invoice_rows
  with (security_invoker = true)
as
select
  i.*,
  b.booking_reference,
  g.group_name,
  g.group_code,
  sc.reference_code as supplier_commitment_reference
from public.invoices i
left join public.departure_group_bookings b on b.id = i.booking_id
left join public.departure_groups g on g.id = i.departure_group_id
left join public.supplier_commitments sc on sc.id = i.supplier_commitment_id;
