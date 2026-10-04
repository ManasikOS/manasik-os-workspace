-- ─────────────────────────────────────────────────────────────────────────────
-- Bank reconciliation (M8 of docs/architecture/remaining-modules-master-plan.md).
--
-- The existing /finance/payments Reconciliation tab
-- (app/(main)/finance/payments/components/tabs/reconciliation-tab.tsx) is
-- explicitly "a view over payments with no counterparty ledger behind it" —
-- exactly the gap the plan's §7 risks table calls out. This migration adds
-- the counterparty ledger: bank statement lines, imported (pasted as CSV —
-- no bank feed integration exists, matching the plan's "Intentionally
-- deferred: live GDS / airline integration" posture for unavailable
-- external connections) and matched against `payments` or
-- `supplier_payments`, one match per bank line.
--
-- `reconciliation_periods` (period close-off) from the plan's M8 is left for
-- a later slice — matching itself is the load-bearing gap; closing a period
-- is a workflow on top of it that can wait until matching is in daily use.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.bank_transactions (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null default public.current_agency_id() references public.agencies (id),

  bank_account_label text not null default 'Main',
  statement_date date not null,
  description text not null,
  reference text,
  -- Positive: money in (a customer's bank transfer). Negative: money out (a
  -- supplier wire). One signed column rather than separate debit/credit
  -- columns, matching how `payments.amount` already signs a reversal.
  amount numeric(14, 2) not null check (amount <> 0),
  currency text not null default 'LKR',

  status text not null default 'UNMATCHED'
    check (status in ('UNMATCHED', 'MATCHED', 'IGNORED')),

  import_batch_id uuid not null default gen_random_uuid(),
  imported_by_name text,
  created_at timestamptz not null default now(),

  -- A re-pasted statement (the same file uploaded twice, or an overlapping
  -- date range) should not double-count — this is the practical dedupe key
  -- for a bank line, short of a bank-supplied unique id.
  constraint bank_transactions_dedupe unique
    (agency_id, bank_account_label, statement_date, amount, description, reference)
);

comment on table public.bank_transactions is
  'One row per bank statement line, imported by paste/CSV (no live bank feed exists). Matched against payments or supplier_payments via reconciliation_matches.';

create index if not exists bank_transactions_agency_status_idx
  on public.bank_transactions (agency_id, status, statement_date desc);

alter table public.bank_transactions enable row level security;

drop policy if exists "staff read bank_transactions" on public.bank_transactions;
create policy "staff read bank_transactions" on public.bank_transactions
  for select to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'FINANCE'));

drop policy if exists "staff write bank_transactions" on public.bank_transactions;
create policy "staff write bank_transactions" on public.bank_transactions
  for all to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'FINANCE'))
  with check (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'FINANCE'));

-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.reconciliation_matches (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null default public.current_agency_id() references public.agencies (id),
  bank_transaction_id uuid not null references public.bank_transactions (id) on delete cascade,

  matched_type text not null check (matched_type in ('PAYMENT', 'SUPPLIER_PAYMENT')),
  -- Not a foreign key: it points at one of two tables depending on
  -- matched_type, which Postgres has no single-column FK for. Application
  -- code resolves it; deleting the underlying payment/supplier_payment is
  -- already effectively prevented (payments has no delete path in this
  -- schema, only reversal).
  matched_id uuid not null,
  matched_amount numeric(14, 2) not null,
  -- A display snapshot ("PMT-2026-00042 · Jane Doe" / "ABC Travels — SC-4"),
  -- taken at match time so the reconciliation screen never needs a dynamic
  -- join across two differently-shaped tables just to label a row.
  matched_label text not null,

  matched_by_name text,
  created_at timestamptz not null default now(),

  -- One bank line matches exactly one payment for v1 — a bank line covering
  -- several payments (a bulk transfer) is reconciled as several bank lines
  -- in practice, not modelled as a many-match here.
  constraint reconciliation_matches_one_per_transaction unique (bank_transaction_id)
);

comment on table public.reconciliation_matches is
  'The confirmed link between one bank_transactions row and the payments/supplier_payments row it settles.';

create index if not exists reconciliation_matches_matched_idx
  on public.reconciliation_matches (matched_type, matched_id);
create index if not exists reconciliation_matches_agency_idx
  on public.reconciliation_matches (agency_id);

alter table public.reconciliation_matches enable row level security;

drop policy if exists "staff read reconciliation_matches" on public.reconciliation_matches;
create policy "staff read reconciliation_matches" on public.reconciliation_matches
  for select to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'FINANCE'));

drop policy if exists "staff write reconciliation_matches" on public.reconciliation_matches;
create policy "staff write reconciliation_matches" on public.reconciliation_matches
  for all to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'FINANCE'))
  with check (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'FINANCE'));
