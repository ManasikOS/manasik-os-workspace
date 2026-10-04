-- Phase 7 of docs/modules/departure-operations-agent-implementation-plan.md: the
-- observability floor §13 describes needs three facts `departure_ops_runs`
-- doesn't carry yet, none of them derivable after the fact:
--
--   * `blocker_count` / `readiness_score` at the moment of the review — the
--     only way "blockers open at T-7" can ever be answered later is if
--     something records the count AT T-7, not reconstructs it afterwards.
--     The full snapshot is never persisted (by design — see snapshot.ts's
--     header on staying a read model, not a second store); these two
--     numbers are the cheap, bounded summary of it worth keeping.
--   * `guardrail_violations` — §11's guardrails already compute exactly
--     which findings got dropped and why (`applyGuardrails()`'s return
--     value), but nothing was persisting it. Without this row, "how often
--     does the corroboration gate actually fire" — the hallucination
--     canary §13 names — is a question with no data behind it.

alter table public.departure_ops_runs
  add column if not exists readiness_score      integer,
  add column if not exists blocker_count         integer,
  add column if not exists tier                  text,
  add column if not exists guardrail_violations  jsonb not null default '[]'::jsonb;

comment on column public.departure_ops_runs.guardrail_violations is
  'Snapshot of applyGuardrails()''s violations for this run — [{gate, detail, stagedId}]. Powers the uncorroborated-finding drop rate (§13) without a separate table.';

create index if not exists departure_ops_runs_tier_idx on public.departure_ops_runs (agency_id, tier);
