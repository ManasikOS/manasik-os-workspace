import type { AddLeadFormData } from "../../types";
import { localInputToIso } from "../../utils";

/** What `createLeadAction` is sent: the form, with the follow-up time as an instant. */
export function buildCreateLeadPayload(formData: AddLeadFormData) {
  return {
    fullName: formData.fullName,
    mobile: formData.mobile,
    email: formData.email,
    city: formData.city,
    preferredLanguage: formData.preferredLanguage,
    preferredChannel: formData.preferredChannel,

    journeyType: formData.journeyType,
    interestedIn: formData.interestedIn,
    packageId: formData.packageId,
    preferredPeriod: formData.preferredPeriod,
    adults: formData.adults,
    children: formData.children,
    roomPreference: formData.roomPreference,
    departureCity: formData.departureCity,
    budgetRange: formData.budgetRange,
    quotaWaitlistInterest: formData.quotaWaitlistInterest,

    source: formData.source,
    campaignReference: formData.campaignReference,
    referralName: formData.referralName,
    assignedToId: formData.assignedToId,
    stage: formData.stage,
    temperature: formData.temperature,

    nextFollowUpAt: localInputToIso(formData.nextFollowUpAt),
    followUpType: formData.followUpType,
    followUpOwnerId: formData.followUpOwnerId,
    notes: formData.notes,

    duplicateReason: formData.duplicateReason,
    createAnyway: formData.createAnyway,
  };
}
