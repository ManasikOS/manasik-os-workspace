/**
 * The identity graph's reads and writes — MI3.3 of docs/inbox/implementation-plan.md (Architecture §5.5).
 *
 * Every query names the agency (the ingest path runs on the service-role client, which RLS does not filter), and the table's
 * own constraints make a cross-agency link impossible. Nothing here merges anything:
 *   - proposing writes PROPOSED edges and an AMBIGUOUS audit event, and creates no lead;
 *   - confirming points ONE identity at ONE lead (the lead rows are never touched) and writes LINKED;
 *   - rejecting or unlinking writes SPLIT / UNLINKED, marks the pair REJECTED so it is never proposed again, and unlinking
 *     puts the previous lead back exactly.
 * The ranking itself is pure and lives in lib/inbox/identity/graph.ts.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { proposeCandidates, nameTokens, phoneTail, type IdentityCandidate, type IdentityProposalView, type IdentitySubject, type LeadForMatching } from "@/lib/inbox/identity/graph";
import { normalizeEmail } from "@/lib/inbox/identity";
import type { GraphMatches, LeadCandidate } from "@/lib/inbox/lead-link-decision";

/* eslint-disable @typescript-eslint/no-explicit-any -- service and session clients share this narrow data contract. */
type Db = SupabaseClient<any, any, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

const LEAD_COLUMNS = "id, reference, full_name, mobile, email, stage, preferred_period";
const SEARCH_LIMIT = 50;

interface LeadRow {
  id: string;
  reference: string;
  full_name: string;
  mobile: string | null;
  email: string | null;
  stage: string;
  preferred_period: string | null;
}

const toCandidate = (row: LeadRow): LeadCandidate => ({ id: row.id, reference: row.reference, full_name: row.full_name, mobile: row.mobile ?? "", stage: row.stage });
const toMatching = (row: LeadRow): LeadForMatching => ({ leadId: row.id, fullName: row.full_name, mobile: row.mobile, email: row.email, preferredPeriod: row.preferred_period });

/* ── Finding candidates ───────────────────────────────────────────────────── */

/** A narrow pre-filter (a shared name word, the phone's tail, or the email) so ranking never scans every lead. */
export async function findLeadsForMatching(db: Db, agencyId: string, subject: IdentitySubject): Promise<LeadRow[]> {
  const filters: string[] = [];
  for (const word of nameTokens(subject.displayName).filter((token) => token.length >= 3 && /^[\p{L}\p{N}]+$/u.test(token))) filters.push(`full_name.ilike.%${word}%`);
  const tail = phoneTail(subject.phone);
  if (tail) filters.push(`mobile.like.%${tail}`);
  const email = normalizeEmail(subject.email);
  if (email && !/[,()]/.test(email)) filters.push(`email.eq.${email}`);
  if (filters.length === 0) return [];

  const { data, error } = await db.from("leads").select(LEAD_COLUMNS).eq("agency_id", agencyId).or(filters.join(",")).order("created_at", { ascending: false }).limit(SEARCH_LIMIT);
  if (error) throw new Error(`Could not search leads for an identity match: ${error.message}`);
  return (data ?? []) as LeadRow[];
}

export interface GraphLookup {
  graph: GraphMatches;
  candidates: IdentityCandidate[];
  leads: Map<string, LeadRow>;
}

/** What the graph says about this contact: the exact matches, and the leads worth putting in front of a person. */
export async function lookUpGraph(
  db: Db,
  input: { agencyId: string; subject: IdentitySubject; subjectIdentityId: string | null; now: string },
): Promise<GraphLookup> {
  const rows = await findLeadsForMatching(db, input.agencyId, input.subject);
  const rejectedLeadIds = input.subjectIdentityId ? await listRejectedLeadIds(db, input.agencyId, input.subjectIdentityId) : [];
  const candidates = proposeCandidates({ subject: input.subject, leads: rows.map(toMatching), rejectedLeadIds, now: input.now });
  const leads = new Map(rows.map((row) => [row.id, row]));
  const pick = (list: IdentityCandidate[]) => list.map((candidate) => leads.get(candidate.leadId)).filter((row): row is LeadRow => Boolean(row)).map(toCandidate);
  return {
    graph: { exact: pick(candidates.filter((candidate) => candidate.autoConfirm)), proposals: pick(candidates.filter((candidate) => !candidate.autoConfirm)) },
    candidates,
    leads,
  };
}

