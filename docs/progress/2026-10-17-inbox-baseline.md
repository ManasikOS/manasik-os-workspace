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

## T10 — contrast
Scoped class `.inbox-aa-contrast` (in `app/globals.css`, applied on the Inbox `<main>` in `app/inbox/layout.tsx`) darkens `--primary` to `#047857`
and `--muted-foreground` to `#6b6b6b` for the Inbox only; dark mode keeps its own values. Computed ratios: `#047857` on white 5.48, on the light green
`#E8F9E5` 4.99, on `#f7f7f7` 5.12; `#6b6b6b` on `#f7f7f7` 4.97 (all pass 4.5:1). Side effect: Inbox primary buttons are darker green, white text on them is 5.48:1.
Dialogs and popovers that render outside the Inbox `<main>` keep the global colours. **Spec A6 (axe) has not been run**; run it on the stack to confirm no other pair fails.
