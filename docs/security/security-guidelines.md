# Security Guidelines

Non-negotiable rules for anything that touches auth, data access, tenancy,
or external input. If a PR violates one of these, it doesn't merge until
fixed — this isn't a style preference.

## 1. Defence in depth: app layer + RLS, always both

- The app layer (`lib/access/*-access.ts`, role checks resolved from
  `getCurrentStaffRole()`) decides what gets *rendered and offered*.
- Postgres Row Level Security decides what's ever *fetchable*, no matter
  which code path runs the query.
- **Every new table gets an RLS policy in the same migration that creates
  it.** No table ships "temporarily open" while the UI is being built.
  Reference: `supabase/migrations/20260822090000_rls_hardening.sql`.
- Never assume the UI's role gate is sufficient — a direct Supabase query
  from a Server Action, a script, or a future API consumer must be blocked
  by RLS on its own.

## 2. Authentication

- Every Server Action and Route Handler that reads or writes data starts
  with `requireUser()` (or `getUser()` when an anonymous fallback is
  explicitly intended) from `lib/dal.ts`. This is not optional and not
  something `proxy.ts` substitutes for — proxy middleware is a UX
  optimization (redirect before render), not the auth boundary.
- Never trust a client-supplied user id, role, or agency id. Always resolve
  identity server-side from the session.
- Mutations that change security-sensitive state (activation, role
  changes, invitation acceptance) go through **security-definer RPCs**
  scoped to the caller's own row — see `touch_own_activity()` /
  `accept_own_invitation()` in `lib/dal.ts` for the pattern, and why a
  direct table `UPDATE` from application code was rejected there.

## 3. Multi-tenancy isolation

- Every tenant-owned table has `agency_id`, and every read/write path is
  scoped to `staff_profiles.active_agency_id` for the current session.
- Never write a query that could return rows across agencies "by accident"
  — don't rely on the caller to always pass the right filter; enforce it
  in RLS.
- Switching agency (`switchAgencyAction` in `lib/tenancy.ts`) invalidates
  every cached read keyed off the current agency (`revalidatePath("/",
  "layout")`) — any new agency-scoped cache must do the same.

## 4. Input validation

- All external input (form submissions, Server Action arguments, webhook
  payloads, query params) is validated with a Zod schema from
  `lib/validations/<domain>.ts` before it touches the database. Never trust
  a `FormData` field or JSON body to already be the right shape.
- Validate at the boundary once; don't re-validate the same data
  redundantly deeper in the call stack — but never skip the boundary check
  because "the UI already validates it" (client-side validation is UX, not
  security).
- Reject unknown/extra fields where the schema allows it (`.strict()`)
  for anything that maps directly onto a privileged column set (roles,
  permissions, pricing).

## 5. Injection & output safety

- Never build a SQL string by concatenating user input — use the Supabase
  client's parameterized query builder or `.rpc()` with typed arguments.
  If raw SQL is unavoidable (a migration, a reporting view), it takes
  parameters, never string-interpolated user input.
- Never `dangerouslySetInnerHTML` with anything derived from user or
  external input without sanitizing it first.
- Treat webhook payloads (`app/api/webhooks/whatsapp`) as hostile until
  verified: check the signature/secret before processing, and validate the
  payload shape before it reaches business logic.

## 6. Secrets & credentials

- Secrets (`SUPABASE_SECRET_KEY`, `OPENROUTER_API_KEY`, WhatsApp/Meta
  tokens, OAuth client secrets) live in environment variables only, never
  committed, never logged. Check `.env.example` stays in sync when adding
  a new one.
- `SUPABASE_SECRET_KEY` (service role) is used server-side only, and only
  where RLS genuinely needs to be bypassed for a specific, documented
  reason (e.g. an admin action that must see across agencies). Default to
  the RLS-respecting client.
- Never pass a secret to client-side code, even transiently — no
  `NEXT_PUBLIC_` prefix on anything sensitive.

## 7. Least privilege

- New RPCs and RLS policies grant the narrowest access that satisfies the
  feature: a "touch my own row" RPC, not a general-purpose update endpoint.
- Role capability additions in `lib/access/module-capability-keys.ts` /
  `module-defaults.ts` default to the most restrictive role that still
  makes the feature usable; broaden deliberately, not by default.

## 8. AI features

- Calls to the Anthropic API happen in server-side code only
  (`lib/ai/**`, `lib/copilot/**`, `lib/inbox/**`) — the API key never
  reaches the client.
- Don't pass more customer/pilgrim PII into a prompt than the specific
  feature needs, and don't let AI-generated content write directly to the
  database without going through the same validation and access checks as
  a human-originated write.
- Treat AI output (reply suggestions, extracted document fields) as
  untrusted input to the rest of the system until validated — a
  hallucinated field value follows the same Zod validation as any other
  external input.

## 9. Auditability

- Security-sensitive mutations (role changes, invitations, agency
  switches, payment/invoice state changes) should be traceable — via
  existing audit tables (`supabase/audits/`) or a clear `updated_by` /
  timestamp trail. If a new mutation changes money, access, or identity
  and leaves no trace of who did it, that's a gap to close before merge.

## 10. Before merging a feature that touches any of the above

Run through [`docs/security/access-control.md`](access-control.md) for
role/permission changes, and confirm:

- [ ] New tables have RLS policies (not just "will add later")
- [ ] New Server Actions/Route Handlers call `requireUser()`
- [ ] New tables/queries are agency-scoped
- [ ] A new `security definer` function checks the caller's role and agency **inside the function** (the
      REST API can call it directly with any session, so a Server Action check alone is not enough), pins
      `search_path`, and its migration runs `revoke execute ... from public, anon` (and from `authenticated`
      too if only server code with the service role calls it). `revoke ... from public` alone is not enough:
      Supabase also grants `anon` directly. See
      [`docs/progress/2026-09-18-security-definer-audit.md`](../progress/2026-09-18-security-definer-audit.md)
- [ ] A new view uses `security_invoker = true` and is not granted to `anon`; without it the view runs with
      its owner's rights and skips row security
- [ ] New input is validated with a Zod schema at the boundary
- [ ] No secret is reachable from client code
- [ ] `npx supabase` advisors (or `get_advisors` via MCP) show no new
      security warnings for changed tables