async function listRejectedLeadIds(db: Db, agencyId: string, subjectIdentityId: string): Promise<string[]> {
  const { data, error } = await db.from("contact_identity_links").select("candidate_lead_id").eq("agency_id", agencyId).eq("subject_identity_id", subjectIdentityId).eq("status", "REJECTED");
  if (error) throw new Error(`Could not read rejected identity links: ${error.message}`);
  return ((data ?? []) as Array<{ candidate_lead_id: string }>).map((row) => row.candidate_lead_id);
}

/** The identity row for a provider contact, created (with no lead) if it does not exist yet. Never touches an existing lead link. */
export async function ensureSubjectIdentity(
  db: Db,
  input: { agencyId: string; provider: string; externalSubjectId: string; displayName: string | null; normalizedPhone: string | null },
): Promise<string> {
  const { data, error } = await db
    .from("contact_identities")
    .upsert(
      {
        agency_id: input.agencyId,
        provider: input.provider,
        external_subject_id: input.externalSubjectId,
        normalized_phone: input.normalizedPhone,
        display_name: input.displayName?.trim() || "",
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "agency_id,provider,external_subject_id" },
    )
    .select("id")
    .single();
  if (error || !data) throw new Error(`Could not save this contact identity: ${error?.message ?? "no row"}`);
  return (data as { id: string }).id;
}

/* ── Proposing ────────────────────────────────────────────────────────────── */

/**
 * Writes one PROPOSED edge per candidate lead. Idempotent: an existing edge, including a REJECTED one, is left exactly as
 * it is, so a person's "no" is never overturned by the next message. No lead is created or changed.
 */
export async function recordProposals(db: Db, input: { agencyId: string; subjectIdentityId: string; candidates: IdentityCandidate[] }): Promise<number> {
  const proposals = input.candidates.filter((candidate) => !candidate.autoConfirm);
  if (proposals.length === 0) return 0;

  const { data, error } = await db
    .from("contact_identity_links")
    .upsert(
      proposals.map((candidate) => ({
        agency_id: input.agencyId,
        subject_identity_id: input.subjectIdentityId,
        candidate_lead_id: candidate.leadId,
        link_type: "SAME_PERSON",
        confidence: candidate.score,
        evidence: { band: candidate.band, signals: candidate.signals, reasons: candidate.reasons },
        status: "PROPOSED",
        proposed_by: "SYSTEM",
      })),
      { onConflict: "agency_id,subject_identity_id,candidate_lead_id", ignoreDuplicates: true },
    )
    .select("id, candidate_lead_id, confidence");
  if (error) throw new Error(`Could not record identity proposals: ${error.message}`);

  const created = (data ?? []) as Array<{ id: string; candidate_lead_id: string; confidence: number }>;
  if (created.length > 0) {
    const { error: eventError } = await db.from("identity_match_events").insert(
      created.map((row) => ({
        agency_id: input.agencyId,
        contact_identity_id: input.subjectIdentityId,
        action: "AMBIGUOUS",
        next_lead_id: row.candidate_lead_id,
        confidence: "PROPOSED",
        evidence: { link_id: row.id, score: row.confidence },
      })),
    );
    if (eventError) throw new Error(`Could not audit the identity proposal: ${eventError.message}`);
  }
  return created.length;
}

/* ── Deciding ─────────────────────────────────────────────────────────────── */

export type IdentityDecisionResult = { ok: true } | { ok: false; error: string };

