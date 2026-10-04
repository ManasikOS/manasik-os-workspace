/**
 * Turning a conversation into work — the server half of MI4.6. Three steps, all through the proposal kernel so the audit
 * trail, the capability check and the executor are the ones every other proposal uses:
 *
 *   preview  → checks the choices, writes a PROPOSED proposal and returns what it WOULD create (nothing is created yet)
 *   confirm  → approves it as the signed-in person; the executor creates the one object
 *   dismiss  → rejects it; nothing was ever created, so there is nothing to undo
 *
 * Runs on the trusted client after the Server Action has authenticated the caller and checked the Inbox capability. Every
 * read and write here names the agency. Each kind also runs under the capability of the module that owns what it writes
 * (`leads.convertToBooking` for a seat hold, `pilgrims.createPilgrim` for a profile, …): the menu greys an option the person's
 * role cannot use, the preview refuses it, and the kernel refuses it again at approval.
 */

import "server-only";

import type { StaffRole } from "@/lib/access/departure-groups-access";
import { resolveCapability } from "@/lib/agent/kernel/proposals/capabilities";
import type { Db } from "@/lib/agent/kernel/proposals/context-pack";
import { loadConversationConversionFacts } from "@/lib/agent/kernel/proposals/conversation-pack";
import { getExecutor } from "@/lib/agent/kernel/proposals/registry";
import { approveProposal, createProposal, rejectProposal, type DecisionActor } from "@/lib/agent/kernel/proposals/service";
import type { ProposalDiffLine } from "@/lib/agent/kernel/proposals/types";
import {
  CONVERSION_CATALOGUE,
  CONVERSION_KINDS,
  conversionBlocker,
  conversionTitle,
  offeredConversions,
  type ConversionFieldChoices,
  type ConversionKind,
  type OfferedConversion,
} from "@/lib/inbox/conversions/catalogue";
import { loadConversionChoices } from "@/lib/inbox/conversions/choices";
import { validateConversionParams } from "@/lib/inbox/conversions/params";

/** A conversion confirmed this recently is not created a second time by a double-click or a retry. */
export const RECENT_CONVERSION_WINDOW_MS = 120_000;

export interface ConversionActor {
  agencyId: string;
  role: StaffRole;
  roleId: string | null;
  staffId: string | null;
  name: string;
}

export type ConversionPreview =
  | { ok: true; proposalId: string; title: string; humanDiff: ProposalDiffLine[]; note: string }
  | { ok: false; error: string };

export type ConversionChoicesResult = { ok: true; fields: ConversionFieldChoices[] } | { ok: false; error: string };

const ROLE_REASON = "Your role cannot do this.";

/** Whether this person's role (with any custom override) may run the kind, by the capability of the module that owns its write. */
async function roleCanRun(db: Db, actor: ConversionActor, kind: ConversionKind): Promise<boolean> {
  const executor = getExecutor(kind);
  if (!executor) return false;
  return resolveCapability(actor.role, actor.roleId, executor.module, executor.requiredCapability, db);
}

/** The menu for one conversation: what can be made now, and a plain reason for each option that cannot. */
export async function listOfferedConversions(db: Db, actor: ConversionActor, conversationId: string): Promise<OfferedConversion[] | null> {
  const facts = await loadConversationConversionFacts(db, actor.agencyId, conversationId);
  if (!facts) return null;
  const offered = offeredConversions(facts);
  return Promise.all(
    offered.map(async (option) => {
      if (!option.available) return option;
      return (await roleCanRun(db, actor, option.kind)) ? option : { ...option, available: false, reason: ROLE_REASON };
    }),
  );
}

/** What the person is asked to choose for one conversion. Only this agency's own records are ever offered. */
export async function loadChoicesForConversion(db: Db, actor: ConversionActor, input: { conversationId: string; kind: ConversionKind }): Promise<ConversionChoicesResult> {
  const facts = await loadConversationConversionFacts(db, actor.agencyId, input.conversationId);
  if (!facts) return { ok: false, error: "That conversation could not be found." };
  const blocker = conversionBlocker(input.kind, facts);
  if (blocker) return { ok: false, error: blocker };
  if (!(await roleCanRun(db, actor, input.kind))) return { ok: false, error: ROLE_REASON };
  return { ok: true, fields: await loadConversionChoices(db, actor.agencyId, facts, input.kind) };
}

type ProposalRow = { id: string; title: string; human_diff: ProposalDiffLine[]; payload: { note?: string } | null };

async function findOpenProposal(db: Db, agencyId: string, conversationId: string, fingerprint: string): Promise<ProposalRow | null> {
  const { data, error } = await db
    .from("agent_proposals")
    .select("id, title, human_diff, payload")
    .eq("agency_id", agencyId)
    .eq("subject_type", "CONVERSATION")
    .eq("subject_id", conversationId)
    .eq("fingerprint", fingerprint)
    .eq("status", "PROPOSED")
    .maybeSingle();
  if (error) throw new Error(`Could not look for an open request: ${error.message}`);
  return (data as ProposalRow | null) ?? null;
}

