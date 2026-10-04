<!-- BEGIN:nextjs-agent-rules -->

# Next.js Agent Rules

This repo's full documentation set lives in [`/docs`](docs/README.md).
**Read [`docs/standards/feature-development-workflow.md`](docs/standards/feature-development-workflow.md)
before planning or building any feature or module** — it is the concrete,
ordered checklist these rules summarize. Every rule below links to the doc
that has the full detail.

## Where documentation goes

- A **module-level** implementation plan or architecture doc goes in
  [`/docs/modules`](docs/modules/README.md), named
  `<module>-implementation-plan.md` (or `<module>-architecture.md` for a
  larger domain's cross-cutting design, e.g.
  `docs/architecture/package-departure-architecture-master-plan.md`).
  eg. working on departure-groups → `docs/modules/departure-groups-implementation-plan.md`.
- A **system-wide / cross-module** design doc (multi-tenancy, roles &
  permissions, design tokens, anything not owned by one module) goes in
  [`/docs/architecture`](docs/architecture/README.md).
- A **discrete task/feature plan** (not a whole module) is saved as
  `TASK-### [Feature].md` in [`/docs/tasks`](docs/tasks/README.md) — see
  that folder's README for the required template.
- A **point-in-time verification/progress snapshot** goes in
  [`/docs/progress`](docs/progress/README.md).
- A **manual operational procedure** (verification steps, external
  submission process) goes in [`/docs/runbooks`](docs/runbooks/README.md).
- The **Inbox + Copilot programme** is the one exception to the folders
  above: its architecture, implementation plan and build checklist live
  together in [`/docs/inbox`](docs/inbox/README.md). Anything belonging to
  that programme goes there, not in `/docs/modules` or
  `/docs/architecture`.

## Inbox + Copilot programme

Any work on the Inbox, conversation intelligence, Manasik Copilot,
channel policy, AI cost/entitlements, or the work-lane queue belongs to
this programme. Before touching any of it:

1. Read [`docs/inbox/architecture.md`](docs/inbox/architecture.md) —
   at minimum §1 (deterministic core, LLM at the edges), §3.2 (the gaps
   G1–G15) and §16 (the resolved decisions R1–R7). Those decisions are
   settled; if one turns out wrong, change the Architecture first rather
   than deviating in a slice.
2. Find the slice in
   [`docs/inbox/implementation-plan.md`](docs/inbox/implementation-plan.md)
   and build exactly that slice — one slice, one PR, nothing adjacent.
3. Check [`docs/inbox/checklist.md`](docs/inbox/checklist.md) first to see
   what is already done, and what the slice depends on.

**Tick the checklist as part of the work, never afterwards.** In the same
PR that delivers a slice:

- tick every deliverable box you completed in
  [`docs/inbox/checklist.md`](docs/inbox/checklist.md), using `- [x]`;
- tick the slice's **Slice merged** box **only** when its exit criterion
  is demonstrably met — a merged PR whose exit criterion is unproven
  leaves that box unticked;
- mark work in flight as `- [~]` with the branch or PR beside it, and
  anything deliberately skipped as `- [-]` with the reason on the line;
- update the **Progress** table's counts and status;
- tick the matching R1–R7, G1–G15 and definition-of-done boxes when that
  slice is what closed them.

Never tick a box for code that is written but not merged, for a test that
is planned but not passing, or for an exit criterion nobody measured. An
inaccurate checklist is worse than no checklist — the next agent reads it
instead of re-deriving the state.

## Architecture & security rules

Follow [`docs/architecture/README.md`](docs/architecture/README.md) for
layering (UI → Server Actions/data-access → Zod validation → Supabase +
RLS), multi-tenancy, and access control, and
[`docs/security/security-guidelines.md`](docs/security/security-guidelines.md) /
[`docs/security/access-control.md`](docs/security/access-control.md) for
the non-negotiable security rules — every new table gets RLS in the same
migration, every Server Action/Route Handler starts with `requireUser()`,
every read/write is agency-scoped, all input is validated with Zod at the
boundary. These take precedence over convenience.

## Engineering rules

Follow [`docs/standards/engineering-standards.md`](docs/standards/engineering-standards.md)
for naming, file placement, TypeScript, and scope discipline, and
[`docs/standards/api-conventions.md`](docs/standards/api-conventions.md)
for how Server Actions and Route Handlers are structured. Do not use any
generic names as components or functions — always make the names unique
and specific to what they do.

## UI Rules

Full detail: [`docs/standards/ui-standards.md`](docs/standards/ui-standards.md)
and the visual reference in [`docs/architecture/design-tokens.md`](docs/architecture/design-tokens.md).

- Do not use any other UI components or custom components. Use shadcn UI
  through MCP.
- For any input component needed, use this format:
  ```tsx
  <InputGroup>
  <InputGroupAddon align="block-start">{label}</InputGroupAddon>
  <InputGroupInput {...props} />
  </InputGroup>
  ```
- Make every text have clarity, understandable for everyone.
- Do not use any generic names as components or functions, always make the
  names unique.
- For UI, refer to the images from `/doc/ui` from root, and to
  [`docs/architecture/design-tokens.md`](docs/architecture/design-tokens.md)
  for the type scale and table conventions. Don't change any color — just
  take a reference of how this system wants to be styled.

## Testing rules

Follow [`docs/standards/testing-standards.md`](docs/standards/testing-standards.md):
cover business-rule branching (race conditions, pricing, capacity,
identity resolution) with a Vitest test; `npm run lint`, `npm run
typecheck`, and `npm run test` must all pass before a PR is opened.

<!-- END:nextjs-agent-rules -->
