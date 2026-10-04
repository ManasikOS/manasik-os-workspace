-- Phase 1 (P1.3) — Reconciliation: many-to-many allocation, period close,
-- import presets, duplicate flagging. docs/manasik-intelligence-build-
-- roadmap.md §P1.3, plan §4.19.
--
-- Extends 20261101090000_bank_reconciliation.sql, which is explicitly a v1
-- ("one bank line matches exactly one payment... a bulk transfer... is
-- reconciled as several bank lines, not modelled as a many-match here").
-- `reconciliation_matches` stays the one-row-per-bank-line "match header"
-- (its `matched_type`/`matched_id`/`matched_amount`/`matched_label` keep
-- meaning "the first/primary line" for the existing UI); the new
-- `reconciliation_match_lines` table is the actual many-to-many allocation
-- for a split match, with a residual for the amount left over on either
-- side (a bank charge deducted in-transit, or credit with no invoice yet).
--
-- RLS here follows this migration's own stricter, agency-scoped pattern
-- (`agency_id = current_agency_id()` + `staff_role_in(...)`) rather than the
-- older finance-module `using (true)` floor, since it is extending that
-- same migration file's tables.

alter table public.bank_transactions
  add column if not exists duplicate_of_id uuid references public.bank_transactions (id);

create index if not exists bank_transactions_duplicate_idx
  on public.bank_transactions (duplicate_of_id) where duplicate_of_id is not null;

alter table public.reconciliation_matches
  add column if not exists residual_amount numeric(14, 2) not null default 0,
  add column if not exists residual_type text check (residual_type in ('UNALLOCATED_CREDIT', 'BANK_CHARGE')),
  add column if not exists residual_reason text;

-- ── reconciliation_match_lines ──────────────────────────────────────────────
create table if not exists public.reconciliation_match_lines (
  id           uuid primary key default gen_random_uuid(),
  agency_id    uuid not null default public.current_agency_id() references public.agencies (id),
  match_id     uuid not null references public.reconciliation_matches (id) on delete cascade,
  target_type  text not null check (target_type in ('PAYMENT', 'SUPPLIER_PAYMENT')),
  target_id    uuid not null,
  amount       numeric(14, 2) not null check (amount <> 0),
  label        text not null,
  created_at   timestamptz not null default now()
);

comment on table public.reconciliation_match_lines is
  'One allocation line under a reconciliation_matches header — lets one bank transaction settle several payments/invoices (plan §4.19 many-to-many).';

create index if not exists reconciliation_match_lines_match_idx on public.reconciliation_match_lines (match_id);
create index if not exists reconciliation_match_lines_target_idx on public.reconciliation_match_lines (target_type, target_id);

alter table public.reconciliation_match_lines enable row level security;

drop policy if exists "staff read reconciliation_match_lines" on public.reconciliation_match_lines;
create policy "staff read reconciliation_match_lines" on public.reconciliation_match_lines
  for select to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'FINANCE'));

drop policy if exists "staff write reconciliation_match_lines" on public.reconciliation_match_lines;
create policy "staff write reconciliation_match_lines" on public.reconciliation_match_lines
  for all to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'FINANCE'))
  with check (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'FINANCE'));

-- ── reconciliation_periods ───────────────────────────────────────────────────
create table if not exists public.reconciliation_periods (
  id               uuid primary key default gen_random_uuid(),
  agency_id        uuid not null default public.current_agency_id() references public.agencies (id),
  bank_account_label text not null,
  period_from      date not null,
  period_to        date not null,
  opening_balance  numeric(14, 2) not null default 0,
  closing_balance  numeric(14, 2),
  status           text not null default 'OPEN' check (status in ('OPEN', 'IN_REVIEW', 'CLOSED')),
  closed_by_name   text,
  closed_at        timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint reconciliation_periods_unique unique (agency_id, bank_account_label, period_from, period_to)
);

comment on table public.reconciliation_periods is
  'Period close-off per bank account (plan §4.19 gap 4). A CLOSED period locks its bank lines'' matches via enforce_reconciliation_period_lock() below.';

create index if not exists reconciliation_periods_agency_idx on public.reconciliation_periods (agency_id, bank_account_label, period_from desc);

drop trigger if exists reconciliation_periods_set_updated_at on public.reconciliation_periods;
create trigger reconciliation_periods_set_updated_at
  before update on public.reconciliation_periods
  for each row execute function public.set_updated_at();

alter table public.reconciliation_periods enable row level security;

drop policy if exists "staff read reconciliation_periods" on public.reconciliation_periods;
create policy "staff read reconciliation_periods" on public.reconciliation_periods
  for select to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'FINANCE'));

drop policy if exists "staff write reconciliation_periods" on public.reconciliation_periods;
create policy "staff write reconciliation_periods" on public.reconciliation_periods
  for all to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'FINANCE'))
  with check (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'FINANCE'));

-- ── bank_import_presets ──────────────────────────────────────────────────────
-- Column-mapping presets per bank export format. Application UI for
-- configuring these is deferred (plan §4.19 gap 6) — the table exists so a
-- future slice can add the mapping screen without another migration.
create table if not exists public.bank_import_presets (
  id                 uuid primary key default gen_random_uuid(),
  agency_id          uuid not null default public.current_agency_id() references public.agencies (id),
  bank_account_label text not null,
  preset_name        text not null,
  column_mapping     jsonb not null default '{}'::jsonb,
  date_format        text,
  created_at         timestamptz not null default now(),

  constraint bank_import_presets_unique unique (agency_id, bank_account_label, preset_name)
);

alter table public.bank_import_presets enable row level security;

drop policy if exists "staff read bank_import_presets" on public.bank_import_presets;
create policy "staff read bank_import_presets" on public.bank_import_presets
  for select to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'FINANCE'));

drop policy if exists "staff write bank_import_presets" on public.bank_import_presets;
create policy "staff write bank_import_presets" on public.bank_import_presets
  for all to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'FINANCE'))
  with check (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'FINANCE'));

-- ── CLOSED period lock ───────────────────────────────────────────────────────
-- A confirm/undo touches `reconciliation_matches` (insert or delete) — this
-- trigger is the one enforcement point for "CLOSED periods lock matches"
-- (plan §4.19 gap 4), regardless of which repository function fires it.
create or replace function public.enforce_reconciliation_period_lock()
returns trigger
language plpgsql
as $$
declare
  v_row record;
  v_closed boolean;
begin
  v_row := coalesce(new, old);

  select exists (
    select 1
    from public.reconciliation_periods p
    join public.bank_transactions bt on bt.id = v_row.bank_transaction_id
    where p.agency_id = bt.agency_id
      and p.bank_account_label = bt.bank_account_label
      and p.status = 'CLOSED'
      and bt.statement_date between p.period_from and p.period_to
  ) into v_closed;

  if v_closed then
    raise exception 'This bank line falls in a CLOSED reconciliation period — reopen the period first.';
  end if;

  return v_row;
end;
$$;

drop trigger if exists reconciliation_matches_period_lock on public.reconciliation_matches;
create trigger reconciliation_matches_period_lock
  before insert or update or delete on public.reconciliation_matches
  for each row execute function public.enforce_reconciliation_period_lock();
