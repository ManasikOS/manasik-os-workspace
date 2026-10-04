/**
 * Pure business rules for Leads: row → view-model mapping, and mutators that
 * operate on an in-memory `LeadStore`.
 *
 * Deliberately client-safe — no `next/headers`, no Supabase import — so the
 * same mutators run identically inside a Server Action
 * (`app/(main)/leads/actions.ts`, backed by `lib/data/leads-repository.ts`)
 * and, before persistence existed, directly in the browser. One
 * implementation of every rule — reference numbering, stage transitions,
 * follow-up scheduling, value recalculation — rather than two that can drift.
 */

import { colomboDayKey } from "@/lib/date";
import { newId } from "@/lib/data/leads-ids";
import type { LeadStore } from "@/lib/data/leads-repository";
import type {
  FollowUpStatus,
  FollowUpType,
  LeadActivityType,
  LeadContactChannel,
  LeadJourneyType,
  LeadLostReason,
  LeadNoteRow,
  LeadPackageRow,
  LeadQuoteRow,
  LeadRoomPreference,
  LeadRow,
  LeadSource,
  LeadStage,
  LeadTemperature,
} from "@/lib/types/leads";
import { CLOSED_STAGES } from "@/lib/types/leads";
import type { QuoteStatus } from "@/lib/copilot/sales/types";
import type { ConsentChannel, ConsentStatus } from "@/lib/types/consent";
import type { AttributionType } from "@/lib/types/campaigns";

/* ── View models ──────────────────────────────────────────────────────────── */

export interface LeadActivityItem {
  id: string;
  type: LeadActivityType;
  message: string;
  actorName: string;
  createdAt: string;
}

export interface LeadNoteItem {
  id: string;
  body: string;
  authorName: string;
  createdAt: string;
}

export interface LeadQuoteItem {
  id: string;
  reference: string;
  status: QuoteStatus;
  totalLkr: number;
  depositLkr: number;
  validUntil: string;
  sentVia: "WHATSAPP" | "EMAIL" | "PDF" | null;
  sentAt: string | null;
  createdAt: string;
}

export interface LeadListItem {
  id: string;
  reference: string;

  name: string;
  initials: string;
  /** Tailwind classes for the avatar chip, derived from the id — not stored. */
  avatarTone: string;
  mobile: string;
  /** Digits only, for `tel:` / `wa.me` links and duplicate matching. */
  mobileRaw: string;
  email: string | null;
  city: string;
  preferredLanguage: string;
  preferredChannel: LeadContactChannel;

  consentStatus: ConsentStatus;
  consentSource: string | null;
  consentAt: string | null;
  doNotContact: boolean;
  contactableChannels: ConsentChannel[];

  campaignId: string | null;
  attributionType: AttributionType;

  journeyType: LeadJourneyType;
  interestedIn: string;
  packageId: string | null;
  packageName: string;
  preferredPeriod: string;
  adults: number;
  children: number;
  partySize: number;
  roomPreference: LeadRoomPreference;
  departureCity: string;
  budgetRange: string;
  quotaWaitlistInterest: boolean;

  source: LeadSource;
  campaignReference: string | null;
  referralName: string | null;
  assignedToId: string;
  assignedToName: string;
  stage: LeadStage;
  temperature: LeadTemperature;
  estimatedValueLkr: number;

  selectedDepartureGroupId: string | null;
  bookingId: string | null;

  nextFollowUpAt: string | null;
  followUpType: FollowUpType | null;
  followUpOwnerName: string | null;
  followUpStatus: FollowUpStatus;
  /** Whole days from today; negative when the follow-up day has passed. */
  daysUntilFollowUp: number | null;
  followUpAttempts: number;
  firstResponseAt: string | null;

  lastContactedAt: string | null;
  daysSinceLastContact: number | null;

  lostReason: LeadLostReason | null;
  lostNote: string | null;
  postponedUntil: string | null;
  duplicateOfLeadId: string | null;

  createdAt: string;
  updatedAt: string;
  ageInDays: number;
  /** No longer in the working pipeline: Booked, Lost, Postponed, Duplicate, Spam. */
  isClosed: boolean;

  activity: LeadActivityItem[];
  notes: LeadNoteItem[];
  quotes: LeadQuoteItem[];
}

/* ── Date helpers ─────────────────────────────────────────────────────────── */

const MS_PER_DAY = 86_400_000;

/**
 * Whole days between two instants, measured on the Colombo calendar rather than
 * by elapsed milliseconds — "tomorrow at 09:00" is one day away whether it is
 * now 08:00 or 23:00, which is how a follow-up list is actually read.
 *
 * Comparing at day granularity also keeps the server render and the first
 * client render in agreement: both resolve the same two calendar dates, where
 * an instant comparison would disagree by the request's travel time.
 */
