import { STAFF_ROLES, type StaffRole } from "@/lib/access/departure-groups-access";
import { capabilitiesForInbox } from "@/lib/access/inbox-access";

/**
 * Who a note may mention (SEC-11 in docs/progress/2026-10-05-inbox-security-and-bug-audit.md). A mention is a way of pulling a colleague into a
 * conversation, so the colleague must be able to open the Inbox. Active in the agency was the only test before, which let a note mention a
 * Guide, who has no Inbox access at all; the mention was then recorded against a conversation that person can never see.
 */

/** Every role whose Inbox access starts at "can open it", derived from the Inbox's own rules so the two cannot drift apart. */
export const INBOX_VIEWER_ROLES: readonly StaffRole[] = STAFF_ROLES.filter((role) => capabilitiesForInbox(role).viewModule);

/** Whether a stored role string is one that can open the Inbox. An unknown or missing role is refused, never guessed. */
export function roleCanOpenInbox(role: string | null | undefined): boolean {
  const upper = String(role ?? "").toUpperCase();
  return (INBOX_VIEWER_ROLES as readonly string[]).includes(upper);
}

export interface MentionCandidate {
  id: string;
  role: string | null;
  status: string | null;
  /** A custom role, if the person has one: it can narrow what their role tier allows. */
  role_id?: string | null;
}

export type MentionCheck = { ok: true } | { ok: false; error: string };

export const MENTION_UNAVAILABLE_MESSAGE = "One or more mentioned staff members are no longer available.";
export const MENTION_NO_INBOX_MESSAGE = "One or more mentioned staff members cannot open the Inbox, so they cannot be mentioned.";

/**
 * `candidates` is what the database returned for the ids that were asked for, within the agency. Every asked-for person must be there and
 * active (so a made-up or foreign id fails), must hold a role that can open the Inbox, and must not have had that taken away by a custom role
 * (`canOpenInbox` is that lookup, passed in so this stays a pure function).
 */
export async function checkMentionedStaff(input: {
  requestedIds: readonly string[];
  candidates: readonly MentionCandidate[];
  canOpenInbox: (candidate: MentionCandidate) => Promise<boolean>;
}): Promise<MentionCheck> {
  const byId = new Map(input.candidates.map((candidate) => [candidate.id, candidate]));
  const people = input.requestedIds.map((id) => byId.get(id));
  if (people.some((person) => !person || person.status !== "ACTIVE")) return { ok: false, error: MENTION_UNAVAILABLE_MESSAGE };

  const found = people as MentionCandidate[];
  if (!found.every((person) => roleCanOpenInbox(person.role))) return { ok: false, error: MENTION_NO_INBOX_MESSAGE };
  const allowed = await Promise.all(found.map((person) => input.canOpenInbox(person)));
  if (!allowed.every(Boolean)) return { ok: false, error: MENTION_NO_INBOX_MESSAGE };
  return { ok: true };
}
