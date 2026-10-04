"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

import { capabilitiesForLeads } from "@/lib/access/leads-access";
import { createGroupBooking, getCurrentStaffRole } from "@/lib/data/departure-groups";
import {
  addLeadNoteInStore,
  assignLeadInStore,
  changeLeadStageInStore,
  completeFollowUpInStore,
  createLeadInStore,
  findDuplicateLead,
  logContactInStore,
  markLeadBookedInStore,
  recordQuoteInStore,
  selectDepartureGroupInStore,
  setFollowUpInStore,
  toLeadListItem,
  updateLeadConsentInStore,
  updateQuoteStatusInStore,
  type CreateLeadInput,
  type LeadListItem,
  type LogContactInput,
  type MutationOutcome,
} from "@/lib/data/leads";
import type { QuoteStatus } from "@/lib/copilot/sales/types";
import type { ConsentChannel, ConsentStatus } from "@/lib/types/consent";
import {
  loadAssignableStaff,
  loadLeadStore,
  persistLeadStore,
  snapshotLeadStore,
  type LeadStore,
} from "@/lib/data/leads-repository";
import { requireUser } from "@/lib/dal";
import type { LeadQuotePricingSnapshot, LeadRoomPreference } from "@/lib/types/leads";
import {
  createLeadSchema,
  toLeadFieldErrors,
  type CreateLeadFormInput,
} from "@/lib/validations/leads";
import { createClient } from "@/utils/supabase/server";
import type { FollowUpType, LeadLostReason, LeadStage } from "@/lib/types/leads";

async function db() {
  return createClient(await cookies());
}

/**
 * Runs one mutation against the database. Loads the whole store (leads is a
 * small module — nothing like the multi-table Departure Groups graph — so
 * there is no benefit to a scoped load), hands it to the pure mutator, then
 * writes back only what changed.
 */
async function mutate<T extends { ok: boolean }>(
  run: (store: LeadStore, actorName: string) => T,
): Promise<T> {
  const supabase = await db();
  const { name } = await getCurrentStaffRole();
  const actorName = name ?? "Staff";

  const store = await loadLeadStore(supabase);
  const before = snapshotLeadStore(store);

  const outcome = run(store, actorName);
  if (!outcome.ok) return outcome;

  await persistLeadStore(supabase, before, store);
  return outcome;
}

function revalidateLeads() {
  revalidatePath("/leads");
  revalidatePath("/quotes");
}

/* ── Create ───────────────────────────────────────────────────────────────── */

export interface CreateLeadActionResult extends MutationOutcome {
  reference?: string;
  fieldErrors?: Partial<Record<keyof CreateLeadFormInput, string>>;
}

export async function createLeadAction(
  input: unknown,
): Promise<CreateLeadActionResult> {
  await requireUser();
  const { role, name } = await getCurrentStaffRole();
  const can = capabilitiesForLeads(role);
  if (!can.createLead) {
    return { ok: false, error: "Your role cannot create leads." };
  }

  const parsed = createLeadSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Check the highlighted fields and try again.",
      fieldErrors: toLeadFieldErrors(parsed.error),
    };
  }
  const data = parsed.data;

  const supabase = await db();
  const store = await loadLeadStore(supabase);
  const before = snapshotLeadStore(store);

  const staffOptions = await loadAssignableStaff(supabase);
  const staff = staffOptions.find((s) => s.id === data.assignedToId);
  const followUpStaff = data.followUpOwnerId
    ? staffOptions.find((s) => s.id === data.followUpOwnerId)
    : staff;

  const createInput: CreateLeadInput = {
    fullName: data.fullName,
    mobile: data.mobile,
    email: data.email,
    city: data.city,
    preferredLanguage: data.preferredLanguage,
    preferredChannel: data.preferredChannel,
    journeyType: data.journeyType,
    interestedIn: data.interestedIn,
    packageId: data.packageId,
    preferredPeriod: data.preferredPeriod,
    adults: data.adults,
    children: data.children,
    roomPreference: data.roomPreference,
    departureCity: data.departureCity,
    budgetRange: data.budgetRange,
    quotaWaitlistInterest: data.quotaWaitlistInterest,
    source: data.source,
    campaignReference: data.campaignReference,
    referralName: data.referralName,
    assignedToId: data.assignedToId,
    assignedToName: staff?.name ?? name ?? "Unassigned",
    stage: data.stage,
    temperature: data.temperature,
    nextFollowUpAt: data.nextFollowUpAt,
    followUpType: data.followUpType,
    followUpOwnerId: data.followUpOwnerId || data.assignedToId,
    followUpOwnerName: followUpStaff?.name ?? staff?.name ?? name ?? "Unassigned",
    notes: data.notes,
    duplicateOverrideReason: data.createAnyway ? data.duplicateReason : undefined,
  };

  const now = new Date().toISOString();
  const outcome = createLeadInStore(store, createInput, now);
  if (!outcome.ok) return outcome;

  await persistLeadStore(supabase, before, store);
  revalidateLeads();
  return { ok: true, reference: outcome.lead?.reference };
}

