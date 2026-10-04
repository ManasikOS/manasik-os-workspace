# API & Server Action Conventions

How server-side entry points (Server Actions and Route Handlers) are
structured. Follow this so every module's server code reads the same way.

## Prefer Server Actions over Route Handlers

- Default to a Server Action (`"use server"`, colocated with the feature
  under `lib/<domain>/**` or `app/**`) for anything driven by this app's
  own UI — forms, mutations, page-triggered fetches.
- Reserve `app/api/**` Route Handlers for things that genuinely need an
  HTTP endpoint: webhooks (`app/api/webhooks/whatsapp`), OAuth callbacks
  (`app/api/oauth/**`), and scheduled cron jobs (`app/api/cron/**`).

## Every entry point, in order

1. **Authenticate.** `await requireUser()` (or `getUser()` for an
   explicitly anonymous path) from `lib/dal.ts` — first line, before any
   other logic.
2. **Validate input.** Parse the raw argument/`FormData`/JSON body through
   the matching `lib/validations/<domain>.ts` Zod schema. Don't touch the
   database with unvalidated shapes.
3. **Check access.** Resolve the caller's role/capability via
   `lib/access/<domain>-access.ts` before performing the mutation — not
   after.
4. **Do the work** through the domain's `lib/data/**` / `lib/<domain>/**`
   functions — the Server Action itself stays thin; business logic lives
   in the data-access layer where it's testable without the Next.js
   request context.
5. **Revalidate what's now stale.** `revalidatePath(...)` (or
   `revalidateTag`) for every cached read the mutation affects — see
   `switchAgencyAction` in `lib/tenancy.ts` for an example of getting this
   right at "changes everything" scope.
6. **Return a typed result**, not a thrown error for expected failure
   modes:

   ```ts
   type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };
   ```

## Route Handlers (webhooks, OAuth, cron)

- **Webhooks** (`app/api/webhooks/whatsapp`): verify the signature/secret
  before parsing the body. Validate the payload shape with Zod. Respond
  quickly (queue heavy work rather than blocking the webhook response) and
  return the status code the provider expects on both success and
  rejection.
- **OAuth callbacks** (`app/api/oauth/**`): validate `state`, exchange the
  code server-side only, never expose the resulting tokens to the client.
- **Cron jobs** (`app/api/cron/**`): verify the request actually comes
  from the scheduler (shared secret / signed header), and make the job
  idempotent — a retry or a double-fire must not double-process (e.g.
  `release-seat-holds`, `whatsapp-billing-sync`).

## Errors

- Expected failures (validation error, permission denied, business-rule
  rejection like "seat hold expired") return a typed error result with a
  specific, user-actionable message — they are not exceptions.
- Unexpected failures (a downstream service down, a genuine bug) can throw
  — Next.js error boundaries / the route's own catch handle them, and they
  get logged with enough context to debug, never silently swallowed (see
  the caution in `lib/dal.ts` about a `catch` that only logged and hid a
  real bug for a long time).

## Naming

- Server Action names describe the exact effect and are exported, not
  generic: `switchAgencyAction`, not `updateAction`.
- Route Handler files follow Next.js's required `route.ts` naming; the
  directory name is what should be specific (`app/api/webhooks/whatsapp`,
  not `app/api/webhooks/handler`).
