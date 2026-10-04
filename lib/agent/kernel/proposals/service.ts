/**
 * The proposal lifecycle — create / approve / reject. See §9 of
 * docs/modules/departure-operations-agent-implementation-plan.md, generalised in
 * Phase 0 (P0.2) to any subject/module per §3.2 of
 * docs/modules/manasik-intelligence-implementation-plan.md.
 *
 * Every function here takes an explicit `Db` client rather than resolving
 * one itself, mirroring `mutate()`'s own pattern: `createProposal` is meant
 * for a session-less caller (an agent), so it always takes the admin
 * client; `approveProposal`/`rejectProposal` are meant for a signed-in
 * human deciding through a Server Action, so they take the session client
 * that action resolved.
 */

import "server-only";

import type { StaffRole } from "@/lib/access/departure-groups-access";
import { hashObject } from "@/lib/agent/kernel/hash";
import { resolveCapability } from "@/lib/agent/kernel/proposals/capabilities";
import type { Db } from "@/lib/agent/kernel/proposals/context-pack";
import { getExecutor } from "@/lib/agent/kernel/proposals/registry";
import type {
  AgentProposalRow,
  ProposalDiffLine,
  ProposalEventKind,
  ProposalRisk,
} from "@/lib/agent/kernel/proposals/types";
import { notifyProposalPending } from "@/lib/data/staff-notifications";
import type { GroupActor } from "@/lib/types/departure-groups";

const RISK_ORDER: Record<ProposalRisk, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };

/* ── create ────────────────────────────────────────────────────────────────── */

export interface CreateProposalInput {
  agencyId: string;
  /**
   * Back-compat alias for `subjectId`, kept because every existing call
   * site (departure-ops's `commitStagedBuffer`) passes this name and every
   * kind registered so far has `subjectType === "DEPARTURE_GROUP"`. New
   * call sites for other modules should pass `subjectId` instead.
   */
  departureGroupId?: string;
  subjectId?: string;
  agentRunId?: string | null;
  kind: string;
  payload: unknown;
  title: string;
  rationale: string;
  evidence?: { label: string; tab: string; filter?: string }[];
  draftBody?: string | null;
  /**
   * Tell the people who can approve it that a proposal is waiting. On by default. A staff member who asks for something
   * themselves and confirms it a moment later (MI4.6's conversions) passes `false`: nobody else needs to be pinged.
   */
  notify?: boolean;
  /** Who asked for it, when a person (not an agent) did. Recorded on the audit trail instead of "Agent". */
  proposedBy?: { id: string | null; name: string };
}

export type CreateProposalOutcome =
  | { ok: true; proposalId: string }
  | { ok: false; error: string; duplicate?: boolean };

/**
 * Validates and writes one proposal. The executor named by `kind` owns
 * every rule about what a valid payload looks like, what this proposal
 * depends on, and how long it stays meaningful — this function is the thin
 * shell around that: parse, build the pack, hash, insert.
 */