/** Bulk create for the CSV import dialog. Best-effort — one bad row does not stop the rest. */
export async function importLeadsAction(
  rows: CreateLeadInput[],
): Promise<{ ok: true; created: number; failures: string[] }> {
  await requireUser();
  const { role } = await getCurrentStaffRole();
  if (!capabilitiesForLeads(role).createLead) {
    return { ok: true, created: 0, failures: ["Your role cannot import leads."] };
  }

  const supabase = await db();
  const store = await loadLeadStore(supabase);
  const before = snapshotLeadStore(store);

  let created = 0;
  const failures: string[] = [];
  const now = new Date().toISOString();

  for (const row of rows) {
    const outcome = createLeadInStore(store, row, now);
    if (outcome.ok) created += 1;
    else failures.push(`${row.fullName}: ${outcome.error}`);
  }

  if (created > 0) {
    await persistLeadStore(supabase, before, store);
    revalidateLeads();
  }
  return { ok: true, created, failures };
}

/* ── Duplicate check ──────────────────────────────────────────────────────── */

export async function findDuplicateLeadAction(
  mobile: string,
  email: string,
): Promise<{ lead: LeadListItem; matchedOn: "mobile" | "email" } | null> {
  await requireUser();
  const supabase = await db();
  const store = await loadLeadStore(supabase);
  const match = findDuplicateLead(store.leads, mobile, email);
  if (!match) return null;
  return { lead: toLeadListItem(match.lead, store, new Date().toISOString()), matchedOn: match.matchedOn };
}

/* ── Stage / assignment ───────────────────────────────────────────────────── */

export interface BulkOutcome extends MutationOutcome {
  changed: number;
}

export async function changeStageAction(input: {
  leadIds: string[];
  stage: LeadStage;
  lostReason?: LeadLostReason;
  lostNote?: string;
  postponedUntil?: string | null;
}): Promise<BulkOutcome> {
  await requireUser();
  const { role } = await getCurrentStaffRole();
  if (!capabilitiesForLeads(role).changeStage) {
    return { ok: false, error: "Your role cannot change a lead's stage.", changed: 0 };
  }

  return mutate((store, actorName) => {
    let changed = 0;
    let error: string | undefined;
    for (const leadId of input.leadIds) {
      const outcome = changeLeadStageInStore(
        store,
        {
          leadId,
          stage: input.stage,
          actorName,
          lostReason: input.lostReason,
          lostNote: input.lostNote,
          postponedUntil: input.postponedUntil,
        },
        new Date().toISOString(),
      );
      if (outcome.ok) changed += 1;
      else error ??= outcome.error;
    }
    if (changed > 0) revalidateLeads();
    return { ok: changed > 0, error: changed > 0 ? undefined : error, changed };
  });
}

export async function assignLeadsAction(input: {
  leadIds: string[];
  staffId: string;
}): Promise<BulkOutcome> {
  await requireUser();
  const { role } = await getCurrentStaffRole();
  if (!capabilitiesForLeads(role).assignLeads) {
    return { ok: false, error: "Your role cannot reassign leads.", changed: 0 };
  }

  const staffOptions = await loadAssignableStaff(await db());
  const staff = staffOptions.find((s) => s.id === input.staffId);
  if (!staff) return { ok: false, error: "Unknown staff member.", changed: 0 };

  return mutate((store, actorName) => {
    let changed = 0;
    let error: string | undefined;
    for (const leadId of input.leadIds) {
      const outcome = assignLeadInStore(
        store,
        { leadId, staffId: staff.id, staffName: staff.name, actorName },
        new Date().toISOString(),
      );
      if (outcome.ok) changed += 1;
      else error ??= outcome.error;
    }
    if (changed > 0) revalidateLeads();
    return { ok: changed > 0, error: changed > 0 ? undefined : error, changed };
  });
}

