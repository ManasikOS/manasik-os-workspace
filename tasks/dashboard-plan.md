# Implementation Plan: Dashboard — role-driven block system (v2)

Spec: [`docs/modules/dashboard-role-blocks-spec.md`](../docs/modules/dashboard-role-blocks-spec.md) (DRAFT, §11 open questions unanswered — see "Assumed defaults").
Task list: [`tasks/dashboard-todo.md`](./dashboard-todo.md). Written 2026-10-13. Read-only planning; no code changed.
Not `tasks/plan.md` / `tasks/todo.md` — those hold the unfinished Inngest→Supabase scheduling plan.

## Overview

The dashboard already exists (registry, 11 panels, capability-gated repository). This plan upgrades it to the spec: (1) fix the
custom-role access leak, (2) make the registry the single source of what renders, with role-selected KPIs, (3) isolate block failures,
(4) add seven specialist blocks one vertical slice at a time. Order is **security first, spine second, new blocks last** so each
checkpoint is shippable and the highest-risk change (G1) lands earliest.

## Assumed defaults (change these and tasks change)

| Spec §11 | Default used here | If you answer differently |
|---|---|---|
| Q1 v2 vs rebuild | v2 on existing code | Plan is invalid — re-plan |
| Q2 CEO My Day | omitted | one-line preset edit in T3 |
| Q3 OPS gets document-review | yes | drop from T10 preset |
| Q4 custom-role layout | base preset pruned by capabilities | curated list = new migration + settings UI, separate plan |
| Q5 guest-voice | **deferred** — T15 is blocked until a real capability key exists | — |

## Architecture decisions

- **One capability resolver for the page.** New `lib/access/dashboard-access.ts` exposes `getCurrentDashboardCapabilities()` (React `cache`),
  mirroring the existing `getLeadActor()` pattern (`lib/data/leads-actor.ts`): base `capabilitiesFor*(role)` as fallback, then
  `loadDynamicCapabilities(db, roleId, <module>, fallback)`. Modules: `finance, leads, operations, reports, visa, documents, suppliers,
  inbox, quotes` (all already in `KNOWN_MODULES`). Pure gating lives in the same file (`BLOCK_GATES`, `visibleBlocks`) so it is
  unit-testable without Supabase.
- **Registry decides presence + order; gates decide permission; neither lives in components.**
- **Fetch plan derives from the resolved block list.** A loader runs only if a visible block needs it. Skipped = `null` (absent), not `0`.
- **Failure isolation via `Promise.allSettled` + per-block error card**, *not* per-block streaming. True `<Suspense>` streaming needs each
  block to own its fetch (a rewrite of the single-entry-point repository); it is explicitly deferred (Risk R3). The page still fails soft.
- **New blocks are vertical slices:** loader/mapper → view model → component → registry id + gate + preset → KPI (if any) → test.
- **Loader contract rule:** every new block's first step is confirming its named loader returns the needed fields. If it can't without
  a new DB view, the block is dropped from this release (spec rule: no stubs, no new migration).

## Dependency graph

```
T1 caps bundle ──► T2 wire repo ──► T4 fetch plan ──► T6 failure isolation
      │                                  ▲
      └──► T3 registry+presets ──────────┤
                 │                       │
                 ├──► T5a KPI select ──► T5b role KPI tiles
                 ├──► T7 merged activity
                 ├──► T8 empty state + docs
                 └──► T9..T15 new blocks (each needs T3; T9/T11 also feed KPIs via T5a)
T2,T3 ──► T16 e2e matrix ;  T4 ──► T17 perf baseline
```

## Task list (index — full detail in dashboard-todo.md)

### Phase 1 — Access fix + spine
- [x] T1 Capability bundle + pure gate table (S)
- [x] T2 Route repository & page through the bundle (M) — **closes G1**
- [x] T3 Registry: structural blocks, gates, role presets (M) — closes G3
- [x] T4 Demand-driven fetch plan (M)
### Checkpoint A — access leak closed, registry live

### Phase 2 — KPIs, resilience, polish
- [x] T5a Role-selected KPI row, cap 6 (S) — closes G2
- [x] T5b KPI tiles that need no new loader (S)
- [x] T6 Per-block failure isolation (M) — closes G6
- [x] T7 Recent Activity on merged feed (S) — closes G5
- [x] T8 Zero-visible-blocks state + stale-doc fix (XS) — closes G7, C9
### Checkpoint B — existing blocks fully role-correct

### Phase 3 — New blocks (each independently shippable; order = value/risk)
- [x] T9 `visa-queue` (M)
- [x] T10 `document-review` (M)
- [x] T11 `supplier-payables` (M)
- [x] T12 `quotes-pending` (M)
- [x] T13 `campaign-pulse` (M)
- [ ] T14 `inbox-sla` (M)
- [ ] T15 `guest-voice` (M) — **BLOCKED** on spec Q5
### Checkpoint C — G4 closed

### Phase 4 — Proof
- [ ] T16 Role matrix e2e (M)
- [ ] T17 Render-time baseline + budget (S)
### Checkpoint D — release gate

## Risks and mitigations

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| R1 | Extra `role_permissions` reads (up to 9 modules) add latency to the landing route | Med | One `Promise.all`; React `cache`; T17 measures. If slow, batch into one query on `role_id` (single table) inside T1 |
| R2 | A named loader for a new block doesn't expose what the row needs | Med | Loader-verification is step 1 of T9–T15; drop block rather than add a view |
| R3 | No true per-block streaming (G6 only half-met: failure isolated, latency not) | Low | Documented; revisit after T17 numbers |
| R4 | Role-preset change surprises existing users (blocks vanish/appear) | Med | Presets edited in T3 only; call out diff in PR; no data deleted |
| R5 | Loader duplication when two blocks need the same data (e.g. rail + visa-queue both read groups) | Med | Both read from the single snapshot already fetched; new loaders only for data not in the snapshot |
| R6 | E2E needs seeded users per role; `e2e/support` fixtures may cover only inbox | Med | T16 starts by inspecting `e2e/support`; fall back to Vitest repository-level role tests and say so |
| R7 | `loadFinancePayments` 500-row cap understates collections (inherited, plan §13.4) | Med | Out of scope here; note on T5b collections-derived tiles; separate fix |

## Parallelization

After Checkpoint A: T9–T14 are independent of each other (different loaders and components); the only shared files are
`dashboard-layout.ts`, `dashboard-access.ts`, `dashboard-repository.ts` and `lib/types/dashboard.ts` — **merge-conflict hotspot**, so
land them sequentially or keep each block's mapper in its own file (`lib/data/dashboard-<block>.ts`) and touch the shared files by
one line each. T16/T17 can start as soon as T2 lands.

## Open questions

- Spec §11 Q1–Q5 above (defaults assumed).
- Which of `support` / `relationships` capability keys should gate `guest-voice`? (T15 blocked.)
- Performance budget number — to be set from T17's measured baseline, not guessed.