interface LinkRow {
  id: string;
  subject_identity_id: string;
  candidate_lead_id: string;
  status: "PROPOSED" | "CONFIRMED" | "REJECTED";
  previous_lead_id: string | null;
  evidence: Record<string, unknown> | null;
}

interface ConversationRef {
  id: string;
  lead_id: string | null;
  identityId: string;
}

/** The conversation, and the identity behind it. A link is only ever decided from the conversation it belongs to. */
async function conversationIdentity(db: Db, agencyId: string, conversationId: string): Promise<ConversationRef | null> {
  const { data: conversation, error } = await db.from("conversations").select("id, lead_id, channel, external_conversation_id").eq("agency_id", agencyId).eq("id", conversationId).maybeSingle();
  if (error || !conversation) return null;
  const row = conversation as { id: string; lead_id: string | null; channel: string; external_conversation_id: string | null };
  if (!row.external_conversation_id) return null;
  const { data: identity } = await db.from("contact_identities").select("id").eq("agency_id", agencyId).eq("provider", row.channel).eq("external_subject_id", row.external_conversation_id).maybeSingle();
  if (!identity) return null;
  return { id: row.id, lead_id: row.lead_id, identityId: (identity as { id: string }).id };
}

async function loadLink(db: Db, agencyId: string, linkId: string): Promise<LinkRow | null> {
  const { data } = await db.from("contact_identity_links").select("id, subject_identity_id, candidate_lead_id, status, previous_lead_id, evidence").eq("agency_id", agencyId).eq("id", linkId).maybeSingle();
  return (data as LinkRow | null) ?? null;
}

function fail(message: string): { ok: false; error: string } {
  return { ok: false, error: message };
}

/** A person said "yes, these are the same customer". Points this one identity and conversation at the lead; no lead record changes. */
export async function confirmIdentityLink(db: Db, input: { agencyId: string; linkId: string; conversationId: string; actorId: string | null }): Promise<IdentityDecisionResult> {
  const conversation = await conversationIdentity(db, input.agencyId, input.conversationId);
  if (!conversation) return fail("That conversation could not be found.");
  const link = await loadLink(db, input.agencyId, input.linkId);
  if (!link || link.subject_identity_id !== conversation.identityId) return fail("That match does not belong to this conversation.");
  if (link.status !== "PROPOSED") return fail("That match has already been decided.");

  const { data: lead } = await db.from("leads").select("id").eq("agency_id", input.agencyId).eq("id", link.candidate_lead_id).maybeSingle();
  if (!lead) return fail("That lead no longer exists.");

  const { data: identity } = await db.from("contact_identities").select("lead_id").eq("agency_id", input.agencyId).eq("id", conversation.identityId).maybeSingle();
  const previousLeadId = (identity as { lead_id: string | null } | null)?.lead_id ?? null;
  const now = new Date().toISOString();

  const identityUpdate = await db.from("contact_identities").update({ lead_id: link.candidate_lead_id, match_confidence: "STAFF_CONFIRMED" }).eq("agency_id", input.agencyId).eq("id", conversation.identityId);
  if (identityUpdate.error) return fail(`Could not link the contact: ${identityUpdate.error.message}`);
  const conversationUpdate = await db.from("conversations").update({ lead_id: link.candidate_lead_id }).eq("agency_id", input.agencyId).eq("id", conversation.id);
  if (conversationUpdate.error) return fail(`Could not link the conversation: ${conversationUpdate.error.message}`);

  const decided = await db.from("contact_identity_links").update({ status: "CONFIRMED", previous_lead_id: previousLeadId, decided_by: input.actorId, decided_at: now }).eq("agency_id", input.agencyId).eq("id", link.id);
  if (decided.error) return fail(`Could not save the decision: ${decided.error.message}`);
  // The contact now has its lead: the other suggestions for it are moot.
  await db.from("contact_identity_links").update({ status: "REJECTED", decided_by: input.actorId, decided_at: now }).eq("agency_id", input.agencyId).eq("subject_identity_id", conversation.identityId).eq("status", "PROPOSED");

  await db.from("identity_match_events").insert({
    agency_id: input.agencyId,
    contact_identity_id: conversation.identityId,
    action: "LINKED",
    previous_lead_id: previousLeadId,
    next_lead_id: link.candidate_lead_id,
    confidence: "STAFF_CONFIRMED",
    evidence: { link_id: link.id, ...(link.evidence ?? {}) },
    actor_id: input.actorId,
  });
  return { ok: true };
}