export async function createProposal(
  input: CreateProposalInput,
  client: Db,
): Promise<CreateProposalOutcome> {
  const executor = getExecutor(input.kind);
  if (!executor) return { ok: false, error: `Unknown proposal kind: ${input.kind}` };

  const subjectId = input.subjectId ?? input.departureGroupId;
  if (!subjectId) return { ok: false, error: "createProposal requires subjectId (or departureGroupId)." };

  const parsed = executor.schema.safeParse(input.payload);
  if (!parsed.success) {
    return { ok: false, error: `Invalid payload for ${input.kind}: ${parsed.error.issues[0]?.message ?? "validation failed"}` };
  }
  const payload = parsed.data;

  const pack = await executor.loadPack(subjectId, input.agencyId, client);
  if (!pack) return { ok: false, error: "That subject no longer exists." };

  const dependencyHash = hashObject(executor.dependencySnapshot(payload, pack));
  const humanDiff: ProposalDiffLine[] = executor.describe(payload, pack).humanDiff;
  const fingerprint = executor.fingerprint(payload);
  const expiresAt = new Date(Date.now() + executor.ttlHours * 3_600_000).toISOString();
  const isGroupSubject = executor.subjectType === "DEPARTURE_GROUP";

  const { data, error } = await client
    .from("agent_proposals")
    .insert({
      agency_id: input.agencyId,
      departure_group_id: isGroupSubject ? subjectId : null,
      agent_run_id: input.agentRunId ?? null,
      module: executor.module,
      subject_type: executor.subjectType,
      subject_id: subjectId,
      kind: input.kind,
      payload,
      required_capability: executor.requiredCapability,
      risk: executor.risk,
      title: input.title,
      rationale: input.rationale,
      human_diff: humanDiff,
      evidence: input.evidence ?? [],
      draft_body: input.draftBody ?? null,
      dependency_keys: Object.keys(executor.dependencySnapshot(payload, pack)),
      dependency_hash: dependencyHash,
      fingerprint,
      expires_at: expiresAt,
    })
    .select("id")
    .single();

  if (error) {
    // D7: one open proposal per (subject, fingerprint) — a second attempt
    // at the same ask while one is already open is not an error worth
    // surfacing loudly, it is the dedupe working.
    if (error.code === "23505") {
      return { ok: false, error: "An open proposal for this already exists.", duplicate: true };
    }
    return { ok: false, error: `Failed to create proposal: ${error.message}` };
  }

  const proposalId = (data as { id: string }).id;
  await writeEvent(client, input.agencyId, proposalId, "PROPOSED", input.proposedBy?.id ?? null, input.proposedBy?.name ?? "Agent", {});

  // Best-effort, never blocks the proposal itself — see
  // notifyProposalPending()'s own doc comment.
  if (input.notify !== false) await notifyProposalPending(
    {
      agencyId: input.agencyId,
      module: executor.module,
      departureGroupId: isGroupSubject ? subjectId : null,
      proposalId,
      requiredCapability: executor.requiredCapability,
      risk: executor.risk,
      title: input.title,
    },
    client,
  );

  return { ok: true, proposalId };
}

/* ── approve ───────────────────────────────────────────────────────────────── */

export interface DecisionActor {
  agencyId: string;
  role: StaffRole;
  /** `staff_profiles.role_id` — for a dynamic-role capability override, same as every page's own capability check. Null falls back to the role's code-level default. */
  roleId: string | null;
  actor: GroupActor;
  /** The agency's configured high-risk approver roles for this proposal's surface, for the HIGH-risk role gate. */
  highRiskRoles: readonly string[];
}

export type ApproveProposalOutcome =
  | { ok: true; status: "EXECUTED" }
  | { ok: false; status: "SUPERSEDED" | "EXPIRED" | "FAILED" | "REFUSED"; error: string };

/**
 * Approves (and, given `editedPayload`, edits-then-approves) a proposal.
 * Every refusal point, in order:
 *
 *   1. Proposal must exist, belong to the caller's agency, and still be PROPOSED.
 *   2. `expires_at` must not have passed.
 *   3. The approver's role (or dynamic role override) must hold this proposal's `module.required_capability`.
 *   4. HIGH risk additionally requires a role in `highRiskRoles`.
 *   5. A fresh pack's dependency hash must match what was stored — a
 *      mismatch supersedes the proposal instead of executing it.
 *   6. The (possibly edited) payload must still validate against the
 *      executor's schema.
 *   7. `executor.execute()` — which re-validates the world a second, final
 *      time via its own mutator's fresh read.
 */
