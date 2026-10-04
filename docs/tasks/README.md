# Tasks

One-off feature/change plans, saved as `TASK-###-<short-feature-name>.md`
(zero-padded to 3 digits, e.g. `TASK-001-invoice-pdf-export.md`). Numbers
are sequential — check the highest existing number in this folder before
assigning the next one.

Use a `TASK-###` doc for a discrete change: a new endpoint, a targeted
fix, a small feature that doesn't warrant a full module design doc. For a
new module or a large cross-cutting feature, write it (or its lasting
design record) under [`docs/modules/`](../modules/) or
[`docs/architecture/`](../architecture/) instead — see
[`docs/standards/feature-development-workflow.md`](../standards/feature-development-workflow.md)
for which one applies.

## Template

```markdown
# TASK-### <Feature Name>

## What
One or two sentences: what is being built.

## Why
The problem or request driving this.

## Data model changes
New/changed tables, columns, RLS policies. "None" if there aren't any.

## Access control changes
New/changed capabilities, roles affected. "None" if there aren't any.

## UI surfaces
Pages/components touched or added.

## Test plan
What will be covered by an automated test, and what needs manual
verification in the browser.

## Status
Draft / In progress / Done — keep this current as the work proceeds.
```

Keep the doc updated as the work proceeds — a `TASK-###` file that still
says "Draft" after the feature has shipped is a stale doc, not a historical
record; either update it to `Done` with what actually got built, or fold
its final state into the relevant module doc and note that here.