/* ── Contact / follow-up / notes ─────────────────────────────────────────── */

export async function logContactAction(
  input: Omit<LogContactInput, "actorName">,
): Promise<MutationOutcome> {
  await requireUser();
  const { role } = await getCurrentStaffRole();
  if (!capabilitiesForLeads(role).logContact) {
    return { ok: false, error: "Your role cannot log contact." };
  }

  return mutate((store, actorName) => {
    const outcome = logContactInStore(store, { ...input, actorName }, new Date().toISOString());
    if (outcome.ok) revalidateLeads();
    return outcome;
  });
}

export async function setFollowUpAction(input: {
  leadId: string;
  nextFollowUpAt: string;
  followUpType: FollowUpType;
  followUpOwnerId: string;
}): Promise<MutationOutcome> {
  await requireUser();
  const { role } = await getCurrentStaffRole();
  if (!capabilitiesForLeads(role).logContact) {
    return { ok: false, error: "Your role cannot schedule follow-ups." };
  }

  const staffOptions = await loadAssignableStaff(await db());
  const owner = staffOptions.find((s) => s.id === input.followUpOwnerId);

  return mutate((store, actorName) => {
    const outcome = setFollowUpInStore(
      store,
      { ...input, followUpOwnerName: owner?.name ?? actorName, actorName },
      new Date().toISOString(),
    );
    if (outcome.ok) revalidateLeads();
    return outcome;
  });
}

export async function completeFollowUpAction(leadId: string): Promise<MutationOutcome> {
  await requireUser();
  const { role } = await getCurrentStaffRole();
  if (!capabilitiesForLeads(role).logContact) {
    return { ok: false, error: "Your role cannot complete follow-ups." };
  }

  return mutate((store, actorName) => {
    const outcome = completeFollowUpInStore(store, { leadId, actorName }, new Date().toISOString());
    if (outcome.ok) revalidateLeads();
    return outcome;
  });
}

export async function addNoteAction(input: { leadId: string; note: string }): Promise<MutationOutcome> {
  await requireUser();
  const { role } = await getCurrentStaffRole();
  if (!capabilitiesForLeads(role).addNote) {
    return { ok: false, error: "Your role cannot add notes." };
  }

  return mutate((store, actorName) => {
    const outcome = addLeadNoteInStore(store, { ...input, actorName }, new Date().toISOString());
    if (outcome.ok) revalidateLeads();
    return outcome;
  });
}

/* ── Group selection ──────────────────────────────────────────────────────── */

export async function selectDepartureGroupAction(input: {
  leadId: string;
  departureGroupId: string;
  groupLabel: string;
}): Promise<MutationOutcome> {
  await requireUser();
  const { role } = await getCurrentStaffRole();
  if (!capabilitiesForLeads(role).findGroups) {
    return { ok: false, error: "Your role cannot select departure groups." };
  }

  return mutate((store, actorName) => {
    const outcome = selectDepartureGroupInStore(store, { ...input, actorName }, new Date().toISOString());
    if (outcome.ok) revalidateLeads();
    return outcome;
  });
}

/* ── Departure group recommendation (Phase 4) ────────────────────────────── */

export interface AvailableGroupOption {
  id: string;
  groupName: string;
  groupCode: string;
  departureDate: string;
  returnDate: string;
  availableSeats: number;
  salesStatus: string;
  currency: string;
  quadPrice: number | null;
  triplePrice: number | null;
  doublePrice: number | null;
  singlePrice: number | null;
  advanceDeposit: number | null;
}

/**
 * Only sellable groups: `SELLING`/`LIMITED_AVAILABILITY`, enough seats left,
 * not cancelled/completed/closed, matching the lead's journey type. Never
 * touches capacity — this is a read, not a hold.
 */