export function colomboDayDiff(fromIso: string, toIso: string): number {
  const from = Date.parse(`${colomboDayKey(fromIso)}T00:00:00Z`);
  const to = Date.parse(`${colomboDayKey(toIso)}T00:00:00Z`);
  return Math.round((to - from) / MS_PER_DAY);
}

function followUpStatusFor(
  lead: LeadRow,
  daysUntil: number | null,
): FollowUpStatus {
  if (CLOSED_STAGES.includes(lead.stage)) return "COMPLETED";
  if (daysUntil === null) return "NONE";
  if (daysUntil < 0) return "OVERDUE";
  if (daysUntil === 0) return "TODAY";
  return "UPCOMING";
}

/* ── Presentation-neutral derivations ─────────────────────────────────────── */

const AVATAR_TONES = [
  "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  "bg-purple-500/15 text-purple-700 dark:text-purple-300",
  "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300",
  "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300",
  "bg-teal-500/15 text-teal-700 dark:text-teal-300",
];

function avatarToneFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return AVATAR_TONES[hash % AVATAR_TONES.length];
}

/** Up to two initials, skipping honorifics so "Dr. Fathima Rila" reads "FR". */
export function initialsFor(name: string): string {
  const HONORIFICS = new Set(["dr", "mr", "mrs", "ms", "al-haj", "alhaj", "haji"]);
  const parts = name
    .split(/\s+/)
    .map((part) => part.replace(/[^\p{L}-]/gu, ""))
    .filter((part) => part && !HONORIFICS.has(part.toLowerCase()));

  const source = parts.length > 0 ? parts : name.split(/\s+/);
  return source
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

/** `771234567` → `+94 77 123 4567`. Unexpected lengths are left alone. */
export function formatSriLankanMobile(digits: string): string {
  const clean = normaliseMobile(digits);
  if (clean.length !== 9) return clean ? `+94 ${clean}` : "";
  return `+94 ${clean.slice(0, 2)} ${clean.slice(2, 5)} ${clean.slice(5)}`;
}

/**
 * Reduces anything an operator might type — `0771234567`, `+94 77 123 4567`,
 * `94771234567` — to the nine-digit subscriber number that is stored.
 */
export function normaliseMobile(input: string): string {
  let digits = input.replace(/\D/g, "");
  if (digits.startsWith("0094")) digits = digits.slice(4);
  else if (digits.startsWith("94") && digits.length > 9) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = digits.slice(1);
  return digits;
}

export function packageById(
  store: Pick<LeadStore, "packages">,
  id: string | null,
): LeadPackageRow | null {
  if (!id) return null;
  return store.packages.find((entry) => entry.id === id) ?? null;
}

const ROOM_PRICE_KEY: Record<Exclude<LeadRoomPreference, "UNDECIDED">, keyof LeadPackageRow> = {
  QUAD: "quad_price",
  TRIPLE: "triple_price",
  DOUBLE: "double_price",
  SINGLE: "single_price",
};

/**
 * Baseline price per traveller when no package has been chosen yet, so an
 * enquiry still carries a defensible pipeline value.
 */
export const BASELINE_PRICE_LKR: Record<LeadJourneyType, number> = {
  UMRAH: 950_000,
  HAJJ: 2_600_000,
  EARLY_REGISTRATION: 1_500_000,
};

/**
 * Per-person price for a package at the given room preference, falling back to
 * the package's cheapest room (or the journey's baseline once no package is
 * chosen at all) — so an "undecided" room never prices a lead at zero.
 */
export function pricePerPerson(
  store: Pick<LeadStore, "packages">,
  packageId: string | null,
  journeyType: LeadJourneyType,
  roomPreference: LeadRoomPreference = "UNDECIDED",
): number {
  const pkg = packageById(store, packageId);
  if (!pkg) return BASELINE_PRICE_LKR[journeyType];

  if (roomPreference !== "UNDECIDED") {
    const value = pkg[ROOM_PRICE_KEY[roomPreference]] as number | null;
    if (value !== null && value !== undefined) return value;
  }
  return pkg.price_per_person_lkr || BASELINE_PRICE_LKR[journeyType];
}

/* ── Row → view model ─────────────────────────────────────────────────────── */

export function toLeadListItem(
  lead: LeadRow,
  store: Pick<LeadStore, "activity" | "notes" | "quotes">,
  nowIso: string,
): LeadListItem {
  const daysUntilFollowUp = lead.next_follow_up_at
    ? colomboDayDiff(nowIso, lead.next_follow_up_at)
    : null;

  return {
    id: lead.id,
    reference: lead.reference,

    name: lead.full_name,
    initials: initialsFor(lead.full_name),
    avatarTone: avatarToneFor(lead.id),
    mobile: formatSriLankanMobile(lead.mobile),
    mobileRaw: lead.mobile,
    email: lead.email,
    city: lead.city,
    preferredLanguage: lead.preferred_language,
    preferredChannel: lead.preferred_channel,

    consentStatus: lead.consent_status,
    consentSource: lead.consent_source,
    consentAt: lead.consent_at,
    doNotContact: lead.do_not_contact,
    contactableChannels: lead.contactable_channels,

    campaignId: lead.campaign_id,
    attributionType: lead.attribution_type,

    journeyType: lead.journey_type,
    interestedIn: lead.interested_in,
    packageId: lead.desired_package_id,
    packageName: lead.desired_package_name ?? "Not decided",
    preferredPeriod: lead.preferred_period,
    adults: lead.adults,
    children: lead.children,
    partySize: lead.adults + lead.children,
    roomPreference: lead.room_preference,
    departureCity: lead.departure_city,
    budgetRange: lead.budget_range,
    quotaWaitlistInterest: lead.quota_waitlist_interest,

    source: lead.source,
    campaignReference: lead.campaign_reference,
    referralName: lead.referral_name,
    assignedToId: lead.assigned_to_id,
    assignedToName: lead.assigned_to_name,
    stage: lead.stage,
    temperature: lead.temperature,
    estimatedValueLkr: lead.estimated_value_lkr,

    selectedDepartureGroupId: lead.selected_departure_group_id,
    bookingId: lead.booking_id,

    nextFollowUpAt: lead.next_follow_up_at,
    followUpType: lead.follow_up_type,
    followUpOwnerName: lead.follow_up_owner_name,
    followUpStatus: followUpStatusFor(lead, daysUntilFollowUp),
    daysUntilFollowUp,
    followUpAttempts: lead.follow_up_attempts,
    firstResponseAt: lead.first_response_at,

    lastContactedAt: lead.last_contacted_at,
    daysSinceLastContact: lead.last_contacted_at
      ? -colomboDayDiff(nowIso, lead.last_contacted_at)
      : null,

    lostReason: lead.lost_reason,
    lostNote: lead.lost_note,
    postponedUntil: lead.postponed_until,
    duplicateOfLeadId: lead.duplicate_of_lead_id,

    createdAt: lead.created_at,
    updatedAt: lead.updated_at,
    ageInDays: -colomboDayDiff(nowIso, lead.created_at),
    isClosed: CLOSED_STAGES.includes(lead.stage),

    activity: store.activity
      .filter((entry) => entry.lead_id === lead.id)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((entry) => ({
        id: entry.id,
        type: entry.type,
        message: entry.message,
        actorName: entry.actor_name,
        createdAt: entry.created_at,
      })),

    notes: store.notes
      .filter((entry) => entry.lead_id === lead.id)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((entry) => ({
        id: entry.id,
        body: entry.body,
        authorName: entry.author_name,
        createdAt: entry.created_at,
      })),

    quotes: store.quotes
      .filter((entry) => entry.lead_id === lead.id)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((entry) => ({
        id: entry.id,
        reference: entry.reference,
        // Rows written before the quote-draft migration have no status column.
        status: entry.status ?? "SENT",
        totalLkr: Number(entry.total_lkr),
        depositLkr: Number(entry.deposit_lkr),
        validUntil: entry.valid_until,
        sentVia: entry.sent_via,
        sentAt: entry.sent_at,
        createdAt: entry.created_at,
      })),
  };
}

export function toLeadListItems(store: LeadStore, nowIso: string): LeadListItem[] {
  return store.leads.map((lead) => toLeadListItem(lead, store, nowIso));
}

/* ── Mutators ─────────────────────────────────────────────────────────────── */

export interface MutationOutcome {
  ok: boolean;
  error?: string;
}

function pushActivity(
  store: LeadStore,
  leadId: string,
  type: LeadActivityType,
  message: string,
  actorName: string,
  nowIso: string,
): void {
  store.activity.push({
    id: newId(),
    lead_id: leadId,
    type,
    message,
    actor_name: actorName,
    created_at: nowIso,
  });
}

function findLead(store: LeadStore, leadId: string): LeadRow | null {
  return store.leads.find((lead) => lead.id === leadId) ?? null;
}

/**
 * Next reference in the `LD-<year>-NNNN` series. Derived from the highest
 * number already in the store rather than randomised, so two leads created in
 * the same session can never collide.
 */
export function nextLeadReference(store: LeadStore, nowIso: string): string {
  const year = colomboDayKey(nowIso).slice(0, 4);
  const prefix = `LD-${year}-`;

  const highest = store.leads.reduce((max, lead) => {
    if (!lead.reference.startsWith(prefix)) return max;
    const parsed = Number.parseInt(lead.reference.slice(prefix.length), 10);
    return Number.isFinite(parsed) ? Math.max(max, parsed) : max;
  }, 0);

  return `${prefix}${String(highest + 1).padStart(4, "0")}`;
}

export interface CreateLeadInput {
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
  assignedToName: string;
  stage: LeadStage;
  temperature: LeadTemperature;

  nextFollowUpAt: string | null;
  followUpType: FollowUpType;
  followUpOwnerId: string;
  followUpOwnerName: string;
  notes: string;

  duplicateOfLeadId?: string | null;
  duplicateOverrideReason?: string;
}

export interface CreateLeadOutcome extends MutationOutcome {
  lead?: LeadRow;
}

export function createLeadInStore(
  store: LeadStore,
  input: CreateLeadInput,
  nowIso: string,
): CreateLeadOutcome {
  const mobile = normaliseMobile(input.mobile);
  if (!input.fullName.trim()) {
    return { ok: false, error: "A full name is required." };
  }
  if (mobile.length !== 9) {
    return {
      ok: false,
      error: "Enter a nine-digit Sri Lankan mobile number, e.g. 77 123 4567.",
    };
  }
  if (input.adults < 1) {
    return { ok: false, error: "A lead needs at least one adult traveller." };
  }
  if (!input.assignedToId) {
    return { ok: false, error: "Assign a sales owner." };
  }
  if (!input.nextFollowUpAt) {
    return { ok: false, error: "A next follow-up is required for every new lead." };
  }

  const reference = nextLeadReference(store, nowIso);
  const pkg = packageById(store, input.packageId);
  const travellers = input.adults + input.children;

  const lead: LeadRow = {
    id: newId(),
    reference,

    full_name: input.fullName.trim(),
    mobile,
    email: input.email.trim() || null,
    city: input.city,
    preferred_language: input.preferredLanguage,
    preferred_channel: input.preferredChannel,

    journey_type: input.journeyType,
    interested_in: input.interestedIn,
    desired_package_id: pkg?.id ?? null,
    desired_package_name: pkg?.name ?? null,
    preferred_period: input.preferredPeriod,
    adults: input.adults,
    children: input.children,
    room_preference: input.roomPreference,
    departure_city: input.departureCity,
    budget_range: input.budgetRange,
    quota_waitlist_interest: input.quotaWaitlistInterest,

    source: input.source,
    campaign_reference: input.campaignReference.trim() || null,
    campaign_id: null,
    utm_source: null,
    utm_medium: null,
    utm_campaign: null,
    utm_content: null,
    utm_term: null,
    attribution_type: "UNKNOWN",
    referral_name: input.referralName.trim() || null,
    assigned_to_id: input.assignedToId,
    assigned_to_name: input.assignedToName,
    stage: input.stage,
    temperature: input.temperature,

    estimated_value_lkr:
      pricePerPerson(store, input.packageId, input.journeyType, input.roomPreference) *
      travellers,

    selected_departure_group_id: null,
    booking_id: null,

    next_follow_up_at: input.nextFollowUpAt,
    follow_up_type: input.followUpType,
    follow_up_owner_id: input.followUpOwnerId,
    follow_up_owner_name: input.followUpOwnerName,
    follow_up_attempts: 0,
    first_response_at: null,

    last_contacted_at: null,

    lost_reason: null,
    lost_note: null,
    postponed_until: null,
    duplicate_of_lead_id: input.duplicateOfLeadId ?? null,
    duplicate_override_reason: input.duplicateOverrideReason?.trim() || null,

    // Never inferred at creation — a lead starts UNKNOWN until a staff
    // member records an explicit decision (see updateLeadConsentInStore).
    consent_status: "UNKNOWN",
    consent_source: null,
    consent_at: null,
    do_not_contact: false,
    contactable_channels: [],

    created_at: nowIso,
    updated_at: nowIso,
  };

  store.leads.unshift(lead);

  pushActivity(
    store,
    lead.id,
    "CREATED",
    `Lead captured and assigned to ${input.assignedToName}.`,
    input.assignedToName,
    nowIso,
  );
  if (lead.duplicate_override_reason) {
    pushActivity(
      store,
      lead.id,
      "CREATED",
      `Created despite a possible duplicate: ${lead.duplicate_override_reason}`,
      input.assignedToName,
      nowIso,
    );
  }
  pushActivity(
    store,
    lead.id,
    "FOLLOW_UP_SCHEDULED",
    "Next follow-up scheduled.",
    input.assignedToName,
    nowIso,
  );

  if (input.notes.trim()) {
    store.notes.push({
      id: newId(),
      lead_id: lead.id,
      body: input.notes.trim(),
      author_name: input.assignedToName,
      created_at: nowIso,
    });
  }

  return { ok: true, lead };
}

export interface ChangeStageInput {
  leadId: string;
  stage: LeadStage;
  actorName: string;
  lostReason?: LeadLostReason;
  lostNote?: string;
  postponedUntil?: string | null;
}

export function changeLeadStageInStore(
  store: LeadStore,
  input: ChangeStageInput,
  nowIso: string,
): MutationOutcome {
  const lead = findLead(store, input.leadId);
  if (!lead) return { ok: false, error: "That lead no longer exists." };
  if (lead.stage === input.stage) return { ok: true };

  if (input.stage === "LOST" && !input.lostReason) {
    return { ok: false, error: "Select a reason before marking a lead lost." };
  }
  if (lead.booking_id) {
    return { ok: false, error: "This lead is already linked to a booking." };
  }

  const previous = lead.stage;
  lead.stage = input.stage;
  lead.updated_at = nowIso;

  if (input.stage === "LOST") {
    lead.lost_reason = input.lostReason ?? null;
    lead.lost_note = input.lostNote?.trim() || null;
  } else {
    lead.lost_reason = null;
    lead.lost_note = null;
  }

  lead.postponed_until = input.stage === "POSTPONED" ? input.postponedUntil ?? null : null;

  // A closed lead must not keep surfacing in the follow-up queue.
  if (CLOSED_STAGES.includes(input.stage)) {
    lead.next_follow_up_at = null;
    lead.follow_up_type = null;
    lead.follow_up_owner_id = null;
    lead.follow_up_owner_name = null;
  }

  const reopened =
    CLOSED_STAGES.includes(previous) && !CLOSED_STAGES.includes(input.stage);

  const type: LeadActivityType =
    input.stage === "LOST"
      ? "LOST"
      : input.stage === "POSTPONED"
        ? "POSTPONED"
        : reopened
          ? "REOPENED"
          : "STAGE_CHANGED";

  const message =
    input.stage === "LOST"
      ? input.lostNote?.trim() ||
        `Marked lost (${input.lostReason?.replace(/_/g, " ").toLowerCase()}).`
      : `Stage moved from ${previous.replace(/_/g, " ").toLowerCase()} to ${input.stage
          .replace(/_/g, " ")
          .toLowerCase()}.`;

  pushActivity(store, lead.id, type, message, input.actorName, nowIso);

  return { ok: true };
}

export function assignLeadInStore(
  store: LeadStore,
  input: { leadId: string; staffId: string; staffName: string; actorName: string },
  nowIso: string,
): MutationOutcome {
  const lead = findLead(store, input.leadId);
  if (!lead) return { ok: false, error: "That lead no longer exists." };
  if (lead.assigned_to_id === input.staffId) return { ok: true };

  // The follow-up task follows the lead unless someone else owns it on purpose.
  const followUpFollowed = lead.follow_up_owner_id === lead.assigned_to_id;
  lead.assigned_to_id = input.staffId;
  lead.assigned_to_name = input.staffName;
  if (followUpFollowed) {
    lead.follow_up_owner_id = input.staffId;
    lead.follow_up_owner_name = input.staffName;
  }
  lead.updated_at = nowIso;

  pushActivity(
    store,
    lead.id,
    "ASSIGNED",
    `Reassigned to ${input.staffName}.`,
    input.actorName,
    nowIso,
  );

  return { ok: true };
}

export interface LogContactInput {
  leadId: string;
  /** What was said; stored on the activity trail, not on the lead. */
  summary: string;
  actorName: string;
  nextFollowUpAt: string | null;
  followUpType: FollowUpType | null;
  followUpOwnerId?: string;
  followUpOwnerName?: string;
  advanceToStage?: LeadStage;
}

export function logContactInStore(
  store: LeadStore,
  input: LogContactInput,
  nowIso: string,
): MutationOutcome {
  const lead = findLead(store, input.leadId);
  if (!lead) return { ok: false, error: "That lead no longer exists." };
  if (!input.summary.trim()) {
    return { ok: false, error: "Add a short note describing the contact." };
  }
  if (input.nextFollowUpAt && Date.parse(input.nextFollowUpAt) < Date.now()) {
    return { ok: false, error: "The next follow-up cannot be in the past." };
  }

  if (!lead.first_response_at) lead.first_response_at = nowIso;
  lead.last_contacted_at = nowIso;
  lead.next_follow_up_at = input.nextFollowUpAt;
  lead.follow_up_type = input.nextFollowUpAt ? input.followUpType : null;
  lead.follow_up_owner_id = input.nextFollowUpAt
    ? input.followUpOwnerId ?? lead.assigned_to_id
    : null;
  lead.follow_up_owner_name = input.nextFollowUpAt
    ? input.followUpOwnerName ?? lead.assigned_to_name
    : null;
  lead.follow_up_attempts += 1;
  lead.updated_at = nowIso;

  pushActivity(store, lead.id, "CONTACT_LOGGED", input.summary.trim(), input.actorName, nowIso);

  // A first contact on a brand-new lead is the whole point of the "New Lead"
  // stage, so move it along rather than leaving the board misleading.
  const target =
    input.advanceToStage ?? (lead.stage === "NEW_LEAD" ? "CONTACTED" : null);
  if (target && target !== lead.stage) {
    changeLeadStageInStore(
      store,
      { leadId: lead.id, stage: target, actorName: input.actorName },
      nowIso,
    );
  }

  if (input.nextFollowUpAt) {
    pushActivity(store, lead.id, "FOLLOW_UP_SCHEDULED", "Next follow-up rescheduled.", input.actorName, nowIso);
  }

  return { ok: true };
}

export interface SetFollowUpInput {
  leadId: string;
  actorName: string;
  nextFollowUpAt: string;
  followUpType: FollowUpType;
  followUpOwnerId: string;
  followUpOwnerName: string;
}

/** Schedules or reschedules the next follow-up without logging a contact. */
export function setFollowUpInStore(
  store: LeadStore,
  input: SetFollowUpInput,
  nowIso: string,
): MutationOutcome {
  const lead = findLead(store, input.leadId);
  if (!lead) return { ok: false, error: "That lead no longer exists." };
  if (Date.parse(input.nextFollowUpAt) < Date.now()) {
    return { ok: false, error: "The next follow-up cannot be in the past." };
  }

  lead.next_follow_up_at = input.nextFollowUpAt;
  lead.follow_up_type = input.followUpType;
  lead.follow_up_owner_id = input.followUpOwnerId;
  lead.follow_up_owner_name = input.followUpOwnerName;
  lead.updated_at = nowIso;

  pushActivity(store, lead.id, "FOLLOW_UP_SCHEDULED", "Next follow-up scheduled.", input.actorName, nowIso);
  return { ok: true };
}

/** Clears an overdue follow-up as handled, without scheduling the next one. */
export function completeFollowUpInStore(
  store: LeadStore,
  input: { leadId: string; actorName: string },
  nowIso: string,
): MutationOutcome {
  const lead = findLead(store, input.leadId);
  if (!lead) return { ok: false, error: "That lead no longer exists." };

  lead.next_follow_up_at = null;
  lead.follow_up_type = null;
  lead.follow_up_owner_id = null;
  lead.follow_up_owner_name = null;
  lead.updated_at = nowIso;

  pushActivity(store, lead.id, "FOLLOW_UP_COMPLETED", "Follow-up marked complete.", input.actorName, nowIso);
  return { ok: true };
}

export function addLeadNoteInStore(
  store: LeadStore,
  input: { leadId: string; note: string; actorName: string },
  nowIso: string,
): MutationOutcome {
  const lead = findLead(store, input.leadId);
  if (!lead) return { ok: false, error: "That lead no longer exists." };
  if (!input.note.trim()) return { ok: false, error: "The note is empty." };

  store.notes.push({
    id: newId(),
    lead_id: lead.id,
    body: input.note.trim(),
    author_name: input.actorName,
    created_at: nowIso,
  });

  lead.updated_at = nowIso;
  pushActivity(store, lead.id, "NOTE_ADDED", input.note.trim(), input.actorName, nowIso);
  return { ok: true };
}

/** Records interest in a live Departure Group without touching its capacity. */
export function selectDepartureGroupInStore(
  store: LeadStore,
  input: { leadId: string; departureGroupId: string; groupLabel: string; actorName: string },
  nowIso: string,
): MutationOutcome {
  const lead = findLead(store, input.leadId);
  if (!lead) return { ok: false, error: "That lead no longer exists." };

  lead.selected_departure_group_id = input.departureGroupId;
  lead.updated_at = nowIso;

  pushActivity(
    store,
    lead.id,
    "GROUP_SELECTED",
    `Selected ${input.groupLabel} as the departure group.`,
    input.actorName,
    nowIso,
  );
  return { ok: true };
}

export interface RecordQuoteInput {
  leadId: string;
  quote: Omit<LeadQuoteRow, "id" | "lead_id" | "created_at">;
  actorName: string;
}

/** Stores a sent quote and advances an early-stage lead to Proposal Sent. */
export function recordQuoteInStore(
  store: LeadStore,
  input: RecordQuoteInput,
  nowIso: string,
): MutationOutcome {
  const lead = findLead(store, input.leadId);
  if (!lead) return { ok: false, error: "That lead no longer exists." };

  const row: LeadQuoteRow = {
    id: newId(),
    lead_id: lead.id,
    created_at: nowIso,
    ...input.quote,
  };
  store.quotes.push(row);
  lead.updated_at = nowIso;

  pushActivity(
    store,
    lead.id,
    "QUOTE_SENT",
    `Quote ${row.reference} sent${row.sent_via ? ` via ${row.sent_via.toLowerCase()}` : ""}.`,
    input.actorName,
    nowIso,
  );

  const EARLY_STAGES: LeadStage[] = ["NEW_LEAD", "CONTACTED", "QUALIFIED"];
  if (EARLY_STAGES.includes(lead.stage)) {
    changeLeadStageInStore(
      store,
      { leadId: lead.id, stage: "PROPOSAL_SENT", actorName: input.actorName },
      nowIso,
    );
  }

  return { ok: true };
}

export interface UpdateQuoteStatusInput {
  quoteId: string;
  status: QuoteStatus;
  actorName: string;
}

/**
 * Records a customer's accept/decline decision (or an explicit expiry) on a
 * previously sent quote. Never touches the booking — accepting a quote is a
 * commercial decision the sales owner still has to act on by actually
 * converting it (`convertQuoteToBookingAction`); this only marks the offer's
 * own state so the /quotes ledger stops showing it as open.
 *
 * Sending a revision (a quote with `supersedes_quote_id` set) also marks the
 * quote it replaces SUPERSEDED — plan §4.4 gap 2: "the previous quote
 * becomes SUPERSEDED when the revision is sent", not the moment it's drafted.
 */
export function updateQuoteStatusInStore(
  store: LeadStore,
  input: UpdateQuoteStatusInput,
  nowIso: string,
): MutationOutcome {
  const quote = store.quotes.find((q) => q.id === input.quoteId);
  if (!quote) return { ok: false, error: "That quote no longer exists." };

  quote.status = input.status;

  pushActivity(
    store,
    quote.lead_id,
    "QUOTE_STATUS_CHANGED",
    `Quote ${quote.reference} marked ${input.status.replace("_", " ").toLowerCase()}.`,
    input.actorName,
    nowIso,
  );

  if (input.status === "SENT" && quote.supersedes_quote_id) {
    const superseded = store.quotes.find((q) => q.id === quote.supersedes_quote_id);
    if (superseded && superseded.status !== "SUPERSEDED") {
      superseded.status = "SUPERSEDED";
      pushActivity(
        store,
        quote.lead_id,
        "QUOTE_STATUS_CHANGED",
        `Quote ${superseded.reference} superseded by revision ${quote.reference}.`,
        input.actorName,
        nowIso,
      );
    }
  }

  return { ok: true };
}

export interface CreateQuoteRevisionInput {
  sourceQuoteId: string;
  actorName: string;
}

/**
 * Clones a quote into a new DRAFT revision — plan §4.4 gap 2. Every price
 * field is copied verbatim from the source; nothing here recomputes a
 * price, so a revision never diverges from whatever the pricing engine
 * already produced for the source quote (the eventual editor for a
 * revision's own numbers is a follow-up, not part of this clone).
 */
export function createQuoteRevisionInStore(
  store: LeadStore,
  input: CreateQuoteRevisionInput,
  nowIso: string,
): MutationOutcome & { quoteId?: string } {
  const source = store.quotes.find((q) => q.id === input.sourceQuoteId);
  if (!source) return { ok: false, error: "That quote no longer exists." };
  if (source.status === "DRAFT") return { ok: false, error: "This quote is already a draft." };

  const revision: LeadQuoteRow = {
    ...source,
    id: newId(),
    reference: `${source.reference}-R${store.quotes.filter((q) => q.supersedes_quote_id === source.id).length + 1}`,
    status: "DRAFT",
    sent_via: null,
    sent_at: null,
    viewed_at: null,
    cancelled_at: null,
    rejection_reason: null,
    booking_id: null,
    portal_token_hash: null,
    supersedes_quote_id: source.id,
    created_by_name: input.actorName,
    created_at: nowIso,
  };
  store.quotes.push(revision);

  pushActivity(
    store,
    source.lead_id,
    "QUOTE_DRAFTED",
    `Revision ${revision.reference} drafted from ${source.reference}.`,
    input.actorName,
    nowIso,
  );

  return { ok: true, quoteId: revision.id };
}

export interface CancelQuoteInput {
  quoteId: string;
  reason: string;
  actorName: string;
}

export function cancelQuoteInStore(store: LeadStore, input: CancelQuoteInput, nowIso: string): MutationOutcome {
  const quote = store.quotes.find((q) => q.id === input.quoteId);
  if (!quote) return { ok: false, error: "That quote no longer exists." };
  if (quote.status === "ACCEPTED") return { ok: false, error: "An accepted quote cannot be cancelled — decline or revise it instead." };

  quote.status = "CANCELLED";
  quote.cancelled_at = nowIso;
  quote.rejection_reason = input.reason;

  pushActivity(store, quote.lead_id, "QUOTE_STATUS_CHANGED", `Quote ${quote.reference} cancelled: ${input.reason}`, input.actorName, nowIso);

  return { ok: true };
}

export interface ExtendQuoteValidityInput {
  quoteId: string;
  days: number;
  actorName: string;
}

/**
 * `QUOTE_EXTEND_VALIDITY`'s only effect (plan §4.4) — moves `valid_until`
 * out, nothing about price or seats. Refused once a quote is no longer
 * open, so extending can't resurrect a decision already made.
 */
export function extendQuoteValidityInStore(
  store: LeadStore,
  input: ExtendQuoteValidityInput,
  nowIso: string,
): MutationOutcome {
  const quote = store.quotes.find((q) => q.id === input.quoteId);
  if (!quote) return { ok: false, error: "That quote no longer exists." };
  if (quote.status !== "SENT" && quote.status !== "VIEWED") {
    return { ok: false, error: "Only a sent or viewed quote's validity can be extended." };
  }

  const nextValidUntil = new Date(Date.parse(quote.valid_until) + input.days * 86_400_000).toISOString();
  quote.valid_until = nextValidUntil;

  pushActivity(
    store,
    quote.lead_id,
    "QUOTE_STATUS_CHANGED",
    `Quote ${quote.reference} validity extended by ${input.days} day(s), to ${nextValidUntil.slice(0, 10)}.`,
    input.actorName,
    nowIso,
  );

  return { ok: true };
}

export interface LinkQuoteToBookingInput {
  quoteId: string;
  bookingId: string;
  actorName: string;
}

/** The write half of `convertQuoteToBooking`'s idempotency check — set once, never cleared. */
export function linkQuoteToBookingInStore(store: LeadStore, input: LinkQuoteToBookingInput, nowIso: string): MutationOutcome {
  const quote = store.quotes.find((q) => q.id === input.quoteId);
  if (!quote) return { ok: false, error: "That quote no longer exists." };
  if (quote.booking_id) return { ok: true }; // already converted — idempotent no-op

  quote.booking_id = input.bookingId;

  pushActivity(store, quote.lead_id, "QUOTE_STATUS_CHANGED", `Quote ${quote.reference} converted to a booking.`, input.actorName, nowIso);

  return { ok: true };
}

export interface UpdateLeadConsentInput {
  leadId: string;
  consentStatus: ConsentStatus;
  doNotContact: boolean;
  contactableChannels: ConsentChannel[];
  source: string;
  actorName: string;
}

/**
 * Records a lead's consent/do-not-contact decision. Deliberately never
 * called from anywhere but an explicit staff action — a reply, an inbound
 * WhatsApp message, or a conversation existing is never treated as consent.
 * The matching `consent_events` audit row is written separately by the
 * caller (`app/(main)/leads/actions.ts`), since `consent_events` sits
 * outside the diffed `LeadStore` collections.
 */
export function updateLeadConsentInStore(
  store: LeadStore,
  input: UpdateLeadConsentInput,
  nowIso: string,
): MutationOutcome {
  const lead = findLead(store, input.leadId);
  if (!lead) return { ok: false, error: "That lead no longer exists." };

  lead.consent_status = input.consentStatus;
  lead.consent_source = input.source.trim() || null;
  lead.consent_at = nowIso;
  lead.do_not_contact = input.doNotContact;
  lead.contactable_channels = input.contactableChannels;
  lead.updated_at = nowIso;

  pushActivity(
    store,
    lead.id,
    "CONSENT_UPDATED",
    `Consent set to ${input.consentStatus.replace("_", " ").toLowerCase()}${
      input.doNotContact ? " · marked do-not-contact" : ""
    }.`,
    input.actorName,
    nowIso,
  );

  return { ok: true };
}

export interface MarkBookedInput {
  leadId: string;
  bookingId: string;
  bookingReference: string;
  actorName: string;
}

/** Links a Booking created from this lead — the only stage change no one can undo from here. */
export function markLeadBookedInStore(
  store: LeadStore,
  input: MarkBookedInput,
  nowIso: string,
): MutationOutcome {
  const lead = findLead(store, input.leadId);
  if (!lead) return { ok: false, error: "That lead no longer exists." };
  if (lead.booking_id) return { ok: true };

  lead.booking_id = input.bookingId;
  lead.stage = "BOOKED";
  lead.next_follow_up_at = null;
  lead.follow_up_type = null;
  lead.follow_up_owner_id = null;
  lead.follow_up_owner_name = null;
  lead.updated_at = nowIso;

  pushActivity(
    store,
    lead.id,
    "BOOKING_CREATED",
    `Booking ${input.bookingReference} created; ${lead.adults + lead.children} seat(s) held.`,
    input.actorName,
    nowIso,
  );
  return { ok: true };
}

/* ── Duplicate detection ──────────────────────────────────────────────────── */

export interface DuplicateMatch {
  lead: LeadRow;
  matchedOn: "mobile" | "email";
}

/**
 * Finds an existing lead for the same person. Mobile is compared on the
 * normalised subscriber number, so `0771234567` and `+94 77 123 4567` match;
 * email is compared case-insensitively.
 */
export function findDuplicateLead(
  leads: LeadRow[],
  mobile: string,
  email: string,
  excludeId?: string,
): DuplicateMatch | null {
  const cleanMobile = normaliseMobile(mobile);
  const cleanEmail = email.trim().toLowerCase();

  if (cleanMobile.length >= 9) {
    const byMobile = leads.find(
      (lead) => lead.id !== excludeId && lead.mobile === cleanMobile,
    );
    if (byMobile) return { lead: byMobile, matchedOn: "mobile" };
  }

  if (cleanEmail) {
    const byEmail = leads.find(
      (lead) =>
        lead.id !== excludeId &&
        (lead.email ?? "").trim().toLowerCase() === cleanEmail,
    );
    if (byEmail) return { lead: byEmail, matchedOn: "email" };
  }

  return null;
}

export type { LeadNoteRow };
