"use server";

/**
 * Manasik Decision — Server Actions for the Lead Drawer.
 *
 * Every action: authenticates, checks the role's capability, loads context
 * through `CopilotKnowledgeContextService`, runs a pure service, and — only
 * for meaningful human actions — writes an audit line. Offers are always
 * recomputed here from live data; the browser never supplies a price, seat
 * count or group eligibility that gets trusted.
 *
 * None of these create a booking, hold seats, change payment/operational
 * data, or move a lead's stage.
 */

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

import { capabilitiesForLeads, type LeadCapabilities } from "@/lib/access/leads-access";
import { detectCopilotSuggestion } from "@/lib/copilot/sales/alerts";
import { answerWithRules, buildScopedContext, classifyQuestion } from "@/lib/copilot/sales/ask-manasik";
import {
  allowedFigures,
  auditCustomerMessage,
  generateCustomerReply,
  toCustomerSafeOffer,
} from "@/lib/copilot/sales/content-generation";
import { formatShortDate } from "@/lib/copilot/sales/format";
import { proposeIntentChanges, type IntentFieldProposal } from "@/lib/copilot/sales/intent-conflicts";
import { loadCopilotKnowledgeContext, type CopilotKnowledgeContext } from "@/lib/copilot/sales/knowledge-context";
import { getReasoningProvider } from "@/lib/copilot/sales/llm/openrouter-provider";
import { matchOffers } from "@/lib/copilot/sales/offer-matching";
import { calculateQuote, type QuoteCalculation } from "@/lib/copilot/sales/quote-calculator";
import { generateSalesStrategy } from "@/lib/copilot/sales/sales-strategy";
import {
  applyIntentSchema,
  draftReplySchema,
  parseTravelIntent,
  saveQuoteDraftSchema,
  saveReplyDraftSchema,
} from "@/lib/copilot/sales/schemas";
import type {
  CopilotAnswer,
  CopilotSuggestion,
  CopilotSuggestionType,
  CustomerSafeOfferFacts,
  GeneratedReply,
  OccupancyType,
  OfferMatch,
  OfferMatchingResult,
  QuoteDraft,
  ReasoningSource,
  SalesStrategy,
  TravelIntent,
} from "@/lib/copilot/sales/types";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import {
  applyTravelIntentInStore,
  createQuoteDraftInStore,
  dismissSuggestionInStore,
  logCopilotActivityInStore,
  nextQuoteReference,
  saveCommunicationDraftInStore,
  selectOfferInStore,
} from "@/lib/data/leads-copilot";
import { persistLeadStore, snapshotLeadStore, type LeadStore } from "@/lib/data/leads-repository";
import { requireUser } from "@/lib/dal";
import type { LeadActivityType } from "@/lib/types/leads";
import { createClient } from "@/utils/supabase/server";

type Failure = { ok: false; error: string };

async function db() {
  return createClient(await cookies());
}

async function actor(): Promise<{ can: LeadCapabilities; name: string; staffId: string | null }> {
  await requireUser();
  const { role, name, staffId } = await getCurrentStaffRole();
  return { can: capabilitiesForLeads(role), name: name ?? "Staff", staffId };
}

/** Pure mutation against an already-loaded store, then persist the diff. */
async function persist<T extends { ok: boolean }>(store: LeadStore, run: (store: LeadStore) => T): Promise<T> {
  const before = snapshotLeadStore(store);
  const outcome = run(store);
  if (outcome.ok) {
    await persistLeadStore(await db(), before, store);
    revalidatePath("/leads");
  }
  return outcome;
}

async function logActivity(
  context: CopilotKnowledgeContext,
  who: { can: LeadCapabilities; name: string },
  type: LeadActivityType,
  message: string,
): Promise<void> {
  // Read-only roles (CEO) can look, but their look is not a sales action.
  if (!who.can.applyCopilotChanges && !who.can.draftCustomerReply) return;
  await persist(context.store, (store) =>
    logCopilotActivityInStore(store, { leadId: context.lead.id, type, message, actorName: who.name }, new Date().toISOString()),
  );
}

function persistenceError(error: unknown): Failure {
  const message = error instanceof Error ? error.message : "Unknown error";
  if (/lead_copilot|lead_communication|column .* does not exist|schema cache/i.test(message)) {
    return { ok: false, error: "The Sales Intelligence migration has not been applied to this database yet." };
  }
  return { ok: false, error: message };
}

