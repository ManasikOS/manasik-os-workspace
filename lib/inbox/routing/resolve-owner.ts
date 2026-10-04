/**
 * Who should own this conversation — MI3.5 of docs/inbox/implementation-plan.md (Architecture §16 R3). Pure: the caller loads
 * the people, their shifts and their load, so every branch is unit-tested with no database.
 *
 * The chain, first match wins:
 *   1. STICKY       the customer's lead already has an owner and that person is available → them. Continuity beats balance.
 *   2. COORDINATOR  a group enquiry (party ≥ threshold), a visa question or a document question → the person of the role the
 *                   agency named for that topic (least loaded, then longest without a conversation).
 *   3. LEAST_LOADED (or ROUND_ROBIN) among available inbox staff. Ties break on `lastAssignedAt`, oldest first, then id — so the
 *                   answer never depends on the order the database returned people in.
 *   4. FALLBACK     `ai_settings.default_lead_owner_id`, if that person is available.
 * Nothing found → UNASSIGNED. Nobody unavailable is ever chosen at any step: an absent person's queue is invisible, while an
 * unassigned conversation is in the Unassigned queue with its reply clock running.
 *
 * "Available" = an active account inside its access window, on an individual shift, not on leave, and able to send Inbox
 * messages. The optional office-hours policy is an additional agency calendar, never a substitute for an individual shift.
 *
 * No policy at all (`policy === null`) is the agency that never turned routing on: the answer is the configured default owner,
 * unchecked, exactly as the AI handoff has always done.
 */

import type { RoutingPolicy, RoutingTopic } from "./policy";

export interface RoutingCandidate {
  id: string;
  name: string;
  role: string;
  /** ACTIVE, and today is inside the access window. */
  active: boolean;
  /** Currently within a SHIFT and not within a LEAVE. */
  availableNow: boolean;
  /** May be given Inbox conversations at all (the resolved `sendMessage` capability). */
  handlesInbox: boolean;
  /** The weighted NEEDS_REPLY load. */
  load: number;
  lastAssignedAt: string | null;
}

export type RoutingStep = "STICKY" | "COORDINATOR" | "LEAST_LOADED" | "ROUND_ROBIN" | "FALLBACK" | "UNASSIGNED" | "LEGACY_DEFAULT";

export interface RoutingInput {
  policy: RoutingPolicy | null;
  candidates: readonly RoutingCandidate[];
  /** The owner of the conversation's lead, if any. */
  existingOwnerId: string | null;
  /** How many people the customer is travelling with, if known. */
  partySize: number | null;
  topic: Exclude<RoutingTopic, "GROUP"> | null;
  /** Is the agency open right now (working-hours calendar; true when none is set). */
  officeOpen: boolean;
  /** `ai_settings.default_lead_owner_id`. */
  defaultOwnerId: string | null;
}

export interface RoutingDecision {
  ownerId: string | null;
  ownerName: string | null;
  step: RoutingStep;
  reason: string;
}

/** The routing topic an intent implies (only visa and documents; group is decided by party size). */
export function topicOfIntent(intentCode: string | null): Exclude<RoutingTopic, "GROUP"> | null {
  return intentCode === "VISA_QUERY" ? "VISA_ISSUES" : intentCode === "DOCUMENT_ISSUE" ? "DOCUMENTS" : null;
}

const unassigned = (reason: string): RoutingDecision => ({ ownerId: null, ownerName: null, step: "UNASSIGNED", reason });
const chosen = (person: RoutingCandidate, step: RoutingStep, reason: string): RoutingDecision => ({ ownerId: person.id, ownerName: person.name, step, reason });

/** Least load first, then the one who has gone longest without a conversation (never-assigned first), then id. */
export function byLoadThenTurn(a: RoutingCandidate, b: RoutingCandidate): number {
  return a.load - b.load || byTurn(a, b);
}

/** Round-robin order: the longest-waiting first, whatever the load. */
export function byTurn(a: RoutingCandidate, b: RoutingCandidate): number {
  const at = a.lastAssignedAt === null ? Number.NEGATIVE_INFINITY : Date.parse(a.lastAssignedAt);
  const bt = b.lastAssignedAt === null ? Number.NEGATIVE_INFINITY : Date.parse(b.lastAssignedAt);
  if (at !== bt) return at < bt ? -1 : 1;
  return a.id.localeCompare(b.id);
}

export function resolveOwner(input: RoutingInput): RoutingDecision {
  const { policy } = input;

  // Routing never turned on for this agency: behave exactly as before.
  if (policy === null) {
    const legacy = input.candidates.find((person) => person.id === input.defaultOwnerId);
    return legacy ? chosen(legacy, "LEGACY_DEFAULT", "No routing policy: the configured default owner, as before.") : unassigned("No routing policy and no default owner.");
  }

  const available = (person: RoutingCandidate) => person.active && person.availableNow && person.handlesInbox && (!policy.respectShifts || input.officeOpen);

  // 1. Owner-sticky.
  if (policy.stickyEnabled && input.existingOwnerId) {
    const owner = input.candidates.find((person) => person.id === input.existingOwnerId);
    if (owner && available(owner)) return chosen(owner, "STICKY", "The customer's lead is already owned by this person.");
  }

  // 2. Designated coordinator.
  const topic: RoutingTopic | null = input.topic ?? (input.partySize !== null && input.partySize >= policy.groupThreshold ? "GROUP" : null);
  if (topic) {
    const role = policy.coordinatorRoles[topic];
    const coordinator = input.candidates.filter((person) => person.role === role && available(person)).sort(byLoadThenTurn)[0];
    if (coordinator) return chosen(coordinator, "COORDINATOR", `${topic === "GROUP" ? "A group enquiry" : topic === "VISA_ISSUES" ? "A visa question" : "A document question"} goes to the ${role.toLowerCase()} role.`);
  }

  // 3. Least loaded (or round-robin) among available inbox staff.
  const pool = input.candidates.filter(available);
  const step: RoutingStep = policy.loadBalanceMode === "ROUND_ROBIN" ? "ROUND_ROBIN" : "LEAST_LOADED";
  const next = [...pool].sort(policy.loadBalanceMode === "ROUND_ROBIN" ? byTurn : byLoadThenTurn)[0];
  if (next) return chosen(next, step, step === "ROUND_ROBIN" ? "Next in turn." : "The least loaded person on shift.");

  // 4. The configured default owner — only if they are available too.
  const fallback = input.candidates.find((person) => person.id === input.defaultOwnerId);
  if (fallback && available(fallback)) return chosen(fallback, "FALLBACK", "The configured default owner.");

  return unassigned("Nobody is available right now.");
}
