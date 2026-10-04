/**
 * S4's reads and writes — MI4.1 of docs/inbox/implementation-plan.md (Architecture §6 S4). Loads the facts the eleven pure
 * detectors read (lib/inbox/risk), runs them, and records what they found as SHADOW signals. Every query names the agency
 * (the pipeline runs on the service-role client).
 *
 * Strict on purpose: if ANY fact cannot be read the whole run throws and records nothing. A missing payments read that quietly
 * became "no payments" would raise a false PAYMENT_CLAIM_UNVERIFIED against a customer who did pay.
 */

import "server-only";

import type { Db } from "@/lib/ai/db";
import { classifyRisk, type RiskClassification } from "@/lib/ai/surfaces/inbox/risk-classify";
import { findOpenInterventions, openIntervention, recordSignals, supersedeSignals, type RecordSignalInput } from "@/lib/data/conversation-intelligence-repository";
import { FLAG_SIGNAL } from "@/lib/inbox/risk/classify";
import { listActiveStaffIdsByRole, notifyConversationWaiting } from "@/lib/data/staff-notifications";
import { interventionForSignal } from "@/lib/inbox/risk/interventions";
import type { OpenReview } from "@/lib/inbox/risk/protection-gate";
import { checkStoredOffer } from "@/lib/data/inbox-offer-repository";
import type { ConversationIntelligence, MatchedOfferSnapshot, SignalCode } from "@/lib/inbox/intelligence/contracts";
import { referencesIn } from "@/lib/inbox/risk/detectors/unrecorded-booking-claim";
import { findingsToSignals, runRiskDetectors } from "@/lib/inbox/risk/run";
import type { RiskFacts, RiskMessage } from "@/lib/inbox/risk/types";

const DEFAULT_PASSPORT_MONTHS = 6;

/** Signals about the CURRENT state, not about one message. When the state stops being true, the live signal is superseded. */
export const STATE_SIGNAL_CODES: readonly SignalCode[] = ["STALE_PRICE_QUOTED", "GROUP_FULL_REQUESTED", "PASSPORT_EXPIRY_RISK", "WINDOW_CLOSING_SOON", "CONCURRENT_COMPOSER", "LOW_CONFIDENCE_DRAFT"];

export async function loadApprovedAccounts(db: Db, agencyId: string): Promise<string[]> {
  const { data, error } = await db.from("agency_payment_accounts").select("account_digits").eq("agency_id", agencyId).eq("active", true);
  if (error) throw new Error(`Could not read the approved accounts: ${error.message}`);
  return ((data ?? []) as Array<{ account_digits: string }>).map((row) => row.account_digits);
}

/** What the protection gate needs, read fresh: the reviews still open, and the approved bank accounts. Throws if either cannot be read. */
export async function loadProtectionContext(db: Db, agencyId: string, conversationId: string): Promise<{ openReviews: OpenReview[]; approvedAccountDigits: string[] }> {
  const [open, approvedAccountDigits] = await Promise.all([findOpenInterventions(db, agencyId, conversationId), loadApprovedAccounts(db, agencyId)]);
  return { openReviews: open.map((review) => ({ kind: review.kind, severity: review.severity, headline: review.headline })), approvedAccountDigits };
}

/**
 * Turns signals into "human review required" cards (Architecture §5.3). One open card per kind: a second signal of the same kind
 * finds the first. When a card is NEW, the role that owns it is told once, through the same notification path handoffs use.
 */
export async function openInterventionsForSignals(db: Db, input: { agencyId: string; conversationId: string; codes: readonly SignalCode[] }): Promise<{ opened: number; notified: number }> {
  let opened = 0;
  let notified = 0;
  for (const code of new Set(input.codes)) {
    const spec = interventionForSignal(code);
    if (!spec) continue;
    const { created } = await openIntervention(db, input.agencyId, {
      conversationId: input.conversationId,
      kind: spec.kind,
      severity: spec.severity,
      headline: spec.headline,
      guidance: spec.guidance,
      requiredActionCode: spec.requiredActionCode,
      assignedRole: spec.assignedRole,
    });
    if (!created) continue;
    opened += 1;
    try {
      const recipients = await listActiveStaffIdsByRole(db, input.agencyId, [spec.assignedRole]);
      const result = await notifyConversationWaiting({ agencyId: input.agencyId, conversationId: input.conversationId, kind: "HANDOFF_ESCALATED", recipientIds: recipients, title: `Review needed: ${spec.headline}` }, db);
      notified += result.notified;
    } catch (cause) {
      console.error("Could not notify the owning role of a new review:", cause instanceof Error ? cause.message : cause);
    }
  }
  return { opened, notified };
}

