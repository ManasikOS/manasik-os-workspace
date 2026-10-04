/**
 * View models and UI-only types for the Leads module.
 *
 * Database rows (snake_case) live in `lib/types/leads.ts`; the view models the
 * components render are built by `lib/data/leads.ts` and simply re-exported
 * here, so no component ever reaches past this file into the data layer.
 */

import type {
  FollowUpStatus,
  FollowUpType,
  LeadActivityType,
  LeadContactChannel,
  LeadJourneyType,
  LeadLostReason,
  LeadRoomPreference,
  LeadSource,
  LeadStage,
  LeadTemperature,
} from "@/lib/types/leads";
import { ALL_FILTER } from "@/hooks/use-filtered-rows";

export type {
  FollowUpStatus,
  FollowUpType,
  LeadActivityType,
  LeadContactChannel,
  LeadJourneyType,
  LeadLostReason,
  LeadRoomPreference,
  LeadSource,
  LeadStage,
  LeadTemperature,
};

export type { LeadActivityItem, LeadListItem, LeadNoteItem, LeadQuoteItem } from "@/lib/data/leads";
export type { LeadPackageRow, StaffRow } from "@/lib/types/leads";

/* ── Saved views ──────────────────────────────────────────────────────────── */

export const LEAD_SAVED_VIEWS = [
  "All Leads",
  "My Leads",
  "New Today",
  "Follow-up Today",
  "Overdue Follow-ups",
  "High-Value Leads",
  "Deposit Pending",
  "Unassigned Leads",
  "Postponed Leads",
  "Lost This Month",
  "Duplicate Review",
] as const;

export type LeadSavedView = (typeof LEAD_SAVED_VIEWS)[number];

/** Which KPI-row card, if any, is narrowing the list. */
export type QuickFilter = "new" | "contacted" | "overdue" | "booked";

/* ── Filters ──────────────────────────────────────────────────────────────── */

/**
 * Sentinel for "no filter", imported (and re-exported) from `useFilteredRows`
 * rather than redeclared: `FilterSelect` already compares against that same
 * constant to decide whether a filter reads as active, and two constants
 * that must always agree are one constant with extra steps.
 */
export const ALL = ALL_FILTER;

export interface LeadFilters {
  stage: string;
  journeyType: string;
  packageId: string;
  source: string;
  temperature: string;
  assignedTo: string;
  followUp: string;
  city: string;
}

export const EMPTY_LEAD_FILTERS: LeadFilters = {
  stage: ALL,
  journeyType: ALL,
  packageId: ALL,
  source: ALL,
  temperature: ALL,
  assignedTo: ALL,
  followUp: ALL,
  city: ALL,
};

/* ── KPIs ─────────────────────────────────────────────────────────────────── */

export interface LeadListKpis {
  newLeads: number;
  newLeadsDeltaPct: number | null;
  contacted: number;
  contactRate: number;
  overdueFollowUps: number;
  dueToday: number;
  booked: number;
  conversionRate: number;
  openPipelineLkr: number;
}

/* ── Add-lead form ────────────────────────────────────────────────────────── */

export interface AddLeadFormData {
  fullName: string;
  mobile: string;
  email: string;
  city: string;
  preferredLanguage: string;
  preferredChannel: LeadContactChannel;

  journeyType: LeadJourneyType;
  interestedIn: string;
  packageId: string | null;
  preferredPeriod: string;
  adults: number;
  children: number;
  roomPreference: LeadRoomPreference;
  departureCity: string;
  budgetRange: string;
  quotaWaitlistInterest: boolean;

  source: LeadSource;
  campaignReference: string;
  referralName: string;
  assignedToId: string;
  stage: LeadStage;
  temperature: LeadTemperature;

  /** `datetime-local` value (`YYYY-MM-DDTHH:mm`), read as Colombo local time. */
  nextFollowUpAt: string;
  followUpType: FollowUpType;
  followUpOwnerId: string;
  createFollowUpTask: boolean;
  notes: string;

  /** Set only when an operator overrides the duplicate warning. */
  duplicateReason: string;
  createAnyway: boolean;
}