function groupFactsOf(context: CopilotKnowledgeContext): Record<string, CustomerSafeOfferFacts> {
  return Object.fromEntries(context.candidates.map((candidate) => [candidate.facts.groupId, candidate.facts]));
}

function intentOverrideFrom(value: unknown): TravelIntent | null {
  return value === null || value === undefined ? null : parseTravelIntent(value);
}

/* ── 1. Analyse Enquiry ───────────────────────────────────────────────────── */

export type AnalyseEnquiryResult =
  | {
      ok: true;
      intent: TravelIntent;
      source: ReasoningSource;
      note: string | null;
      proposals: IntentFieldProposal[];
    }
  | Failure;

export async function analyseEnquiryAction(input: { leadId: string; text: string }): Promise<AnalyseEnquiryResult> {
  const who = await actor();
  if (!who.can.applyCopilotChanges) return { ok: false, error: "Your role cannot analyse enquiries." };
  const text = input.text.trim();
  if (text.length < 10) return { ok: false, error: "Paste the customer's messages or notes first." };
  if (text.length > 12_000) return { ok: false, error: "That text is too long — paste the relevant part of the conversation." };

  const context = await loadCopilotKnowledgeContext(await db(), input.leadId);
  if (!context) return { ok: false, error: "That lead no longer exists." };

  const outcome = await getReasoningProvider().extractIntent({
    text,
    notes: context.lead.notes.slice(0, 10),
    now: new Date().toISOString(),
  });

  try {
    await logActivity(context, who, "ENQUIRY_ANALYSED", "Analysed enquiry with Manasik.");
  } catch (error) {
    return persistenceError(error);
  }

  return {
    ok: true,
    intent: outcome.intent,
    source: outcome.source,
    note: outcome.note,
    proposals: proposeIntentChanges(outcome.intent, context.lead),
  };
}

/** Recomputes conflicts for an intent staff edited in the dialog. Read-only. */
export async function proposeIntentChangesAction(input: { leadId: string; intent: unknown }): Promise<IntentFieldProposal[]> {
  const who = await actor();
  if (!who.can.useCopilot) return [];
  const intent = parseTravelIntent(input.intent);
  if (!intent) return [];
  const context = await loadCopilotKnowledgeContext(await db(), input.leadId);
  return context ? proposeIntentChanges(intent, context.lead) : [];
}

export async function applyTravelIntentAction(input: unknown): Promise<{ ok: true } | Failure> {
  const who = await actor();
  if (!who.can.applyCopilotChanges) return { ok: false, error: "Your role cannot apply changes to a lead." };
  const parsed = applyIntentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "The extracted details are incomplete — review them and try again." };

  const context = await loadCopilotKnowledgeContext(await db(), parsed.data.leadId);
  if (!context) return { ok: false, error: "That lead no longer exists." };

  try {
    const outcome = await persist(context.store, (store) =>
      applyTravelIntentInStore(
        store,
        {
          leadId: parsed.data.leadId,
          intent: parsed.data.intent,
          source: getReasoningProvider().source,
          fields: parsed.data.fields,
          actorName: who.name,
        },
        new Date().toISOString(),
      ),
    );
    return outcome.ok ? { ok: true } : { ok: false, error: outcome.error ?? "Could not apply." };
  } catch (error) {
    return persistenceError(error);
  }
}

/* ── 2. Build Offer / Compare Options ─────────────────────────────────────── */

export type BuildOffersResult =
  | {
      ok: true;
      result: OfferMatchingResult;
      strategy: SalesStrategy | null;
      hasSavedIntent: boolean;
      usedIntent: boolean;
    }
  | Failure;

