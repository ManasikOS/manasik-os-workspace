/** Inbox routing data-access: all reads and writes are agency-scoped. */
import "server-only";

import type { Db } from "@/lib/ai/db";
import { loadDynamicCapabilities } from "@/lib/access/dynamic-capabilities";
import { capabilitiesForInbox } from "@/lib/access/inbox-access";
import type { StaffRole } from "@/lib/access/departure-groups-access";
import { loadIntelligence } from "@/lib/data/conversation-intelligence-repository";
import { loadSlaSettings } from "@/lib/data/inbox-sla-repository";
import { isWithinBusinessHours } from "@/lib/inbox/sla/business-hours";
import { staffAvailabilityInputSchema, type StaffAvailabilityInput, type StaffAvailabilityRecord } from "@/lib/inbox/routing/availability";
import { loadByStaff } from "@/lib/inbox/routing/load";
import { policyFromRow, policyToRow, type RoutingPolicy, type RoutingPolicyInput, routingPolicyInputSchema } from "@/lib/inbox/routing/policy";
import { resolveOwner, topicOfIntent, type RoutingCandidate, type RoutingDecision, type RoutingInput } from "@/lib/inbox/routing/resolve-owner";

const LOAD_ROW_LIMIT = 2000;
const CHUNK = 200;
const isoDay = (at: Date) => at.toISOString().slice(0, 10);

export async function loadRoutingPolicy(db: Db, agencyId: string): Promise<RoutingPolicy | null> {
  const { data, error } = await db.from("inbox_routing_policy").select("sticky_enabled, group_threshold, load_balance_mode, respect_shifts, coordinator_role_by_queue").eq("agency_id", agencyId).maybeSingle();
  if (error) throw new Error(`Could not read the routing policy: ${error.message}`);
  return data ? policyFromRow(data as Record<string, unknown>) : null;
}

export async function saveRoutingPolicy(db: Db, agencyId: string, staffId: string, input: RoutingPolicyInput): Promise<void> {
  const parsed = routingPolicyInputSchema.parse(input);
  const { error } = await db.from("inbox_routing_policy").upsert({ agency_id: agencyId, ...policyToRow(parsed), updated_by: staffId }, { onConflict: "agency_id" });
  if (error) throw new Error(`Could not save the routing policy: ${error.message}`);
}

async function loadCandidates(db: Db, agencyId: string, now: Date): Promise<RoutingCandidate[]> {
  const nowIso = now.toISOString();
  const [{ data, error }, { data: availability, error: availabilityError }] = await Promise.all([
    db.from("staff_profiles").select("id, full_name, role, role_id, status, access_starts_on, access_ends_on, last_assigned_at").eq("agency_id", agencyId),
    db.from("staff_availability").select("staff_id, kind").eq("agency_id", agencyId).lte("starts_at", nowIso).gt("ends_at", nowIso),
  ]);
  if (error) throw new Error(`Could not read staff: ${error.message}`);
  if (availabilityError) throw new Error(`Could not read staff availability: ${availabilityError.message}`);
  const today = isoDay(now);
  const staff = (data ?? []) as Array<{ id: string; full_name: string; role: string; role_id: string | null; status: string; access_starts_on: string | null; access_ends_on: string | null; last_assigned_at: string | null }>;
  const onShift = new Set((availability ?? []).filter((row) => (row as { kind: string }).kind === "SHIFT").map((row) => (row as { staff_id: string }).staff_id));
  const onLeave = new Set((availability ?? []).filter((row) => (row as { kind: string }).kind === "LEAVE").map((row) => (row as { staff_id: string }).staff_id));
  const load = await loadOpenLoad(db, agencyId);
  return Promise.all(staff.map(async (person) => ({
    id: person.id,
    name: person.full_name,
    role: person.role,
    active: person.status === "ACTIVE" && (!person.access_starts_on || person.access_starts_on <= today) && (!person.access_ends_on || person.access_ends_on >= today),
    availableNow: onShift.has(person.id) && !onLeave.has(person.id),
    handlesInbox: (await loadDynamicCapabilities(db, person.role_id, "inbox", capabilitiesForInbox(person.role as StaffRole))).sendMessage,
    load: load.get(person.id) ?? 0,
    lastAssignedAt: person.last_assigned_at,
  })));
}

