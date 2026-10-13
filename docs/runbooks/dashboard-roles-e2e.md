# Dashboard role-matrix browser run

Proves, with a real sign-in per role, that each built-in role's `/dashboard`
shows exactly the blocks the registry and capabilities allow, and none of the
ones it must not. Spec:
[dashboard-role-blocks-spec.md](../modules/dashboard-role-blocks-spec.md)
(section 8, task T16). Spec file: `e2e/dashboard-roles.spec.ts`.

It is **not** part of `npm run test:e2e` (that config is an Inbox allowlist).

## What it asserts

For each of ADMIN, CEO, FINANCE, MARKETING, OPERATIONS, VISA, GUIDE:

- every block the role is entitled to is on the page
  (`[data-dashboard-block="<id>"]`), except the owner panel, which also needs
  the agency's plan to include it;
- every other block is **absent from the DOM**, and for the six blocks with a
  distinctive title (collections, supplier payables, visa queue, document
  review, campaign pulse, quotes pending) that text is **absent from the served
  document**, so it is not in the RSC payload either;
- nothing fell back to its error card (`[role="alert"]` inside a block).

Two boundaries are also asserted by name, independent of the registry: a GUIDE
never has a money, sales, team or approvals block; OPERATIONS never has supplier
payables.

## Prerequisites

1. A **staging or disposable** Supabase project and a deployment (or local
   `next start`) pointed at it. The run refuses `production`, a ref equal to the
   production ref, and the known production ref, before a browser starts.
2. One real sign-in account per role, in one agency, with seed data so blocks
   have rows. The Packages P0 seeder already creates one profile per role
   (`scripts/e2e/seed-packages-p0-fixtures.ts`, `PACKAGES_E2E_*_EMAIL`); you can
   reuse those accounts. Accounts themselves must already exist in Supabase Auth.
3. Enough data that the blocks are not all empty: a few departure groups with
   visa and document rows, a supplier with a payment due, a sent quote, an
   active campaign. An empty agency still passes (empty states render) but
   proves less.

## Variables

| Variable | Meaning |
|---|---|
| `DASHBOARD_E2E_ENVIRONMENT` | `staging` or `disposable` |
| `DASHBOARD_E2E_BASE_URL` | where the app is served; only its origin is used |
| `DASHBOARD_E2E_PROJECT_REF` | the Supabase project ref under test |
| `DASHBOARD_E2E_PRODUCTION_PROJECT_REF` | the production ref, so it can be refused |
| `DASHBOARD_E2E_<ROLE>_EMAIL`, `DASHBOARD_E2E_<ROLE>_PASSWORD` | for `ADMIN`, `CEO`, `FINANCE`, `MARKETING`, `OPERATIONS`, `VISA`, `GUIDE` |

Optional, as the other specs: `PLAYWRIGHT_BROWSER_CHANNEL=chrome`,
`PLAYWRIGHT_SLOW_FACTOR=3`.

## Run

```bash
npm run test:e2e:dashboard
```

HTML report: `playwright-report/dashboard-roles/`.

## Known gaps

- **Custom roles are not covered.** The plan asked for one restricted custom
  role; that needs a custom role with a saved override in the fixture agency,
  which no existing seeder creates. The same property is asserted at unit level
  (`lib/data/dashboard-repository.test.ts`, `lib/access/dashboard-access.test.ts`).
- **The owner panel is optional** by design (plan entitlement).
- **Expectations come from the registry**, so a spec failure means "the page
  disagrees with the registry". The hard-coded boundaries above are the
  protection against the registry itself being widened by mistake.
- Not yet run in CI: it needs the staging credentials above. Until it is, the
  unit tests are the standing guarantee.