export async function buildOffersAction(input: {
  leadId: string;
  mode: "BUILD" | "COMPARE";
  intentOverride?: unknown;
}): Promise<BuildOffersResult> {
  const who = await actor();
  if (!who.can.useCopilot) return { ok: false, error: "Your role cannot view offers." };

  const context = await loadCopilotKnowledgeContext(await db(), input.leadId, intentOverrideFrom(input.intentOverride));
  if (!context) return { ok: false, error: "That lead no longer exists." };

  const now = new Date().toISOString();
  const result = matchOffers({ lead: context.lead, intent: context.intent, candidates: context.candidates, now });
  const strategy = result.offers.length > 0 ? generateSalesStrategy({ lead: context.lead, intent: context.intent, result }) : null;

  try {
    if (input.mode === "COMPARE" && result.offers.length >= 2) {
      const names = [...new Set(result.offers.slice(0, 3).map((offer) => offer.packageName))];
      const label = names.length >= 2 ? names.join(" and ") : result.offers.slice(0, 3).map((offer) => offer.groupName).join(" and ");
      await logActivity(context, who, "OFFERS_COMPARED", `Compared ${label}.`);
    } else if (input.mode === "BUILD") {
      await logActivity(context, who, "OFFERS_BUILT", "Built offer options.");
    }
  } catch (error) {
    return persistenceError(error);
  }

  return { ok: true, result, strategy, hasSavedIntent: context.hasSavedIntent, usedIntent: context.intent !== null };
}

/* ── 3. Use This Offer ────────────────────────────────────────────────────── */

export async function selectOfferAction(input: {
  leadId: string;
  offerId: string;
  applyRoomType: boolean;
  intentOverride?: unknown;
}): Promise<{ ok: true; groupName: string } | Failure> {
  const who = await actor();
  if (!who.can.applyCopilotChanges) return { ok: false, error: "Your role cannot select offers." };

  const context = await loadCopilotKnowledgeContext(await db(), input.leadId, intentOverrideFrom(input.intentOverride));
  if (!context) return { ok: false, error: "That lead no longer exists." };

  const now = new Date().toISOString();
  const result = matchOffers({ lead: context.lead, intent: context.intent, candidates: context.candidates, now });
  const offer = result.offers.find((entry) => entry.id === input.offerId);
  if (!offer) return { ok: false, error: "That offer is no longer available — rebuild the offers." };

  try {
    const outcome = await persist(context.store, (store) =>
      selectOfferInStore(
        store,
        {
          leadId: input.leadId,
          isRecommended: offer.isRecommended,
          applyRoomType: input.applyRoomType,
          actorName: who.name,
          offer: {
            offerId: offer.id,
            packageTemplateId: offer.packageTemplateId,
            departureGroupId: offer.departureGroupId,
            groupName: offer.groupName,
            packageName: offer.packageName,
            departureDate: String(offer.departureDate),
            returnDate: String(offer.returnDate),
            roomType: offer.roomType ?? null,
            pricePerPerson: offer.pricePerPerson,
            totalPrice: offer.totalPrice,
            currency: offer.currency,
          },
        },
        now,
      ),
    );
    return outcome.ok ? { ok: true, groupName: offer.groupName } : { ok: false, error: outcome.error ?? "Could not select." };
  } catch (error) {
    return persistenceError(error);
  }
}

/* ── 4. Draft Customer Reply ──────────────────────────────────────────────── */

export type DraftReplyResult = ({ ok: true } & GeneratedReply) | Failure;

export async function draftCustomerReplyAction(input: unknown): Promise<DraftReplyResult> {
  const who = await actor();
  if (!who.can.draftCustomerReply) return { ok: false, error: "Your role cannot draft customer replies." };
  const parsed = draftReplySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose a purpose, tone and language." };
  const request = parsed.data;

  const context = await loadCopilotKnowledgeContext(await db(), request.leadId, request.intentOverride);
  if (!context) return { ok: false, error: "That lead no longer exists." };

  const now = new Date().toISOString();
  const result = matchOffers({ lead: context.lead, intent: context.intent, candidates: context.candidates, now });
  const chosen = (request.offerId && result.offers.find((entry) => entry.id === request.offerId)) || result.offers[0] || null;
  const alternatives = result.offers.filter((entry) => entry.id !== chosen?.id).slice(0, 2);
  const strategy = result.offers.length > 0 ? generateSalesStrategy({ lead: context.lead, intent: context.intent, result }) : null;

  const template = generateCustomerReply({
    customerFirstName: context.lead.firstName,
    purpose: request.purpose,
    tone: request.tone,
    language: request.language,
    include: request.include,
    offer: chosen ? toCustomerSafeOffer(chosen) : null,
    alternatives: alternatives.map(toCustomerSafeOffer),
    internalQuestions: strategy?.missingInformationToAsk ?? context.intent?.unansweredQuestions ?? [],
  });

  // An LLM may only rephrase. Any new figure, guarantee or discount in its
  // output discards it in favour of the template.
  let reply: GeneratedReply = template;
  const provider = getReasoningProvider();
  if (provider.source === "LLM" && template.warnings.length === 0) {
    const polished = await provider.polishReply({ draft: template.text, tone: request.tone, language: request.language });
    if (polished) {
      const allowed = allowedFigures([chosen, ...alternatives].filter((entry): entry is OfferMatch => entry !== null).map(toCustomerSafeOffer));
      const findings = auditCustomerMessage(polished, allowed);
      if (findings.length === 0) reply = { text: polished, source: "LLM", warnings: [] };
    }
  }

  try {
    await logActivity(
      context,
      who,
      "REPLY_DRAFTED",
      request.tone === "SHORT_WHATSAPP" ? "Generated WhatsApp reply draft." : "Generated customer reply draft.",
    );
  } catch (error) {
    return persistenceError(error);
  }

  return { ok: true, ...reply };
}

