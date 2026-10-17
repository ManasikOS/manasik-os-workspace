# Inbox baseline checks — 17 October 2026 (T1)

Branch `UI-update`, run on the developer machine. Results of the checks the 17 Oct report listed as "not run".

| Check | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | Pass (before and after the T7/T10 edits) |
| Production build | `npm run build` | Pass |
| Dependency audit | `npm audit --omit=dev` | 0 vulnerabilities |
| Unit tests, whole repo | `npx vitest run` | 538 files, 5,778 tests, all pass |
| Unit tests, Inbox only | `npx vitest run app/inbox lib/inbox lib/access/inbox-access` | 241 files, 2,864 tests, all pass |
| Lint ratchet (Inbox paths) | eslint as in `inbox-ci.yml` | 0 errors, 13 warnings (ceiling 13) |
| Lint, files changed by T7/T10 | eslint | clean |
| Browser specs | Playwright | **Not run**: needs the staging or local stack with E2E logins |

No critical or high audit findings, so no owner is needed for T1.

## T7 — bulk close now asks first
`app/inbox/components/bulk-selection-bar.tsx`: "Close" opens a confirmation ("Close N conversations?") that says nothing is sent, a customer
message reopens the chat, chats with an open review stay open, and there is no undo. Spec B5 added to `e2e/inbox-ownership-and-bulk.spec.ts`
(cancel changes nothing). **B5 has not been run.** An undo window was left out: the server has no reopen action for bulk, so it would need new server code.

## T10 — contrast (reverted)
A scoped darker-green/grey token set was built (commit `931a5c6f`) and then reverted at the owner's request; the design-system colours are unchanged.
Spec A6 (axe colour contrast) will keep failing on `text-primary` (about 2.3:1) and on muted text over the selected row (4.42:1) until the owner decides otherwise.