export interface RiskRunInput {
  agencyId: string;
  conversationId: string;
  now: Date;
  /** The recent thread as the pipeline read it, oldest first. */
  messages: ReadonlyArray<{ id: string; actor: "CUSTOMER" | "AI" | "STAFF" | "SYSTEM"; text: string; type: string; createdAt: string; attachmentName?: string | null }>;
  intentConfidence: number | null;
  matchedOffer: MatchedOfferSnapshot | null;
  travelIntent: ConversationIntelligence["travelIntent"];
  approvedAccounts: string[];
  /** INBOX_RISK past SHADOW: findings also open review cards. In SHADOW they are recorded as signals only. */
  openInterventions?: boolean;
  /**
   * MI4.3: run the judgement flags (complaint, fraud, medical, religious ruling, distress). `false` = lexicon only, `true` = the
   * model may also be asked when the lexicon cannot decide (INBOX_RISK_MODEL is on). Absent = not run.
   */
  classifyModel?: boolean;
}

const toRiskMessage = (message: RiskRunInput["messages"][number]): RiskMessage => ({ id: message.id, text: message.text, type: message.type, createdAt: message.createdAt, attachmentName: message.attachmentName ?? null });

export async function loadRiskFacts(db: Db, input: RiskRunInput): Promise<RiskFacts> {
  const { agencyId, conversationId } = input;
  const nowIso = input.now.toISOString();

  const customer = input.messages.filter((message) => message.actor === "CUSTOMER");
  const latestCustomer = customer.at(-1) ?? null;
  const lastCustomerAt = latestCustomer ? Date.parse(latestCustomer.createdAt) : null;
  const outbound = input.messages.filter((message) => message.actor === "STAFF" || message.actor === "AI").map(toRiskMessage);
  const lastOutboundAt = outbound.length > 0 ? Date.parse(outbound[outbound.length - 1].createdAt) : null;
  const awaitingReply = lastCustomerAt !== null && (lastOutboundAt === null || lastCustomerAt > lastOutboundAt);

  const { data: conversation, error: conversationError } = await db
    .from("conversations")
    .select("lead_id, service_window_expires_at, composing_by, composing_at")
    .eq("agency_id", agencyId)
    .eq("id", conversationId)
    .maybeSingle();
  if (conversationError) throw new Error(`Could not read the conversation: ${conversationError.message}`);
  const conv = (conversation ?? {}) as { lead_id?: string | null; service_window_expires_at?: string | null; composing_by?: string | null; composing_at?: string | null };

  let bookingId: string | null = null;
  let selectedGroupId: string | null = null;
  if (conv.lead_id) {
    const { data: lead, error } = await db.from("leads").select("booking_id, selected_departure_group_id").eq("agency_id", agencyId).eq("id", conv.lead_id).maybeSingle();
    if (error) throw new Error(`Could not read the lead: ${error.message}`);
    const row = lead as { booking_id: string | null; selected_departure_group_id: string | null } | null;
    bookingId = row?.booking_id ?? null;
    selectedGroupId = row?.selected_departure_group_id ?? null;
  }

  // Payments and travellers of the conversation's booking.
  let payments: RiskFacts["payments"] = null;
  const passengers: RiskFacts["passengers"] = [];
  let bookingGroupId: string | null = null;
  if (bookingId) {
    const [{ data: booking, error: bookingError }, { data: paymentRows, error: paymentError }, { data: pilgrimRows, error: pilgrimError }] = await Promise.all([
      db.from("departure_group_bookings").select("departure_group_id").eq("agency_id", agencyId).eq("id", bookingId).maybeSingle(),
      db.from("payments").select("amount, status").eq("agency_id", agencyId).eq("booking_id", bookingId),
      db.from("departure_group_pilgrims").select("full_name_snapshot, passport_expiry, date_of_birth").eq("agency_id", agencyId).eq("booking_id", bookingId),
    ]);
    if (bookingError) throw new Error(`Could not read the booking: ${bookingError.message}`);
    if (paymentError) throw new Error(`Could not read payments: ${paymentError.message}`);
    if (pilgrimError) throw new Error(`Could not read travellers: ${pilgrimError.message}`);
    bookingGroupId = (booking as { departure_group_id: string } | null)?.departure_group_id ?? null;

    const rows = (paymentRows ?? []) as Array<{ amount: number | string; status: string }>;
    const completed = rows.filter((row) => row.status === "COMPLETED");
    payments = {
      confirmedTotal: completed.reduce((sum, row) => sum + Number(row.amount), 0),
      confirmedCount: completed.length,
      pendingCount: rows.filter((row) => row.status === "PENDING_VERIFICATION").length,
    };

    for (const pilgrim of (pilgrimRows ?? []) as Array<{ full_name_snapshot: string; passport_expiry: string | null; date_of_birth: string | null }>) {
      passengers.push({ name: pilgrim.full_name_snapshot, passportExpiry: pilgrim.passport_expiry, dateOfBirth: pilgrim.date_of_birth });
    }
  }

  // The departure the customer wants, read live: the lead's chosen group, else the matched offer's.
  const requestedGroupId = selectedGroupId ?? input.matchedOffer?.departureGroupId ?? null;
  let requestedGroup: RiskFacts["requestedGroup"] = null;
  let departureDate: string | null = null;
  const groupIds = [...new Set([requestedGroupId, bookingGroupId].filter((id): id is string => Boolean(id)))];
  if (groupIds.length > 0) {
    const { data, error } = await db.from("departure_groups").select("id, group_name, available_seats, group_status, sales_status, archived, departure_date").eq("agency_id", agencyId).in("id", groupIds);
    if (error) throw new Error(`Could not read departure groups: ${error.message}`);
    const groups = new Map(((data ?? []) as Array<{ id: string; group_name: string; available_seats: number | null; group_status: string; sales_status: string; archived: boolean | null; departure_date: string }>).map((group) => [group.id, group]));
    const wanted = requestedGroupId ? groups.get(requestedGroupId) : undefined;
    if (wanted) {
      const open = !wanted.archived && !["CANCELLED", "COMPLETED", "CLOSED", "DEPARTED"].includes(wanted.group_status) && ["SELLING", "LIMITED_AVAILABILITY"].includes(wanted.sales_status);
      requestedGroup = { name: wanted.group_name, availableSeats: wanted.available_seats ?? 0, sellable: open };
    }
    departureDate = (bookingGroupId ? groups.get(bookingGroupId) : wanted)?.departure_date ?? null;
  }

  const [{ data: settings, error: settingsError }, claimed, offerCheck] = await Promise.all([
    db.from("agency_settings").select("passport_validity_months").eq("agency_id", agencyId).maybeSingle(),
    referencesIn(latestCustomer?.text ?? "").length > 0
      ? db.from("departure_group_bookings").select("booking_reference").eq("agency_id", agencyId).in("booking_reference", referencesIn(latestCustomer?.text ?? ""))
      : Promise.resolve({ data: [] as Array<{ booking_reference: string }>, error: null }),
    input.matchedOffer ? checkStoredOffer(db, agencyId, input.matchedOffer, nowIso) : Promise.resolve(null),
  ]);
  if (settingsError) throw new Error(`Could not read the passport rule: ${settingsError.message}`);
  if (claimed.error) throw new Error(`Could not look up booking references: ${claimed.error.message}`);
  const known = new Set(((claimed.data ?? []) as Array<{ booking_reference: string }>).map((row) => row.booking_reference.toUpperCase()));

  const travellers = input.travelIntent?.travellers;
  return {
    now: nowIso,
    latest: latestCustomer ? toRiskMessage(latestCustomer) : null,
    awaitingReply,
    outbound,
    intentConfidence: input.intentConfidence,
    matchedOffer: input.matchedOffer,
    offerCheck,
    partySize: travellers && travellers.adults > 0 ? travellers.adults + travellers.children + travellers.infants : null,
    accessibilityNeeds: input.travelIntent?.travelPreferences.accessibilityNeeds ?? [],
    requestedGroup,
    payments,
    approvedAccounts: input.approvedAccounts,
    passengers,
    departureDate,
    passportValidityMonths: (settings as { passport_validity_months: number | null } | null)?.passport_validity_months ?? DEFAULT_PASSPORT_MONTHS,
    serviceWindowExpiresAt: conv.service_window_expires_at ?? null,
    composing: conv.composing_by && conv.composing_at ? { staffId: conv.composing_by, at: conv.composing_at } : null,
    claimedReferences: referencesIn(latestCustomer?.text ?? "").map((reference) => ({ reference, exists: known.has(reference) })),
  };
}

