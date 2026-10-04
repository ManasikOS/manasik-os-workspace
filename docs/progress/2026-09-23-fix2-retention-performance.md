# FIX2 retention sweep — performance evidence — 2026-09-23

Snapshot for [`docs/inbox/fixing-plan.md`](../inbox/fixing-plan.md) FIX2
("Retention integrity and resumable batches"). Historical record — do not
edit to match later reality; if the query or index changes, record a new
snapshot instead.

## What this measures

`inbox_retention_candidate_conversations()`
(`supabase/migrations/20261202092900_fix2_retention_resumable_sweep.sql`) is
the keyset-paged, booking-classifying candidate query the nightly MESSAGES
retention sweep calls once per batch. FIX2 requires: *"`EXPLAIN (ANALYZE,
BUFFERS)` the candidate query at 1 million conversations. Add only an index
proven to change the plan."*

## Scale actually measured, and why

The plan's own target is 1,000,000 conversations. Reaching that against the
real Manasik OS project (`klognjpwmqwlgeibvanf`) turned out to be blocked by
a per-row trigger on `conversations`
(`trg_refresh_queues_for_conversation` → `refresh_conversation_queues()` →
`compute_conversation_queues()`) that recomputes queue membership on every
insert; bulk-inserting at that volume through the trigger repeatedly hit
Supabase's statement timeout even at 50,000–70,000-row batches. Disabling
that trigger to force a 1M-row seed was judged too large a change to make
against shared, real infrastructure for a one-off measurement, so the
measurement below is at **100,000 synthetic conversations** instead — the
plan's own interim data point (`docs/inbox/fixing-plan.md` FIX7 names both
100k and 1M explicitly). The 1M-row figure remains unmeasured; it is
deferred to FIX14's dedicated staging load harness, which already owns the
project's full-scale performance verification.

**Synthetic fixture** (all rows tagged and deleted after this measurement):
one agency (`FIX2 LOAD TEST — DELETE ME`, `8ed12dd3-c713-4948-a61e-20bac909cb95`),
one departure group, one departure-group booking, 2,000 leads pointing at
that booking, and 100,000 conversations — 96,000 with no lead (the enquiry
cutoff path) and 4,000 with `lead_id` pointing at one of the 2,000 leads (the
booking-linked cutoff path, via the `lead_id → leads.booking_id` relationship
FIX2 added). `last_activity_at` spread randomly across the last five years so
both cutoff branches have real candidates at query time.

## Before: no supporting index

`EXPLAIN (ANALYZE, BUFFERS)` of the candidate query's own SQL (the function
body inlined, since a `security definer` SQL function's plan is opaque from
outside), first page, cursor at epoch, limit 250:

- **Plan:** `Parallel Seq Scan on conversations` (all 100,000 rows, 2 workers)
  → `Sort` that spills to disk (`Sort Method: external merge, Disk: 2232kB` /
  `1176kB`) to satisfy `order by last_activity_at, id`, because no index
  supported the sweep's own predicate
  (`agency_id = ? and (last_activity_at, id) > (?, ?)`) in that order.
- **Execution Time: 103.777 ms** for one 250-row page.
- Already over FIX2's stated budget (*"each 250-row claim under 100 ms"*) —
  at 1/10th the plan's target scale.

## The index added

`supabase/migrations/20261202093000_fix2_retention_conversation_keyset_index.sql`:

```sql
create index if not exists conversations_agency_activity_id_idx
  on public.conversations (agency_id, last_activity_at, id);
```

Composite, matching the query's filter and its `order by` exactly — nothing
broader was tried or kept.

## After: index-backed, no sort

Same query, same parameters, after the index was applied:

- **Plan:** `Index Scan using conversations_agency_activity_id_idx on
  conversations` — the filter, the keyset comparison, and the `order by` are
  all satisfied by the index; no sequential scan, no sort, no disk spill.
- **Execution Time: 7.062 ms** — first page, cursor at epoch.
- **Execution Time: 22.811 ms** — a second measurement with the cursor
  positioned mid-table (after 50,000 rows), to confirm the index holds for a
  resumed sweep, not just a fresh one.

| | Before (no index) | After (`conversations_agency_activity_id_idx`) |
|---|---|---|
| Plan | Parallel Seq Scan + external disk sort | Index Scan, no sort |
| First page (250 rows, cursor at epoch) | 103.777 ms | 7.062 ms |
| Mid-sweep page (250 rows, cursor after 50k rows) | *(not measured — before state was already over budget)* | 22.811 ms |
| Rows scanned to produce the page | ~100,000 (whole table) | ~259–269 (index range) |

Both after-measurements are well inside the FIX2 budget. The index changed
the plan, was proven by measurement, and is the only index this slice added.

## What is still open

- **1,000,000-row measurement** — deferred to FIX14 (staging load harness),
  for the reason above.
- **Live dry-run/live reconciliation** — the exit criterion needing dry-run
  counts to equal a live sweep's counts on real data — not attempted here;
  this snapshot only exercises the read-only candidate query, never the
  sweep's delete path, against synthetic data.
- The five non-MESSAGES scopes (ATTACHMENTS, VOICE_AUDIO, INTELLIGENCE,
  SIGNALS, AI_RUNS, WEBHOOK_PAYLOADS) reuse the same resumable-sweep
  primitive and the same keyset-filter shape, but their own candidate
  queries were not separately `EXPLAIN`-measured here; the existing indexes
  each already had before FIX2 (their tables are smaller and narrower than
  `conversations`) were assumed adequate rather than proven. Revisit if
  FIX14's load run shows otherwise.
