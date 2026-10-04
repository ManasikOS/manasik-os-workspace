# Feature Development Workflow

The process for building any new feature or module in this CRM, from plan
to merge. This is the concrete checklist `AGENTS.md` refers to — follow it
in order.

## 1. Plan before building

- For a new module or a change large enough to need design decisions
  written down, create the plan first, saved as
  `docs/tasks/TASK-###-<feature-name>.md` (see
  [`docs/tasks/README.md`](../tasks/README.md) for the numbering and
  template).
- For a module-level feature, also write (or update) that module's
  implementation plan under [`docs/modules/`](../modules/), named
  `<module>-implementation-plan.md` (or `-architecture.md` for the
  cross-cutting design of a larger domain, following the existing pattern
  in `docs/architecture/package-departure-architecture-master-plan.md`).
- A plan states: what's being built, why, the data model changes, the
  access/RLS changes, the UI surfaces touched, and how it'll be tested.
  It does not need to be long — it needs to be checkable against once the
  code exists.

## 2. Design against the standing rules

Before writing code, confirm the plan is consistent with:

- [`docs/architecture/README.md`](../architecture/README.md) — layering,
  multi-tenancy, module structure
- [`docs/security/security-guidelines.md`](../security/security-guidelines.md)
  and [`docs/security/access-control.md`](../security/access-control.md) —
  RLS, auth, tenancy, least privilege
- [`docs/standards/ui-standards.md`](ui-standards.md) — shadcn-only,
  `InputGroup`, design tokens, naming
- [`docs/standards/api-conventions.md`](api-conventions.md) — Server
  Action/Route Handler shape
- [`docs/standards/engineering-standards.md`](engineering-standards.md) —
  naming, file placement, scope discipline

If the plan requires deviating from any of these, the deviation and its
reason go in the plan doc explicitly — it's not a silent exception.

## 3. Build in layer order

1. Migration(s) under `supabase/migrations/` — schema + RLS policy in the
   same migration, always.
2. Zod schema in `lib/validations/<domain>.ts`.
3. Access file in `lib/access/<domain>-access.ts` (capability keys +
   defaults, per [`docs/security/access-control.md`](../security/access-control.md)).
4. Data-access functions in `lib/data/**` or `lib/<domain>/**`.
5. Server Actions / Route Handlers, per
   [`docs/standards/api-conventions.md`](api-conventions.md).
6. UI under `app/(main)/<module>/**`, per
   [`docs/standards/ui-standards.md`](ui-standards.md).

## 4. Test

- Add tests per [`docs/standards/testing-standards.md`](testing-standards.md)
  for any business-rule branching introduced.
- Run `npm run lint`, `npm run typecheck`, `npm run test` — all three, not
  a subset.

## 5. Verify in the browser

For anything with a UI surface: start the dev server, exercise the golden
path and the realistic edge cases (empty state, permission-denied state,
error state) yourself before calling it done. Type/test passes verify
correctness of logic, not that the feature actually works — don't
substitute one for the other.

## 6. Update documentation

- Update the module's doc in [`docs/modules/`](../modules/) if the
  implementation diverged from the plan.
- If the feature introduced a new cross-cutting pattern (a new kind of
  access rule, a new API convention), update the relevant doc under
  [`docs/standards/`](.) or [`docs/architecture/`](../architecture/) so
  the next feature doesn't have to rediscover it.
- If the feature is a one-off operational procedure (a migration runbook,
  a manual verification step), it goes under [`docs/runbooks/`](../runbooks/),
  not mixed into the module's design doc.

## 7. Security pass

Before opening the PR, run the checklist in
[`docs/security/security-guidelines.md`](../security/security-guidelines.md#10-before-merging-a-feature-that-touches-any-of-the-above).

## Summary checklist

- [ ] Plan written: `docs/tasks/TASK-###-*.md` and/or `docs/modules/*.md`
- [ ] Migration + RLS policy together
- [ ] Zod validation at every boundary
- [ ] Access checks in `lib/access/**`, enforced in UI *and* the mutation
- [ ] Server Actions/Route Handlers follow the standard shape
- [ ] UI uses shadcn + `InputGroup` + existing design tokens, no generic
      names
- [ ] Tests added for business-rule logic; lint/typecheck/test all pass
- [ ] Verified manually in the browser (golden path + edge cases)
- [ ] Docs updated to match what was actually built
- [ ] Security checklist run