async function loadOpenLoad(db: Db, agencyId: string): Promise<Map<string, number>> {
  const { data, error } = await db.from("conversation_queue_membership").select("conversation_id, priority_rank").eq("agency_id", agencyId).eq("queue_code", "NEEDS_REPLY").order("entered_at", { ascending: false }).limit(LOAD_ROW_LIMIT);
  if (error) throw new Error(`Could not read the reply queue: ${error.message}`);
  const rows = (data ?? []) as Array<{ conversation_id: string; priority_rank: number }>;
  const rank = new Map(rows.map((row) => [row.conversation_id, row.priority_rank]));
  const owned: Array<{ assignedToId: string | null; priorityRank: number }> = [];
  const ids = [...rank.keys()];
  for (let start = 0; start < ids.length; start += CHUNK) {
    const { data: conversations, error: conversationError } = await db.from("conversations").select("id, assigned_to_id").eq("agency_id", agencyId).in("id", ids.slice(start, start + CHUNK));
    if (conversationError) throw new Error(`Could not read assigned conversations: ${conversationError.message}`);
    for (const row of (conversations ?? []) as Array<{ id: string; assigned_to_id: string | null }>) owned.push({ assignedToId: row.assigned_to_id, priorityRank: rank.get(row.id) ?? 0 });
  }
  return loadByStaff(owned);
}

export async function listRoutingStaff(db: Db, agencyId: string): Promise<Array<{ id: string; name: string }>> {
  const { data, error } = await db.from("staff_profiles").select("id, full_name").eq("agency_id", agencyId).eq("status", "ACTIVE").order("full_name");
  if (error) throw new Error(`Could not read staff for availability: ${error.message}`);
  return (data ?? []).map((row) => ({ id: (row as { id: string }).id, name: (row as { full_name: string }).full_name }));
}

export async function listStaffAvailability(db: Db, agencyId: string): Promise<StaffAvailabilityRecord[]> {
  const { data, error } = await db.from("staff_availability").select("id, staff_id, starts_at, ends_at, kind").eq("agency_id", agencyId).order("starts_at", { ascending: true });
  if (error) throw new Error(`Could not read staff availability: ${error.message}`);
  return (data ?? []).map((row) => ({ id: (row as { id: string }).id, staffId: (row as { staff_id: string }).staff_id, startsAt: (row as { starts_at: string }).starts_at, endsAt: (row as { ends_at: string }).ends_at, kind: (row as { kind: StaffAvailabilityRecord["kind"] }).kind }));
}

export async function createStaffAvailability(db: Db, agencyId: string, staffId: string, input: StaffAvailabilityInput): Promise<void> {
  const parsed = staffAvailabilityInputSchema.parse(input);
  const { error } = await db.from("staff_availability").insert({ agency_id: agencyId, staff_id: parsed.staffId, starts_at: parsed.startsAt, ends_at: parsed.endsAt, kind: parsed.kind, created_by: staffId });
  if (error) throw new Error(`Could not save staff availability: ${error.message}`);
}

export async function deleteStaffAvailability(db: Db, agencyId: string, availabilityId: string): Promise<void> {
  const { error } = await db.from("staff_availability").delete().eq("agency_id", agencyId).eq("id", availabilityId);
  if (error) throw new Error(`Could not remove staff availability: ${error.message}`);
}

