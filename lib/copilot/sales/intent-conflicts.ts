/**
 * Compares an extracted TravelIntent against what staff already entered on
 * the lead. Nothing is overwritten automatically: every field becomes a
 * proposal the staff member ticks, and a proposal that contradicts a
 * manually entered value is flagged and left unticked.
 */

import type { LeadRoomPreference, LeadRow } from "@/lib/types/leads";

import { MONTH_NAMES, yearOf } from "./format";
import { formatMoney } from "./money";
import type { IntentLeadField } from "./schemas";
import type { LeadFacts, TravelIntent } from "./types";

export interface IntentFieldProposal {
  field: IntentLeadField;
  label: string;
  currentValue: string;
  proposedValue: string;
  conflict: boolean;
  applyByDefault: boolean;
}

const JOURNEY_LABEL: Record<NonNullable<TravelIntent["journeyType"]>, string> = {
  UMRAH: "Umrah",
  HAJJ: "Hajj",
  EARLY_REGISTRATION: "Early Registration",
};

const ROOM_LABEL: Record<LeadRoomPreference, string> = {
  QUAD: "Quad",
  TRIPLE: "Triple",
  DOUBLE: "Double",
  SINGLE: "Single",
  UNDECIDED: "Undecided",
};

const TIER_LABEL: Record<NonNullable<TravelIntent["commercialSignals"]["budgetRange"]>, string> = {
  ECONOMY: "Economy",
  STANDARD: "Standard",
  PREMIUM: "Premium",
  VIP: "VIP",
  UNKNOWN: "Unknown",
};

/** "December 2026 · Flexible" / "Ramadan". Null when no window was extracted. */
export function describeTravelWindow(intent: TravelIntent): string | null {
  const window = intent.travelWindow;
  if (!window.preferredMonth) return null;
  const year = typeof window.earliestDate === "string" ? ` ${yearOf(window.earliestDate)}` : "";
  const monthKnown = (MONTH_NAMES as readonly string[]).includes(window.preferredMonth);
  const base = `${window.preferredMonth}${monthKnown ? year : ""}`;
  if (window.flexibility === "FLEXIBLE") return `${base} · Flexible`;
  if (window.flexibility === "FIXED") return `${base} · Fixed dates`;
  return base;
}

/** "Up to LKR 450,000 per person" / "Standard budget". */
export function describeBudget(intent: TravelIntent): string | null {
  const signals = intent.commercialSignals;
  if (signals.statedBudget !== undefined) return `Up to ${formatMoney(signals.statedBudget)} per person`;
  if (signals.budgetRange && signals.budgetRange !== "UNKNOWN") return `${TIER_LABEL[signals.budgetRange]} budget`;
  return null;
}

function isBlank(value: string): boolean {
  return !value.trim() || /^(not (?:sure|decided|specified)|tbd|n\/a|unknown|-)$/i.test(value.trim());
}

const normalise = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");

export function proposeIntentChanges(intent: TravelIntent, lead: LeadFacts): IntentFieldProposal[] {
  const proposals: IntentFieldProposal[] = [];
  const push = (
    field: IntentLeadField,
    label: string,
    currentValue: string,
    proposedValue: string,
    currentMeaningful: boolean,
    sameMeaning = false,
  ) => {
    if (normalise(currentValue) === normalise(proposedValue) || sameMeaning) return;
    const conflict = currentMeaningful;
    proposals.push({ field, label, currentValue, proposedValue, conflict, applyByDefault: !conflict });
  };

  if (intent.journeyType) {
    push("journeyType", "Journey", JOURNEY_LABEL[lead.journeyType], JOURNEY_LABEL[intent.journeyType], true);
  }

  if (intent.travellers.adults > 0) {
    push("adults", "Adults", String(lead.adults), String(intent.travellers.adults), true);
  }
  if (intent.travellers.children > 0) {
    push("children", "Children", String(lead.children), String(intent.travellers.children), lead.children > 0);
  }

  const room = intent.accommodationPreferences.roomType;
  if (room && room !== "NOT_DECIDED") {
    push("roomPreference", "Room preference", ROOM_LABEL[lead.roomPreference], ROOM_LABEL[room], lead.roomPreference !== "UNDECIDED");
  }

  const period = describeTravelWindow(intent);
  if (period) {
    const month = intent.travelWindow.preferredMonth ?? "";
    const alreadySaysMonth = month !== "" && normalise(lead.preferredPeriod).includes(month.toLowerCase().slice(0, 3));
    push("preferredPeriod", "Preferred period", lead.preferredPeriod || "—", period, !isBlank(lead.preferredPeriod), alreadySaysMonth);
  }

  const budget = describeBudget(intent);
  if (budget) {
    push("budgetRange", "Budget range", lead.budgetRange || "—", budget, !isBlank(lead.budgetRange));
  }

  return proposals;
}

export type LeadIntentPatch = Partial<
  Pick<LeadRow, "journey_type" | "adults" | "children" | "room_preference" | "preferred_period" | "budget_range">
>;

/** The lead columns an approved set of fields writes. Only ticked fields. */
export function buildLeadPatch(intent: TravelIntent, fields: readonly IntentLeadField[]): LeadIntentPatch {
  const patch: LeadIntentPatch = {};
  for (const field of fields) {
    switch (field) {
      case "journeyType":
        if (intent.journeyType) patch.journey_type = intent.journeyType;
        break;
      case "adults":
        if (intent.travellers.adults > 0) patch.adults = intent.travellers.adults;
        break;
      case "children":
        patch.children = intent.travellers.children;
        break;
      case "roomPreference": {
        const room = intent.accommodationPreferences.roomType;
        if (room && room !== "NOT_DECIDED") patch.room_preference = room;
        break;
      }
      case "preferredPeriod": {
        const period = describeTravelWindow(intent);
        if (period) patch.preferred_period = period;
        break;
      }
      case "budgetRange": {
        const budget = describeBudget(intent);
        if (budget) patch.budget_range = budget;
        break;
      }
    }
  }
  return patch;
}
