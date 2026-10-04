-- MI4.1b — let staff mark a Copilot signal correct or not correct, so detector precision can be MEASURED.
--
-- MI4.1 (PAYMENT_CLAIM_UNVERIFIED >= 95 % precision gates MI4.2) and MI4.3 (recall on distress) both need a human verdict per
-- signal, and nothing in the app could record one. The verdict lives on the signal itself: the same append-only row, only
-- four review columns are ever written by staff, and only once per signal (a verdict is not edited, a new signal is judged
-- on its own).
--
-- Roll back with:
--   drop view if exists public.inbox_signal_precision;
--   alter table public.conversation_signals drop column review_verdict, drop column reviewed_by, drop column reviewed_at;

alter table public.conversation_signals
  add column if not exists review_verdict text,
  add column if not exists reviewed_by    uuid,
  add column if not exists reviewed_at    timestamptz;

alter table public.conversation_signals
  drop constraint if exists conversation_signals_review_verdict_check,
  add  constraint conversation_signals_review_verdict_check
    check (review_verdict is null or review_verdict in ('CORRECT', 'WRONG'));

-- A verdict, who gave it and when arrive together or not at all.
alter table public.conversation_signals
  drop constraint if exists conversation_signals_review_complete_check,
  add  constraint conversation_signals_review_complete_check
    check ((review_verdict is null) = (reviewed_at is null) and (review_verdict is null) = (reviewed_by is null));

-- The reviewer must be staff of the SAME agency (composite FK, like every other tenant reference).
alter table public.conversation_signals
  drop constraint if exists conversation_signals_reviewer_agency_fkey,
  add  constraint conversation_signals_reviewer_agency_fkey
    foreign key (reviewed_by, agency_id) references public.staff_profiles (id, agency_id);

-- The review queue reads "newest unreviewed"; precision groups reviewed rows by code.
create index if not exists conversation_signals_unreviewed_idx
  on public.conversation_signals (agency_id, created_at desc) where review_verdict is null;
create index if not exists conversation_signals_reviewed_idx
  on public.conversation_signals (agency_id, signal_code) where review_verdict is not null;

-- Staff may write ONLY the review columns; the signal's facts stay service-role writes.
revoke update on table public.conversation_signals from authenticated;
grant update (review_verdict, reviewed_by, reviewed_at) on table public.conversation_signals to authenticated;

drop policy if exists "staff review conversation_signals" on public.conversation_signals;
create policy "staff review conversation_signals" on public.conversation_signals
  for update to authenticated
  using (
    agency_id = (select public.current_agency_id())
    and review_verdict is null
    and (select public.staff_role_in('ADMIN', 'MARKETING', 'OPERATIONS', 'FINANCE'))
  )
  with check (
    agency_id = (select public.current_agency_id())
    and reviewed_by = (select auth.uid())
    and (select public.staff_role_in('ADMIN', 'MARKETING', 'OPERATIONS', 'FINANCE'))
  );

-- Precision per detector, per agency. security_invoker so it inherits the signals table's RLS.
create or replace view public.inbox_signal_precision
with (security_invoker = true) as
select
  s.agency_id,
  s.signal_code,
  s.detector,
  count(*)                                          as total_signals,
  count(*) filter (where s.review_verdict is not null) as reviewed,
  count(*) filter (where s.review_verdict = 'CORRECT') as correct,
  count(*) filter (where s.review_verdict = 'WRONG')   as wrong
from public.conversation_signals s
group by s.agency_id, s.signal_code, s.detector;

grant select on public.inbox_signal_precision to authenticated;

notify pgrst, 'reload schema';