export async function findAvailableGroupsAction(input: {
  journeyType: string;
  packageId: string | null;
  requiredSeats: number;
}): Promise<AvailableGroupOption[]> {
  await requireUser();
  const { role } = await getCurrentStaffRole();
  if (!capabilitiesForLeads(role).findGroups) return [];

  const supabase = await db();
  // Prices come from `departure_group_pricing` — the group's CURRENT,
  // editable price — never from `departure_group_package_snapshots
  // .pricing_snapshot`, which is a placeholder frozen at creation time and
  // never updated after (`emptyPricingSnapshot()` in
  // lib/data/departure-groups-copy.ts always seeds it null; the group's
  // real price has lived in `departure_group_pricing` since
  // `20260908090000_departure_group_pricing.sql`). Reading the snapshot
  // here meant every quoted price in this picker was null regardless of
  // what the group actually sells at. See
  // docs/modules/packages-production-readiness-plan.md, finding D1.
  let query = supabase
    .from("departure_groups")
    .select(
      "id, group_name, group_code, journey_type, departure_date, return_date, available_seats, sales_status, group_status, archived, package_template_id, departure_group_pricing(currency, quad_price, triple_price, double_price, single_price, advance_deposit)",
    )
    .in("sales_status", ["SELLING", "LIMITED_AVAILABILITY"])
    .not("group_status", "in", "(CANCELLED,COMPLETED,CLOSED)")
    .eq("archived", false)
    .eq("journey_type", input.journeyType)
    .gte("available_seats", input.requiredSeats)
    .order("departure_date", { ascending: true });

  if (input.packageId) query = query.eq("package_template_id", input.packageId);

  const { data, error } = await query;
  if (error) return [];

  return (data ?? []).map((row: Record<string, unknown>) => {
    const pricing = (
      Array.isArray(row.departure_group_pricing)
        ? row.departure_group_pricing[0]
        : row.departure_group_pricing
    ) as Record<string, unknown> | null ?? {};

    return {
      id: String(row.id),
      groupName: String(row.group_name),
      groupCode: String(row.group_code),
      departureDate: String(row.departure_date),
      returnDate: String(row.return_date),
      availableSeats: Number(row.available_seats),
      salesStatus: String(row.sales_status),
      currency: String(pricing.currency ?? "LKR"),
      quadPrice: pricing.quad_price === undefined || pricing.quad_price === null ? null : Number(pricing.quad_price),
      triplePrice: pricing.triple_price === undefined || pricing.triple_price === null ? null : Number(pricing.triple_price),
      doublePrice: pricing.double_price === undefined || pricing.double_price === null ? null : Number(pricing.double_price),
      singlePrice: pricing.single_price === undefined || pricing.single_price === null ? null : Number(pricing.single_price),
      advanceDeposit: pricing.advance_deposit === undefined || pricing.advance_deposit === null ? null : Number(pricing.advance_deposit),
    };
  });
}

/* ── Quotes (Phase 5) ─────────────────────────────────────────────────────── */

function nextQuoteReference(quotes: { reference: string }[], nowIso: string): string {
  const year = nowIso.slice(0, 4);
  const prefix = `QT-${year}-`;
  const highest = quotes.reduce((max, quote) => {
    if (!quote.reference.startsWith(prefix)) return max;
    const parsed = Number.parseInt(quote.reference.slice(prefix.length), 10);
    return Number.isFinite(parsed) ? Math.max(max, parsed) : max;
  }, 0);
  return `${prefix}${String(highest + 1).padStart(4, "0")}`;
}

export interface SendQuoteInput {
  leadId: string;
  packageId: string | null;
  departureGroupId: string | null;
  roomPreference: LeadRoomPreference;
  adults: number;
  children: number;
  roomPricePerPerson: number;
  depositPerPerson: number;
  currency: string;
  packageName: string;
  groupLabel: string | null;
  groupDates: string | null;
  sentVia: "WHATSAPP" | "EMAIL" | "PDF" | null;
}

export interface SendQuoteResult extends MutationOutcome {
  reference?: string;
  totalLkr?: number;
  depositLkr?: number;
  validUntil?: string;
}

