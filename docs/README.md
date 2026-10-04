# Documentation

Start with [`docs/standards/feature-development-workflow.md`](standards/feature-development-workflow.md)
if you're about to build something — it's the checklist that ties every
other doc here together.

| Folder | What's in it |
|---|---|
| [`architecture/`](architecture/) | System-wide design: layering, multi-tenancy, roles/permissions model, the package/departure domain model, design tokens, cross-module roadmap, production readiness. Start at [`architecture/README.md`](architecture/README.md). |
| [`security/`](security/) | Non-negotiable security rules and the access-control model. |
| [`standards/`](standards/) | Engineering, UI, API, and testing conventions, and the feature-development workflow. |
| [`inbox/`](inbox/) | The Inbox + Copilot programme: architecture, 33-slice implementation plan, and the live build checklist. Start at [`inbox/README.md`](inbox/README.md). |
| [`onboarding/`](onboarding/plan.md) | Agency self-onboarding: signup, guided setup, connector setup. Start at [`onboarding/plan.md`](onboarding/plan.md). |
| [`modules/`](modules/) | Per-module implementation plans (leads, departure groups, pilgrims, documents, visa, finance, packages, suppliers, team, reports, settings, inbox, WhatsApp, Manasik intelligence, campaigns, operations). |
| [`tasks/`](tasks/) | `TASK-###-<name>.md` plans for discrete features/changes. |
| [`progress/`](progress/) | Point-in-time phase verification / progress snapshots. |
| [`runbooks/`](runbooks/) | Manual operational procedures (verification steps, external app-review submissions). |

## Reading order for a new contributor (human or agent)

1. [`architecture/README.md`](architecture/README.md) — how the system is
   put together.
2. [`security/security-guidelines.md`](security/security-guidelines.md)
   and [`security/access-control.md`](security/access-control.md) — the
   rules that don't bend.
3. [`standards/`](standards/) — the four conventions docs (engineering,
   UI, API, testing).
4. The specific module doc under [`modules/`](modules/) for whatever
   you're about to touch.
5. [`standards/feature-development-workflow.md`](standards/feature-development-workflow.md)
   when you're ready to actually plan and build.

See also the repository root [`AGENTS.md`](../AGENTS.md) for the rules
this documentation set is built to enforce.