/** One suggestion that `rejectIdentityLinks` closed, kept so the decision can be recorded once it holds, or undone if it does not. */
export interface RejectedIdentityLink {
  id: string;
  candidateLeadId: string;
}

export type RejectIdentityLinksResult =
  | { ok: true; rejected: number; identityId: string; links: RejectedIdentityLink[] }
  | { ok: false; error: string };

/**
 * A person said "keep them separate". Every open suggestion for this contact is closed and never proposed again. This only closes them:
 * the history rows are written by `recordIdentityKeptSeparate` once the separate lead really exists, and if it could not be created the
 * caller reopens the suggestions with `restoreRejectedIdentityLinks`, so a failed attempt never costs the person their suggestions.
 */
export async function rejectIdentityLinks(db: Db, input: { agencyId: string; conversationId: string; actorId: string | null }): Promise<RejectIdentityLinksResult> {
  const conversation = await conversationIdentity(db, input.agencyId, input.conversationId);
  if (!conversation) return fail("That conversation could not be found.");

  const { data, error } = await db
    .from("contact_identity_links")
    .update({ status: "REJECTED", decided_by: input.actorId, decided_at: new Date().toISOString() })
    .eq("agency_id", input.agencyId)
    .eq("subject_identity_id", conversation.identityId)
    .eq("status", "PROPOSED")
    .select("id, candidate_lead_id");
  if (error) return fail(`Could not save the decision: ${error.message}`);

  const links = ((data ?? []) as Array<{ id: string; candidate_lead_id: string }>).map((row) => ({ id: row.id, candidateLeadId: row.candidate_lead_id }));
  return { ok: true, rejected: links.length, identityId: conversation.identityId, links };
}

/** The history rows for a "keep them separate" decision, written once it has held. Best effort: the decision itself is already saved. */
export async function recordIdentityKeptSeparate(db: Db, input: { agencyId: string; identityId: string; links: readonly RejectedIdentityLink[]; actorId: string | null }): Promise<void> {
  if (input.links.length === 0) return;
  const { error } = await db.from("identity_match_events").insert(
    input.links.map((link) => ({
      agency_id: input.agencyId,
      contact_identity_id: input.identityId,
      action: "SPLIT",
      previous_lead_id: link.candidateLeadId,
      confidence: "STAFF_CONFIRMED",
      evidence: { link_id: link.id, decision: "KEPT_SEPARATE" },
      actor_id: input.actorId,
    })),
  );
  if (error) console.error("Could not record that the contact was kept separate:", error.message);
}

/**
 * Puts suggestions that `rejectIdentityLinks` just closed back to waiting for a decision, because the separate lead could not be created.
 * Only a link that is still REJECTED is touched, so a suggestion someone has decided since is never reopened.
 */
export async function restoreRejectedIdentityLinks(db: Db, input: { agencyId: string; linkIds: readonly string[] }): Promise<IdentityDecisionResult> {
  if (input.linkIds.length === 0) return { ok: true };
  const { error } = await db
    .from("contact_identity_links")
    .update({ status: "PROPOSED", decided_by: null, decided_at: null })
    .eq("agency_id", input.agencyId)
    .in("id", [...input.linkIds])
    .eq("status", "REJECTED");
  if (error) return fail(`Could not reopen the suggestions: ${error.message}`);
  return { ok: true };
}

