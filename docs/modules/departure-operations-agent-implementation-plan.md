# Departure Operations Agent — Implementation Plan

The second of five Agentic AI surfaces on this CRM, and the first **autonomous** one. Where the
WhatsApp AI Agent (`docs/whatsapp-ai-agent-implementation-plan.md`) is a *conversational* agent
that answers a human in real time, this one is a *background operator* that nobody talks to. It
wakes on a schedule, reads one departure group's operational state, decides what is stopping that
group from travelling, and either does the internal work itself or asks a human for permission.

Status: **Not started.** Everything it needs to reuse already exists and is listed in §1.

The product rule the whole plan enforces:

```text
Mission        →  make every group departure green before travel.
Green          →  group_status = READY_TO_DEPART, certified against the real rows.
Truth          →  deriveReadinessStatuses() / buildBlockers() / scoreReadiness(). Not the model.
Agent          →  triage, sequencing, root cause, drafting. It decides what to DO, never what IS.
Autonomy       →  internal, reversible, agency-only work.
Human approval →  supplier bookings, itinerary changes, external commitments. Always. No exceptions.
```

And the boundary it must not cross:

```text
The model may schedule work, chase an owner, and draft a request.
The model may not confirm a hotel, move a date, ticket a PNR, message a customer,
touch money, or certify a group as ready.
```

Three rules carried into every section:

- **The deterministic engine is the source of truth.** `deriveReadinessStatuses()`,
  `buildBlockers()` and `scoreReadiness()` already compute what is wrong with a group, from the
  real flight/hotel/booking/pilgrim rows, and they already refuse to be overridden by hand. The
  agent consumes their output. It never recomputes readiness, and a finding it invents that the
  engine does not corroborate is not persisted.
- **Every write goes through an existing `*InStore` mutator inside `mutate()`.** This module adds
  no second way to touch a departure group. If the agent needs behaviour `lib/data/*` does not
  have, the change lands in `lib/data/*` and the Departure Groups UI gets it too.
- **Approval is a mechanism, not a prompt instruction.** "Ask a human before booking a supplier"
  written in a system prompt is a suggestion. Here it is enforced by the tool registry (the agent
  is never handed a supplier-writing tool at all) and by the executor layer (which runs under the
  *approving human's* identity and capabilities, never the agent's).

---

## 1. What exists today — the real starting point

This is not a greenfield build. The following already ship and are the substrate:

| Asset | Where | Why it matters here |
|---|---|---|
| Deterministic readiness engine | [departure-groups-readiness.ts:38](lib/data/departure-groups-readiness.ts:38) `deriveReadinessStatuses()` | 14 `auto_source` rules derive item status from flights, hotels, transport, payments, documents, visas, rooming, guide and manifest. Already refuses manual override of a derived item. |
| Blocker builder | [departure-groups.ts:1150](lib/data/departure-groups.ts:1150) `buildBlockers()` | Ranked CRITICAL/WARNING list with a target tab and filter per blocker. This is the agent's work queue, pre-computed. |
| Readiness score + status | `scoreReadiness()`, `syncDerivedColumns()` | Score, category progress, blocker count — derived on read *and* on write, so they cannot fall stale. |
| The ready gate | [departure-groups-lifecycle.ts:576](lib/data/departure-groups-lifecycle.ts:576) `MARK_READY` | Already refuses to certify unless every required item is `COMPLETE`. The agent's goal state has a server-side gate already written. |
| Unit of work with an actor override | [departure-groups.ts:509](lib/data/departure-groups.ts:509) `mutate(groupIds, run, { client, actor })` | **The single most important enabler.** A session-less caller can already run any mutator with an admin client and an explicit actor. Nothing needs rewriting for the agent to write. |
| Session-less reads | `listDepartureGroups({ client })`, `listConfirmedHotels(id, client)`, `getPackageSnapshotRow(id, client)` | The `client?: Db` parameter pattern is established (F3 of the WhatsApp plan). |
| Job queue + drain, **as a design** | `agent_jobs`, `claim_agent_jobs()` (FOR UPDATE SKIP LOCKED), [drain.ts](lib/agent/whatsapp/drain.ts) `processDueJobs({ budgetMs })`, `GET /api/cron/agent-jobs` | A working, claim-safe, budgeted background worker with retries, a `DEAD` terminal state and `CRON_SECRET` auth — **the shape is reused, not the tables themselves.** F-DRIFT found the live `agent_jobs` doesn't match this table's migration file, so Phase 1 built `departure_ops_jobs` to the same design instead of altering it. |
| Agent runtime | [runtime.ts](lib/agent/whatsapp/runtime.ts) — `client.beta.messages.toolRunner`, adaptive thinking, per-call `effort`, prompt-cache-ordered system prompt | The loop shape, the model id (`claude-opus-5`), the usage accounting. Phase 0 extracted the model/client plumbing into `lib/agent/kernel/runner.ts`, shared by every agent. |
| Tool wrapper | [kernel/telemetry.ts](lib/agent/kernel/telemetry.ts) `wrapWithTelemetryAndRedaction()` | Per-call telemetry and a defensive allowlist redaction pass. Moved to the kernel in Phase 0 — was `lib/agent/tools/registry.ts`, WhatsApp-specific. |
| Observability, **as a design** | `agent_runs`, `agent_tool_calls` | Cost, latency, stop reason, per-tool arguments and redacted results, already RLS'd to ADMIN/CEO — again the shape is reused (`departure_ops_runs`/`departure_ops_tool_calls`), not the tables (F-DRIFT). |
| Approval vocabulary | `pilgrim_charges.requires_approval`, `departure_group_pilgrim_deviations` REQUESTED → APPROVED → ARRANGED | The agency already runs a request/decide/arrange workflow. The proposal queue reuses its shape and its language. |
| Activity trail with a system actor | `departure_group_activity_logs` (`actor_id` nullable, `is_system`, `is_high_impact`) | An AI actor is already representable: `{ id: null, name: "Departure Operations Agent" }`, `is_system = true`. |
| Role capabilities | [departure-groups-access.ts](lib/access/departure-groups-access.ts) `capabilitiesFor(role)` | 23 named capabilities. The approval layer checks against these, not a new permission model. |
| Operations Control Center | `app/(main)/operations/`, `lib/types/operations.ts` | A cross-group cockpit that already reuses `buildBlockers`/`scoreReadiness`. The natural home for the approval queue. |
| Machine-route bypass | [proxy.ts:20](proxy.ts:20) `MACHINE_ROUTES = ["/api/webhooks", "/api/cron"]` | Cron routes already skip the session refresh. |

**Conclusion:** roughly 70% of this agent is wiring existing parts together. The genuinely new
engineering is the *proposal/approval subsystem* (§6, §9) and the *scheduler* (§10). Everything
else is composition.

---

## 2. Where this sits among the five agents