export interface RiskRunOutcome {
  /** MI4.3: how the judgement flags were settled, when they were run. */
  classification?: Pick<RiskClassification, "source" | "note" | "modelCalls">;
  fired: SignalCode[];
  recorded: number;
  superseded: number;
  failedDetectors: Array<{ code: string; message: string }>;
}

/** Loads the facts, runs the eleven detectors, records SHADOW signals, and retires state signals that are no longer true. */
export async function runRiskForConversation(db: Db, input: RiskRunInput): Promise<RiskRunOutcome> {
  const facts = await loadRiskFacts(db, input);
  const { findings, failed } = runRiskDetectors(facts);

  // The judgement flags: lexicon first, the model only when the lexicon cannot decide. It never throws and never reports a
  // silent "no risk" after a failure (it falls back to weak cues).
  let classification: RiskRunOutcome["classification"];
  const modelSignals: RecordSignalInput[] = [];
  const latest = facts.latest;
  if (input.classifyModel !== undefined && latest && latest.text.trim().length > 0) {
    const customerLines = input.messages.filter((message) => message.actor === "CUSTOMER" && message.id !== latest.id).map((message) => message.text);
    const result = await classifyRisk({ agencyId: input.agencyId, conversationId: input.conversationId, text: latest.text, earlier: customerLines, allowModel: input.classifyModel, db });
    classification = { source: result.source, note: result.note, modelCalls: result.modelCalls };
    // A message nobody could read is reported, never called routine: the person sees "could not check this message".
    if (result.unread) {
      modelSignals.push({ signalCode: "LOW_CONFIDENCE_DRAFT", messageId: latest.id, detector: "RULE", confidence: 0.5, evidence: [{ messageId: latest.id, snippet: "Could not check this message for risk. Please read it yourself." }] });
    }
    for (const reading of result.readings) {
      modelSignals.push({
        signalCode: FLAG_SIGNAL[reading.flag],
        messageId: latest.id,
        detector: reading.source === "MODEL" ? "MODEL" : "RULE",
        confidence: reading.confidence,
        evidence: [{ messageId: latest.id, snippet: reading.snippet }],
      });
    }
  }

  const recorded = await recordSignals(db, input.agencyId, input.conversationId, [...findingsToSignals(findings), ...modelSignals]);
  const stillTrue = new Set(findings.map((finding) => finding.code));
  const ended = STATE_SIGNAL_CODES.filter((code) => !stillTrue.has(code) && !failed.some((entry) => entry.code === code));
  const superseded = ended.length > 0 ? await supersedeSignals(db, input.agencyId, input.conversationId, { codes: [...ended] }) : 0;
  const fired = [...findings.map((finding) => finding.code), ...modelSignals.map((signal) => signal.signalCode)];
  if (input.openInterventions) await openInterventionsForSignals(db, { agencyId: input.agencyId, conversationId: input.conversationId, codes: fired });
  return { classification, fired, recorded, superseded, failedDetectors: failed };
}