/** True when this exact conversion was carried out moments ago — the double-click / retry guard. */
async function wasJustCreated(db: Db, agencyId: string, conversationId: string, fingerprint: string, now: number): Promise<boolean> {
  const since = new Date(now - RECENT_CONVERSION_WINDOW_MS).toISOString();
  const { data, error } = await db
    .from("agent_proposals")
    .select("id")
    .eq("agency_id", agencyId)
    .eq("subject_type", "CONVERSATION")
    .eq("subject_id", conversationId)
    .eq("fingerprint", fingerprint)
    .eq("status", "EXECUTED")
    .gte("executed_at", since)
    .limit(1);
  if (error) throw new Error(`Could not check for a recent request: ${error.message}`);
  return (data ?? []).length > 0;
}

export async function previewConversion(
  db: Db,
  actor: ConversionActor,
  input: { conversationId: string; kind: ConversionKind; note: string; params?: Record<string, unknown> },
  now: number = Date.now(),
): Promise<ConversionPreview> {
  const executor = getExecutor(input.kind);
  if (!executor) return { ok: false, error: "That kind of request is not available." };

  const facts = await loadConversationConversionFacts(db, actor.agencyId, input.conversationId);
  if (!facts) return { ok: false, error: "That conversation could not be found." };
  const blocker = conversionBlocker(input.kind, facts);
  if (blocker) return { ok: false, error: blocker };
  if (!facts.sourceMessageId) return { ok: false, error: "This conversation has no messages to point back at." };
  if (!(await roleCanRun(db, actor, input.kind))) return { ok: false, error: ROLE_REASON };

  // What the person chose must be something the server actually offered for this conversation.
  const choices = await loadConversionChoices(db, actor.agencyId, facts, input.kind);
  const checked = validateConversionParams(input.kind, input.params ?? {}, choices);
  if (!checked.ok) return checked;

  const payload = { conversationId: input.conversationId, sourceMessageId: facts.sourceMessageId, note: input.note, labels: checked.labels, ...checked.params };
  const parsed = executor.schema.safeParse(payload);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check what you asked for." };
  const fingerprint = executor.fingerprint(parsed.data);

  if (await wasJustCreated(db, actor.agencyId, input.conversationId, fingerprint, now)) {
    return { ok: false, error: "That was just created a moment ago. Check the team's task list before creating another." };
  }

  const title = conversionTitle(input.kind, facts.customerName, facts.leadReference);
  const created = await createProposal(
    {
      agencyId: actor.agencyId,
      subjectId: input.conversationId,
      kind: input.kind,
      payload: parsed.data,
      title,
      rationale: `${actor.name} asked to turn this conversation into work: ${CONVERSION_CATALOGUE[input.kind].label.toLowerCase()}.`,
      notify: false,
      proposedBy: { id: actor.staffId, name: actor.name },
    },
    db,
  );

  if (!created.ok) {
    // One open request per conversation and choice: a second click while one is waiting shows the same request, not an error.
    if (created.duplicate) {
      const open = await findOpenProposal(db, actor.agencyId, input.conversationId, fingerprint);
      if (open) return { ok: true, proposalId: open.id, title: open.title, humanDiff: open.human_diff, note: open.payload?.note ?? "" };
    }
    return { ok: false, error: created.error };
  }

  const stored = await findOpenProposal(db, actor.agencyId, input.conversationId, fingerprint);
  if (!stored) return { ok: false, error: "The request could not be read back. Please try again." };
  return { ok: true, proposalId: stored.id, title: stored.title, humanDiff: stored.human_diff, note: input.note };
}

function decisionActor(actor: ConversionActor): DecisionActor {
  return {
    agencyId: actor.agencyId,
    role: actor.role,
    roleId: actor.roleId,
    actor: { id: actor.staffId ?? "", name: actor.name, agencyId: actor.agencyId },
    // The kernel requires this list; a seat hold is MEDIUM (a human confirms it and it releases itself), so it is never consulted.
    highRiskRoles: ["ADMIN", "CEO"],
  };
}

/** The proposal must be one of THIS agency's conversation conversions — this service never decides any other proposal. */
async function loadConversionProposal(db: Db, agencyId: string, proposalId: string): Promise<{ id: string } | null> {
  const { data, error } = await db
    .from("agent_proposals")
    .select("id, kind, subject_type")
    .eq("agency_id", agencyId)
    .eq("id", proposalId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as { id: string; kind: string; subject_type: string };
  return row.subject_type === "CONVERSATION" && (CONVERSION_KINDS as readonly string[]).includes(row.kind) ? { id: row.id } : null;
}

export async function confirmConversion(db: Db, actor: ConversionActor, proposalId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const row = await loadConversionProposal(db, actor.agencyId, proposalId);
  if (!row) return { ok: false, error: "That request could not be found." };
  const outcome = await approveProposal(proposalId, decisionActor(actor), db);
  return outcome.ok ? { ok: true } : { ok: false, error: outcome.error };
}

export async function dismissConversion(db: Db, actor: ConversionActor, proposalId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const row = await loadConversionProposal(db, actor.agencyId, proposalId);
  if (!row) return { ok: false, error: "That request could not be found." };
  const outcome = await rejectProposal(proposalId, decisionActor(actor), db, "Cancelled from the Inbox before anything was created.");
  return outcome.ok ? { ok: true } : { ok: false, error: outcome.error };
}