export async function saveReplyDraftAction(input: unknown): Promise<{ ok: true } | Failure> {
  const who = await actor();
  if (!who.can.draftCustomerReply) return { ok: false, error: "Your role cannot save customer drafts." };
  const parsed = saveReplyDraftSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "The draft is invalid." };

  const context = await loadCopilotKnowledgeContext(await db(), parsed.data.leadId);
  if (!context) return { ok: false, error: "That lead no longer exists." };

  try {
    const outcome = await persist(context.store, (store) =>
      saveCommunicationDraftInStore(
        store,
        {
          lead_id: parsed.data.leadId,
          purpose: parsed.data.purpose,
          tone: parsed.data.tone,
          language: parsed.data.language,
          body: parsed.data.body,
          offer_id: parsed.data.offerId,
          created_by_name: who.name,
          created_by_user_id: who.staffId,
        },
        new Date().toISOString(),
      ),
    );
    return outcome.ok ? { ok: true } : { ok: false, error: outcome.error ?? "Could not save." };
  } catch (error) {
    return persistenceError(error);
  }
}

/* ── 5. Ask Manasik ───────────────────────────────────────────────────────── */

export async function askManasikAction(input: { leadId: string; question: string }): Promise<({ ok: true } & CopilotAnswer) | Failure> {
  const who = await actor();
  if (!who.can.useCopilot) return { ok: false, error: "Your role cannot use Ask Manasik." };
  const question = input.question.trim();
  if (!question) return { ok: false, error: "Ask a question first." };
  if (question.length > 500) return { ok: false, error: "Keep the question under 500 characters." };

  const context = await loadCopilotKnowledgeContext(await db(), input.leadId);
  if (!context) return { ok: false, error: "That lead no longer exists." };

  const now = new Date().toISOString();
  const result = matchOffers({ lead: context.lead, intent: context.intent, candidates: context.candidates, now });
  const strategy = result.offers.length > 0 ? generateSalesStrategy({ lead: context.lead, intent: context.intent, result }) : null;
  const base = { question, lead: context.lead, intent: context.intent, result, strategy, groupFacts: groupFactsOf(context), now };

  const rules = answerWithRules(base);
  if (classifyQuestion(question) !== "FREEFORM") return { ok: true, ...rules };

  const provider = getReasoningProvider();
  const freeform = await provider.answerFreeform({ question, context: buildScopedContext(base) });
  if (!freeform) return { ok: true, ...rules };
  return {
    ok: true,
    ...rules,
    answer: freeform,
    source: "LLM",
    followUps: [{ action: "USE_IN_REPLY", label: "Use in Reply" }],
  };
}

/* ── 6. Alerts ────────────────────────────────────────────────────────────── */

export async function getCopilotAlertAction(leadId: string): Promise<CopilotSuggestion | null> {
  const who = await actor();
  if (!who.can.useCopilot) return null;

  const context = await loadCopilotKnowledgeContext(await db(), leadId);
  // Only when there is something real to cross-check against.
  if (!context || (!context.lead.selectedDepartureGroupId && !context.hasSavedIntent)) return null;

  const now = new Date().toISOString();
  const result = matchOffers({ lead: context.lead, intent: context.intent, candidates: context.candidates, now });
  return detectCopilotSuggestion({
    lead: context.lead,
    hasIntent: context.hasSavedIntent,
    result,
    selected: context.selectedCandidate,
    dismissedFingerprints: context.dismissedFingerprints,
    now,
  });
}

