# Architecture Overview

This is the map of how the CRM is built. Read this before designing a new
module or making a cross-cutting change. Module-specific design docs live in
[`docs/modules/`](../modules/); this file covers what's shared by all of them.

## Stack

- **Next.js 16** (App Router, Server Components, Server Actions, Route Handlers)
- **Supabase** — Postgres, Row Level Security, Auth, Storage
- **OpenRouter** — one key for every AI feature (document agent, Manasik Copilot, inbox reply suggestions, WhatsApp assistant); see [`ai-model-selection.md`](ai-model-selection.md)
- **Tailwind CSS v4** + **shadcn UI** (via the shadcn MCP — see [`docs/standards/ui-standards.md`](../standards/ui-standards.md))
- **Zod** for runtime validation, **Vitest** for tests

## Layering

Every feature is built in the same four layers, top to bottom. A layer only
talks to the one directly below it.

```
app/**                    Route segments: pages, layouts, Server Actions colocated with UI
lib/data/**, lib/<domain>/**  Data-access layer (DAL): reads/writes, business rules, mapping
lib/validations/**         Zod schemas — the single source of truth for shape + constraints
supabase/migrations/**      Schema, RLS policies, views, RPCs — the last line of defence
```

- **UI components never call Supabase directly.** They call a function in
  `lib/data/*` or a Server Action, and get back typed data.
- **Server Actions and Route Handlers start with `requireUser()`**
  (`lib/dal.ts`) or an equivalent auth check. `proxy.ts` middleware is an
  optimistic gate only — it improves latency/UX, it is never the security
  boundary.
- **Every list/detail read is scoped to the caller's role and agency.**
  Role gating lives in `lib/access/*-access.ts`, resolved from
  `getCurrentStaffRole()`. Tenancy scoping lives in `lib/tenancy.ts` and the
  `active_agency_id` on `staff_profiles`.
- **RLS is not optional because the app layer already checked.** The
  application layer decides what's *rendered*; Postgres RLS decides what's
  ever *fetchable*. A new table without an RLS policy is a bug, not a
  follow-up task. See [`docs/security/security-guidelines.md`](../security/security-guidelines.md).

## Multi-tenancy

The platform is multi-agency. Every tenant-scoped table carries an
`agency_id`, every RLS policy filters on it, and the caller's active agency
lives on `staff_profiles.active_agency_id` (switchable via
`switch_active_agency()`, see [`lib/tenancy.ts`](../../lib/tenancy.ts)).
Full design: [`docs/architecture/multi-tenancy-implementation-plan.md`](multi-tenancy-implementation-plan.md).

**Rule for new tables:** if the data belongs to an agency, it gets an
`agency_id` column, an RLS policy that filters on it, and an index on it.
There is no opt-out.

## Access control

Roles and per-module capabilities are modelled in `lib/access/*-access.ts`
and `lib/access/dynamic-capabilities.ts`, keyed by
`lib/access/module-capability-keys.ts`. Full design:
[`docs/architecture/dynamic-roles-permissions-plan.md`](dynamic-roles-permissions-plan.md)
and [`docs/security/access-control.md`](../security/access-control.md).

**Rule for new modules:** every module gets its own `<module>-access.ts`
file. Don't inline role checks (`if (role === "ADMIN")`) in components or
Server Actions — resolve them through the access layer so the capability
matrix stays in one place and is testable.

## Module structure

Each domain module (leads, departure groups, pilgrims, documents, visa,
finance, packages, suppliers, team, reports, settings, inbox, WhatsApp,
Manasik intelligence, …) has:

1. A design doc in [`docs/modules/`](../modules/) written *before* the
   module is built (see [`docs/standards/feature-development-workflow.md`](../standards/feature-development-workflow.md)).
2. A route segment under `app/(main)/**` (or `(portal)`/`(agent-portal)`
   for external-facing surfaces).
3. A data-access module under `lib/data/**` or `lib/<domain>/**`.
4. A Zod schema in `lib/validations/<domain>.ts`.
5. An access file in `lib/access/<domain>-access.ts`.
6. Migrations under `supabase/migrations/` with RLS for every new table.
7. Tests under `tests/<domain>/` for anything with business-rule branching
   (seat holds, race conditions, capacity limits, billing math — not
   simple CRUD).

## AI features

AI-backed features (the Document Agent, Manasik Copilot, inbox reply
suggestions, the WhatsApp assistant) call OpenRouter (see [`ai-model-selection.md`](ai-model-selection.md)) from server-side code only
(`lib/ai/**`, `lib/copilot/**`, `lib/inbox/**`) — never from the client, and
never with a customer's raw PII passed further than the single call that
needs it. See [`docs/security/security-guidelines.md`](../security/security-guidelines.md#ai-features).

## Where the deeper detail lives

| Concern | Doc |
|---|---|
| Multi-tenancy design | [multi-tenancy-implementation-plan.md](multi-tenancy-implementation-plan.md) |
| Roles & permissions | [dynamic-roles-permissions-plan.md](dynamic-roles-permissions-plan.md) |
| Package/departure domain model | [package-departure-architecture-master-plan.md](package-departure-architecture-master-plan.md) |
| Conversation intelligence, Inbox Copilot, AI cost & commercial model | [../inbox/architecture.md](../inbox/architecture.md) |
| Design tokens / theming | [design-tokens.md](design-tokens.md) |
| Cross-module roadmap | [remaining-modules-master-plan.md](remaining-modules-master-plan.md) |
| Production readiness checklist | [production-readiness-plan.md](production-readiness-plan.md) |
| Security rules | [../security/security-guidelines.md](../security/security-guidelines.md) |
| Access control model | [../security/access-control.md](../security/access-control.md) |
| Engineering standards | [../standards/engineering-standards.md](../standards/engineering-standards.md) |
| UI/UX standards | [../standards/ui-standards.md](../standards/ui-standards.md) |
| API/Server Action conventions | [../standards/api-conventions.md](../standards/api-conventions.md) |
| Testing standards | [../standards/testing-standards.md](../standards/testing-standards.md) |
| How to plan and build a new feature | [../standards/feature-development-workflow.md](../standards/feature-development-workflow.md) |