/** Undoes a confirmed link: the identity and conversation go back to the lead they had before, and the pair is not proposed again. */
export async function unlinkIdentityLink(db: Db, input: { agencyId: string; linkId: string; conversationId: string; actorId: string | null }): Promise<IdentityDecisionResult> {
  const conversation = await conversationIdentity(db, input.agencyId, input.conversationId);
  if (!conversation) return fail("That conversation could not be found.");
  const link = await loadLink(db, input.agencyId, input.linkId);
  if (!link || link.subject_identity_id !== conversation.identityId) return fail("That link does not belong to this conversation.");
  if (link.status !== "CONFIRMED") return fail("Only a confirmed link can be undone.");

  const restoreTo = link.previous_lead_id;
  const identityUpdate = await db.from("contact_identities").update({ lead_id: restoreTo, match_confidence: "UNRESOLVED" }).eq("agency_id", input.agencyId).eq("id", conversation.identityId);
  if (identityUpdate.error) return fail(`Could not undo the link: ${identityUpdate.error.message}`);
  // Only put the conversation back if it still points where this link put it: a later change by a person is theirs to keep.
  if (conversation.lead_id === link.candidate_lead_id) {
    const conversationUpdate = await db.from("conversations").update({ lead_id: restoreTo }).eq("agency_id", input.agencyId).eq("id", conversation.id);
    if (conversationUpdate.error) return fail(`Could not undo the link: ${conversationUpdate.error.message}`);
  }
  const decided = await db.from("contact_identity_links").update({ status: "REJECTED", decided_by: input.actorId, decided_at: new Date().toISOString() }).eq("agency_id", input.agencyId).eq("id", link.id);
  if (decided.error) return fail(`Could not save the decision: ${decided.error.message}`);

  await db.from("identity_match_events").insert({
    agency_id: input.agencyId,
    contact_identity_id: conversation.identityId,
    action: "UNLINKED",
    previous_lead_id: link.candidate_lead_id,
    next_lead_id: restoreTo,
    confidence: "STAFF_CONFIRMED",
    evidence: { link_id: link.id },
    actor_id: input.actorId,
  });
  return { ok: true };
}

/* ── What the card shows ──────────────────────────────────────────────────── */

/** Open suggestions for a conversation's contact, best first. Empty when the conversation already has a lead. */
export async function loadProposalsForConversation(db: Db, agencyId: string, conversationId: string): Promise<IdentityProposalView[]> {
  const conversation = await conversationIdentity(db, agencyId, conversationId);
  if (!conversation || conversation.lead_id) return [];

  const { data, error } = await db
    .from("contact_identity_links")
    .select("id, candidate_lead_id, confidence, evidence")
    .eq("agency_id", agencyId)
    .eq("subject_identity_id", conversation.identityId)
    .eq("status", "PROPOSED")
    .order("confidence", { ascending: false });
  if (error) throw new Error(`Could not read identity suggestions: ${error.message}`);
  const links = (data ?? []) as Array<{ id: string; candidate_lead_id: string; confidence: number; evidence: { band?: string; reasons?: string[] } | null }>;
  if (links.length === 0) return [];

  const { data: leadRows } = await db.from("leads").select("id, reference, full_name, mobile, stage").eq("agency_id", agencyId).in("id", links.map((link) => link.candidate_lead_id));
  const leads = new Map(((leadRows ?? []) as Array<{ id: string; reference: string; full_name: string; mobile: string | null; stage: string }>).map((lead) => [lead.id, lead]));

  return links.flatMap((link) => {
    const lead = leads.get(link.candidate_lead_id);
    if (!lead) return [];
    return [{
      linkId: link.id,
      band: link.evidence?.band === "HIGH" ? ("HIGH" as const) : ("MEDIUM" as const),
      leadId: lead.id,
      leadReference: lead.reference,
      leadName: lead.full_name,
      leadMobile: lead.mobile ?? "",
      leadStage: lead.stage,
      reasons: link.evidence?.reasons ?? [],
    }];
  });
}
