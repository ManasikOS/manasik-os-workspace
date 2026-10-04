-- FIX2 (docs/inbox/fixing-plan.md) — performance follow-up, measured not guessed.
--
-- `EXPLAIN (ANALYZE, BUFFERS)` of `inbox_retention_candidate_conversations()`'s
-- inlined query against 100,000 seeded conversations showed a parallel
-- sequential scan of the whole table followed by an external (disk-spilling)
-- sort to satisfy `order by last_activity_at, id` — ~104 ms for a single
-- 250-row page, already over the FIX2 budget at 100k rows and only getting
-- worse at 1M. There was no index supporting the sweep's own predicate,
-- `agency_id = ? and (last_activity_at, id) > (?, ?)`, ordered the same way.
--
-- This index lets the planner satisfy the filter, the keyset comparison, and
-- the `order by` from the index directly, with an index scan that stops at
-- the requested page instead of touching the whole table.
create index if not exists conversations_agency_activity_id_idx
  on public.conversations (agency_id, last_activity_at, id);

notify pgrst, 'reload schema';
