# Inbox + Copilot

The dedicated documentation set for turning the Unified Inbox into the
**Manasik Inbox** workspace and the **Manasik Copilot** intelligence
layer. This folder is the whole programme documentation set.

| File | What it is | Read it when |
|---|---|---|
| [`architecture.md`](./architecture.md) | The design record — what changes, what to build, how, the concurrency and cost model, multi-tenancy, autonomy and safety, the commercial model, and the resolved decisions R1–R7 | Before designing or planning anything in this programme |
| [`implementation-plan.md`](./implementation-plan.md) | The ordered build sequence — 33 slices across 7 phases, each with its migration, files, tests and exit criteria | When you are about to build a slice |
| [`scaling.md`](./scaling.md) | The focused multi-tenant scaling plan — scoped Realtime, incremental reads, inbound durability, worker capacity gates and load proof | Before changing Inbox Realtime, worker topology or scale limits |
| [`scale-review-inngest-2026-09-25.md`](./scale-review-inngest-2026-09-25.md) | Point-in-time review of the backend at 500 msg/min: defects, bottlenecks, evidence | Before the proposed scale work |
| [`scale-inngest-implementation-plan.md`](./scale-inngest-implementation-plan.md) | Proposed plan: one Postgres queue + worker for per-message work, Inngest for lifecycle workflows and schedules, end-to-end feature audit, security gaps, cost per agency | Before amending the Architecture with R8 or building any P0/Q/I/D/F/E slice |
| [`launch-readiness-implementation-plan.md`](./launch-readiness-implementation-plan.md) | Release-readiness plan and cross-slice checklist for the full Inbox + Copilot programme | Before preparing a staging or production release |
| [`email-channel-implementation-plan.md`](./email-channel-implementation-plan.md) | Plan for adding Email (generic SMTP+IMAP) as a Gmail-like Inbox channel — read, thread, reply, compose, attachments, search | Before building inbound/outbound email support in the Inbox |
| [`email-trust-guardian-implementation-plan.md`](./email-trust-guardian-implementation-plan.md) | Follow-on plan for safe custom-mail setup, sender/domain verification, delivery safeguards, bounce handling, and health status | Before extending Email setup or delivery behaviour |
| [`checklist.md`](./checklist.md) | Live progress — one checkbox per slice and per deliverable, plus the per-PR gate, decisions and gap tracking | Before starting work, and again before opening the PR |
| [`usage.md`](./usage.md) | Staff and administrator guide — daily workflows, safety rules, operational scenarios and manual acceptance tests | When configuring, using or validating the complete Inbox |
| [`../usages/inbox/everyday-user-guide.md`](../usages/inbox/everyday-user-guide.md) | Plain-language guide for non-technical users — every screen, button, channel rule, role limit and real-life scenario, checked against the code on 2026-10-05 | When training staff or answering "how do I…?" |
| [`inbox-technical-documentation.md`](./inbox-technical-documentation.md) | **How the Inbox works** — one verified map of the code: architecture, inbound/outbound paths, queue and workers, Copilot pipeline, risk gate, realtime, security, scheduled jobs, how to extend (checked 2026-10-05) | When you are new to the Inbox code, or need the big picture before opening a deeper doc |
| [`inbox-user-guide.md`](./inbox-user-guide.md) | **Simple guide for everyone** — what the Inbox is, a screen tour, how-to steps, 28 real scenarios, channel rules, troubleshooting, roles, cheat sheet. Written for non-technical staff | When onboarding someone, or answering "how do I…?" in plain words |
| [`staff-guide.md`](./staff-guide.md), [`admin-guide.md`](./admin-guide.md), [`finance-evidence-guide.md`](./finance-evidence-guide.md) | Short role guides — daily use, boundaries, recovery and expected outcomes | When training or supporting a specific role |
| [`supabase-native-scheduling-plan.md`](./supabase-native-scheduling-plan.md) | Proposed plan to replace Inngest with pg_cron + pg_net and Postgres sweeps (would supersede R8) | Before changing scheduling or lifecycle workflows |
| [`production-wrap-up-plan.md`](./production-wrap-up-plan.md) | The no-new-features production plan: human test scripts for every scenario and the go-live checklist | Before and during the production release |
| [`release-evidence-assisted-operation.md`](./release-evidence-assisted-operation.md) | The Checkpoint P6 evidence record (nothing collected yet) | When deciding assisted operation or an autonomy pilot |
| [`spam-state-contract.md`](./spam-state-contract.md) | What spam means and how it is marked and restored | When working on spam or queues |
| [`channels-and-ai-agent-guide.md`](./channels-and-ai-agent-guide.md) | Deep functional guide — the Inbox dialog, WhatsApp/Messenger/Instagram behaviour, the AI agent and Copilot, every staff task, scenarios, cross-module impact and code-verified caveats | When you need to understand *how* it works and *why*, not just the steps |

## Order of use

1. Read `architecture.md` — at minimum §1 (the deterministic-core rule),
   §3.2 (the gaps) and §16 (the resolved decisions).
2. Find your slice in `implementation-plan.md`. Build exactly that slice
   and nothing adjacent.
3. Tick your boxes in `checklist.md` **in the same PR**, and update its
   Progress table.

## Why this folder exists

The Inbox spans an architecture concern, a module plan and a long-running
build. Splitting those across `docs/architecture/` and `docs/modules/`
made the programme hard to follow, so the three documents live together
here instead. The prior, narrower Inbox docs remain where they are and
are still accurate for the channel-neutral platform this builds on:

- [`../modules/inbox-architecture.md`](../modules/inbox-architecture.md)
  — the conversation platform (connections, identities, canonical
  messages, outbox, realtime)
- [`../modules/inbox-implementation-plan.md`](../modules/inbox-implementation-plan.md)
  — how that platform was delivered

System-wide rules still apply and are not repeated here:
[`../security/security-guidelines.md`](../security/security-guidelines.md),
[`../security/access-control.md`](../security/access-control.md),
[`../standards/`](../standards/), and
[`../architecture/`](../architecture/).
