"use client";

import type { LeadPackageRow, StaffRow } from "@/lib/types/leads";
import type { DuplicateLeadSummary } from "@/lib/data/leads-repository";

import type { LeadEditorStepId } from "./decide-lead-step-gate";
import DuplicateCheckSection from "./duplicate-check-section";
import LeadContactInfo from "./lead-contact-info";
import LeadNextAction from "./lead-next-action";
import LeadReviewSummary from "./lead-review-summary";
import LeadSalesSetup from "./lead-sales-setup";
import LeadTravelInterest from "./lead-travel-interest";
import type { LeadEditorForm } from "./use-lead-editor-form";

export interface LeadEditorStep {
  id: LeadEditorStepId;
  label: string;
  description: string;
  /** Which error keys live on this step (used to show the error dot). */
  errorKeys: string[];
}

export const LEAD_EDITOR_STEPS: LeadEditorStep[] = [
  {
    id: "duplicate",
    label: "Duplicate Check",
    description: "Verify the lead is new",
    errorKeys: ["duplicate"],
  },
  {
    id: "contact",
    label: "Contact Details",
    description: "Name, mobile & preferences",
    errorKeys: ["fullName", "mobile", "email"],
  },
  {
    id: "sales",
    label: "Sales Setup",
    description: "Source, stage & assignment",
    errorKeys: [],
  },
  {
    id: "travel",
    label: "Travel Interest",
    description: "Journey type & packages",
    errorKeys: [],
  },
  {
    id: "action",
    label: "Next Action",
    description: "Follow-up task & notes",
    errorKeys: ["nextFollowUpAt"],
  },
  {
    id: "review",
    label: "Review & Create",
    description: "Confirm before saving",
    errorKeys: [],
  },
];

interface LeadEditorStepContentProps {
  stepId: LeadEditorStepId;
  form: LeadEditorForm;
  duplicate: {
    lead: DuplicateLeadSummary;
    matchedOn: "mobile" | "email";
  } | null;
  /** Where the duplicate lookup stands; leave out when `duplicate` is known synchronously. */
  duplicateCheckStatus?: "idle" | "checking" | "clear" | "found" | "failed";
  /** Messages for the fields the person has reached; see `useLeadEditorStepper`. */
  visibleErrors: Record<string, string>;
  packages: LeadPackageRow[];
  staffOptions: StaffRow[];
}

/** The fields of one step. */
export function LeadEditorStepContent({
  stepId,
  form,
  duplicate,
  duplicateCheckStatus,
  visibleErrors,
  packages,
  staffOptions,
}: LeadEditorStepContentProps) {
  const { formData, updateField } = form;

  switch (stepId) {
    case "duplicate":
      return (
        <DuplicateCheckSection
          mobile={formData.mobile}
          onMobileChange={(value) => updateField("mobile", value)}
          duplicate={duplicate}
          duplicateReason={formData.duplicateReason}
          onDuplicateReasonChange={(value) =>
            updateField("duplicateReason", value)
          }
          createAnyway={formData.createAnyway}
          onCreateAnywayChange={(value) => updateField("createAnyway", value)}
          checkStatus={duplicateCheckStatus}
        />
      );

    case "contact":
      return (
        <LeadContactInfo
          fullName={formData.fullName}
          onFullNameChange={(value) => updateField("fullName", value)}
          mobile={formData.mobile}
          onMobileChange={(value) => updateField("mobile", value)}
          email={formData.email}
          onEmailChange={(value) => updateField("email", value)}
          city={formData.city}
          onCityChange={(value) => updateField("city", value)}
          preferredLanguage={formData.preferredLanguage}
          onPreferredLanguageChange={(value) =>
            updateField("preferredLanguage", value)
          }
          preferredChannel={formData.preferredChannel}
          onPreferredChannelChange={(value) =>
            updateField("preferredChannel", value)
          }
          errors={visibleErrors}
        />
      );

    case "sales":
      return (
        <LeadSalesSetup
          staffOptions={staffOptions}
          source={formData.source}
          onSourceChange={form.updateSource}
          campaignReference={formData.campaignReference}
          onCampaignReferenceChange={(value) =>
            updateField("campaignReference", value)
          }
          referralName={formData.referralName}
          onReferralNameChange={(value) => updateField("referralName", value)}
          assignedToId={formData.assignedToId}
          onAssignedToChange={form.updateAssignedTo}
          stage={formData.stage}
          onStageChange={(value) => updateField("stage", value)}
          temperature={formData.temperature}
          onTemperatureChange={(value) => updateField("temperature", value)}
        />
      );

    case "travel":
      return (
        <LeadTravelInterest
          packages={packages}
          journeyType={formData.journeyType}
          onJourneyTypeChange={form.updateJourneyType}
          interestedIn={formData.interestedIn}
          onInterestedInChange={(value) => updateField("interestedIn", value)}
          packageId={formData.packageId}
          onPackageChange={(value) => updateField("packageId", value)}
          preferredPeriod={formData.preferredPeriod}
          onPreferredPeriodChange={(value) =>
            updateField("preferredPeriod", value)
          }
          adults={formData.adults}
          onAdultsChange={(value) => updateField("adults", value)}
          childrenCount={formData.children}
          onChildrenChange={(value) => updateField("children", value)}
          roomPreference={formData.roomPreference}
          onRoomPreferenceChange={(value) =>
            updateField("roomPreference", value)
          }
          departureCity={formData.departureCity}
          onDepartureCityChange={(value) => updateField("departureCity", value)}
          budgetRange={formData.budgetRange}
          onBudgetRangeChange={(value) => updateField("budgetRange", value)}
          quotaWaitlistInterest={formData.quotaWaitlistInterest}
          onQuotaWaitlistInterestChange={(value) =>
            updateField("quotaWaitlistInterest", value)
          }
        />
      );

    case "action":
      return (
        <LeadNextAction
          staffOptions={staffOptions}
          nextFollowUpAt={formData.nextFollowUpAt}
          onNextFollowUpAtChange={form.updateFollowUpAt}
          followUpType={formData.followUpType}
          onFollowUpTypeChange={(value) => updateField("followUpType", value)}
          followUpOwnerId={formData.followUpOwnerId}
          onFollowUpOwnerChange={(value) =>
            updateField("followUpOwnerId", value)
          }
          notes={formData.notes}
          onNotesChange={(value) => updateField("notes", value)}
          errors={visibleErrors}
        />
      );

    case "review":
      return (
        <LeadReviewSummary
          formData={formData}
          packages={packages}
          staffOptions={staffOptions}
        />
      );

    default:
      return null;
  }
}
