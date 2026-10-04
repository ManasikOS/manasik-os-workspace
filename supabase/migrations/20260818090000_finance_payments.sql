-- Finance: Payments & Invoices — the agency's finance control center.
--
-- Bookings define what customers owe. Payments record what they paid.
-- Invoices request payment. Departure Groups only see whether payment status
-- creates travel risk.
--
-- `departure_group_bookings` stays the debtor (total_booking_value,
-- amount_paid, outstanding_balance) — this migration does not touch those
-- columns or their only writer, `recordBookingPaymentInStore()`. It adds the
-- transaction layer underneath: a real payment record, a booking-grain
-- milestone schedule, invoices, and the read views the Finance page renders.
--
-- Additive only. Safe on a database with 20260808090000 … 20260817090000
-- applied. See docs/modules/payments-invoices-module-implementation-plan.md for the
-- findings (F1–F13) and decisions (D1–D10) this migration answers.

-- ─────────────────────────────────────────────────────────────────────────────
-- A. booking_payment_milestones — the schedule, at booking grain (plan F2).
--
--    pilgrim_payment_milestones stays and becomes a projection (plan D2):
--    it is per-traveller and keeps the Pilgrim profile's Payments tab
--    working unchanged. This table is the one Finance and the Departure
--    Group Payments tab read from.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.booking_payment_milestones (
  id                    uuid primary key default gen_random_uuid(),
  booking_id            uuid not null references public.departure_group_bookings (id) on delete cascade,
  departure_group_id    uuid not null references public.departure_groups (id) on delete cascade,
  sequence              integer not null default 0,
  label                 text not null,
  milestone_type        text not null default 'INSTALMENT'
                          check (milestone_type in ('DEPOSIT','INSTALMENT','FINAL_BALANCE','ADJUSTMENT','OTHER')),
  amount                numeric(14, 2) not null default 0 check (amount >= 0),
  due_at                timestamptz,
  -- Maintained by the trigger in section C from payment_allocations; never
  -- written directly by application code.
  paid_amount           numeric(14, 2) not null default 0 check (paid_amount >= 0),
  paid_at               timestamptz,
  -- A due-date change requires a reason (spec: "Change due dates with an
  -- audit reason"); the previous value is retained rather than overwritten.
  due_at_changed_at     timestamptz,
  due_at_previous       timestamptz,
  due_at_change_reason  text,
  waived                boolean not null default false,
  note                  text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint booking_payment_milestones_seq unique (booking_id, sequence)
);

create index if not exists booking_milestones_booking_idx on public.booking_payment_milestones (booking_id, sequence);
create index if not exists booking_milestones_due_idx     on public.booking_payment_milestones (due_at)
  where paid_amount < amount and not waived;
create index if not exists booking_milestones_group_idx   on public.booking_payment_milestones (departure_group_id);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists booking_milestones_set_updated_at on public.booking_payment_milestones;
create trigger booking_milestones_set_updated_at
  before update on public.booking_payment_milestones
  for each row execute function public.set_updated_at();

alter table public.booking_payment_milestones enable row level security;

drop policy if exists booking_milestones_select on public.booking_payment_milestones;
create policy booking_milestones_select on public.booking_payment_milestones
  for select to authenticated using (true);

drop policy if exists booking_milestones_write on public.booking_payment_milestones;
create policy booking_milestones_write on public.booking_payment_milestones
  for all to authenticated using (true) with check (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- Backfill: every existing booking gets a real schedule.
--
-- Expands `departure_group_package_snapshots.payment_schedule_snapshot`
-- exactly as `seedPilgrimPaymentMilestones()` already does for new bookings
-- (lib/data/departure-groups.ts), but at booking grain rather than divided
-- per traveller. A group with no schedule — or a schedule with only
-- percentage amounts, which cannot be resolved without the template — falls
-- back to one FINAL_BALANCE milestone for the whole booking value, so no
-- booking is left without a schedule (plan F3).
--
-- amount_paid is then allocated across the new milestones oldest-due-first,
-- mirroring `allocatePaymentToMilestonesInStore()` (lib/data/pilgrims.ts),
-- so a booking that has already collected money does not appear unpaid.
-- Idempotent: `unique (booking_id, sequence)` makes a second run a no-op.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  bk record;
  item jsonb;
  seq integer;
  remaining_to_allocate numeric(14, 2);
  applied numeric(14, 2);
  mrow record;
  fixed_total numeric(14, 2);
begin
  for bk in
    select b.id as booking_id, b.departure_group_id, b.total_booking_value, b.amount_paid, b.next_due_at
    from public.departure_group_bookings b
    where not exists (
      select 1 from public.booking_payment_milestones m where m.booking_id = b.id
    )
  loop
    seq := 0;

    select coalesce(sum((elem ->> 'amount')::numeric), 0)
      into fixed_total
      from public.departure_group_package_snapshots s,
           lateral jsonb_array_elements(coalesce(s.payment_schedule_snapshot, '[]'::jsonb)) as elem
      where s.departure_group_id = bk.departure_group_id
        and coalesce(elem ->> 'amount_type', 'Fixed') <> 'Percentage'
        and (elem ->> 'amount') is not null;

    if fixed_total > 0 then
      for item in
        select value from public.departure_group_package_snapshots s,
             lateral jsonb_array_elements(coalesce(s.payment_schedule_snapshot, '[]'::jsonb)) as value
        where s.departure_group_id = bk.departure_group_id
        order by (value ->> 'due_date') nulls last
      loop
        if coalesce(item ->> 'amount_type', 'Fixed') = 'Percentage' or (item ->> 'amount') is null then
          continue;
        end if;
        seq := seq + 1;
        insert into public.booking_payment_milestones
          (booking_id, departure_group_id, sequence, label, milestone_type, amount, due_at)
        values (
          bk.booking_id,
          bk.departure_group_id,
          seq,
          coalesce(nullif(item ->> 'label', ''), 'Instalment ' || seq),
          case
            when seq = 1 then 'DEPOSIT'
            when (item ->> 'label') ilike '%final%' then 'FINAL_BALANCE'
            else 'INSTALMENT'
          end,
          (item ->> 'amount')::numeric,
          nullif(item ->> 'due_date', '')::timestamptz
        );
      end loop;
    else
      insert into public.booking_payment_milestones
        (booking_id, departure_group_id, sequence, label, milestone_type, amount, due_at)
      values (bk.booking_id, bk.departure_group_id, 1, 'Full Balance', 'FINAL_BALANCE', bk.total_booking_value, bk.next_due_at);
    end if;

    -- Allocate whatever has already been collected, oldest-due-first.
    remaining_to_allocate := bk.amount_paid;
    if remaining_to_allocate > 0 then
      for mrow in
        select id, amount from public.booking_payment_milestones
        where booking_id = bk.booking_id
        order by due_at nulls last, sequence
      loop
        exit when remaining_to_allocate <= 0;
        applied := least(remaining_to_allocate, mrow.amount);
        update public.booking_payment_milestones
          set paid_amount = applied
          where id = mrow.id;
        remaining_to_allocate := remaining_to_allocate - applied;
      end loop;
    end if;
  end loop;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- B. payments — the immutable transaction ledger (plan F1).
--
--    Never updated after insert except the verification columns (verified_at
--    / verified_by / verified_by_name) and receipt columns on issue. A
--    correction is a new row naming `reverses_payment_id`, never a delete or
--    an amount edit — enforced by the repository, the only writer.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.payments (
  id                    uuid primary key default gen_random_uuid(),
  payment_reference     text not null,
  booking_id            uuid not null references public.departure_group_bookings (id) on delete restrict,
  departure_group_id    uuid not null references public.departure_groups (id) on delete restrict,
  amount                numeric(14, 2) not null check (amount <> 0),
  currency              text not null default 'LKR',
  paid_at               timestamptz not null,
  method                text not null
                          check (method in ('CASH','BANK_TRANSFER','CARD','ONLINE','CHEQUE','OTHER')),
  reference_number      text,
  proof_path            text,
  status                text not null default 'COMPLETED'
                          check (status in ('COMPLETED','PENDING_VERIFICATION','FAILED',
                                            'REVERSED','REFUNDED','VOIDED')),
  verified_at           timestamptz,
  verified_by           uuid references auth.users (id) on delete set null,
  verified_by_name      text,
  reverses_payment_id   uuid references public.payments (id) on delete restrict,
  reversal_reason       text,
  receipt_number        text,
  receipt_issued_at     timestamptz,
  internal_note         text,
  recorded_by           uuid references auth.users (id) on delete set null,
  recorded_by_name      text not null default 'Staff',
  created_at            timestamptz not null default now(),

  constraint payments_reference_unique unique (payment_reference),
  constraint payments_receipt_unique   unique (receipt_number),
  constraint payments_reversal_shape check (
    (reverses_payment_id is null and amount > 0)
    or (reverses_payment_id is not null and amount < 0 and reversal_reason is not null)
  )
);

create index if not exists payments_booking_idx  on public.payments (booking_id, paid_at desc);
create index if not exists payments_group_idx    on public.payments (departure_group_id, paid_at desc);
create index if not exists payments_paid_at_idx  on public.payments (paid_at desc);
create index if not exists payments_status_idx   on public.payments (status) where status <> 'COMPLETED';

alter table public.payments enable row level security;

drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments
  for select to authenticated using (true);

drop policy if exists payments_write on public.payments;
create policy payments_write on public.payments
  for all to authenticated using (true) with check (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- C. payment_allocations — which milestone(s) a payment settles.
--
--    An unallocated payment is legal: sum(allocations) < payment.amount
--    surfaces in the ledger as "Unallocated" rather than being refused at
--    entry. The trigger keeps booking_payment_milestones.paid_amount equal
--    to the sum of COMPLETED allocations — same shape as
--    sync_supplier_commitment_amount_paid, and it touches only the milestone
--    table, never departure_group_bookings (plan F13).
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.payment_allocations (
  id            uuid primary key default gen_random_uuid(),
  payment_id    uuid not null references public.payments (id) on delete cascade,
  milestone_id  uuid not null references public.booking_payment_milestones (id) on delete cascade,
  amount        numeric(14, 2) not null check (amount <> 0),
  created_at    timestamptz not null default now(),

  unique (payment_id, milestone_id)
);
create index if not exists payment_allocations_milestone_idx on public.payment_allocations (milestone_id);
create index if not exists payment_allocations_payment_idx   on public.payment_allocations (payment_id);

alter table public.payment_allocations enable row level security;

drop policy if exists payment_allocations_select on public.payment_allocations;
create policy payment_allocations_select on public.payment_allocations
  for select to authenticated using (true);

drop policy if exists payment_allocations_write on public.payment_allocations;
create policy payment_allocations_write on public.payment_allocations
  for all to authenticated using (true) with check (true);

create or replace function public.sync_milestone_paid_amount()
returns trigger language plpgsql as $$
declare
  affected_milestone uuid := coalesce(new.milestone_id, old.milestone_id);
begin
  update public.booking_payment_milestones
    set paid_amount = coalesce((
      select sum(a.amount)
      from public.payment_allocations a
      join public.payments p on p.id = a.payment_id
      where a.milestone_id = affected_milestone
        and p.status = 'COMPLETED'
    ), 0),
    paid_at = (
      select max(p.paid_at)
      from public.payment_allocations a
      join public.payments p on p.id = a.payment_id
      where a.milestone_id = affected_milestone
        and p.status = 'COMPLETED'
    )
    where id = affected_milestone;
  return null;
end;
$$;

drop trigger if exists payment_allocations_sync_milestone on public.payment_allocations;
create trigger payment_allocations_sync_milestone
  after insert or update or delete on public.payment_allocations
  for each row execute function public.sync_milestone_paid_amount();

-- A payment's status can also change (e.g. verification, reversal) without
-- its allocation rows changing — re-sync affected milestones on that path.
create or replace function public.sync_milestones_for_payment()
returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status then
    update public.booking_payment_milestones m
      set paid_amount = coalesce((
        select sum(a.amount)
        from public.payment_allocations a
        join public.payments p on p.id = a.payment_id
        where a.milestone_id = m.id and p.status = 'COMPLETED'
      ), 0)
      where m.id in (select milestone_id from public.payment_allocations where payment_id = new.id);
  end if;
  return null;
end;
$$;

drop trigger if exists payments_sync_milestones on public.payments;
create trigger payments_sync_milestones
  after update on public.payments
  for each row execute function public.sync_milestones_for_payment();

-- ─────────────────────────────────────────────────────────────────────────────
-- D. invoices — generated from bookings, never disconnected finance records
--    (plan F5). One shared table for customer invoices (booking_id) and
--    supplier bills (supplier_commitment_id) — exactly one party per row.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.invoices (
  id                       uuid primary key default gen_random_uuid(),
  invoice_number           text not null,
  invoice_type             text not null
                             check (invoice_type in ('BOOKING','DEPOSIT','INSTALMENT','FINAL_BALANCE',
                                                     'ADJUSTMENT','REFUND_CREDIT_NOTE','SUPPLIER')),
  booking_id               uuid references public.departure_group_bookings (id) on delete restrict,
  departure_group_id       uuid references public.departure_groups (id) on delete set null,
  supplier_commitment_id   uuid references public.supplier_commitments (id) on delete restrict,
  milestone_id             uuid references public.booking_payment_milestones (id) on delete set null,
  party_name               text not null default '',
  party_contact            text,
  amount                   numeric(14, 2) not null default 0 check (amount >= 0),
  currency                 text not null default 'LKR',
  issued_at                timestamptz,
  due_at                   timestamptz,
  status                   text not null default 'DRAFT'
                             check (status in ('DRAFT','ISSUED','PAID','OVERDUE','VOID')),
  sent_channel             text check (sent_channel is null or sent_channel in ('WHATSAPP','EMAIL','PORTAL','MANUAL')),
  sent_at                  timestamptz,
  void_reason              text,
  voided_at                timestamptz,
  credit_note_of           uuid references public.invoices (id) on delete set null,
  notes                    text,
  created_by               uuid references auth.users (id) on delete set null,
  created_by_name          text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  constraint invoices_number_unique unique (invoice_number),
  constraint invoices_one_party check (
    (booking_id is not null and supplier_commitment_id is null)
    or (booking_id is null and supplier_commitment_id is not null)
  )
);

create index if not exists invoices_booking_idx  on public.invoices (booking_id, issued_at desc);
create index if not exists invoices_status_idx   on public.invoices (status, due_at);
create index if not exists invoices_supplier_idx on public.invoices (supplier_commitment_id)
  where supplier_commitment_id is not null;

drop trigger if exists invoices_set_updated_at on public.invoices;
create trigger invoices_set_updated_at
  before update on public.invoices
  for each row execute function public.set_updated_at();

alter table public.invoices enable row level security;

drop policy if exists invoices_select on public.invoices;
create policy invoices_select on public.invoices
  for select to authenticated using (true);

drop policy if exists invoices_write on public.invoices;
create policy invoices_write on public.invoices
  for all to authenticated using (true) with check (true);

create table if not exists public.invoice_line_items (
  id            uuid primary key default gen_random_uuid(),
  invoice_id    uuid not null references public.invoices (id) on delete cascade,
  sequence      integer not null default 0,
  description   text not null,
  quantity      numeric(10, 2) not null default 1,
  unit_amount   numeric(14, 2) not null default 0,
  line_total    numeric(14, 2) not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists invoice_line_items_invoice_idx on public.invoice_line_items (invoice_id, sequence);

alter table public.invoice_line_items enable row level security;

drop policy if exists invoice_line_items_select on public.invoice_line_items;
create policy invoice_line_items_select on public.invoice_line_items
  for select to authenticated using (true);

drop policy if exists invoice_line_items_write on public.invoice_line_items;
create policy invoice_line_items_write on public.invoice_line_items
  for all to authenticated using (true) with check (true);

-- An invoice is marked PAID once every payment-milestone it is linked to is
-- fully settled. Runs off the same milestone sync path as section C.
create or replace function public.sync_invoice_status_for_milestone()
returns trigger language plpgsql as $$
begin
  update public.invoices
    set status = 'PAID'
    where milestone_id = new.id
      and new.paid_amount >= new.amount
      and status = 'ISSUED';
  return null;
end;
$$;

drop trigger if exists booking_milestones_sync_invoice on public.booking_payment_milestones;
create trigger booking_milestones_sync_invoice
  after update on public.booking_payment_milestones
  for each row execute function public.sync_invoice_status_for_milestone();

-- ─────────────────────────────────────────────────────────────────────────────
-- E. Refunds and adjustments (plan F6, Phase 8). Created now so the schema
--    is complete; the application layer for this section ships later.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.refund_requests (
  id                    uuid primary key default gen_random_uuid(),
  reference             text not null,
  booking_id            uuid not null references public.departure_group_bookings (id) on delete restrict,
  departure_group_id    uuid not null references public.departure_groups (id) on delete restrict,
  reason                text not null
                          check (reason in ('CANCELLATION','OVERPAYMENT','PACKAGE_CHANGE','OTHER')),
  reason_note           text,
  amount                numeric(14, 2) not null check (amount > 0),
  currency              text not null default 'LKR',
  policy_snapshot       text,
  status                text not null default 'PENDING_APPROVAL'
                          check (status in ('PENDING_APPROVAL','APPROVED','REJECTED','PAID','CANCELLED')),
  requested_by          uuid references auth.users (id) on delete set null,
  requested_by_name     text,
  requested_at          timestamptz not null default now(),
  decided_by            uuid references auth.users (id) on delete set null,
  decided_by_name       text,
  decided_at            timestamptz,
  decision_note         text,
  payout_payment_id     uuid references public.payments (id) on delete set null,

  constraint refund_requests_reference_unique unique (reference),
  constraint refund_requests_decision check (
    status in ('PENDING_APPROVAL', 'CANCELLED') or decided_by_name is not null
  )
);
create index if not exists refund_requests_booking_idx on public.refund_requests (booking_id);
create index if not exists refund_requests_status_idx  on public.refund_requests (status);

alter table public.refund_requests enable row level security;

drop policy if exists refund_requests_select on public.refund_requests;
create policy refund_requests_select on public.refund_requests
  for select to authenticated using (true);

drop policy if exists refund_requests_write on public.refund_requests;
create policy refund_requests_write on public.refund_requests
  for all to authenticated using (true) with check (true);

create table if not exists public.finance_adjustments (
  id                  uuid primary key default gen_random_uuid(),
  reference           text not null,
  booking_id          uuid not null references public.departure_group_bookings (id) on delete restrict,
  adjustment_type     text not null
                        check (adjustment_type in ('DISCOUNT','ROOM_UPGRADE_CHARGE','GROUP_TRANSFER',
                                                   'PARTIAL_REFUND','CANCELLATION_FEE','PRICE_CORRECTION',
                                                   'MANUAL_CREDIT')),
  amount              numeric(14, 2) not null check (amount <> 0),
  reason              text not null,
  balance_before      numeric(14, 2) not null,
  balance_after       numeric(14, 2) not null,
  created_by          uuid references auth.users (id) on delete set null,
  created_by_name     text not null default 'Staff',
  approved_by         uuid references auth.users (id) on delete set null,
  approved_by_name    text,
  approved_at         timestamptz,
  created_at          timestamptz not null default now(),

  constraint finance_adjustments_reference_unique unique (reference)
);
create index if not exists finance_adjustments_booking_idx on public.finance_adjustments (booking_id);

alter table public.finance_adjustments enable row level security;

drop policy if exists finance_adjustments_select on public.finance_adjustments;
create policy finance_adjustments_select on public.finance_adjustments
  for select to authenticated using (true);

drop policy if exists finance_adjustments_write on public.finance_adjustments;
create policy finance_adjustments_write on public.finance_adjustments
  for all to authenticated using (true) with check (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- F. finance_activity_events — append-only, mirrors supplier_activity_events.
--    Written alongside departure_group_activity_logs (entity_type PAYMENT),
--    never instead of it, so the group's Activity tab keeps telling the
--    whole story.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.finance_activity_events (
  id                       uuid primary key default gen_random_uuid(),
  booking_id               uuid references public.departure_group_bookings (id) on delete cascade,
  departure_group_id       uuid references public.departure_groups (id) on delete cascade,
  payment_id               uuid references public.payments (id) on delete cascade,
  invoice_id               uuid references public.invoices (id) on delete cascade,
  supplier_commitment_id   uuid references public.supplier_commitments (id) on delete cascade,
  actor_id                 uuid references auth.users (id) on delete set null,
  actor_name               text not null default 'System',
  actor_role               text,
  action                   text not null
                             check (action in ('PAYMENT_RECORDED','PAYMENT_VERIFIED','PAYMENT_REVERSED','PAYMENT_VOIDED',
                                               'RECEIPT_ISSUED','INVOICE_CREATED','INVOICE_ISSUED','INVOICE_SENT',
                                               'INVOICE_VOIDED','CREDIT_NOTE_CREATED','MILESTONE_DUE_DATE_CHANGED',
                                               'ADJUSTMENT_APPLIED','ADJUSTMENT_APPROVED','REFUND_REQUESTED',
                                               'REFUND_APPROVED','REFUND_REJECTED','REFUND_PAID',
                                               'SUPPLIER_PAYMENT_RECORDED','REMINDER_SENT','FINANCE_OWNER_ASSIGNED',
                                               'NOTE_ADDED')),
  from_value               text,
  to_value                 text,
  note                     text,
  is_high_impact           boolean not null default false,
  created_at               timestamptz not null default now()
);
create index if not exists finance_events_booking_idx on public.finance_activity_events (booking_id, created_at desc);
create index if not exists finance_events_created_idx on public.finance_activity_events (created_at desc);

alter table public.finance_activity_events enable row level security;

drop policy if exists finance_activity_events_select on public.finance_activity_events;
create policy finance_activity_events_select on public.finance_activity_events
  for select to authenticated using (true);

drop policy if exists finance_activity_events_insert on public.finance_activity_events;
create policy finance_activity_events_insert on public.finance_activity_events
  for insert to authenticated with check (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- G. Per-booking finance owner (plan F8). Nullable override; the receivables
--    view falls back to the group's finance_owner_name.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.departure_group_bookings
  add column if not exists finance_owner_id   uuid references auth.users (id) on delete set null,
  add column if not exists finance_owner_name text;

create index if not exists bookings_finance_owner_idx on public.departure_group_bookings (finance_owner_name)
  where finance_owner_name is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- H. Deposit threshold — no new column. `Deposit Pending` (plan F4) reads
--    departure_group_package_snapshots.pricing_snapshot->>'advance_deposit',
--    the same field the group Payments tab already renders as
--    "Advance deposit (snapshot)".
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- I. Read shapes — one flattening view per tab, the same shape as
--    pilgrim_journey_rows / visa_application_rows / supplier_directory_rows.
-- ─────────────────────────────────────────────────────────────────────────────

-- One row per live booking: everything the Customer Receivables table needs.
create or replace view public.finance_receivable_rows as
select
  b.id                                                  as booking_id,
  b.booking_reference,
  b.primary_contact_name,
  b.primary_contact_phone,
  b.traveller_count,
  b.booking_status,
  b.total_booking_value,
  b.amount_paid,
  b.outstanding_balance,
  b.next_due_at,
  coalesce(b.finance_owner_name, g.finance_owner_name)  as finance_owner_name,
  g.id                                                  as departure_group_id,
  g.group_name,
  g.group_code,
  g.branch,
  g.departure_date,
  (s.pricing_snapshot ->> 'advance_deposit')::numeric    as advance_deposit,
  coalesce(s.pricing_snapshot ->> 'currency', 'LKR')      as currency,
  m.id                                                  as next_milestone_id,
  m.label                                               as next_milestone_label,
  m.milestone_type                                      as next_milestone_type,
  m.amount                                              as next_milestone_amount,
  m.paid_amount                                         as next_milestone_paid,
  m.due_at                                              as next_milestone_due_at,
  (select count(*) from public.booking_payment_milestones mm
     where mm.booking_id = b.id and not mm.waived
       and mm.paid_amount < mm.amount and mm.due_at < now())            as overdue_milestone_count,
  (select coalesce(sum(mm.amount - mm.paid_amount), 0) from public.booking_payment_milestones mm
     where mm.booking_id = b.id and not mm.waived
       and mm.paid_amount < mm.amount and mm.due_at < now())            as overdue_amount,
  (select count(*) from public.refund_requests r
     where r.booking_id = b.id and r.status in ('PENDING_APPROVAL', 'APPROVED'))  as open_refund_count
from public.departure_group_bookings b
join public.departure_groups g on g.id = b.departure_group_id
left join public.departure_group_package_snapshots s on s.departure_group_id = g.id
left join lateral (
  select mm.* from public.booking_payment_milestones mm
  where mm.booking_id = b.id and not mm.waived and mm.paid_amount < mm.amount
  order by mm.due_at nulls last, mm.sequence
  limit 1
) m on true;

comment on view public.finance_receivable_rows is
  'One row per booking for the Customer Receivables tab. overdue_* and next_milestone_* are milestone-level, never booking.next_due_at (plan F4).';

-- One row per payment for the immutable ledger tab.
create or replace view public.finance_payment_rows as
select
  p.*,
  b.booking_reference,
  b.primary_contact_name,
  g.group_name,
  g.group_code,
  (select string_agg(m.label, ', ' order by m.sequence)
     from public.payment_allocations a
     join public.booking_payment_milestones m on m.id = a.milestone_id
     where a.payment_id = p.id)                                          as allocated_to,
  (select coalesce(sum(a.amount), 0) from public.payment_allocations a where a.payment_id = p.id) as allocated_amount,
  orig.payment_reference                                                 as reverses_payment_reference
from public.payments p
join public.departure_group_bookings b on b.id = p.booking_id
join public.departure_groups g on g.id = p.departure_group_id
left join public.payments orig on orig.id = p.reverses_payment_id;

comment on view public.finance_payment_rows is
  'One row per payment (including reversals as their own rows) for the Payments tab ledger.';

-- One row per invoice for the register.
create or replace view public.finance_invoice_rows as
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

comment on view public.finance_invoice_rows is
  'One row per invoice, customer and supplier, for the Invoices tab.';

-- One row per supplier commitment for the Payables tab — reuses the
-- Suppliers module's own model rather than a second payable table (plan F7).
create or replace view public.finance_supplier_payable_rows as
select
  c.id                as commitment_id,
  c.reference_code,
  c.service_category,
  c.service_label,
  c.booking_reference as service_booking_reference,
  c.status             as commitment_status,
  c.amount,
  c.amount_paid,
  greatest(coalesce(c.amount, 0) - c.amount_paid, 0)  as outstanding_amount,
  c.currency,
  c.payment_due_at,
  c.owner_name,
  s.id                as supplier_id,
  s.name              as supplier_name,
  s.supplier_code,
  g.id                as departure_group_id,
  g.group_name,
  g.group_code
from public.supplier_commitments c
join public.suppliers s on s.id = c.supplier_id
join public.departure_groups g on g.id = c.departure_group_id
where c.status not in ('CANCELLED');

comment on view public.finance_supplier_payable_rows is
  'Supplier Payables tab, read directly from supplier_commitments — never a second payable model (plan F7).';

-- ─────────────────────────────────────────────────────────────────────────────
-- J. Private storage for payment proofs (bank slips, receipts).
--    Separate bucket from pilgrim-documents and supplier-evidence —
--    different retention, different audience.
-- ─────────────────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'payment-proofs',
  'payment-proofs',
  false,
  10 * 1024 * 1024,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

do $$
declare
  policy_name text;
  policy_names text[] := array[
    'staff read payment proofs',
    'staff upload payment proofs',
    'staff update payment proofs',
    'staff delete payment proofs'
  ];
begin
  foreach policy_name in array policy_names loop
    execute format('drop policy if exists %I on storage.objects', policy_name);
  end loop;

  execute $p$
    create policy "staff read payment proofs" on storage.objects
      for select to authenticated using (bucket_id = 'payment-proofs')
  $p$;
  execute $p$
    create policy "staff upload payment proofs" on storage.objects
      for insert to authenticated with check (bucket_id = 'payment-proofs')
  $p$;
  execute $p$
    create policy "staff update payment proofs" on storage.objects
      for update to authenticated
      using (bucket_id = 'payment-proofs')
      with check (bucket_id = 'payment-proofs')
  $p$;
  execute $p$
    create policy "staff delete payment proofs" on storage.objects
      for delete to authenticated using (bucket_id = 'payment-proofs')
  $p$;
end;
$$;