export async function dismissCopilotAlertAction(input: {
  leadId: string;
  type: CopilotSuggestionType;
  fingerprint: string;
}): Promise<{ ok: true } | Failure> {
  const who = await actor();
  if (!who.can.useCopilot) return { ok: false, error: "Your role cannot dismiss alerts." };

  const context = await loadCopilotKnowledgeContext(await db(), input.leadId);
  if (!context) return { ok: false, error: "That lead no longer exists." };

  try {
    const outcome = await persist(context.store, (store) =>
      dismissSuggestionInStore(
        store,
        { leadId: input.leadId, type: input.type, fingerprint: input.fingerprint.slice(0, 300), actorName: who.name },
        new Date().toISOString(),
      ),
    );
    return outcome.ok ? { ok: true } : { ok: false, error: outcome.error ?? "Could not dismiss." };
  } catch (error) {
    return persistenceError(error);
  }
}

/* ── 7. Quote Builder ─────────────────────────────────────────────────────── */

export interface QuoteBuilderSeed {
  leadId: string;
  departureGroupId: string;
  packageTemplateId: string;
  groupName: string;
  packageName: string;
  departureDate: string;
  returnDate: string;
  currency: string;
  availableSeats: number;
  occupancyPrices: Partial<Record<OccupancyType, number>>;
  childPrice: number | null;
  infantPrice: number | null;
  depositPerPerson: number | null;
  paymentSchedule: CustomerSafeOfferFacts["paymentSchedule"];
  inclusions: string[];
  exclusions: string[];
  defaultOccupancy: OccupancyType;
  adults: number;
  children: number;
  infants: number;
  canDiscountFreely: boolean;
  strategy: SalesStrategy | null;
}

export async function prepareQuoteAction(input: {
  leadId: string;
  offerId: string | null;
}): Promise<({ ok: true; seed: QuoteBuilderSeed }) | Failure> {
  const who = await actor();
  if (!who.can.useCopilot) return { ok: false, error: "Your role cannot prepare quotes." };

  const context = await loadCopilotKnowledgeContext(await db(), input.leadId);
  if (!context) return { ok: false, error: "That lead no longer exists." };

  const now = new Date().toISOString();
  const result = matchOffers({ lead: context.lead, intent: context.intent, candidates: context.candidates, now });
  const selectedId = context.contextRow?.selected_offer?.offerId ?? null;
  const offer =
    result.offers.find((entry) => entry.id === input.offerId) ??
    result.offers.find((entry) => entry.id === selectedId) ??
    result.offers[0];
  if (!offer) {
    return { ok: false, error: result.noMatch?.reason ?? "No viable offer to quote — build offers first." };
  }
  const facts = context.candidates.find((candidate) => candidate.facts.groupId === offer.departureGroupId)?.facts;
  if (!facts) return { ok: false, error: "That departure group is no longer available." };

  return {
    ok: true,
    seed: {
      leadId: input.leadId,
      departureGroupId: facts.groupId,
      packageTemplateId: facts.packageTemplateId,
      groupName: facts.groupName,
      packageName: facts.packageName,
      departureDate: facts.departureDate,
      returnDate: facts.returnDate,
      currency: facts.currency,
      availableSeats: facts.availableSeats,
      occupancyPrices: facts.occupancyPrices,
      childPrice: facts.childPrice,
      infantPrice: facts.infantPrice,
      depositPerPerson: facts.depositPerPerson,
      paymentSchedule: facts.paymentSchedule,
      inclusions: facts.inclusions,
      exclusions: facts.exclusions,
      defaultOccupancy: offer.roomType ?? "QUAD",
      adults: offer.adults,
      children: offer.children,
      infants: offer.infants,
      canDiscountFreely: who.can.applyUnrestrictedDiscount,
      strategy: generateSalesStrategy({ lead: context.lead, intent: context.intent, result }),
    },
  };
}

export type SaveQuoteDraftResult =
  | { ok: true; reference: string; quote: QuoteDraft; calculation: QuoteCalculation }
  | Failure;

