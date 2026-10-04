/**
 * Client-safe display and derivation helpers for the Leads module.
 *
 * No server imports — the table, the drawer, the KPI row and the add-lead sheet
 * all read from this file.
 *
 * Two rules run through it:
 *
 *  * **Colour is never the only signal.** Every helper that returns a colour
 *    has a matching label, and the components render both.
 *  * **Every date is formatted in Asia/Colombo.** `toLocaleString()` without an
 *    explicit zone renders UTC on the server and UTC+5:30 in the browser, which
 *    is a hydration mismatch on every timestamp on the page.
 */

import type { LeadListItem } from "@/lib/data/leads";
import { colomboDayDiff, normaliseMobile } from "@/lib/data/leads";
import { COLOMBO_TZ, colomboDayKey } from "@/lib/date";
import type { Tone } from "@/lib/ui/tone";
import { LEAD_STAGE_LABELS } from "@/lib/types/leads";
import type {
  FollowUpStatus,
  FollowUpType,
  LeadContactChannel,
  LeadFilters,
  LeadJourneyType,
  LeadListKpis,
  LeadLostReason,
  LeadRoomPreference,
  LeadSavedView,
  LeadSource,
  LeadStage,
  LeadTemperature,
} from "./types";
import { ALL } from "./types";

/* ── Labels ───────────────────────────────────────────────────────────────── */

/**
 * Re-exported rather than redeclared: this used to be a second copy of
 * `LEAD_STAGE_LABELS` (`lib/types/leads.ts`) that disagreed with the one the
 * Sales & Leads report built for itself — "New Lead" here, "New Leads"
 * there, for the same stage.
 */
export const STAGE_LABELS = LEAD_STAGE_LABELS;

/** Pipeline order, used for the "advance stage" action and for sorting. */
export const STAGE_ORDER: LeadStage[] = [
  "NEW_LEAD",
  "CONTACTED",
  "QUALIFIED",
  "PROPOSAL_SENT",
  "NEGOTIATION",
  "DEPOSIT_PENDING",
  "BOOKED",
  "LOST",
  "POSTPONED",
  "DUPLICATE",
  "SPAM",
];

/** Working-pipeline stages only — the terminal states are reached through their own actions. */
export const ACTIVE_STAGE_ORDER: LeadStage[] = [
  "NEW_LEAD",
  "CONTACTED",
  "QUALIFIED",
  "PROPOSAL_SENT",
  "NEGOTIATION",
  "DEPOSIT_PENDING",
  "BOOKED",
];

export const ROOM_PREFERENCE_LABELS: Record<LeadRoomPreference, string> = {
  QUAD: "Quad",
  TRIPLE: "Triple",
  DOUBLE: "Double",
  SINGLE: "Single",
  UNDECIDED: "Not decided",
};

export const CONTACT_CHANNEL_LABELS: Record<LeadContactChannel, string> = {
  WHATSAPP: "WhatsApp",
  CALL: "Call",
  EMAIL: "Email",
  SMS: "SMS",
  IN_PERSON: "In person",
  INSTAGRAM: "Instagram",
  MESSENGER: "Messenger",
};

export const JOURNEY_TYPE_LABELS: Record<LeadJourneyType, string> = {
  UMRAH: "Umrah",
  HAJJ: "Hajj",
  EARLY_REGISTRATION: "Early Registration",
};

export const SOURCE_LABELS: Record<LeadSource, string> = {
  WHATSAPP: "WhatsApp",
  PHONE_CALL: "Phone Call",
  WALK_IN: "Walk-in",
  FACEBOOK: "Facebook",
  INSTAGRAM: "Instagram",
  WEBSITE: "Website",
  GOOGLE: "Google",
  REFERRAL: "Referral",
  REPEAT_CUSTOMER: "Repeat Customer",
  COMMUNITY_EVENT: "Mosque / Community Event",
  OTHER: "Other",
};

export const TEMPERATURE_LABELS: Record<LeadTemperature, string> = {
  HOT: "Hot",
  WARM: "Warm",
  COLD: "Cold",
};

export const FOLLOW_UP_TYPE_LABELS: Record<FollowUpType, string> = {
  CALL: "Call",
  WHATSAPP_MESSAGE: "WhatsApp Message",
  SEND_QUOTE: "Send Package Quote",
  SEND_BROCHURE: "Send Brochure",
  IN_PERSON_VISIT: "In-Person Visit",
  DEPOSIT_REMINDER: "Deposit Reminder",
};

