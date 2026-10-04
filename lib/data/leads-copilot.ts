/**
 * Pure store mutators for the Sales Intelligence Engine — same pattern as
 * `lib/data/leads.ts`: they take a `LeadStore`, change it in memory, and the
 * Server Action persists the diff. Client-safe.
 *
 * What these never do, by design: create a booking, hold or release seats,
 * change payment or operational data, or move a lead's stage.
 */

import { newId } from "@/lib/data/leads-ids";
import type { LeadStore } from "@/lib/data/leads-repository";
import type {
  LeadActivityType,
  LeadCommunicationDraftRow,
  LeadCopilotContextRow,
  LeadQuoteRow,
  LeadRow,
} from "@/lib/types/leads";
import { buildLeadPatch } from "@/lib/copilot/sales/intent-conflicts";
import { SUGGESTION_LABELS } from "@/lib/copilot/sales/alerts";
import type { IntentLeadField } from "@/lib/copilot/sales/schemas";
import type {
  CopilotSuggestionType,
  LeadFacts,
  ReasoningSource,
  SelectedOfferSnapshot,
  TravelIntent,
} from "@/lib/copilot/sales/types";

export interface CopilotMutationOutcome {
  ok: boolean;
  error?: string;
}

export function toLeadFacts(lead: LeadRow, store: Pick<LeadStore, "notes">): LeadFacts {
  return {
    id: lead.id,
    reference: lead.reference,
    fullName: lead.full_name,
    firstName: lead.full_name.trim().split(/\s+/)[0] ?? lead.full_name,
    stage: lead.stage,
    journeyType: lead.journey_type,
    adults: lead.adults,
    children: lead.children,
    roomPreference: lead.room_preference,
    preferredPeriod: lead.preferred_period,
    budgetRange: lead.budget_range,
    preferredLanguage: lead.preferred_language,
    packageId: lead.desired_package_id,
    packageName: lead.desired_package_name,
    selectedDepartureGroupId: lead.selected_departure_group_id,
    notes: store.notes
      .filter((note) => note.lead_id === lead.id)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((note) => note.body),
  };
}

export function copilotContextFor(store: Pick<LeadStore, "copilotContexts">, leadId: string): LeadCopilotContextRow | null {
  return store.copilotContexts.find((row) => row.lead_id === leadId) ?? null;
}

function findLead(store: LeadStore, leadId: string): LeadRow | null {
  return store.leads.find((lead) => lead.id === leadId) ?? null;
}

function pushActivity(
  store: LeadStore,
  leadId: string,
  type: LeadActivityType,
  message: string,
  actorName: string,
  nowIso: string,
): void {
  store.activity.push({ id: newId(), lead_id: leadId, type, message, actor_name: actorName, created_at: nowIso });
}

function ensureContext(store: LeadStore, leadId: string, actorName: string, nowIso: string): LeadCopilotContextRow {
  const existing = copilotContextFor(store, leadId);
  if (existing) {
    existing.updated_by_name = actorName;
    existing.updated_at = nowIso;
    return existing;
  }
  const row: LeadCopilotContextRow = {
    lead_id: leadId,
    travel_intent: null,
    intent_source: null,
    intent_applied_at: null,
    selected_offer: null,
    selected_offer_at: null,
    updated_by_name: actorName,
    created_at: nowIso,
    updated_at: nowIso,
  };
  store.copilotContexts.push(row);
  return row;
}

/** An audit line for a meaningful human action (analyse, build, compare, draft). */
export function logCopilotActivityInStore(
  store: LeadStore,
  input: { leadId: string; type: LeadActivityType; message: string; actorName: string },
  nowIso: string,
): CopilotMutationOutcome {
  if (!findLead(store, input.leadId)) return { ok: false, error: "That lead no longer exists." };
  pushActivity(store, input.leadId, input.type, input.message, input.actorName, nowIso);
  return { ok: true };
}

const FIELD_LABELS: Record<IntentLeadField, string> = {
  journeyType: "journey",
  adults: "adults",
  children: "children",
  roomPreference: "room preference",
  preferredPeriod: "preferred period",
  budgetRange: "budget range",
};

/**
 * Saves the approved TravelIntent and writes ONLY the lead fields staff
 * ticked. Everything else on the lead is left exactly as entered.
 */
export function applyTravelIntentInStore(
  store: LeadStore,
  input: {
    leadId: string;
    intent: TravelIntent;
    source: ReasoningSource;
    fields: readonly IntentLeadField[];
    actorName: string;
  },
  nowIso: string,
): CopilotMutationOutcome {
  const lead = findLead(store, input.leadId);
  if (!lead) return { ok: false, error: "That lead no longer exists." };

  const patch = buildLeadPatch(input.intent, input.fields);
  if (Object.keys(patch).length > 0) {
    Object.assign(lead, patch);
    lead.updated_at = nowIso;
  }

  const context = ensureContext(store, lead.id, input.actorName, nowIso);
  context.travel_intent = input.intent;
  context.intent_source = input.source;
  context.intent_applied_at = nowIso;

  const applied = input.fields.filter((field) => field in FIELD_LABELS).map((field) => FIELD_LABELS[field]);
  pushActivity(
    store,
    lead.id,
    "INTENT_APPLIED",
    applied.length > 0
      ? `Applied extracted travel intent. Updated ${applied.join(", ")}.`
      : "Applied extracted travel intent.",
    input.actorName,
    nowIso,
  );
  return { ok: true };
}

