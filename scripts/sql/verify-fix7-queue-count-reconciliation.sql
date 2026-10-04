-- FIX7 operational audit. Run after the migration against the intended database.
-- Zero rows means every stored counter equals its exact membership count.
-- This is read-only and can safely run while the Inbox is in use.
with actual as (
  select agency_id, queue_code, count(*)::integer as conversation_count
    from public.conversation_queue_membership
   group by agency_id, queue_code
),
reconciliation as (
  select coalesce(actual.agency_id, stored.agency_id) as agency_id,
         coalesce(actual.queue_code, stored.queue_code) as queue_code,
         coalesce(actual.conversation_count, 0) as membership_count,
         coalesce(stored.conversation_count, 0) as stored_count
    from actual
    full join public.conversation_queue_counts stored
      on stored.agency_id = actual.agency_id
     and stored.queue_code = actual.queue_code
)
select *
  from reconciliation
 where membership_count <> stored_count
 order by agency_id, queue_code;

-- Count read plan: this should read only the small per-agency counter set.
explain (analyze, buffers)
select queue_code, conversation_count
  from public.conversation_queue_counts
 where agency_id = '<agency-id>'::uuid;