async function loadInputs(db: Db, input: { agencyId: string; conversationId: string; now: Date; partySize?: number | null; intentCode?: string | null }): Promise<RoutingInput> {
  const [policy, candidates, sla, settings, conversation, intelligence] = await Promise.all([
    loadRoutingPolicy(db, input.agencyId), loadCandidates(db, input.agencyId, input.now), loadSlaSettings(db, input.agencyId),
    db.from("ai_settings").select("default_lead_owner_id").eq("agency_id", input.agencyId).maybeSingle(),
    db.from("conversations").select("lead_id").eq("agency_id", input.agencyId).eq("id", input.conversationId).maybeSingle(),
    input.partySize !== undefined && input.intentCode !== undefined ? Promise.resolve(null) : loadIntelligence(db, input.agencyId, input.conversationId),
  ]);
  if (settings.error) throw new Error(`Could not read the default owner: ${settings.error.message}`);
  if (conversation.error) throw new Error(`Could not read the conversation: ${conversation.error.message}`);
  let existingOwnerId: string | null = null;
  const leadId = (conversation.data as { lead_id: string | null } | null)?.lead_id ?? null;
  if (leadId) {
    const { data: lead, error } = await db.from("leads").select("assigned_to_id").eq("agency_id", input.agencyId).eq("id", leadId).maybeSingle();
    if (error) throw new Error(`Could not read the lead's owner: ${error.message}`);
    existingOwnerId = (lead as { assigned_to_id: string | null } | null)?.assigned_to_id ?? null;
  }
  const travellers = intelligence?.travelIntent?.travellers;
  const storedParty = travellers && travellers.adults > 0 ? travellers.adults + travellers.children + travellers.infants : null;
  return { policy, candidates, existingOwnerId, partySize: input.partySize !== undefined ? input.partySize : storedParty, topic: topicOfIntent(input.intentCode !== undefined ? input.intentCode : (intelligence?.intentCode ?? null)), officeOpen: isWithinBusinessHours(input.now, sla.calendar, sla.timezone), defaultOwnerId: (settings.data as { default_lead_owner_id: string | null } | null)?.default_lead_owner_id ?? null };
}

/** The conversation event written when routing (not a person) picks the owner. The history block words it. */
export const ROUTING_ASSIGNED_EVENT_KIND = "OWNER_ASSIGNED_BY_ROUTING";

export type AssignmentOutcome = { status: "SKIPPED"; reason: string } | { status: "UNASSIGNED"; decision: RoutingDecision } | { status: "ASSIGNED"; decision: RoutingDecision };

export async function assignConversationOwner(db: Db, input: { agencyId: string; conversationId: string; now: Date; partySize: number | null; intentCode: string | null }): Promise<AssignmentOutcome> {
  const inputs = await loadInputs(db, input);
  if (inputs.policy === null) return { status: "SKIPPED", reason: "The agency has no routing policy." };
  const decision = resolveOwner(inputs);
  if (!decision.ownerId) return { status: "UNASSIGNED", decision };
  const { data, error } = await db.from("conversations").update({ assigned_to_id: decision.ownerId, assigned_to_name: decision.ownerName }).eq("agency_id", input.agencyId).eq("id", input.conversationId).is("assigned_to_id", null).select("id");
  if (error) throw new Error(`Could not assign the conversation: ${error.message}`);
  if (!data || data.length === 0) return { status: "SKIPPED", reason: "Someone else already owns this conversation." };
  const { error: stampError } = await db.from("staff_profiles").update({ last_assigned_at: input.now.toISOString() }).eq("agency_id", input.agencyId).eq("id", decision.ownerId);
  if (stampError) console.error("Could not record when the owner was last assigned:", stampError.message);
  // Keep why routing chose this person, so staff can read it in the conversation's history. Best effort: never undoes the assignment.
  try {
    const { error: eventError } = await db.from("conversation_events").insert({
      agency_id: input.agencyId,
      conversation_id: input.conversationId,
      kind: ROUTING_ASSIGNED_EVENT_KIND,
      actor_kind: "SYSTEM",
      actor_id: null,
      data: { to_id: decision.ownerId, to_name: decision.ownerName, step: decision.step, reason: decision.reason },
    });
    if (eventError) console.error("Could not record why the conversation was routed:", eventError.message);
  } catch (cause) {
    console.error("Could not record why the conversation was routed:", cause instanceof Error ? cause.message : cause);
  }
  return { status: "ASSIGNED", decision };
}

export async function resolveHandoffOwner(db: Db, input: { agencyId: string; conversationId: string; now?: Date }): Promise<{ id: string | null; name: string | null }> {
  const inputs = await loadInputs(db, { agencyId: input.agencyId, conversationId: input.conversationId, now: input.now ?? new Date() });
  const decision = resolveOwner(inputs);
  if (decision.ownerId && inputs.policy !== null) await db.from("staff_profiles").update({ last_assigned_at: (input.now ?? new Date()).toISOString() }).eq("agency_id", input.agencyId).eq("id", decision.ownerId);
  return { id: decision.ownerId, name: decision.ownerName };
}