export const LOST_REASON_LABELS: Record<LeadLostReason, string> = {
  PRICE_TOO_HIGH: "Price too high",
  DATE_UNAVAILABLE: "Preferred date unavailable",
  NO_SEATS: "No seats available",
  COMPETITOR: "Competitor selected",
  VISA_CONCERN: "Visa concern",
  NO_RESPONSE: "No response",
  POSTPONED_TRAVEL: "Postponed travel",
  PAYMENT_ISSUE: "Payment / instalment issue",
  DUPLICATE: "Duplicate",
  OTHER: "Other",
};

export const FOLLOW_UP_STATUS_LABELS: Record<FollowUpStatus, string> = {
  OVERDUE: "Overdue",
  TODAY: "Due today",
  UPCOMING: "Upcoming",
  COMPLETED: "Closed",
  NONE: "Not scheduled",
};

/* ── Tones ────────────────────────────────────────────────────────────────── */

/**
 * Every status in this module maps onto the app-wide semantic tone palette
 * (`lib/ui/tone.ts`), the same six tones twenty-plus other files use, so a
 * status reads the same colour everywhere in the app. Colour is never the
 * only signal — every tone here is always paired with a label by `ToneBadge`
 * (`components/ui/tone-badge.tsx`).
 *
 * Eleven `LeadStage` values collapse onto six tones on purpose: pipeline
 * *order* is carried by `STAGE_ORDER`/`ACTIVE_STAGE_ORDER` and by the stage
 * column's position, not by a distinct hue per stage.
 */
export const STAGE_TONES: Record<LeadStage, Tone> = {
  NEW_LEAD: "info",
  CONTACTED: "warning",
  QUALIFIED: "info",
  PROPOSAL_SENT: "brand",
  NEGOTIATION: "warning",
  DEPOSIT_PENDING: "warning",
  BOOKED: "success",
  LOST: "danger",
  POSTPONED: "neutral",
  DUPLICATE: "neutral",
  SPAM: "neutral",
};

export const TEMPERATURE_TONES: Record<LeadTemperature, Tone> = {
  HOT: "danger",
  WARM: "warning",
  COLD: "info",
};

export const FOLLOW_UP_TONES: Record<FollowUpStatus, Tone> = {
  OVERDUE: "danger",
  TODAY: "warning",
  UPCOMING: "neutral",
  COMPLETED: "neutral",
  NONE: "neutral",
};

/* ── Formatting ───────────────────────────────────────────────────────────── */

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: COLOMBO_TZ,
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const timeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: COLOMBO_TZ,
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
});

export function formatDate(iso: string): string {
  return dateFormatter.format(new Date(iso));
}

export function formatTime(iso: string): string {
  return timeFormatter.format(new Date(iso)).toUpperCase();
}

export function formatDateTime(iso: string): string {
  return `${formatDate(iso)}, ${formatTime(iso)}`;
}

/**
 * "Overdue by 2 days", "Today, 04:00 PM", "Tomorrow, 10:00 AM", "12 Nov 2026".
 * `daysDiff` is the day-granularity offset already on the view model, so the
 * label agrees with the status badge next to it.
 */
export function followUpLabel(iso: string | null, daysDiff: number | null): string {
  if (!iso || daysDiff === null) return "No follow-up";
  if (daysDiff === 0) return `Today, ${formatTime(iso)}`;
  if (daysDiff === 1) return `Tomorrow, ${formatTime(iso)}`;
  if (daysDiff === -1) return `Yesterday, ${formatTime(iso)}`;
  if (daysDiff < 0) return `${formatDate(iso)} · ${-daysDiff} days overdue`;
  if (daysDiff <= 6) return `In ${daysDiff} days, ${formatTime(iso)}`;
  return formatDateTime(iso);
}

/** "Today", "Yesterday", "3 days ago", or an absolute date past a week. */
export function pastLabel(iso: string | null, daysAgo: number | null): string {
  if (!iso || daysAgo === null) return "Never contacted";
  if (daysAgo <= 0) return `Today, ${formatTime(iso)}`;
  if (daysAgo === 1) return `Yesterday, ${formatTime(iso)}`;
  if (daysAgo <= 7) return `${daysAgo} days ago`;
  return formatDate(iso);
}

const numberFormatter = new Intl.NumberFormat("en-US");

/** `5_200_000` → `LKR 5.2M`. Deterministic: locale is pinned, never implicit. */
export function formatCurrencyLKR(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "LKR 0";
  if (value >= 1_000_000) {
    const millions = (value / 1_000_000).toFixed(1).replace(/\.0$/, "");
    return `LKR ${millions}M`;
  }
  if (value >= 1_000) {
    const thousands = (value / 1_000).toFixed(0);
    return `LKR ${thousands}K`;
  }
  return `LKR ${numberFormatter.format(value)}`;
}