| Agent | Trigger | Talks to | Writes |
|---|---|---|---|
| **1. WhatsApp Sales Agent** (built) | Inbound message | Customer | Lead, note, `HELD` booking, handoff |
| **2. Departure Operations Agent** (this plan) | Schedule + events | Nobody. Staff read its output. | Internal tasks, findings, **proposals** |
| 3–5 (future) | — | — | — |

Because agents 3–5 are coming, **Phase 0 extracts a shared kernel** rather than copying
`lib/agent/` a second time:

```text
lib/agent/
  kernel/            ← shared by every agent
    context.ts       AgentContext (agencyId is server-derived, never model-supplied)
    runner.ts        toolRunner wrapper + usage accounting + telemetry
    registry.ts      wrapWithTelemetryAndRedaction, capability gating, tool classes
    telemetry.ts     agent_runs / agent_tool_calls writers
    proposals/       the approval subsystem — shared, because agents 3–5 will need it
      types.ts       ProposalKind, ProposalRisk, ProposalStatus
      executors.ts   the executor registry contract
      service.ts     create / approve / reject / supersede / expire
  whatsapp/          ← today's lib/agent/{prompt,guardrails,phone,tools/*} move here unchanged
  departure-ops/     ← this plan
    snapshot.ts      the deterministic read model
    prompt.ts
    guardrails.ts
    scheduler.ts
    tools/
    executors/
```

This is a **move, not a rewrite**: the WhatsApp agent's behaviour must be identical after Phase 0
(one `git mv` per file plus import rewrites, verified by `npm run typecheck` and its existing
surface).

---

## 3. Decisions

| # | Decision | Why |
|---|---|---|
| **D1** | The agent is **not conversational**. No chat surface, no inbox, no user to answer. Its output is findings (a risk narrative), tasks (internal work), and proposals (asks). | An operations agent that chats invites a human to negotiate with it. Every output here is a durable row a human acts on later, which is also what makes it auditable. |
| **D2** | **The model never computes readiness.** The snapshot handed to it already contains derived item statuses, ranked blockers, the score, and the days-to-departure tier. | The engine is already correct and already tested. A model that re-derives "the Makkah hotel looks confirmed" reintroduces exactly the two-screens-one-group disagreement `auto_source` was built to end. |
| **D3** | Every capability is classified into **four action classes**, enforced by which tools exist in the tool set — not by prompt text: `READ` → `INTERNAL_WRITE` → `HUMAN_APPROVAL` → `FORBIDDEN`. See §5. | A guardrail expressed as an instruction is advisory. A guardrail expressed as "that function is not in the array" cannot be talked around. |
| **D4** | Class-2 actions produce an **`agent_proposals` row**, never a direct write. A human approves; an **executor** then performs the change by calling the same `*InStore` mutator the UI's Server Action calls, **under the approving human's `GroupActor` and capability set**. | This is the whole human-approval design in one sentence. The approval is not a rubber stamp on an agent write — the agent's write never happens. The human's write happens, with the agent's payload as its input. RLS, capabilities and the activity trail then all work unmodified. |
| **D5** | A proposal payload is a **typed, Zod-validated, closed** shape per `kind`. There is no free-form "call this function with these args" proposal. | An open payload is a remote-code-execution surface where the attacker is a language model. A closed set of ~18 kinds is auditable and reviewable. |
| **D6** | Approving a proposal **re-validates the world**, then executes. If the fields it depends on changed since it was written, it is marked `SUPERSEDED` and never runs. | `canHoldSeats()` already establishes this posture for the WhatsApp agent: eligibility is re-checked at the moment of commitment, not at the moment of suggestion. A hotel proposal written on Monday must not overwrite Tuesday's manual confirmation. |
| **D7** | Proposals and tasks are **fingerprinted and deduplicated**. A rejected fingerprint enters a cooldown, and the rejection reason is fed back into the next run's prompt for that group. | Without this the agent re-proposes the same thing every four hours and the queue becomes noise nobody reads — the most likely way this feature dies in production. The rejection feedback loop is also how the agency teaches it, with no fine-tuning. |
| **D8** | All writes in a turn are **staged in memory and committed atomically** when the model calls the terminal `submit_review` tool. A run that ends without `submit_review` persists nothing but telemetry. | Mirrors `mutate()`'s own "a failed outcome writes nothing" contract, makes the whole turn unit-testable, and makes shadow mode a one-line change (stage, then discard). |
| **D9** | The model call is **skipped** when the group's material fingerprint is unchanged, the escalation tier has not advanced, and no open item has aged past its threshold. The run is still recorded, with status `NOOP`. | 200 groups × 4 reviews/day at Opus prices is the difference between a feature and a line item. Most reviews of most groups have nothing new to say. |
| **D10** | ~~The queue, worker, cron route and retry semantics are `agent_jobs` unchanged.~~ **Superseded — see F-DRIFT below.** The agent gets its own `departure_ops_jobs` queue and `departure_ops_runs`/`departure_ops_tool_calls` observability, built to the *same design* (same claim-function pattern, same retry/`DEAD` semantics, same cron route) but as separate tables, never altering `agent_jobs`/`agent_runs`. | The reuse this decision originally argued for assumed `agent_jobs`/`agent_runs` in the live database match their migration files. F-DRIFT found they do not, and fixing that mismatch is a separate, pre-existing problem with the WhatsApp Sales Agent this plan should not be entangled with. Duplicating the (small, proven) queue/observability shape costs one migration section; coupling to an uncertain, already-mismatched table costs a second outage. |
| **D11** | Cadence is a pure function of `daysUntilDeparture` (§10.1), plus event-driven re-review debounced by 10 minutes and coalesced by a partial unique index. | A group 200 days out does not need a daily opinion. A group departing Thursday needs one every two hours. One table of tiers, no per-group configuration to drift. |
| **D12** | Rollout is staged per agency **and per group**: `OFF → SHADOW → PROPOSE → ACTIVE`. `SHADOW` runs the full loop and records what it *would* have done, writing nothing. | The approval rate in SHADOW/PROPOSE is the evidence that decides whether `ACTIVE` is safe. Shipping straight to autonomous writes is how an agent loses an agency's trust in one afternoon. |
| **D13** | Model: **`claude-opus-5`**, adaptive thinking, `effort` scaled by tier — `low` beyond T-45, `medium` inside T-21, `high` inside T-7. Reuses `MODEL_ID` from `lib/agent/kernel/runner.ts`. | One model id in the codebase. Effort follows consequence: a mistake 90 days out is cheap, a mistake on Thursday is not. |
| **D14** | `MARK_READY` — the mission's success condition — is itself a **proposal**, never autonomous. | Certifying a group is a human signing their name against a departure. The agent's contribution is assembling the evidence pack so the click is a five-second review instead of an hour of tab-hopping. |
| **D15** | Cancellation, deletion, discount approval, refunds, and every write to visa/passport/document records are **FORBIDDEN** — not even proposable. The agent may only raise a *task* saying a human should consider one. | These are irreversible or legally consequential. An approval queue containing "Cancel this group" is a queue where one mis-click ends 40 people's trip. |

