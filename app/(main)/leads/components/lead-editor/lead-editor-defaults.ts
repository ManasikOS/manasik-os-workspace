import type { AddLeadFormData, LeadJourneyType, LeadSource } from "../../types";
import { defaultFollowUpInput } from "../../utils";

import { DEFAULT_INTEREST, DEFAULT_PERIOD } from "./lead-travel-interest";

/**
 * A fresh blank form.
 *
 * Built on demand rather than frozen into a module constant: a constant would
 * compute its default follow-up time once at import, so a tab left open for an
 * hour would start already failing its own "cannot be in the past" check — and,
 * evaluated on both the server and the client, the two would disagree and the
 * field would hydrate wrong.
 */
export function buildBlankLeadForm(assigneeId: string): AddLeadFormData {
  const source: LeadSource = "WHATSAPP";
  const journeyType: LeadJourneyType = "UMRAH";

  return {
    fullName: "",
    mobile: "",
    email: "",
    city: "Colombo",
    preferredLanguage: "English",
    preferredChannel: "WHATSAPP",

    journeyType,
    interestedIn: DEFAULT_INTEREST[journeyType],
    packageId: null,
    preferredPeriod: DEFAULT_PERIOD[journeyType],
    adults: 1,
    children: 0,
    roomPreference: "UNDECIDED",
    departureCity: "Colombo",
    budgetRange: "Not discussed",
    quotaWaitlistInterest: false,

    source,
    campaignReference: "",
    referralName: "",
    assignedToId: assigneeId,
    stage: "NEW_LEAD",
    temperature: "WARM",

    nextFollowUpAt: defaultFollowUpInput(source),
    followUpType: "CALL",
    followUpOwnerId: assigneeId,
    notes: "",

    duplicateReason: "",
    createAnyway: false,
  };
}

/**
 * The form for "create and add another": blank, but keeping what a person
 * entering a run of leads does not want to pick again — source, owner and
 * journey type.
 */
export function buildNextLeadForm(
  previous: AddLeadFormData,
  assigneeId: string,
): AddLeadFormData {
  return {
    ...buildBlankLeadForm(assigneeId),
    source: previous.source,
    assignedToId: previous.assignedToId,
    followUpOwnerId: previous.assignedToId,
    journeyType: previous.journeyType,
    interestedIn: DEFAULT_INTEREST[previous.journeyType],
    preferredPeriod: DEFAULT_PERIOD[previous.journeyType],
    nextFollowUpAt: defaultFollowUpInput(previous.source),
  };
}
