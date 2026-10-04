/**
 * The closed set of proposal kinds — every kind that exists, and nothing
 * else. There is no free-form "call this function" proposal: a kind not
 * in this map cannot be created, approved, or executed.
 *
 * Phase 0 (P0.2) generalises this from departure-groups-only to any
 * module: the 21 pre-existing kinds are wrapped via `groupExecutor()`
 * (unchanged behaviour, proven by the departure-ops evals) and registered
 * alongside whatever native v2 executors later phases add for other
 * modules. A load-time assertion checks every executor's
 * `requiredCapability` actually exists on its `module`'s capability list —
 * a typo here is a startup failure, not a silent "this proposal can never
 * be approved" discovered later.
 */

import "server-only";

import {
  accommodationMarkConfirmedExecutor,
  accommodationSetReferenceExecutor,
  accommodationSetVoucherExecutor,
  accommodationUpdateExecutor,
} from "@/lib/agent/kernel/proposals/kinds/accommodation";
import {
  deviationDecideExecutor,
  deviationMarkArrangedExecutor,
} from "@/lib/agent/kernel/proposals/kinds/deviations";
import {
  bookingDocumentChaseExecutor,
  bookingInconsistencyReviewExecutor,
  bookingSendReminderExecutor,
} from "@/lib/agent/kernel/proposals/kinds/bookings";
import { conversationComplaintCaseExecutor } from "@/lib/agent/kernel/proposals/kinds/conversation-complaint";
import { conversationPilgrimProfileExecutor, conversationTravellerRelationshipExecutor } from "@/lib/agent/kernel/proposals/kinds/conversation-profile";
import { conversationFeedbackRequestExecutor, conversationPackageRecommendationExecutor } from "@/lib/agent/kernel/proposals/kinds/conversation-recommendation";
import { conversationSeatHoldExecutor } from "@/lib/agent/kernel/proposals/kinds/conversation-seat-hold";
import {
  conversationDocumentRequestExecutor,
  conversationGuideEscalationExecutor,
  conversationPaymentFollowUpExecutor,
  conversationRoomingRequestExecutor,
  conversationTransportRequirementExecutor,
  conversationVisaTaskExecutor,
} from "@/lib/agent/kernel/proposals/kinds/conversation-tasks";
import { documentReworkRequestExecutor } from "@/lib/agent/kernel/proposals/kinds/documents";
import { invoiceSendReminderExecutor } from "@/lib/agent/kernel/proposals/kinds/invoices";
import {
  paymentPlanFlagForReviewExecutor,
  paymentPlanRescheduleDraftExecutor,
  paymentReminderSendExecutor,
} from "@/lib/agent/kernel/proposals/kinds/payments";
import {
  quoteExtendValidityExecutor,
  quoteRevisionDraftedExecutor,
  quoteSendFollowUpExecutor,
} from "@/lib/agent/kernel/proposals/kinds/quotes";
import {
  flightMarkTicketsIssuedExecutor,
  flightRecordTicketingExecutor,
  flightUpsertExecutor,
} from "@/lib/agent/kernel/proposals/kinds/flights";
import {
  groupCloseSalesExecutor,
  groupMarkReadyExecutor,
  groupUpdateDetailsExecutor,
  groupUpdatePricingExecutor,
} from "@/lib/agent/kernel/proposals/kinds/group";
import {
  roomsAutoAssignExecutor,
  roomsGenerateExecutor,
  roomSwapSuggestedExecutor,
} from "@/lib/agent/kernel/proposals/kinds/rooms";
import {
  transportMarkConfirmedExecutor,
  transportSetReferenceExecutor,
} from "@/lib/agent/kernel/proposals/kinds/transport";
import { groupExecutors } from "@/lib/agent/kernel/proposals/group-executor";
import { isKnownProposalModule } from "@/lib/agent/kernel/proposals/capabilities";
import { MODULE_CAPABILITY_KEYS } from "@/lib/access/module-capability-keys";
import type { PermissionModule } from "@/lib/access/role-permissions-shared";
import type { AnyLegacyProposalExecutor, AnyProposalExecutor } from "@/lib/agent/kernel/proposals/executor";