export async function sendQuoteAction(input: SendQuoteInput): Promise<SendQuoteResult> {
  await requireUser();
  const { role } = await getCurrentStaffRole();
  if (!capabilitiesForLeads(role).sendQuote) {
    return { ok: false, error: "Your role cannot send quotes." };
  }

  const travellers = input.adults + input.children;
  const totalLkr = input.roomPricePerPerson * travellers;
  const depositLkr = input.depositPerPerson * travellers;
  const now = new Date().toISOString();
  const validUntil = new Date(Date.now() + 7 * 86_400_000).toISOString();

  const pricingSnapshot: LeadQuotePricingSnapshot = {
    currency: input.currency,
    roomPricePerPerson: input.roomPricePerPerson,
    depositPerPerson: input.depositPerPerson,
    paymentMilestones: [],
    packageName: input.packageName,
    groupLabel: input.groupLabel,
    groupDates: input.groupDates,
  };

  let reference = "";
  const result = await mutate((store, actorName) => {
    reference = nextQuoteReference(store.quotes, now);
    const outcome = recordQuoteInStore(
      store,
      {
        leadId: input.leadId,
        actorName,
        quote: {
          reference,
          package_id: input.packageId,
          departure_group_id: input.departureGroupId,
          pricing_snapshot: pricingSnapshot,
          adults: input.adults,
          children: input.children,
          room_preference: input.roomPreference,
          total_lkr: totalLkr,
          deposit_lkr: depositLkr,
          valid_until: validUntil,
          sent_via: input.sentVia,
          sent_at: input.sentVia ? now : null,
          created_by_name: actorName,
          status: "SENT",
          occupancy_type: input.roomPreference === "UNDECIDED" ? null : input.roomPreference,
          infants: 0,
          price_per_person: input.roomPricePerPerson,
          discount_amount: 0,
          discount_reason: null,
          payment_milestones: [],
          inclusions: [],
          exclusions: [],
          created_by_user_id: null,
          supersedes_quote_id: null,
          viewed_at: null,
          cancelled_at: null,
          rejection_reason: null,
          owner_id: null,
          discount_approved_by: null,
          discount_approved_at: null,
          booking_id: null,
          portal_token_hash: null,
        },
      },
      now,
    );
    if (outcome.ok) revalidateLeads();
    return outcome;
  });

  if (!result.ok) return result;
  return { ok: true, reference, totalLkr, depositLkr, validUntil };
}

/**
 * Records the customer's decision on a sent quote (accept/decline) or an
 * explicit expiry/cancellation. Gated by the same capability as sending one
 * — accepting here only marks the offer's state; converting it into a
 * booking is still a separate, deliberate action
 * (`convertLeadToBookingAction`).
 */
export async function updateQuoteStatusAction(input: {
  quoteId: string;
  status: QuoteStatus;
}): Promise<MutationOutcome> {
  await requireUser();
  const { role } = await getCurrentStaffRole();
  if (!capabilitiesForLeads(role).sendQuote) {
    return { ok: false, error: "Your role cannot change a quote's status." };
  }

  const result = await mutate((store, actorName) =>
    updateQuoteStatusInStore(store, { quoteId: input.quoteId, status: input.status, actorName }, new Date().toISOString()),
  );
  if (result.ok) revalidateLeads();
  return result;
}

/* ── Consent ──────────────────────────────────────────────────────────────── */

/**
 * Records an explicit consent/do-not-contact decision on a lead. Gated by
 * `editLead` — the same capability that already lets a role change any
 * other lead field. Writes the `consent_events` audit row directly (it
 * lives outside the diffed lead store) after the store mutation succeeds.
 */
export async function updateLeadConsentAction(input: {
  leadId: string;
  consentStatus: ConsentStatus;
  doNotContact: boolean;
  contactableChannels: ConsentChannel[];
  source: string;
  note?: string;
}): Promise<MutationOutcome> {
  await requireUser();
  const { role, name } = await getCurrentStaffRole();
  if (!capabilitiesForLeads(role).editLead) {
    return { ok: false, error: "Your role cannot record consent decisions." };
  }
  if (!input.source.trim()) {
    return { ok: false, error: "Say where this decision came from (e.g. WhatsApp reply, verbal at walk-in)." };
  }

  const actorName = name ?? "Staff";
  const result = await mutate((store) =>
    updateLeadConsentInStore(
      store,
      {
        leadId: input.leadId,
        consentStatus: input.consentStatus,
        doNotContact: input.doNotContact,
        contactableChannels: input.contactableChannels,
        source: input.source,
        actorName,
      },
      new Date().toISOString(),
    ),
  );
  if (!result.ok) return result;

  const supabase = await db();
  const { error } = await supabase.from("consent_events").insert({
    subject_type: "LEAD",
    subject_id: input.leadId,
    action: input.doNotContact ? "DNC_SET" : input.consentStatus === "OPTED_IN" ? "OPT_IN" : "OPT_OUT",
    channel: null,
    source: input.source.trim(),
    note: input.note?.trim() || null,
    actor_name: actorName,
  });
  // The lead's own fields are already saved — a consent_events insert
  // failure (e.g. the migration not yet applied) must not be reported as
  // the whole action failing, since that would tell the caller to retry a
  // mutation that already succeeded and would only duplicate it.
  if (error) console.error("consent_events insert failed:", error.message);

  revalidateLeads();
  return result;
}

