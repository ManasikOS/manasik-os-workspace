# Testing Standards

## What's tested today

Vitest, `node` environment, pure-logic unit tests only (see
`vitest.config.mts`'s own header comment). No React Testing Library/jsdom
yet — component tests aren't set up. Tests live either colocated
(`lib/csv.test.ts`, `lib/validations/packages.test.ts`) or under
`tests/<domain>/` for suites large enough to want fixtures
(`tests/departure-groups/`).

Run with:

```bash
npm run test        # single run
npm run test:watch  # watch mode
```

## What to write a test for

Write a test when the code has **business-rule branching** — logic that
can be silently wrong and only a test would catch it:

- Race conditions and concurrency (seat-hold release vs. new booking,
  capacity checks under contention — see
  `tests/departure-groups/reconciliation.test.ts`)
- Ambiguous/edge-case identity resolution (e.g. the inbox's
  ambiguous-identity and sold-out cases)
- Billing/pricing math (itemised billing, invoice totals)
- Validation schemas with non-trivial constraints (`packages.test.ts`)
- Anything a past incident already broke once — encode the regression as
  a test, referencing the doc/section that describes the incident
  (`lib/dal.ts`'s comments pointing at
  `docs/modules/team-module-remediation-plan.md` §10 are exactly the kind
  of thing that deserves a regression test, not just a comment)

## What not to write a test for

- Simple CRUD passthroughs with no branching logic
- Pure UI rendering (no test runner is set up for it yet — don't add one
  ad hoc for a single component; that's a project-wide decision)
- Anything requiring a live Supabase connection — out of scope for this
  runner today (see the `vitest.config.mts` header comment). If a change
  genuinely needs database-backed integration testing, raise it as its own
  decision rather than working around the gap per-PR.

## Structuring tests

- Use fixtures (`tests/departure-groups/fixtures.ts`) for shared setup
  across a suite rather than duplicating object literals in every test.
- Name test files after the module under test, `.test.ts`/`.test.tsx`
  suffix, colocated with the source when the suite is small, under
  `tests/<domain>/` when it needs its own fixtures/helpers.
- A test name should describe the scenario and expected outcome, not just
  the function name — `"rejects a booking when the seat hold already
  expired"`, not `"test bookSeat"`.

## Before merging

- [ ] `npm run test` passes
- [ ] New business-rule logic (race conditions, pricing, capacity,
      identity resolution) has a covering test
- [ ] `npm run typecheck` and `npm run lint` pass — type/lint checks are
      part of "tested", not a separate optional step
