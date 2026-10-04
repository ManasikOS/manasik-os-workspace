-- Supplier refunds — the mirror of pilgrim refunds (20260818090000), for
-- money coming back *from* a supplier instead of going out to a pilgrim.
--
-- Until now `supplier_payments.amount` was constrained `> 0`, so there was no
-- way to record a supplier refunding the agency (e.g. a hotel commitment
-- cancelled after a deposit was already paid). `updateCommitmentStatus()`
-- could flip a commitment to CANCELLED/DISPUTED but never touched
-- `amount_paid` — it only raised a manual task telling a human to sort the
-- money out themselves, with no ledger entry ever recording that it happened.
--
-- The fix follows the same signed-ledger convention `payments` already uses
-- for `reversePayment()`/`payRefund()` (lib/data/finance-repository.ts): a
-- refund is a negative `supplier_payments` row. `sync_supplier_commitment_amount_paid()`
-- already sums every row unconditionally, so a negative row reduces
-- `amount_paid` with no trigger change needed — the one-writer discipline
-- this schema already relies on keeps working unmodified.

alter table public.supplier_payments drop constraint if exists supplier_payments_amount_check;
alter table public.supplier_payments add constraint supplier_payments_amount_check check (amount <> 0);

alter table public.supplier_activity_events drop constraint if exists supplier_activity_events_action_check;
alter table public.supplier_activity_events add constraint supplier_activity_events_action_check
  check (action in ('SUPPLIER_CREATED','SUPPLIER_UPDATED','RELIABILITY_CHANGED',
                     'CONTACT_ADDED','CONTACT_UPDATED','COMMITMENT_CREATED',
                     'COMMITMENT_REQUESTED','SUPPLIER_RESPONDED','COMMITMENT_CONFIRMED',
                     'COMMITMENT_COMPLETED','COMMITMENT_CANCELLED','COMMITMENT_DISPUTED',
                     'EVIDENCE_UPLOADED','PAYMENT_RECORDED','PAYMENT_REFUNDED','NOTE_ADDED'));