export async function saveQuoteDraftAction(input: unknown): Promise<SaveQuoteDraftResult> {
  const who = await actor();
  if (!who.can.createQuoteDraft) return { ok: false, error: "Your role cannot create quotes." };
  const parsed = saveQuoteDraftSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the quote details." };
  const request = parsed.data;

  if (request.discountAmount > 0 && !request.discountReason) {
    return { ok: false, error: "Give a reason for the discount." };
  }

  const context = await loadCopilotKnowledgeContext(await db(), request.leadId);
  if (!context) return { ok: false, error: "That lead no longer exists." };

  // Price is always re-read from the live group — never taken from the browser.
  const candidate = context.candidates.find((entry) => entry.facts.groupId === request.departureGroupId);
  if (!candidate || !candidate.internal.isSellable || !candidate.internal.packagePublished) {
    return { ok: false, error: "That departure group is no longer open for sale." };
  }
  const facts = candidate.facts;
  const travellers = request.adults + request.children + request.infants;
  if (facts.availableSeats < travellers) {
    return { ok: false, error: `Only ${facts.availableSeats} seat(s) remain on ${facts.groupName}.` };
  }
  const unitPrice = facts.occupancyPrices[request.occupancyType];
  if (unitPrice === undefined) {
    return { ok: false, error: `${request.occupancyType.toLowerCase()} sharing is not priced for this group.` };
  }

  const now = new Date().toISOString();
  const calculation = calculateQuote({
    occupancyType: request.occupancyType,
    adults: request.adults,
    children: request.children,
    infants: request.infants,
    adultPricePerPerson: unitPrice,
    childPrice: facts.childPrice,
    infantPrice: facts.infantPrice,
    depositPerPerson: facts.depositPerPerson,
    discountAmount: request.discountAmount,
    schedule: facts.paymentSchedule,
    departureDate: facts.departureDate,
    nowIso: now,
  });

  const status: QuoteDraft["status"] = calculation.discount > 0 && !who.can.applyUnrestrictedDiscount ? "PENDING_APPROVAL" : "DRAFT";
  const expiresAt = new Date(Date.now() + request.expiresInDays * 86_400_000).toISOString();
  // Customer-facing lists may only be narrowed, never extended with free text.
  const inclusions = request.inclusions.filter((line) => facts.inclusions.includes(line));
  const exclusions = request.exclusions.filter((line) => facts.exclusions.includes(line));
  const reference = nextQuoteReference(context.store.quotes, now);

  try {
    const outcome = await persist(context.store, (store) =>
      createQuoteDraftInStore(
        store,
        {
          leadId: request.leadId,
          actorName: who.name,
          quote: {
            reference,
            package_id: facts.packageTemplateId || null,
            departure_group_id: facts.groupId,
            pricing_snapshot: {
              currency: facts.currency,
              roomPricePerPerson: unitPrice,
              depositPerPerson: facts.depositPerPerson ?? 0,
              paymentMilestones: calculation.milestones.map((milestone) => ({
                label: milestone.label,
                amount: milestone.amount,
                dueRule: milestone.dueLabel,
              })),
              packageName: facts.packageName,
              groupLabel: `${facts.groupName} (${facts.groupCode})`,
              groupDates: `${formatShortDate(facts.departureDate)} – ${formatShortDate(facts.returnDate)}`,
            },
            adults: request.adults,
            children: request.children,
            room_preference: request.occupancyType,
            total_lkr: calculation.total,
            deposit_lkr: calculation.deposit,
            valid_until: expiresAt,
            sent_via: null,
            sent_at: null,
            created_by_name: who.name,
            status,
            occupancy_type: request.occupancyType,
            infants: request.infants,
            price_per_person: unitPrice,
            discount_amount: calculation.discount,
            discount_reason: calculation.discount > 0 ? request.discountReason : null,
            payment_milestones: calculation.milestones,
            inclusions,
            exclusions,
            created_by_user_id: who.staffId,
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
      ),
    );
    if (!outcome.ok || !outcome.row) return { ok: false, error: outcome.error ?? "Could not save the quote." };

    const row = outcome.row;
    return {
      ok: true,
      reference,
      calculation,
      quote: {
        id: row.id,
        leadId: row.lead_id,
        packageTemplateId: facts.packageTemplateId,
        departureGroupId: facts.groupId,
        occupancyType: request.occupancyType,
        adults: row.adults,
        children: row.children,
        infants: row.infants,
        pricePerPerson: unitPrice,
        totalAmount: calculation.total,
        depositAmount: calculation.deposit,
        paymentMilestones: calculation.milestones,
        discountAmount: calculation.discount || undefined,
        discountReason: row.discount_reason ?? undefined,
        expiresAt,
        status,
        createdAt: row.created_at,
        createdByUserId: who.staffId ?? "",
      },
    };
  } catch (error) {
    return persistenceError(error);
  }
}
