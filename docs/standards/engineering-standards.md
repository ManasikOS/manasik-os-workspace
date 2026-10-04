# Engineering Standards

General coding rules that apply across every module. Module-specific rules
live in each module's own doc under [`docs/modules/`](../modules/).

## Naming

- **No generic names.** `Card.tsx`, `useData()`, `handleSubmit`,
  `utils.ts` tell you nothing when there are forty of them. Name things
  after what they specifically do or hold: `DeparturePilgrimRosterCard`,
  `useSeatHoldCountdown`, `submitVisaDocumentUpload`. This is a hard rule
  from `AGENTS.md`, not a suggestion.
- Match the domain vocabulary already used in the codebase (`pilgrim`,
  `departure group`, `seat hold`, `agency`) rather than inventing synonyms.
- File names are kebab-case; components are PascalCase; hooks start with
  `use`.

## File placement

- Route/UI code lives under `app/(main)/<module>/**` (or `(portal)` /
  `(agent-portal)` for the customer/agent-facing surfaces).
- Data-access code lives under `lib/data/**` or `lib/<domain>/**` — never
  inline a Supabase query inside a component when a data-access module is
  the right home for it.
- Validation schemas live in `lib/validations/<domain>.ts`.
- Access/permission checks live in `lib/access/<domain>-access.ts`.
- Cross-cutting helpers (`lib/utils.ts`, `lib/date.ts`) are for things used
  by multiple unrelated domains — a domain-specific helper belongs in that
  domain's folder, not in a shared grab-bag file.

## TypeScript

- No `any`. If a type is genuinely unknown at a boundary (webhook payload,
  AI response), parse it through a Zod schema and use the inferred type
  from there on.
- Prefer explicit return types on exported functions in `lib/**` — it's
  the contract other modules read.
- Discriminated unions for state that has distinct shapes per case (e.g.
  `{ ok: true } | { ok: false; error: string }`, already used in
  `lib/tenancy.ts`) rather than optional fields that are only sometimes
  present.

## Comments

- Default to no comments. Code should read clearly from naming and
  structure.
- Write a comment only when it explains a *non-obvious why*: a constraint
  from the database, a workaround for a specific bug, a trade-off that
  isn't visible from the code itself. `lib/dal.ts` and `lib/tenancy.ts`
  are good examples of this — every comment there earns its place by
  explaining a decision, not narrating what the next line does.
- Reference the specific doc/migration/issue a decision came from when it
  helps a future reader avoid re-breaking it (e.g. "see
  `docs/modules/team-module-remediation-plan.md` §10").

## Scope discipline

- Don't refactor unrelated code while fixing a bug or building a feature.
  A three-line duplication is fine; don't extract a premature abstraction
  for it.
- Don't add validation, error handling, or fallbacks for states that can't
  occur given the caller's guarantees. Validate at system boundaries
  (user input, external APIs, webhooks) — trust internal contracts
  elsewhere.
- No feature flags or backwards-compatibility shims for internal code —
  change the call sites instead.

## Error handling

- Server Actions return a typed result (`{ ok: true, data } | { ok: false,
  error: string }`), not a thrown exception the UI has to guess about.
  Reserve thrown errors for truly exceptional/unexpected states (a bug,
  not an anticipated failure like "seat hold expired").
- User-facing error messages are specific enough to act on ("You are not
  an active member of that workspace.") — not a generic "Something went
  wrong" when the failure mode is known.

## Linting & type-checking

- `npm run lint` must pass with 0 errors before a PR is opened (warnings
  are tracked, not yet a hard gate — see
  [`docs/architecture/production-readiness-plan.md`](../architecture/production-readiness-plan.md)).
- `npm run typecheck` must pass — no `@ts-ignore` to silence a real type
  error; fix the type.