export async function approveProposal(
  proposalId: string,
  ctx: DecisionActor,
  client: Db,
  options?: { editedPayload?: unknown },
): Promise<ApproveProposalOutcome> {
  const proposal = await loadDecidable(client, proposalId, ctx.agencyId);
  if (!proposal.ok) return { ok: false, status: "REFUSED", error: proposal.error };
  const row = proposal.row;

  if (new Date(row.expires_at).getTime() < Date.now()) {
    await transitionStatus(client, row, "EXPIRED", null);
    await writeEvent(client, ctx.agencyId, row.id, "EXPIRED", ctx.actor.id, ctx.actor.name, {});
    return { ok: false, status: "EXPIRED", error: "This proposal has expired." };
  }

  const canDecide = await resolveCapability(ctx.role, ctx.roleId, row.module, row.required_capability, client);
  if (!canDecide) {
    return { ok: false, status: "REFUSED", error: "Your role cannot approve this kind of proposal." };
  }
  if (row.risk === "HIGH" && !ctx.highRiskRoles.includes(ctx.role)) {
    return { ok: false, status: "REFUSED", error: "This proposal needs a high-risk approver for this agency." };
  }

  const executor = getExecutor(row.kind);
  if (!executor) return { ok: false, status: "REFUSED", error: `Unknown proposal kind: ${row.kind}` };

  let payload = row.payload;
  if (options?.editedPayload !== undefined) {
    if (row.risk === "HIGH") {
      return { ok: false, status: "REFUSED", error: "High-risk proposals cannot be edited — reject and re-propose instead." };
    }
    const parsedEdit = executor.schema.safeParse(options.editedPayload);
    if (!parsedEdit.success) {
      return { ok: false, status: "REFUSED", error: `Invalid edited payload: ${parsedEdit.error.issues[0]?.message ?? "validation failed"}` };
    }
    payload = parsedEdit.data;
    await client
      .from("agent_proposals")
      .update({ payload })
      .eq("id", row.id)
      .eq("status", "PROPOSED");
    await writeEvent(client, ctx.agencyId, row.id, "EDITED", ctx.actor.id, ctx.actor.name, {
      before: row.payload,
      after: payload,
    });
  } else {
    const parsedOriginal = executor.schema.safeParse(payload);
    if (!parsedOriginal.success) {
      return { ok: false, status: "REFUSED", error: "This proposal's stored payload no longer validates — reject it." };
    }
    payload = parsedOriginal.data;
  }

  // Re-validate the world against a fresh pack before executing.
  const pack = await executor.loadPack(row.subject_id, ctx.agencyId, client);
  if (!pack) {
    await transitionStatus(client, row, "SUPERSEDED", null);
    await writeEvent(client, ctx.agencyId, row.id, "SUPERSEDED", ctx.actor.id, ctx.actor.name, {
      reason: "subject no longer exists",
    });
    return { ok: false, status: "SUPERSEDED", error: "That record no longer exists." };
  }
  const freshHash = hashObject(executor.dependencySnapshot(payload, pack));
  if (freshHash !== row.dependency_hash) {
    await transitionStatus(client, row, "SUPERSEDED", null);
    await writeEvent(client, ctx.agencyId, row.id, "SUPERSEDED", ctx.actor.id, ctx.actor.name, {
      reason: "one or more fields this proposal depended on have changed since it was written",
    });
    return {
      ok: false,
      status: "SUPERSEDED",
      error: "Something this proposal depended on has changed since it was written. It has been superseded.",
    };
  }

  const decidedAt = new Date().toISOString();
  await client
    .from("agent_proposals")
    .update({
      status: "APPROVED",
      decided_by: ctx.actor.id,
      decided_by_name: ctx.actor.name,
      decided_at: decidedAt,
    })
    .eq("id", row.id)
    .eq("status", "PROPOSED");
  await writeEvent(client, ctx.agencyId, row.id, "APPROVED", ctx.actor.id, ctx.actor.name, {});

  const result = await executor.execute(payload, {
    agencyId: ctx.agencyId,
    subjectId: row.subject_id,
    actor: ctx.actor,
    role: ctx.role,
    db: client,
  });

  if (result.ok) {
    await client
      .from("agent_proposals")
      .update({ status: "EXECUTED", executed_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("status", "APPROVED");
    await writeEvent(client, ctx.agencyId, row.id, "EXECUTED", ctx.actor.id, ctx.actor.name, {});
    return { ok: true, status: "EXECUTED" };
  }

  await client
    .from("agent_proposals")
    .update({ status: "FAILED", execution_error: result.error })
    .eq("id", row.id)
    .eq("status", "APPROVED");
  await writeEvent(client, ctx.agencyId, row.id, "EXECUTION_FAILED", ctx.actor.id, ctx.actor.name, {
    error: result.error,
  });
  return { ok: false, status: "FAILED", error: result.error };
}

/* ── reject ────────────────────────────────────────────────────────────────── */

export type RejectProposalOutcome = { ok: true } | { ok: false; error: string };

/** Rejects a proposal. `decisionNote` is required for MEDIUM/HIGH risk — it is the training signal that feeds the surface's rejection cooldown / auto-demotion. */
export async function rejectProposal(
  proposalId: string,
  ctx: DecisionActor,
  client: Db,
  decisionNote?: string,
): Promise<RejectProposalOutcome> {
  const proposal = await loadDecidable(client, proposalId, ctx.agencyId);
  if (!proposal.ok) return { ok: false, error: proposal.error };
  const row = proposal.row;

  const canDecide = await resolveCapability(ctx.role, ctx.roleId, row.module, row.required_capability, client);
  if (!canDecide) {
    return { ok: false, error: "Your role cannot decide on this kind of proposal." };
  }

  if (RISK_ORDER[row.risk] >= RISK_ORDER.MEDIUM && !decisionNote?.trim()) {
    return { ok: false, error: "A rejection needs a reason for anything above LOW risk." };
  }

  const { error } = await client
    .from("agent_proposals")
    .update({
      status: "REJECTED",
      decided_by: ctx.actor.id,
      decided_by_name: ctx.actor.name,
      decided_at: new Date().toISOString(),
      decision_note: decisionNote ?? null,
    })
    .eq("id", row.id)
    .eq("status", "PROPOSED");

  if (error) return { ok: false, error: `Failed to reject proposal: ${error.message}` };

  await writeEvent(client, ctx.agencyId, row.id, "REJECTED", ctx.actor.id, ctx.actor.name, {
    note: decisionNote ?? null,
  });

  return { ok: true };
}

/* ── shared helpers ───────────────────────────────────────────────────────── */

async function loadDecidable(
  client: Db,
  proposalId: string,
  agencyId: string,
): Promise<{ ok: true; row: AgentProposalRow } | { ok: false; error: string }> {
  const { data, error } = await client
    .from("agent_proposals")
    .select("*")
    .eq("id", proposalId)
    .eq("agency_id", agencyId)
    .maybeSingle();

  if (error) return { ok: false, error: `Failed to load proposal: ${error.message}` };
  if (!data) return { ok: false, error: "That proposal no longer exists." };
  const row = data as AgentProposalRow;
  if (row.status !== "PROPOSED") {
    return { ok: false, error: `This proposal is already ${row.status.toLowerCase()}.` };
  }
  return { ok: true, row };
}

async function transitionStatus(
  client: Db,
  row: AgentProposalRow,
  status: "EXPIRED" | "SUPERSEDED",
  extra: Record<string, unknown> | null,
): Promise<void> {
  await client
    .from("agent_proposals")
    .update({ status, ...(extra ?? {}) })
    .eq("id", row.id)
    .eq("status", "PROPOSED");
}

async function writeEvent(
  client: Db,
  agencyId: string,
  proposalId: string,
  event: ProposalEventKind,
  actorId: string | null,
  actorName: string,
  detail: Record<string, unknown>,
): Promise<void> {
  // Best-effort: a trail write failing must never roll back a decision that
  // already landed — the proposal's own status transition is the thing
  // that has to be correct.
  await client.from("agent_proposal_events").insert({
    agency_id: agencyId,
    proposal_id: proposalId,
    event,
    actor_id: actorId,
    actor_name: actorName,
    detail,
  });
}
