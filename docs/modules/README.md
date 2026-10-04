# Module Docs

One implementation plan (and, where the domain is large enough, a
dedicated architecture doc) per module: leads, departure groups, pilgrims,
documents, visa, finance/payments, packages, suppliers, team, reports,
settings, inbox, WhatsApp integration, Manasik intelligence, campaigns, and
operations.

Each plan is the design spec the module was (or is being) built against —
see the repo root `README.md`'s "Further reading" section. When a module's
implementation diverges from its plan, update the plan; don't leave it
describing a version of the module that no longer exists.

The Inbox has two layers of plan. The channel-neutral conversation
platform is documented here, in
[`inbox-architecture.md`](./inbox-architecture.md) and
[`inbox-implementation-plan.md`](./inbox-implementation-plan.md). The
intelligence layer built on top of it — Manasik Inbox + Manasik Copilot —
has its own folder, [`docs/inbox/`](../inbox/README.md), holding its
architecture, implementation plan and build checklist.

Cross-module/system-level design (multi-tenancy, roles & permissions, the
package/departure domain model, design tokens) lives in
[`docs/architecture/`](../architecture/) instead, since it isn't owned by
any single module.

For the process to follow when adding a new module or feature, see
[`docs/standards/feature-development-workflow.md`](../standards/feature-development-workflow.md).