---

## 4. Findings — what will bite during the build

| # | Finding | Impact | Fix |
|---|---|---|---|
| **F1** | `getDepartureGroupDetail(groupId, role)` at [departure-groups.ts:1531](lib/data/departure-groups.ts:1531) calls `await db()` with **no `client` parameter**, unlike `listDepartureGroups`. From a session-less worker it returns nothing. | **Blocking.** The agent's primary read does not work in the context it runs in. | Phase 2 threads `client?: Db` through `getDepartureGroupDetail` (and its `getGroupCostingRow` call site), matching the established `listDepartureGroups({ client })` signature. Backwards-compatible. |
| **F2** | Both `getDepartureGroupDetail` and `listDepartureGroups` are wrapped in React `cache()` — **request-scoped memoisation**. The drain loop processes many groups inside one request. | A read-after-write inside one drain invocation returns the pre-write value; worse, a sweep touching 50 groups holds 50 hydrated stores in memory for the life of the request. | The agent reads through `buildOpsSnapshot()` (§7), which calls `loadStore()` directly and is **not** `cache()`-wrapped. The `cache()` entrypoints stay for the UI, untouched. |
| **F-DRIFT** | **The live database's `agent_jobs`/`agent_runs`/`agent_tool_calls`/`conversations`/`conversation_messages`/`booking_sessions` do not match the migration files that describe them, and `ai_settings` does not exist live at all.** Confirmed two ways: PostgREST's OpenAPI schema (column-by-column: live `agent_jobs` has `job_type`/`lease_until`, not `kind`/`locked_at`/`locked_by`; live `agent_runs` has `tier`/`role`/`model_requested`/`model_served`/`cost_usd`/`turn_count`, not this repo's `model`/`effort`/`stop_reason` design) and `supabase migration list` against the linked project, which shows **every migration file in this repo with an empty `Remote` column** — none were ever applied through tracked history; the whole database was hand-copied into the SQL editor over time. Every Departure Groups/Packages/Leads/Staff table matches its migration file exactly; only the WhatsApp/AI-agent tables diverge, and all of them are empty (0 rows), except `whatsapp_integrations` (2 live rows, unaffected by this). | `lib/agent/whatsapp/*` — the existing WhatsApp Sales Agent code, unrelated to anything in this plan — has been querying columns that don't exist in production since before this plan started. And this plan's own D10 (reuse `agent_jobs`/`agent_runs`) assumed a table shape that isn't real, which is what actually blocked Phase 1's first migration attempt. | Two separate fixes, not one: (1) **This plan** stops depending on the disputed tables entirely — D10 revised, §6 gives the Departure Operations Agent its own `departure_ops_jobs`/`departure_ops_runs`/`departure_ops_tool_calls`, and creates `ai_settings` fresh (pure addition, nothing live conflicts with it). (2) **Repairing the WhatsApp Sales Agent's schema mismatch** is out of scope here — a separate, pre-existing bug, flagged for the user rather than silently fixed or silently worked around. |
| **F3** | `departure_ops_jobs.kind` and `departure_ops_runs.status` are **CHECK constraints**, defined fresh in this migration rather than widened from `agent_jobs`/`agent_runs` (see F-DRIFT — those tables' live shape made widening them unsafe). | N/A now that the tables are new — noted for history; the constraint values (`DEPARTURE_OPS_SWEEP`/`DEPARTURE_OPS_REVIEW`, and `...NOOP, INCOMPLETE`) are correct from creation. | The migration creates both CHECKs inline, matching `agent_jobs`/`agent_runs`' original *design* without touching the tables themselves. |
| **F4** | ~~`agent_runs` needs a `surface` column~~ — moot: `departure_ops_runs` is its own table, so every row in it is already unambiguously a Departure Ops run. `departure_group_id` is `not null` on it directly (this agent never runs without a group), rather than a nullable column bolted onto a shared table. | N/A — `app/(main)/management/ai-agent/ai-agent-activity.tsx` continues reading only `agent_runs` (the WhatsApp agent's own table) unchanged; a future Departure Ops management panel (§12.3) reads `departure_ops_runs` instead of filtering a shared table by `surface`. | No column addition needed. |
| **F5** | `departure_ops_jobs` needs the same coalescing protection `agent_jobs` would have needed. | A group with five high-impact edits in a minute enqueues five reviews — five model calls for one state change, the last four racing each other's proposals. | Partial unique index on `(agency_id, kind, (payload->>'groupId'))` `where status = 'QUEUED'`, plus a 10-minute `run_after` debounce on event-driven enqueues. Insert uses `on conflict do nothing`. |
| **F6** | There is **no notification infrastructure anywhere in the schema** (grep for `notification` returns nothing). | A proposal queue nobody is told about is a queue nobody reads, and the agent silently stops mattering. | V1 answers this with *placement*, not push: a count badge on the Operations nav item, a per-group Agent tab badge, and the group Overview's blocker strip. A digest channel is explicitly deferred to §16. |
| **F7** | `capabilitiesFor(role)` has **no AI role** and should not gain one. | An agent executing under a synthetic `AI` role would need every capability — a superuser with no human behind it. | D4: executors run under the approving human's `GroupActor`. The proposal declares `required_capability`, checked against `capabilitiesFor(approverRole)` in the Server Action *before* the executor is reached. |
| **F8** | `deriveReadinessStatuses()` runs on **every read** and again in `syncDerivedColumns()` before every persist. A snapshot's item statuses are a point-in-time read of live rows. | A proposal built from a 6-hour-old snapshot can be stale in a way the agent cannot know. | D6's `dependency_keys` + re-validation at approval time. Deliberately *not* a whole-group hash — that would expire nearly every proposal and train staff to ignore the warning. |
| **F9** | `updateReadinessItemInStore` **refuses** any status change on an item with a non-null `auto_source`. | The most obvious agent action — "mark the Makkah hotel item complete" — is correctly impossible. | This is a feature the plan leans on: the agent's only route to a green checklist is to move the *underlying* row, which is exactly the Class-2 proposal path. `AUTO_SOURCE_HINTS` is fed into the prompt so it proposes against the right tab. |
| **F10** | `departure_group_tasks.owner_name` defaults to `''` and `owner_id` is frequently null (documented in `departure-groups-tasks.ts`). | An agent-created task with no resolvable owner is a task nobody sees. | The snapshot carries the group's named owners (`operations_owner_name`, `visa_owner_name`, `finance_owner_name`, `primary_guide_name`) and their `staff_profiles.id`. A task tool call that cannot resolve an owner is rejected at the tool boundary, not silently accepted. |
| **F11** | `persistStore` is **not transactional across collections** — hence `DeparturePartialWriteError`, which can only log loudly. | A multi-collection executor failing halfway leaves the group inconsistent. | Executors are constrained to **single-mutator** operations; D5's closed kind set makes this statically checkable. No proposal kind may span two mutators — a compound change is two proposals with a declared order. |
| **F12** | `departure_groups.available_seats` is a **generated column**; the activity trail is **append-only** in `persistStore`. | An executor writing either fails or is silently ignored. | Already handled by the repository; noted here so no executor is written against those fields. |
| **F13** | **There is no group-broadcast mutator.** `sendGroupCommunications` is a *capability gate only* — its 10 call sites all guard a per-booking reminder button (booking detail, Documents & Visa, Payments, Pilgrims & Bookings), and every one routes to `sendBookingReminderAction` → `sendBookingReminderInStore` ([departure-groups-bookings.ts:1196](lib/data/departure-groups-bookings.ts:1196)). | A `GROUP_SEND_COMMUNICATION` proposal kind has nothing to execute. Building one would also collide with the WhatsApp plan's **D9**, which forbids an autonomous scheduled-broadcast path and keeps `message_templates`' `requires_approval` contract intact. | **Dropped from V1.** Only `BOOKING_SEND_REMINDER` ships, wrapping the mutator that already exists. A group broadcast is a separate product decision with its own compliance surface (Meta's 24-hour service window, F7 of the WhatsApp plan) and does not belong inside an operations agent's first release. This also settles §16 question 2. |

---

## 5. The action class taxonomy — the heart of the safety model

Every capability the agent could conceivably want sits in exactly one class. The class is a
property of the **tool**, resolved at tool-set assembly time in `lib/agent/kernel/registry.ts`,
and re-asserted at the executor boundary.

### Class 0 — `READ`
Everything through `buildOpsSnapshot()` (§7) and its narrow companions. No approval, no limit
beyond the run's iteration cap.

### Class 1 — `INTERNAL_WRITE` — autonomous
Agency-internal, reversible, and **invisible outside the agency**. No supplier, customer or
regulator learns anything as a result.

| Action | Backing mutator |
|---|---|
| Create an operational task | `createGroupTaskInStore` |
| Reassign a task to a named owner | `reassignGroupTaskInStore` |
| Move a task's status (open ↔ in progress) | `updateGroupTaskStatusInStore` |
| Set a readiness item's owner, due date, notes, evidence URL | `updateReadinessItemInStore` (**status excluded** — F9) |
| Append an advisory note to the activity trail | activity row, `is_system = true` |
| Record a finding in the group's risk register | `departure_group_agent_findings` |
| Stage a draft (supplier chase, chaser copy, rooming plan) | stored on a proposal, never sent |

Rate-limited per run (§11). Every row is stamped with the agent actor and shows an **AI** chip.

### Class 2 — `HUMAN_APPROVAL` — proposal only
The agent produces an `agent_proposals` row. Nothing changes until a capable human approves.

| Group | Proposal kinds | `required_capability` | Risk |
|---|---|---|---|
| **Supplier bookings** | `ACCOMMODATION_MARK_CONFIRMED`, `ACCOMMODATION_SET_REFERENCE`, `ACCOMMODATION_SET_VOUCHER`, `ACCOMMODATION_UPDATE`, `TRANSPORT_MARK_CONFIRMED`, `TRANSPORT_SET_REFERENCE`, `FLIGHT_UPSERT`, `FLIGHT_RECORD_TICKETING`, `FLIGHT_MARK_TICKETS_ISSUED` | `manageAccommodation` / `manageTransport` / `manageFlights` | MEDIUM–HIGH |
| **Itinerary / commercial** | `GROUP_UPDATE_DETAILS` (dates, capacity, owners), `GROUP_UPDATE_PRICING`, `DEVIATION_DECIDE`, `DEVIATION_MARK_ARRANGED` | `editGroupDetails` / `overrideCapacityAndPrice` / `manageTravellerCustomisations` | HIGH |
| **Rooming at scale** | `ROOMS_GENERATE`, `ROOMS_AUTO_ASSIGN` | `manageRooming` | LOW |
| **External commitments** | `BOOKING_SEND_REMINDER` (F13) | `sendGroupCommunications` | HIGH |
| **Lifecycle** | `GROUP_MARK_READY` (D14), `GROUP_CLOSE_SALES` | `editGroupDetails` / `cancelOrArchiveGroup` | HIGH |

`risk = HIGH` additionally requires the approver to hold `ADMIN` or `CEO` — configurable per
agency (§14).

### Class 3 — `FORBIDDEN` (D15)
`CANCEL` (group or booking), any delete, `recordBookingPayment`, refunds,
`approvePilgrimCharge`, discounts, and every write to visa/passport/document records. **No tool
exists and no proposal kind exists.** The agent's only recourse is a Class-1 task addressed to a
human.

---

## 6. Schema — one migration

`supabase/migrations/20260919090000_departure_operations_agent.sql` — the file itself is the
source of truth; this section summarises its shape rather than duplicating its SQL, so the two
cannot drift the way an earlier draft of this section did (see **F-DRIFT**).

**Does not alter `agent_jobs` / `agent_runs` / `agent_tool_calls`.** The original design (D10, as
first written) planned to add two `kind` values and two columns to those tables. F-DRIFT found
the live database's versions of those three tables do not match the migration files that describe
them — different column names, a different `agent_runs` design entirely — and that `ai_settings`
does not exist live at all. That mismatch predates this plan and belongs to the WhatsApp Sales
Agent, not here. So instead:

| Section | Creates | Notes |
|---|---|---|
| **A** | `ai_settings` (fresh — F-DRIFT) | Full shape from `20260826090000_ai_agent.sql`, plus this migration's `departure_ops_*` columns. A pure addition — nothing live conflicts with a table that doesn't exist. Seeded with one inert row per agency. |
| **B** | `departure_ops_jobs` + `claim_departure_ops_jobs()` | This agent's own queue — same design as `agent_jobs`/`claim_agent_jobs` (`FOR UPDATE SKIP LOCKED`, `QUEUED`/`RUNNING`/`DONE`/`FAILED`/`DEAD`), scoped to `DEPARTURE_OPS_SWEEP`/`DEPARTURE_OPS_REVIEW`. Coalescing partial unique index on `(agency_id, kind, payload->>'groupId') where status = 'QUEUED'` (F5) so a burst of edits enqueues one review, not one per edit. |
| **C** | `departure_ops_runs` + `departure_ops_tool_calls` | This agent's own observability — same design as `agent_runs`/`agent_tool_calls` (model, effort, token/latency accounting, redacted tool results), with `departure_group_id not null` from the start (this agent never runs without a group) and `status` including `NOOP`/`INCOMPLETE` from creation, not bolted on. |
| **D** | `departure_group_agent_state` | One row per group — the scheduler's memory (D9, D11): `next_run_at`, `last_fingerprint`, `last_tier`, per-group `mode` override, suppression. |
| **E** | `agent_proposals` + `agent_proposal_events` | The approval queue (D4–D7) and its append-only decision trail. Named generically, not `departure_ops_*` — this is shared kernel infrastructure every future agent that needs human approval reuses (§2), not something specific to this one. `agent_run_id` references `departure_ops_runs`. |
| **F** | `departure_group_agent_findings` | The risk register — one row per finding, `agent_run_id` references `departure_ops_runs`, every CRITICAL/WARNING row constrained (`dg_agent_findings_corroboration` CHECK) to name a corroborating blocker or readiness item id (§11). |
| **G** | RLS on all four new tables (state/proposals/events/findings) | Select mirrors the Departure Groups module's own `viewModule` roles; GUIDE further scoped via `staff_assigned_to_group()`, the same helper `20260903090000_departure_group_guide_scoping.sql` wires into the core tables. `agent_proposal_events` has no join-aware path to a group yet, so it is left un-scoped to GUIDE (findings yes, approval history no). Every write is service-role only — Phase 3 adds the authenticated `UPDATE` policy on `agent_proposals` once there is a Server Action to call it. |

---

## 7. The deterministic snapshot — `lib/agent/departure-ops/snapshot.ts`

The single read the agent gets. One hydration, no `cache()` (F2), admin client, explicitly scoped
by `agency_id`.

```ts
export interface OpsSnapshot {
  group: {
    id: string; code: string; name: string; branch: string;
    journeyType: GroupJourneyType;
    departureDate: string; returnDate: string;
    daysUntilDeparture: number;
    tier: EscalationTier;                 // §10.1
    groupStatus: DepartureGroupStatus; salesStatus: GroupSalesStatus;
    capacity: number; bookedSeats: number; heldSeats: number; availableSeats: number;
    minimumGroupSize: number;
    owners: { operations?: Owner; visa?: Owner; finance?: Owner; guide?: Owner; coordinator?: Owner };
  };
  readiness: {
    score: number; status: GroupReadinessStatus;
    categories: ReadinessCategoryProgress[];
    items: {
      id: string; label: string; status: ReadinessItemStatus; required: boolean;
      autoSource: ReadinessAutoSource | null;
      /** AUTO_SOURCE_HINTS[autoSource] — where a human must go to actually move it (F9). */
      movedBy: string | null;
      dueAt: string | null; assignedToName: string | null; daysOverdue: number | null;
    }[];
  };
  blockers: DepartureGroupBlocker[];       // buildBlockers(), verbatim and ranked
  suppliers: {
    flights: { direction; status; pnr: boolean; ticketingDeadline; daysToDeadline }[];
    accommodations: { id; city; status; nights; reference: boolean; voucher: boolean }[];
    transports: { id; routeLabel; status; reference: boolean }[];
  };
  travellers: {
    total: number; travelling: number; waitlisted: number; cancelled: number;
    visaCounts: Record<VisaStatus, number>;
    passportIssues: number;
    documentsOutstanding: number;
    roomsAssigned: number;
    blockingDeviations: number;
  };
  payments: { bookingsOverdue: number; bookingsWithBalance: number } | null;  // null without viewFinance
  work: {
    openTasks: { id; title; ownerName; dueAt; status; category }[];
    openProposals: { id; kind; title; risk; createdAt }[];          // D7 — do not duplicate
    recentRejections: { kind; fingerprint; reason; decidedAt }[];   // D7 — the learning loop
    recentHighImpactActivity: { message; createdAt; actorName }[];
  };
  fingerprint: string;                     // D9
}
```

Two hard rules:

1. **No supplier cost, no margin, no passport number, no traveller PII beyond counts.** The
   snapshot is built from the same allowlist posture as `departure-groups-ai.ts`, and the kernel's
   `FORBIDDEN_KEYS` redaction (already written) is a second pass over every tool result. An
   operations agent needs *counts and statuses*, never a passport number — and `agent_tool_calls`
   persists tool arguments, so anything in the snapshot ends up in a log table.
2. **The fingerprint (D9) hashes only material fields**: every readiness item status, every
   supplier status + deadline, blocker ids, traveller status counts, seat counts, group status, and
   open-work ids. It deliberately excludes `updated_at`, activity rows and score arithmetic, so
   ordinary churn does not force a model call.

`buildOpsSnapshot()` calls `loadStore()` once, then `syncGroupDerivedState()` +
`deriveReadinessStatuses()` + `scoreReadiness()` + `buildBlockers()` — the same four calls
`getDepartureGroupDetail` makes. **No new derivation logic is written.** F1's `client` parameter is
added so the UI path and this path share the underlying reads.

---

## 8. The tool layer — `lib/agent/departure-ops/tools/`

Every tool carries a `class` and is filtered at assembly time by mode and capability flags (§14).
Descriptions state *when not* to use a tool as prominently as when to.

| Tool | Class | Notes |
|---|---|---|
| `get_group_snapshot` | READ | The snapshot above. Usually pre-loaded into the prompt; the tool exists for a mid-turn refresh. |
| `get_readiness_item_detail` | READ | One item, its history, its `movedBy` hint. |
| `get_supplier_context` | READ | Supplier directory row for a linked hotel/transport: reliability, typical response time, open commitments. Reads `lib/data/suppliers.ts`. **No pricing.** |
| `get_similar_group_history` | READ | How the last N comparable departures resolved this blocker, and how long it took. This is what makes due dates realistic rather than invented. |
| `create_task` | INTERNAL_WRITE | Owner must resolve to a named person (F10). Fingerprinted. |
| `reassign_task` / `update_task_status` | INTERNAL_WRITE | |
| `update_readiness_item_meta` | INTERNAL_WRITE | Owner, due date, notes, evidence. **No `status` field in the schema at all** (F9, D3). |
| `record_finding` | INTERNAL_WRITE | Risk register row. Must name a `corroborating_blocker_id` unless severity is `INFO`. |
| `propose_action` | HUMAN_APPROVAL | The single Class-2 tool. Discriminated union over `kind`; payload validated by that kind's Zod schema (D5). Returns the proposal id so the model can link a finding to it. |
| `submit_review` | terminal | `{ summary, confidence, tierAssessment }`. Commits the staged buffer (D8). Nothing persists without it. |

Notice what is **absent**: there is no `confirm_hotel`, no `send_message`, no `mark_ready`, no
`record_payment`. Not disabled — absent. That is D3.

`propose_action`'s schema, in outline:

```ts
const ProposalInput = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("ACCOMMODATION_MARK_CONFIRMED"),
    accommodationId: z.uuid(),
    confirmationReference: z.string().min(3),
    confirmedNights: z.number().int().positive(),
    title: z.string().max(120),
    rationale: z.string().max(600),
    evidence: z.array(EvidenceRef).max(5),
    draftBody: z.string().max(2000).optional(),   // the chase email, for the human to send
  }),
  /* … 17 more kinds … */
]);
```

Each kind's `required_capability`, `risk`, `dependency_keys` builder and `expires_at` window come
from the **executor registry** (§9), not from the model. The model supplies the *content* of a
proposal; the system supplies its *authority*.

---

## 9. The proposal → approval → execution subsystem

This is the part that does not exist yet, and the part the whole feature's safety rests on.

### 9.1 Executor contract — `lib/agent/kernel/proposals/executors.ts`

```ts
export interface ProposalExecutor<TPayload> {
  kind: ProposalKind;
  schema: z.ZodType<TPayload>;
  requiredCapability: keyof DepartureGroupCapabilities;
  risk: ProposalRisk;
  /** How long this kind of ask stays meaningful. A ticketing deadline is short; rooming is long. */
  ttlHours: number;
  /** Which snapshot fields must be unchanged at approval time (D6/F8). */
  dependencyKeys(payload: TPayload): string[];
  /** Deduplication identity (D7). */
  fingerprint(payload: TPayload): string;
  /** Rendered for the human. Never re-derived at render time — stored on the row. */
  describe(payload: TPayload, snapshot: OpsSnapshot): { title: string; humanDiff: DiffLine[] };
  /**
   * Performs the change by calling exactly ONE existing *InStore mutator through mutate(),
   * with the APPROVING HUMAN's actor and the session client (D4, F11).
   */
  execute(
    payload: TPayload,
    ctx: { groupId: string; actor: GroupActor; role: StaffRole },
  ): Promise<{ ok: true } | { ok: false; error: string }>;
}
```

**An executor contains no business logic.** `ACCOMMODATION_MARK_CONFIRMED`'s `execute` is:

```ts
execute: (p, ctx) =>
  mutate([ctx.groupId],
    (store, actor) => markAccommodationConfirmedInStore(store, p, actor),
    { actor: ctx.actor }),
```

— the identical call `markAccommodationConfirmedAction` already makes. Every capacity gate, seat
reconciliation, activity-log entry and derived-column resync therefore happens exactly as it does
for a human click, because it *is* a human click, with a machine-drafted payload.

### 9.2 The approval Server Action — `approveAgentProposalAction`

Order matters; each step is a refusal point:

1. `getCurrentStaffRole()` → role, staffId, agencyId. **No session, no approval.**
2. Load the proposal `for update`. Reject unless `status = 'PROPOSED'`.
3. `agency_id` must equal the caller's active agency. (Tenancy, not just RLS.)
4. `capabilitiesFor(role)[proposal.required_capability]` must be `true` (F7).
5. If `risk = 'HIGH'`, role must be in `ai_settings.departure_ops_high_risk_roles`.
6. `expires_at > now()`, else → `EXPIRED`.
7. **Re-validate (D6):** rebuild the snapshot, recompute `dependency_hash` over `dependency_keys`.
   Mismatch → `SUPERSEDED`, an event row, and a re-review enqueued. The human is told *which* field
   moved, so a supersede reads as useful, not as a failure.
8. `schema.parse(payload)` — again. The row has been sitting in a database since it was written.
9. `executor.execute(payload, { actor: theApprover, role })`.
10. On success: `EXECUTED` + `executed_at`; event row `EXECUTED`. On failure: `FAILED` +
    `execution_error`; event row `EXECUTION_FAILED`; the proposal stays visible with a retry.
11. `revalidatePath` the group and the Operations queue.

**Reject** (`rejectAgentProposalAction`) requires a `decision_note` when `risk >= MEDIUM`. The note
is the training signal: it lands in `recentRejections` on the next snapshot, and the prompt
instructs the agent to treat a rejected fingerprint as settled for
`departure_ops_rejection_cooldown_days` (D7).

**Edit-then-approve** is supported for LOW/MEDIUM risk: the human adjusts the payload in the UI,
which writes an `EDITED` event with the diff, then proceeds from step 4. The agent's suggestion
becoming a human's corrected action is the most common good outcome, and it must be one dialog —
not "reject, then go do it by hand in another tab".

### 9.3 Expiry and supersession

A `DEPARTURE_OPS_SWEEP` pass expires proposals past `expires_at` and supersedes any whose
`dependency_hash` no longer matches — so a hotel a human confirmed manually on Tuesday clears
Monday's proposal from the queue without anyone touching it. Queue hygiene is not optional; a
stale queue is an ignored queue (F6).

---

## 10. Scheduling and the run loop

### 10.1 Escalation tiers (D11)

| Tier | Days to departure | Cadence | `effort` | Posture |
|---|---|---|---|---|
| `PLANNING` | > 90 | weekly | low | Structural gaps only: no guide, no hotel requested, capacity vs. minimum size. |
| `BUILDING` | 90–46 | every 3 days | low | Supplier requests should be *out*. Chase what has not been asked for. |
| `CONFIRMING` | 45–22 | daily | medium | Confirmations, visa submissions, ticketing deadlines. |
| `FINALISING` | 21–8 | every 12h | medium | Rooming, documents, manifest, payment balances. |
| `IMMINENT` | 7–3 | every 6h | high | Everything outstanding is now critical. Proposals get short TTLs. |
| `CRITICAL` | 2–0 | every 2h | high | Exceptions only. Nothing new is proposed that cannot land today. |
| `POST` | departed | on demand | low | One close-out review, then `mode = OFF`. |

Tiers are derived from `daysUntilDeparture` in `scheduler.ts` — a pure function, unit-tested, with
no per-group configuration to drift.

### 10.2 `DEPARTURE_OPS_SWEEP` — cron, every 15 minutes

A new cron route (`GET /api/cron/departure-ops-jobs`, mirroring `GET /api/cron/agent-jobs`'s
`CRON_SECRET` bearer auth and `processDueJobs`-style budgeted drain loop) claims from
`departure_ops_jobs` via `claim_departure_ops_jobs()` — see F-DRIFT for why this is a separate
route and queue rather than a `kind` added to the existing one. The sweep job:

1. Expires and supersedes stale proposals (§9.3).
2. Selects groups where `next_run_at <= now()`, mode ≠ OFF, `suppressed_until` has passed, and the
   group is not `CANCELLED`/`COMPLETED`/`CLOSED`.
3. Enqueues one `DEPARTURE_OPS_REVIEW` per group (`on conflict do nothing` against F5's index).
4. Recomputes `next_run_at` from the tier.

Event-driven re-review: an `is_high_impact` activity row on a group enqueues a review with
`run_after = now() + interval '10 minutes'`, coalesced by the same index (F5). Ten minutes is
deliberate — it lets a human finish a burst of edits before the agent reacts to the first one.

### 10.3 `DEPARTURE_OPS_REVIEW` — one group, one turn

```text
1. buildOpsSnapshot(groupId, adminClient)
2. Gate (D9): fingerprint unchanged && tier unchanged && no open item newly overdue
              → record departure_ops_runs{ status: 'NOOP' }, bump consecutive_noop_runs, return.
3. buildSystemPrompt(tier, agency settings, class taxonomy, AUTO_SOURCE_HINTS)
4. toolRunner: model=claude-opus-5, thinking adaptive, effort=tier.effort, max_iterations=12
   ├─ tool calls stage into a per-run buffer (D8)
   └─ terminal submit_review commits
5. Guardrails (§11) run over the STAGED buffer, before commit.
6. Commit: findings + tasks (via mutate) + proposals, in one pass.
   SHADOW mode: skip the commit; serialise the buffer into departure_ops_runs for review.
7. Record departure_ops_runs{ departure_group_id, usage, latency, status }
   + departure_ops_tool_calls rows. Update agent state: last_fingerprint, last_tier, next_run_at.
```

The `budgetMs` deadline in `processDueJobs` already stops one slow group monopolising an
invocation; a group not reached this pass is simply still due next pass.

### 10.4 The system prompt

Cache-ordered exactly as `lib/agent/prompt.ts` does today — frozen preamble first, agency settings
next, volatile snapshot last, with the cache breakpoint before the snapshot.

Frozen preamble, in outline:

```text
You are the Departure Operations Agent for a Hajj & Umrah travel agency. Nobody reads your
output in real time. It is work items and requests that operations staff act on later.

Your goal: every departure group reaches READY_TO_DEPART before it travels.

What is already true, and you must not re-derive it:
- The readiness checklist and the blocker list you are given are computed from the real flight,
  hotel, transport, booking, document, visa and rooming rows. They are correct. Do not argue with
  them and do not restate them as findings.
- An item with a `movedBy` hint cannot be ticked. It follows the row it names. To move it, propose
  a change to that row.

What you may do alone: create and assign tasks, set owners and due dates on checklist items,
record findings, leave notes.

What you may only PROPOSE, for a human to approve: anything a supplier, a customer, or a
regulator would learn about — hotel and transport confirmations, flight and ticketing changes,
itinerary or date or price changes, messages to travellers, and certifying the group ready.

What you may never do, in any form: cancel anything, delete anything, record or refund money,
approve a discount, or touch a passport, visa or document record. If one of those is needed,
create a task for a human and say why.

Rules:
1. Every finding must name the blocker or checklist item that corroborates it. If nothing in the
   data corroborates it, do not report it.
2. Do not repeat work already open. You are given the open tasks and open proposals.
3. Do not re-propose anything in the rejection list. A human has already answered that.
4. Due dates must be reachable. Use the historical resolution times you are given, not optimism.
5. Say less. A review with one real finding beats a review with six restatements of the checklist.
```

Volatile section: the tier and its meaning, the snapshot as JSON, the open work, the rejection
history, and the per-run budgets.

---

## 11. Guardrails — `lib/agent/departure-ops/guardrails.ts`

Checked over the **staged buffer** before commit (D8), so a violation costs a model call and
nothing else.

| Gate | Rule |
|---|---|
| **Class enforcement** | Structural: Class-2 tools are absent from the tool set, so this is a backstop assertion, not the primary control. |
| **Corroboration** | Every `CRITICAL`/`WARNING` finding must carry a `corroborating_blocker_id` present in the snapshot's blockers, or a readiness item id. Uncorroborated findings are dropped (not the whole run) and counted in telemetry — a rising drop rate is the hallucination signal to watch. |
| **Budgets** | ≤ `departure_ops_max_proposals_per_run` (default 5) and ≤ `departure_ops_max_tasks_per_run` (default 10). Exceeding truncates by the agent's own stated priority order, and the run is flagged. |
| **Queue ceiling** | ≤ 12 open proposals per group. At the ceiling, only proposals for `CRITICAL` blockers are accepted. |
| **Dedupe** | Any staged item whose fingerprint matches an open task/proposal, or a rejection inside its cooldown, is dropped silently. |
| **Freeze window** | Inside 48 hours of departure, no `GROUP_UPDATE_DETAILS` or `GROUP_UPDATE_PRICING` proposal is accepted at all. Changing a date or a price two days out is not an operations decision. |
| **Lifecycle sanity** | `GROUP_MARK_READY` is refused at stage time unless every required readiness item is already `COMPLETE` — the same predicate `setGroupLifecycleInStore` enforces, checked early so the human never sees a proposal that would bounce. |
| **Owner resolution** | A task whose owner does not resolve to an active `staff_profiles` row is rejected at the tool boundary (F10). |
| **Tenancy** | `agencyId` comes from the job's group row, never from the model. Every staged row is stamped with it and re-checked at commit. |
| **Kill switches** | `ai_settings.departure_ops_enabled`, `departure_ops_mode`, per-group `mode`, per-group `suppressed_until`. Any of them off ends the run before the model call. |
| **Auto-demotion** | If a group's or agency's 30-day proposal rejection rate exceeds a threshold (default 40%), mode drops `ACTIVE → PROPOSE` and an alert lands on the Operations dashboard. Trust is measured, not assumed. |

---

## 12. UI surfaces

Reuses the module's existing vocabulary — the same `Tone`, badge, drawer and table primitives
Readiness and Operations already use. No new design language.

### 12.1 Group detail → new `agent` tab

`DepartureGroupTabId` gains `"agent"` (a typed union change in
[types.ts:687](app/(main)/departure-groups/types.ts:687), so every consumer is caught by the
compiler). The tab shows:

- **Header strip:** readiness score, tier, last review time, next review time, mode, and a
  **Suppress** control (with reason) for staff who want the agent quiet on this group.
- **Latest review:** the `submit_review` summary and confidence, plus the findings list — severity
  chip, headline, detail, and a link to the blocker's tab+filter (the `DepartureGroupBlocker` shape
  already carries `tab` and `filter`, so navigation is free).
- **Pending approvals:** proposal cards. Title, rationale, the `human_diff` rendered as a from → to
  table, the evidence links, the draft body if present, and **Approve / Edit & Approve / Reject**.
  Risk and required capability are shown; the buttons are disabled with an explanation for a role
  that lacks the capability, rather than hidden.
- **Agent-created work:** open tasks with an **AI** chip, and the decision history.

### 12.2 Operations Control Center → **Approvals** queue

The daily driver, and the answer to F6. A cross-group table over `agent_proposals` where
`status = 'PROPOSED'`, ordered by risk then by the group's days-to-departure. Filters by group,
kind, risk and capability. Bulk-approve is allowed **only** for `risk = 'LOW'` — a bulk-approve
button over supplier commitments defeats the entire design.

A count badge on the Operations nav item is the notification mechanism in V1.

### 12.3 `management/ai-agent` → **Departure Operations** panel

Mode, enable switch, per-class autonomy toggles, budgets, high-risk approver roles, rejection
cooldown, and a live view of `departure_ops_runs` (its own table — no `surface` filter needed,
see F-DRIFT/F4) — runs, NOOP ratio, token spend, proposal funnel, approval rate.

### 12.4 Attribution, everywhere

Any row the agent created renders an **AI** chip sourced from `is_system` + the actor name — in the
activity trail, the task table and the readiness drawer. A staff member must never be unsure
whether a person or the agent wrote something.

---

## 13. Observability and evaluation

**Per run:** `departure_ops_runs` (model, effort, tokens, cache hits, latency, status, group, tier).
**Per tool call:** `departure_ops_tool_calls`, redacted (already built).

**The metrics that decide whether this is working:**

| Metric | Why it is the one to watch |
|---|---|
| **Proposal approval rate**, by kind and risk | The trust signal. Below ~60% on a kind means that kind's proposals are wrong and it should be pulled. |
| **Time-to-green**, vs. a pre-launch baseline | The mission metric. Median days from group creation to `READY_TO_DEPART`. |
| **Blockers open at T-7**, vs. baseline | The outcome that actually costs money. |
| **Uncorroborated-finding drop rate** | The hallucination canary (§11). |
| **NOOP ratio** | Should be high (>60%). A low ratio means the fingerprint is too sensitive and money is being burned. |
| **Cost per group per departure** | Tokens × runs. Must be quoted per departure, not per month. |
| **Supersede rate** | High means the agent reasons on stale snapshots — shorten TTLs or tighten `dependency_keys`. |

**Offline evaluation** — `lib/agent/departure-ops/__evals__/`: `fixtures.ts` (row builders over
`emptyStore()` + the real `UMRAH_TEMPLATE` for a realistic checklist), `check.ts` (the runner —
asserts against `buildOpsSnapshotFromStore()`, the pure core `buildOpsSnapshot()` was split into
specifically so this needs no database) and `scenarios.ts`. **Shipped: 3 of the ~25 originally
scoped** — healthy-on-track, refused-visa-plus-unconfirmed-Madinah-hotel-at-T10, and a
ticketing-deadline-in-3-days case reading the flight readiness item as `AT_RISK`. The infrastructure
(builders + runner) is what makes fixture #4 onward a short scenario function, not new plumbing —
growing to 25 is now authoring, not engineering. What this checks is the deterministic engine only
(blockers, readiness derivation, tier) — never what the model would propose against a snapshot,
which needs a live API call and is a different kind of test. Not wired to a test runner (none is
configured in this repo); `runEvalSuite(GOLDEN_SET)` is a plain function away from one. Intended to
run before every prompt or tool change, once wired up.

---

## 14. Configuration

```bash
# Already present — reused unchanged.
ANTHROPIC_API_KEY=
CRON_SECRET=

# New.
DEPARTURE_OPS_SWEEP_ENABLED=true          # global kill switch, above per-agency settings
DEPARTURE_OPS_MAX_GROUPS_PER_SWEEP=200    # fan-out ceiling per sweep invocation
```

Everything else is per-agency in `ai_settings` (§6.1) and per-group in
`departure_group_agent_state` — deliberately, so an agency can pilot on one group.

The cron schedule gains a second entry pointed at the same route; the sweep is a job kind, not a
new endpoint.

---

## 15. Phases

| Phase | Deliverable | Depends on | Verifiable by |
|---|---|---|---|
| **0** | Kernel extraction: `lib/agent/kernel/` + `lib/agent/whatsapp/`. Pure move + import rewrites. | — | WhatsApp agent behaviour unchanged; `npm run typecheck` clean. |
| **1** | Migration `20260919090000` (§6) + types + RLS. | 0 | Applies standalone against the live project regardless of which earlier migrations were actually run (F-DRIFT); RLS verified per role. |
| **2** | F1/F2 fixes: `client?: Db` through `getDepartureGroupDetail`; `buildOpsSnapshot()` + fingerprint. | 1 | Snapshot builds from an admin client with no session; fingerprint stable across a no-op read. |
| **3** | Executor registry (§9.1) + all Class-2 kinds + `approve`/`reject`/`edit` Server Actions. **No agent yet.** | 2 | A hand-inserted proposal row can be approved through the UI and lands the same write a manual click does. |
| **4** | Tool layer (§8), staged buffer, guardrails (§11), prompt (§10.4). | 3 | Eval fixtures produce expected findings/proposals with no database. |
| **5** | Scheduler + `DEPARTURE_OPS_SWEEP`/`REVIEW` job kinds against `departure_ops_jobs` + new `GET /api/cron/departure-ops-jobs` route + NOOP gate. | 4 | A group's `next_run_at` advances per tier; duplicate enqueues coalesce. |
| **6** | UI: group `agent` tab, Operations Approvals queue, management panel, AI chips. | 3, 5 | A full loop: agent proposes → staff approves → hotel row confirmed → readiness item derives to COMPLETE. |
| **7** | Evaluation harness + metrics views + auto-demotion. | 5 | Approval rate and time-to-green computed from real rows. `metrics.ts` (all 7 §13 metrics, each a real query — required a schema addition, `20260922090000`, since two metrics weren't computable from anything previously persisted), `auto-demotion.ts` (wired into the sweep), `__evals__/` (3 of ~25 fixtures — see §13's own note on that scope trim). Metrics UI surfacing (a dashboard view) is not built — the functions exist and are correct against real rows, but nothing in `management/ai-agent` or Operations calls them yet. |
| **8** | Rollout: `SHADOW` on one agency, one branch → `PROPOSE` → `ACTIVE` for Class-1 only. | 7 | Two weeks of SHADOW with an approval rate above threshold before `PROPOSE`. |

Phase 3 landing before Phase 4 is deliberate, and is the most important sequencing decision here:
**the approval machinery is built and proven with no AI attached to it.** If the executor layer is
correct, an agent behind it can be wrong without being dangerous.

---

## 16. Open questions

1. **Who owns the queue?** F6's badge assumes someone opens Operations daily. If nobody does, a
   digest (WhatsApp template to the operations owner, or email) becomes Phase 6.5 rather than
   deferred. Worth deciding with the agency before Phase 6, not after.
2. **Should the agent draft outbound supplier emails at all?** `draft_body` is designed for it, but
   this CRM has no supplier-messaging channel today — the human copies the text elsewhere. Useful,
   or a half-feature that invites a "just send it" request the design refuses? (Partly settled by
   F13: group broadcast is out of V1 regardless. This question is now only about *drafting*.)
3. **`GROUP_MARK_READY` as a proposal (D14)** — genuinely valuable, or does the existing
   `MARK_READY` gate already make it a one-click act that needs no agent? Worth measuring in SHADOW
   before building the evidence pack.
4. **Cross-group optimisation** is out of scope here (moving a traveller between groups,
   consolidating two under-filled departures). It is a different agent with a different blast
   radius, and it should stay that way.
5. **Guide-scoped visibility**: `departure_group_guide_scoping` restricts guides to their own
   groups. Should a guide see agent findings on their group at all? Leaning yes for findings, no
   for proposals — but that is an agency policy call, not an engineering one.