/** Exact figure, for the drawer and the CSV export. */
export function formatExactLKR(value: number): string {
  return `LKR ${numberFormatter.format(Math.round(value))}`;
}

/* ── datetime-local ↔ ISO ─────────────────────────────────────────────────── */

const COLOMBO_OFFSET = "+05:30";

const inputPartsFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: COLOMBO_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** ISO instant → the `YYYY-MM-DDTHH:mm` a `datetime-local` input expects. */
export function isoToLocalInput(iso: string | null): string {
  if (!iso) return "";
  const parts = inputPartsFormatter.formatToParts(new Date(iso));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "00";
  // en-CA renders midnight as "24" rather than "00" in hour12:false.
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}-${get("month")}-${get("day")}T${hour}:${get("minute")}`;
}

/** `YYYY-MM-DDTHH:mm` typed by the operator → an ISO instant in Colombo time. */
export function localInputToIso(value: string): string | null {
  if (!value) return null;
  const withSeconds = value.length === 16 ? `${value}:00` : value;
  const parsed = new Date(`${withSeconds}${COLOMBO_OFFSET}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/**
 * The follow-up time a new lead should default to, expressed as a
 * `datetime-local` value.
 *
 * Computed on demand rather than frozen into a module constant: the previous
 * form built its default once at import time, so a tab left open for an hour
 * opened the sheet already failing its own "cannot be in the past" validation.
 */
