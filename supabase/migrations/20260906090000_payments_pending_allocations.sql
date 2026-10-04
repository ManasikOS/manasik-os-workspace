-- Preserves a hand-picked milestone allocation across payment verification.
--
-- `recordPayment()` (lib/data/finance-repository.ts) defers milestone
-- allocation for a `PENDING_VERIFICATION` payment until `verifyPayment()`
-- confirms it — money must not apply before its evidence is checked (see
-- the Phase 1 fix to that function). `verifyPaymentSchema` only ever
-- carried the payment id, so the allocation `verifyPayment()` applies has
-- always been recomputed oldest-unsettled-first, discarding whichever
-- milestone the person who recorded the payment actually ticked.
--
-- This column carries that original choice through the wait: `recordPayment()`
-- writes it when the payment lands `PENDING_VERIFICATION` with a hand-picked
-- allocation, and `verifyPayment()` applies it instead of falling back to
-- oldest-first, exactly reproducing what a `COMPLETED` payment recorded with
-- the same milestone choice would have done immediately.
alter table public.payments
  add column if not exists pending_allocations jsonb;

comment on column public.payments.pending_allocations is
  'Milestone allocation chosen at record time for a payment that landed PENDING_VERIFICATION — [{milestone_id, amount}], applied by verifyPayment() instead of the oldest-unsettled-first fallback. Null once applied or when no allocation was hand-picked.';