/* ── Convert to booking (Phase 6) ────────────────────────────────────────── */

export interface ConvertToBookingInput {
  leadId: string;
  departureGroupId: string;
  primaryContactName: string;
  primaryContactPhone: string;
  adults: number;
  children: number;
  roomOccupancyPreference: "QUAD" | "TRIPLE" | "DOUBLE" | "SINGLE" | "OTHER";
  packagePricePerPerson: number;
  depositAmount: number;
}

export interface ConvertToBookingResult extends MutationOutcome {
  bookingReference?: string;
}

/**
 * Runs the spec's ten conversion steps. Seat holding, pilgrim placeholders and
 * document/payment-milestone copying are already implemented and tested in
 * `createGroupBooking` (`lib/data/departure-groups.ts`) — this delegates to it
 * rather than re-deriving that logic, then links the result back onto the lead.
 */
export async function convertLeadToBookingAction(
  input: ConvertToBookingInput,
): Promise<ConvertToBookingResult> {
  await requireUser();
  const { role } = await getCurrentStaffRole();
  if (!capabilitiesForLeads(role).convertToBooking) {
    return { ok: false, error: "Your role cannot convert leads to bookings." };
  }

  const supabase = await db();
  const leadStore = await loadLeadStore(supabase);
  const lead = leadStore.leads.find((entry) => entry.id === input.leadId);
  if (!lead) return { ok: false, error: "That lead no longer exists." };
  if (lead.booking_id) return { ok: false, error: "This lead is already linked to a booking." };

  const travellerCount = input.adults + input.children;
  const bookingReference = `LD-${lead.reference.replace(/^LD-/, "")}`;

  const bookingOutcome = await createGroupBooking({
    departureGroupId: input.departureGroupId,
    leadId: input.leadId,
    bookingReference,
    bookingStatus: "DEPOSIT_PENDING",
    primaryContactName: input.primaryContactName,
    primaryContactPhone: input.primaryContactPhone,
    travellerCount,
    roomOccupancyPreference: input.roomOccupancyPreference,
    packagePricePerPerson: input.packagePricePerPerson,
    amountPaid: 0,
  });

  if (!bookingOutcome.ok) return bookingOutcome;

  const before = snapshotLeadStore(leadStore);
  const markOutcome = markLeadBookedInStore(
    leadStore,
    {
      leadId: input.leadId,
      bookingId: bookingOutcome.result.bookingId,
      bookingReference: bookingOutcome.result.bookingReference,
      actorName: (await getCurrentStaffRole()).name ?? "Staff",
    },
    new Date().toISOString(),
  );
  if (markOutcome.ok) {
    await persistLeadStore(supabase, before, leadStore);
    revalidateLeads();
    revalidatePath("/departure-groups");
  }

  return { ok: true, bookingReference: bookingOutcome.result.bookingReference };
}

/* ── Lead sources (Manage Lead Sources) ──────────────────────────────────── */

export async function upsertLeadSourceAction(input: {
  id?: string;
  code: string;
  label: string;
  active: boolean;
}): Promise<MutationOutcome> {
  await requireUser();
  const { role } = await getCurrentStaffRole();
  if (!capabilitiesForLeads(role).manageSourcesAndAutomation) {
    return { ok: false, error: "Your role cannot manage lead sources." };
  }
  if (!input.label.trim()) return { ok: false, error: "A source needs a label." };

  const supabase = await db();
  const { error } = await supabase.from("lead_sources").upsert(
    {
      id: input.id,
      code: input.code.trim().toUpperCase().replace(/\s+/g, "_"),
      label: input.label.trim(),
      active: input.active,
    },
    { onConflict: "code" },
  );

  if (error) return { ok: false, error: error.message };
  revalidateLeads();
  return { ok: true };
}