export function defaultFollowUpInput(source: LeadSource): string {
  const now = new Date();

  // Digital enquiries go cold fast — chase them within the hour.
  if (["WEBSITE", "FACEBOOK", "INSTAGRAM", "GOOGLE"].includes(source)) {
    return isoToLocalInput(new Date(now.getTime() + 30 * 60_000).toISOString());
  }

  // Someone standing at the counter gets a same-day callback if there is still
  // time today, otherwise first thing tomorrow.
  if (source === "WALK_IN") {
    const evening = new Date(`${colomboDayKey(now)}T17:00:00${COLOMBO_OFFSET}`);
    if (evening.getTime() > now.getTime() + 30 * 60_000) {
      return isoToLocalInput(evening.toISOString());
    }
  }

  const tomorrow = new Date(`${colomboDayKey(now)}T10:00:00${COLOMBO_OFFSET}`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  return isoToLocalInput(tomorrow.toISOString());
}

/* ── Search ───────────────────────────────────────────────────────────────── */

/**
 * Matches against the fields an operator would actually search by.
 *
 * The previous implementation stringified the whole row, so typing "emerald"
 * matched every lead whose avatar happened to be green and "bg" matched all of
 * them. Explicit fields also mean a search never leaks internal ids.
 */
export function matchesLeadSearch(lead: LeadListItem, query: string): boolean {
  const term = query.trim().toLowerCase();
  if (!term) return true;

  const haystack = [
    lead.reference,
    lead.name,
    lead.mobile,
    lead.mobileRaw,
    lead.email ?? "",
    lead.city,
    lead.packageName,
    lead.interestedIn,
    lead.assignedToName,
    lead.campaignReference ?? "",
    lead.referralName ?? "",
    STAGE_LABELS[lead.stage],
    SOURCE_LABELS[lead.source],
    JOURNEY_TYPE_LABELS[lead.journeyType],
  ]
    .join(" ")
    .toLowerCase();

  if (haystack.includes(term)) return true;

  // Numbers are searched as numbers: "0771234567", "+94 77 123 4567" and
  // "1234567" all have to find the lead stored as "771234567". Normalising the
  // term the same way the column is normalised handles the country code and
  // the trunk zero; the raw digits cover a partial mid-number search.
  const digits = term.replace(/\D/g, "");
  if (digits.length < 4) return false;
  const normalised = normaliseMobile(term);
  return (
    (normalised.length >= 4 && lead.mobileRaw.includes(normalised)) ||
    lead.mobileRaw.includes(digits)
  );
}

/* ── Sorting ──────────────────────────────────────────────────────────────── */

export type LeadSortField =
  | "followUp"
  | "name"
  | "stage"
  | "value"
  | "created"
  | "lastContact"
  | "owner";

export type SortDirection = "asc" | "desc";

export interface LeadSort {
  field: LeadSortField;
  direction: SortDirection;
}

export const DEFAULT_LEAD_SORT: LeadSort = {
  field: "followUp",
  direction: "asc",
};

export interface LeadSortOption {
  field: LeadSortField;
  label: string;
  ascLabel: string;
  descLabel: string;
  defaultDirection: SortDirection;
}

export const LEAD_SORT_OPTIONS: LeadSortOption[] = [
  {
    field: "followUp",
    label: "Next follow-up",
    ascLabel: "Soonest first",
    descLabel: "Latest first",
    defaultDirection: "asc",
  },
  {
    field: "value",
    label: "Estimated value",
    ascLabel: "Lowest first",
    descLabel: "Highest first",
    defaultDirection: "desc",
  },
  {
    field: "stage",
    label: "Pipeline stage",
    ascLabel: "Earliest stage first",
    descLabel: "Furthest stage first",
    defaultDirection: "asc",
  },
  {
    field: "created",
    label: "Date created",
    ascLabel: "Oldest first",
    descLabel: "Newest first",
    defaultDirection: "desc",
  },
  {
    field: "lastContact",
    label: "Last contact",
    ascLabel: "Longest ago first",
    descLabel: "Most recent first",
    defaultDirection: "asc",
  },
  {
    field: "name",
    label: "Lead name",
    ascLabel: "A → Z",
    descLabel: "Z → A",
    defaultDirection: "asc",
  },
  {
    field: "owner",
    label: "Assigned owner",
    ascLabel: "A → Z",
    descLabel: "Z → A",
    defaultDirection: "asc",
  },
];

export function sortLabel(sort: LeadSort): string {
  return (
    LEAD_SORT_OPTIONS.find((option) => option.field === sort.field)?.label ??
    "Next follow-up"
  );
}

/** Clicking the active column flips it; clicking another adopts its default. */
export function toggleSort(current: LeadSort, field: LeadSortField): LeadSort {
  if (current.field === field) {
    return {
      field,
      direction: current.direction === "asc" ? "desc" : "asc",
    };
  }
  const option = LEAD_SORT_OPTIONS.find((entry) => entry.field === field);
  return { field, direction: option?.defaultDirection ?? "asc" };
}

/** Leads with nothing scheduled sort last in both directions, never first. */
const NO_FOLLOW_UP = Number.POSITIVE_INFINITY;

function comparableValue(lead: LeadListItem, field: LeadSortField): number | string {
  switch (field) {
    case "followUp":
      return lead.nextFollowUpAt ? Date.parse(lead.nextFollowUpAt) : NO_FOLLOW_UP;
    case "value":
      return lead.estimatedValueLkr;
    case "stage":
      return STAGE_ORDER.indexOf(lead.stage);
    case "created":
      return Date.parse(lead.createdAt);
    case "lastContact":
      return lead.lastContactedAt ? Date.parse(lead.lastContactedAt) : 0;
    case "name":
      return lead.name.toLowerCase();
    case "owner":
      return lead.assignedToName.toLowerCase();
  }
}

export function sortLeads(leads: LeadListItem[], sort: LeadSort): LeadListItem[] {
  const factor = sort.direction === "asc" ? 1 : -1;

  return [...leads].sort((a, b) => {
    const left = comparableValue(a, sort.field);
    const right = comparableValue(b, sort.field);

    if (typeof left === "string" || typeof right === "string") {
      const compared = String(left).localeCompare(String(right));
      return compared !== 0 ? compared * factor : a.reference.localeCompare(b.reference);
    }

    // Unscheduled follow-ups stay at the bottom regardless of direction.
    if (sort.field === "followUp") {
      if (left === NO_FOLLOW_UP && right === NO_FOLLOW_UP) {
        return a.reference.localeCompare(b.reference);
      }
      if (left === NO_FOLLOW_UP) return 1;
      if (right === NO_FOLLOW_UP) return -1;
    }

    if (left === right) return a.reference.localeCompare(b.reference);
    return left < right ? -factor : factor;
  });
}

/* ── Saved views & filters ────────────────────────────────────────────────── */

/** High-value leads are the top quartile of open pipeline, floored at a sane minimum. */
const HIGH_VALUE_THRESHOLD_LKR = 1_500_000;

export function applySavedView(
  leads: LeadListItem[],
  view: LeadSavedView,
  currentUserId: string | null,
  nowIso: string,
): LeadListItem[] {
  switch (view) {
    case "My Leads":
      return currentUserId
        ? leads.filter((lead) => lead.assignedToId === currentUserId)
        : leads;
    case "New Today":
      return leads.filter((lead) => colomboDayDiff(lead.createdAt, nowIso) === 0);
    case "Follow-up Today":
      return leads.filter((lead) => lead.followUpStatus === "TODAY");
    case "Overdue Follow-ups":
      return leads.filter((lead) => lead.followUpStatus === "OVERDUE");
    case "High-Value Leads":
      return leads.filter(
        (lead) => !lead.isClosed && lead.estimatedValueLkr >= HIGH_VALUE_THRESHOLD_LKR,
      );
    case "Deposit Pending":
      return leads.filter((lead) => lead.stage === "DEPOSIT_PENDING");
    case "Unassigned Leads":
      return leads.filter((lead) => !lead.assignedToId);
    case "Postponed Leads":
      return leads.filter((lead) => lead.stage === "POSTPONED");
    case "Lost This Month":
      return leads.filter(
        (lead) =>
          lead.stage === "LOST" &&
          colomboDayKey(lead.updatedAt).slice(0, 7) === colomboDayKey(nowIso).slice(0, 7),
      );
    case "Duplicate Review":
      return leads.filter(
        (lead) => lead.stage === "DUPLICATE" || lead.duplicateOfLeadId !== null,
      );
    case "All Leads":
    default:
      return leads;
  }
}

export function matchesLeadFilters(
  lead: LeadListItem,
  filters: LeadFilters,
): boolean {
  if (filters.stage !== ALL && lead.stage !== filters.stage) return false;
  if (filters.journeyType !== ALL && lead.journeyType !== filters.journeyType) {
    return false;
  }
  if (filters.packageId !== ALL && lead.packageId !== filters.packageId) return false;
  if (filters.source !== ALL && lead.source !== filters.source) return false;
  if (filters.temperature !== ALL && lead.temperature !== filters.temperature) {
    return false;
  }
  if (filters.assignedTo !== ALL && lead.assignedToId !== filters.assignedTo) {
    return false;
  }
  if (filters.followUp !== ALL && lead.followUpStatus !== filters.followUp) {
    return false;
  }
  if (filters.city !== ALL && lead.city !== filters.city) return false;
  return true;
}

/* ── KPIs ─────────────────────────────────────────────────────────────────── */

/**
 * Computed from the leads currently in view, so the cards and the table always
 * describe the same set — hard-coded KPI numbers were the previous behaviour
 * and disagreed with the table the moment anything was filtered or added.
 */
export function computeLeadKpis(
  leads: LeadListItem[],
  nowIso: string,
): LeadListKpis {
  const ageInDays = (lead: LeadListItem) => -colomboDayDiff(nowIso, lead.createdAt);

  const newLast30 = leads.filter((lead) => ageInDays(lead) <= 30).length;
  const newPrev30 = leads.filter(
    (lead) => ageInDays(lead) > 30 && ageInDays(lead) <= 60,
  ).length;
  const newLeadsDeltaPct =
    newPrev30 === 0
      ? null
      : Math.round(((newLast30 - newPrev30) / newPrev30) * 100);

  const open = leads.filter((lead) => !lead.isClosed);
  const contacted = leads.filter((lead) => lead.stage !== "NEW_LEAD").length;
  const booked = leads.filter((lead) => lead.stage === "BOOKED").length;

  return {
    newLeads: newLast30,
    newLeadsDeltaPct,
    contacted,
    contactRate: leads.length === 0 ? 0 : Math.round((contacted / leads.length) * 100),
    overdueFollowUps: leads.filter((lead) => lead.followUpStatus === "OVERDUE").length,
    dueToday: leads.filter((lead) => lead.followUpStatus === "TODAY").length,
    booked,
    conversionRate: leads.length === 0 ? 0 : Math.round((booked / leads.length) * 100),
    openPipelineLkr: open.reduce((sum, lead) => sum + lead.estimatedValueLkr, 0),
  };
}

/* ── Misc ─────────────────────────────────────────────────────────────────── */

/** The next stage in the pipeline, or `null` at the end / for closed leads. */
export function nextStage(stage: LeadStage): LeadStage | null {
  const index = ACTIVE_STAGE_ORDER.indexOf(stage);
  if (index === -1) return null;
  return ACTIVE_STAGE_ORDER[index + 1] ?? null;
}

/** `wa.me` deep link for the lead's WhatsApp number. */
export function whatsappLink(mobileRaw: string): string {
  return `https://wa.me/94${mobileRaw}`;
}

export function partySizeLabel(adults: number, children: number): string {
  const parts = [`${adults} adult${adults === 1 ? "" : "s"}`];
  if (children > 0) parts.push(`${children} child${children === 1 ? "" : "ren"}`);
  return parts.join(", ");
}