/**
 * Records the offer staff chose: package + departure group (+ room type only
 * when staff confirmed it). Does not reserve seats or create a booking.
 */
export function selectOfferInStore(
  store: LeadStore,
  input: {
    leadId: string;
    offer: SelectedOfferSnapshot;
    isRecommended: boolean;
    applyRoomType: boolean;
    actorName: string;
  },
  nowIso: string,
): CopilotMutationOutcome {
  const lead = findLead(store, input.leadId);
  if (!lead) return { ok: false, error: "That lead no longer exists." };
  if (lead.booking_id) return { ok: false, error: "This lead is already linked to a booking." };

  lead.desired_package_id = input.offer.packageTemplateId;
  lead.desired_package_name = input.offer.packageName;
  lead.selected_departure_group_id = input.offer.departureGroupId;
  if (input.applyRoomType && input.offer.roomType) lead.room_preference = input.offer.roomType;
  lead.updated_at = nowIso;

  const context = ensureContext(store, lead.id, input.actorName, nowIso);
  context.selected_offer = input.offer;
  context.selected_offer_at = nowIso;

  pushActivity(
    store,
    lead.id,
    "GROUP_SELECTED",
    `${input.isRecommended ? "Selected recommended offer" : "Selected offer"}: ${input.offer.groupName}.`,
    input.actorName,
    nowIso,
  );
  return { ok: true };
}

export function saveCommunicationDraftInStore(
  store: LeadStore,
  input: Omit<LeadCommunicationDraftRow, "id" | "status" | "created_at">,
  nowIso: string,
): CopilotMutationOutcome {
  if (!findLead(store, input.lead_id)) return { ok: false, error: "That lead no longer exists." };
  store.communicationDrafts.push({ ...input, id: newId(), status: "DRAFT", created_at: nowIso });
  pushActivity(store, input.lead_id, "REPLY_DRAFT_SAVED", "Saved reply draft.", input.created_by_name, nowIso);
  return { ok: true };
}

/** Next reference in the `QT-<year>-NNNN` series (same series as sent quotes). */
export function nextQuoteReference(quotes: readonly { reference: string }[], nowIso: string): string {
  const prefix = `QT-${nowIso.slice(0, 4)}-`;
  const highest = quotes.reduce((max, quote) => {
    if (!quote.reference.startsWith(prefix)) return max;
    const parsed = Number.parseInt(quote.reference.slice(prefix.length), 10);
    return Number.isFinite(parsed) ? Math.max(max, parsed) : max;
  }, 0);
  return `${prefix}${String(highest + 1).padStart(4, "0")}`;
}

/**
 * Stores a quote draft. Unlike `recordQuoteInStore`, this never advances the
 * lead's stage — staff move it to Proposal Sent explicitly.
 */
export function createQuoteDraftInStore(
  store: LeadStore,
  input: { leadId: string; quote: Omit<LeadQuoteRow, "id" | "lead_id" | "created_at">; actorName: string },
  nowIso: string,
): CopilotMutationOutcome & { row?: LeadQuoteRow } {
  const lead = findLead(store, input.leadId);
  if (!lead) return { ok: false, error: "That lead no longer exists." };

  const row: LeadQuoteRow = { ...input.quote, id: newId(), lead_id: lead.id, created_at: nowIso };
  store.quotes.push(row);
  lead.updated_at = nowIso;

  pushActivity(
    store,
    lead.id,
    "QUOTE_DRAFTED",
    row.status === "PENDING_APPROVAL"
      ? `Created quote draft ${row.reference} — discount pending Admin approval.`
      : `Created quote draft ${row.reference}.`,
    input.actorName,
    nowIso,
  );
  return { ok: true, row };
}

export function dismissSuggestionInStore(
  store: LeadStore,
  input: { leadId: string; type: CopilotSuggestionType; fingerprint: string; actorName: string },
  nowIso: string,
): CopilotMutationOutcome {
  if (!findLead(store, input.leadId)) return { ok: false, error: "That lead no longer exists." };
  const already = store.copilotDismissals.some(
    (row) => row.lead_id === input.leadId && row.fingerprint === input.fingerprint,
  );
  if (already) return { ok: true };

  store.copilotDismissals.push({
    id: newId(),
    lead_id: input.leadId,
    suggestion_type: input.type,
    fingerprint: input.fingerprint,
    dismissed_by_name: input.actorName,
    dismissed_at: nowIso,
  });
  pushActivity(
    store,
    input.leadId,
    "ALERT_DISMISSED",
    `Dismissed ${SUGGESTION_LABELS[input.type]} alert.`,
    input.actorName,
    nowIso,
  );
  return { ok: true };
}