const LEGACY_EXECUTORS: readonly AnyLegacyProposalExecutor[] = [
  accommodationMarkConfirmedExecutor,
  accommodationSetReferenceExecutor,
  accommodationSetVoucherExecutor,
  accommodationUpdateExecutor,
  transportMarkConfirmedExecutor,
  transportSetReferenceExecutor,
  flightUpsertExecutor,
  flightRecordTicketingExecutor,
  flightMarkTicketsIssuedExecutor,
  groupUpdateDetailsExecutor,
  groupUpdatePricingExecutor,
  deviationDecideExecutor,
  deviationMarkArrangedExecutor,
  documentReworkRequestExecutor,
  roomsGenerateExecutor,
  roomsAutoAssignExecutor,
  roomSwapSuggestedExecutor,
  groupMarkReadyExecutor,
  groupCloseSalesExecutor,
];

/**
 * Every v2 executor in the system. Phase 1 (P1.2) registers the first three,
 * scoped to `module: "finance"` / `subjectType: "BOOKING"` — later slices
 * add their own module's native `ProposalExecutor<TPayload, TPack>` objects
 * here (e.g. `kinds/quotes.ts`'s `QUOTE_SEND_FOLLOW_UP`).
 */
const NATIVE_V2_EXECUTORS: readonly AnyProposalExecutor[] = [
  paymentPlanFlagForReviewExecutor,
  paymentReminderSendExecutor,
  paymentPlanRescheduleDraftExecutor,
  quoteSendFollowUpExecutor,
  quoteRevisionDraftedExecutor,
  quoteExtendValidityExecutor,
  bookingSendReminderExecutor,
  bookingDocumentChaseExecutor,
  bookingInconsistencyReviewExecutor,
  invoiceSendReminderExecutor,
  // MI4.6: conversation -> workflow conversions.
  conversationDocumentRequestExecutor,
  conversationVisaTaskExecutor,
  conversationPaymentFollowUpExecutor,
  conversationRoomingRequestExecutor,
  conversationTransportRequirementExecutor,
  conversationGuideEscalationExecutor,
  conversationComplaintCaseExecutor,
  conversationPilgrimProfileExecutor,
  conversationTravellerRelationshipExecutor,
  conversationSeatHoldExecutor,
  conversationPackageRecommendationExecutor,
  conversationFeedbackRequestExecutor,
];

const EXECUTORS: readonly AnyProposalExecutor[] = [...groupExecutors(LEGACY_EXECUTORS), ...NATIVE_V2_EXECUTORS];

for (const executor of EXECUTORS) {
  if (!isKnownProposalModule(executor.module)) {
    throw new Error(
      `Proposal kind "${executor.kind}" is registered against module "${executor.module}", which has no capability fallback in lib/agent/kernel/proposals/capabilities.ts.`,
    );
  }
  const moduleKeys = MODULE_CAPABILITY_KEYS[executor.module as PermissionModule];
  if (!moduleKeys?.includes(executor.requiredCapability)) {
    throw new Error(
      `Proposal kind "${executor.kind}" requires capability "${executor.requiredCapability}" on module "${executor.module}", which is not in that module's MODULE_CAPABILITY_KEYS list.`,
    );
  }
}

/** Every valid `agent_proposals.kind` value — the DB CHECK constraint's application-layer twin. */
export type ProposalKind = string;

const REGISTRY: ReadonlyMap<string, AnyProposalExecutor> = new Map(
  EXECUTORS.map((executor) => [executor.kind, executor]),
);

export function getExecutor(kind: string): AnyProposalExecutor | null {
  return REGISTRY.get(kind) ?? null;
}

export function isProposalKind(kind: string): boolean {
  return REGISTRY.has(kind);
}

export const PROPOSAL_KINDS: readonly string[] = EXECUTORS.map((e) => e.kind);
