"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { SidebarStepperDialogBody } from "@/components/ui/sidebar-stepper-dialog-body";
import { toast } from "@/components/ui/toast";
import { normaliseMobile } from "@/lib/data/leads";
import { AlertCircle } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { useLeads } from "../leads-store";
import type { AddLeadFormData, LeadJourneyType, LeadSource } from "../types";
import { defaultFollowUpInput, localInputToIso } from "../utils";

import DiscardConfirmDialog from "./components/discard-confirm-dialog";
import DuplicateCheckSection from "./components/duplicate-check-section";
import LeadContactInfo from "./components/lead-contact-info";
import LeadNextAction from "./components/lead-next-action";
import LeadSalesSetup from "./components/lead-sales-setup";
import LeadTravelInterest, {
  DEFAULT_INTEREST,
  DEFAULT_PERIOD,
} from "./components/lead-travel-interest";
import LeadReviewSummary from "./components/lead-review-summary";

interface AddNewLeadProps {
  open: boolean;
  setOpen: (open: boolean) => void;
}

/**
 * A fresh blank form.
 *
 * Built on demand rather than frozen into a module constant: the previous
 * version computed its default follow-up time once at import, so a tab left
 * open for an hour opened the sheet already failing its own "cannot be in the
 * past" validation — and, because that constant was evaluated on both the
 * server and the client, the two disagreed and the field hydrated wrong.
 */
function blankForm(assigneeId: string): AddLeadFormData {
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
    createFollowUpTask: true,
    notes: "",

    duplicateReason: "",
    createAnyway: false,
  };
}

// ---------------------------------------------------------------------------
// Step definitions
// ---------------------------------------------------------------------------

interface StepDef {
  id: string;
  label: string;
  description: string;
  /** Which error keys live on this step (used to show the error dot). */
  errorKeys: string[];
}

const STEPS: StepDef[] = [
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

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function AddNewLead({ open, setOpen }: AddNewLeadProps) {
  const { createLead, findDuplicate, currentStaffId, store } = useLeads();

  const [formData, setFormData] = useState<AddLeadFormData>(() =>
    blankForm(currentStaffId),
  );
  const [isDirty, setIsDirty] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  // Stepper state
  const [activeStep, setActiveStep] = useState(0);
  // Tracks the furthest step the user has legitimately unlocked by clicking
  // Continue. Sidebar items beyond this index are locked and unclickable.
  const [highestReachedStep, setHighestReachedStep] = useState(0);
  // Which way the step transition animates. Computed in the event handler
  // that changes `activeStep`, not derived from a ref read during render —
  // a ref's `current` is not a value React can use to decide whether this
  // render needs to differ from the last one.
  const [direction, setDirection] = useState(1);

  const goToStep = useCallback(
    (index: number) => {
      setDirection(index >= activeStep ? 1 : -1);
      setActiveStep(index);
    },
    [activeStep],
  );

  const updateField = useCallback(
    <K extends keyof AddLeadFormData>(field: K, value: AddLeadFormData[K]) => {
      setFormData((previous) => {
        if (Object.is(previous[field], value)) return previous;
        // Only a real change marks the form dirty, so re-picking the value a
        // select already had does not trigger the discard prompt on close.
        setIsDirty(true);
        return { ...previous, [field]: value };
      });
    },
    [],
  );

  /** Reassigning the lead moves the follow-up task too, unless it was split. */
  const updateAssignedTo = useCallback((staffId: string) => {
    setFormData((previous) => {
      if (previous.assignedToId === staffId) return previous;
      setIsDirty(true);
      return {
        ...previous,
        assignedToId: staffId,
        followUpOwnerId:
          previous.followUpOwnerId === previous.assignedToId
            ? staffId
            : previous.followUpOwnerId,
      };
    });
  }, []);

  /** The source dictates how quickly the first follow-up should happen. */
  const updateSource = useCallback((source: LeadSource) => {
    setFormData((previous) => {
      if (previous.source === source) return previous;
      setIsDirty(true);
      return {
        ...previous,
        source,
        nextFollowUpAt: defaultFollowUpInput(source),
      };
    });
  }, []);

  const duplicate = useMemo(
    () => findDuplicate(formData.mobile, formData.email),
    [findDuplicate, formData.mobile, formData.email],
  );

  /**
   * "Is this time already past?" cannot be answered during render — reading the
   * clock there makes the result unstable across re-renders. It is checked in
   * the change handler and again on submit, which is when it actually matters.
   */
  const [pastFollowUp, setPastFollowUp] = useState<string | null>(null);

  const checkFollowUpTime = useCallback((localValue: string) => {
    const iso = localInputToIso(localValue);
    const isPast = iso !== null && Date.parse(iso) < Date.now() - 60_000;
    setPastFollowUp(isPast ? "Follow-up time cannot be in the past" : null);
    return !isPast;
  }, []);

  const updateFollowUpAt = useCallback(
    (value: string) => {
      updateField("nextFollowUpAt", value);
      checkFollowUpTime(value);
    },
    [checkFollowUpTime, updateField],
  );

  const errors = useMemo(() => {
    const found: Record<string, string> = {};

    if (!formData.fullName.trim()) {
      found.fullName = "Full name is required";
    }

    const mobile = normaliseMobile(formData.mobile);
    if (!mobile) {
      found.mobile = "Mobile number is required";
    } else if (mobile.length !== 9) {
      found.mobile = "Enter a nine-digit Sri Lankan number, e.g. 77 123 4567";
    }

    if (formData.email.trim()) {
      const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email.trim());
      if (!valid) found.email = "Please enter a valid email address";
    }

    if (formData.createFollowUpTask) {
      if (!localInputToIso(formData.nextFollowUpAt)) {
        found.nextFollowUpAt = "Next follow-up date and time is required";
      } else if (pastFollowUp) {
        found.nextFollowUpAt = pastFollowUp;
      }
    }

    // The duplicate warning was previously advisory only — the form let you
    // create the second copy without ever answering it.
    if (duplicate && !(formData.duplicateReason && formData.createAnyway)) {
      found.duplicate =
        "This looks like an existing lead. Choose a reason and confirm, or open the existing lead.";
    }

    return found;
  }, [formData, duplicate, pastFollowUp]);

  const isFormValid = Object.keys(errors).length === 0;

  const resetForm = useCallback(
    (retainPreferences: boolean) => {
      setFormData((previous) => {
        const blank = blankForm(currentStaffId);
        if (!retainPreferences) return blank;
        return {
          ...blank,
          source: previous.source,
          assignedToId: previous.assignedToId,
          followUpOwnerId: previous.assignedToId,
          journeyType: previous.journeyType,
          interestedIn: DEFAULT_INTEREST[previous.journeyType],
          preferredPeriod: DEFAULT_PERIOD[previous.journeyType],
          nextFollowUpAt: defaultFollowUpInput(previous.source),
        };
      });
      setIsDirty(false);
      setSubmitAttempted(false);
      setShowDiscardConfirm(false);
      setPastFollowUp(null);
      setDirection(1);
      setActiveStep(0);
      setHighestReachedStep(0);
    },
    [currentStaffId],
  );

  const attemptClose = useCallback(() => {
    if (isDirty) {
      setShowDiscardConfirm(true);
      return;
    }
    setOpen(false);
    resetForm(false);
  }, [isDirty, resetForm, setOpen]);

  const submit = useCallback(
    async (keepOpen: boolean) => {
      setSubmitAttempted(true);
      setServerError(null);

      // Re-check the clock here rather than trusting a value computed when the
      // field was last touched: a dialog left open long enough will have
      // drifted past the time the operator chose.
      const followUpStillValid =
        !formData.createFollowUpTask ||
        checkFollowUpTime(formData.nextFollowUpAt);

      if (!isFormValid || !followUpStillValid) {
        toast.add({
          title: "Check the form",
          description:
            Object.values(errors)[0] ?? "Follow-up time cannot be in the past",
        });
        return;
      }

      setSubmitting(true);
      const result = await createLead({
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

        nextFollowUpAt: formData.createFollowUpTask
          ? localInputToIso(formData.nextFollowUpAt)
          : null,
        followUpType: formData.followUpType,
        followUpOwnerId: formData.followUpOwnerId,
        notes: formData.notes,

        duplicateReason: formData.duplicateReason,
        createAnyway: formData.createAnyway,
      });
      setSubmitting(false);

      if (!result.ok) {
        setServerError(result.error ?? "Could not create lead.");
        toast.add({
          title: "Could not create lead",
          description: result.error,
        });
        return;
      }

      toast.add({
        title: `Lead ${result.reference} created`,
        description: `${formData.fullName.trim()} assigned to ${
          formData.assignedToId === currentStaffId
            ? "you"
            : "the selected owner"
        }.`,
      });

      if (keepOpen) {
        resetForm(true);
      } else {
        setOpen(false);
        resetForm(false);
      }
    },
    [
      createLead,
      currentStaffId,
      errors,
      formData,
      isFormValid,
      resetForm,
      setOpen,
      checkFollowUpTime,
    ],
  );

  // Errors surface once the operator has tried to save, or as soon as a field
  // they have touched goes invalid — not on an untouched blank form.
  const visibleErrors = useMemo(
    () => (submitAttempted || isDirty ? errors : {}),
    [submitAttempted, isDirty, errors],
  );

  // Which steps have errors visible right now
  const stepHasError = useCallback(
    (step: StepDef) =>
      step.errorKeys.some((key) => Boolean(visibleErrors[key])),
    [visibleErrors],
  );

  // A step is "completed" if the user has moved past it and it has no errors.
  // We use submitAttempted as the signal — once they've tried, every
  // error-free step can light up.
  const stepIsCompleted = useCallback(
    (index: number, step: StepDef) =>
      submitAttempted && index < activeStep && !stepHasError(step),
    [submitAttempted, activeStep, stepHasError],
  );

  /**
   * Whether the current step's requirements are met so the operator may
   * advance. Steps without hard requirements (Sales Setup, Travel Interest,
   * Review) always return true.
   */
  const stepCanContinue = useMemo(() => {
    switch (activeStep) {
      case 0: {
        // Duplicate Check: mobile must have been entered (≥9 digits) and any
        // detected duplicate must be explicitly resolved before moving on.
        const digits = formData.mobile.replace(/\D/g, "");
        const mobileChecked = digits.length >= 9;
        const duplicateResolved =
          !duplicate ||
          (Boolean(formData.duplicateReason) && formData.createAnyway);
        return mobileChecked && duplicateResolved;
      }
      case 1: {
        // Contact Details: name + mobile must be valid; email only if provided.
        return !errors.fullName && !errors.mobile && !errors.email;
      }
      case 4: {
        // Next Action: if a follow-up task is being created, the date must be
        // set and must not be in the past.
        if (!formData.createFollowUpTask) return true;
        return (
          !errors.nextFollowUpAt &&
          Boolean(localInputToIso(formData.nextFollowUpAt))
        );
      }
      default:
        return true;
    }
  }, [activeStep, formData, duplicate, errors]);

  /** Human-readable reason shown under Continue when the gate is locked. */
  const stepBlockedReason = useMemo(() => {
    if (stepCanContinue) return null;
    switch (activeStep) {
      case 0: {
        const digits = formData.mobile.replace(/\D/g, "");
        if (digits.length < 9)
          return "Enter the mobile number first to check for duplicates";
        if (duplicate && !formData.duplicateReason)
          return "Select a reason for the duplicate before continuing";
        if (duplicate && !formData.createAnyway)
          return "Confirm you want to create a separate lead";
        return null;
      }
      case 1:
        return errors.fullName ?? errors.mobile ?? errors.email ?? null;
      case 4:
        return errors.nextFollowUpAt ?? null;
      default:
        return null;
    }
  }, [stepCanContinue, activeStep, formData, duplicate, errors]);

  // The duplicate answer is given on step 1, but an email typed on step 2 can
  // also match an existing lead — say so where the operator is looking.
  const emailDuplicateNotice =
    duplicate &&
    duplicate.matchedOn === "email" &&
    !(formData.duplicateReason && formData.createAnyway)
      ? `This email already belongs to ${duplicate.lead.name} (${duplicate.lead.reference}). Confirm it is a separate person before saving.`
      : null;

  // Step content panels
  const stepContent = [
    // 0 — Duplicate Check
    <DuplicateCheckSection
      key="duplicate"
      mobile={formData.mobile}
      onMobileChange={(value) => updateField("mobile", value)}
      duplicate={duplicate}
      duplicateReason={formData.duplicateReason}
      onDuplicateReasonChange={(value) => updateField("duplicateReason", value)}
      createAnyway={formData.createAnyway}
      onCreateAnywayChange={(value) => updateField("createAnyway", value)}
    />,

    // 1 — Contact Details
    <LeadContactInfo
      key="contact"
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
      // emailDuplicateNotice={emailDuplicateNotice}
      // onReviewDuplicate={() => goToStep(0)}
    />,

    // 2 — Sales Setup
    <LeadSalesSetup
      key="sales"
      source={formData.source}
      onSourceChange={updateSource}
      campaignReference={formData.campaignReference}
      onCampaignReferenceChange={(value) =>
        updateField("campaignReference", value)
      }
      referralName={formData.referralName}
      onReferralNameChange={(value) => updateField("referralName", value)}
      assignedToId={formData.assignedToId}
      onAssignedToChange={updateAssignedTo}
      stage={formData.stage}
      onStageChange={(value) => updateField("stage", value)}
      temperature={formData.temperature}
      onTemperatureChange={(value) => updateField("temperature", value)}
    />,

    // 3 — Travel Interest
    <LeadTravelInterest
      key="travel"
      packages={store.packages}
      journeyType={formData.journeyType}
      onJourneyTypeChange={(journeyType) =>
        setFormData((previous) => {
          if (previous.journeyType === journeyType) return previous;
          setIsDirty(true);
          return {
            ...previous,
            journeyType,
            interestedIn: DEFAULT_INTEREST[journeyType],
            preferredPeriod: DEFAULT_PERIOD[journeyType],
            // A Hajj package cannot stay selected on an Umrah enquiry.
            packageId: null,
            quotaWaitlistInterest:
              journeyType === "HAJJ" ? previous.quotaWaitlistInterest : false,
          };
        })
      }
      interestedIn={formData.interestedIn}
      onInterestedInChange={(value) => updateField("interestedIn", value)}
      packageId={formData.packageId}
      onPackageChange={(value) => updateField("packageId", value)}
      preferredPeriod={formData.preferredPeriod}
      onPreferredPeriodChange={(value) => updateField("preferredPeriod", value)}
      adults={formData.adults}
      onAdultsChange={(value) => updateField("adults", value)}
      childrenCount={formData.children}
      onChildrenChange={(value) => updateField("children", value)}
      roomPreference={formData.roomPreference}
      onRoomPreferenceChange={(value) => updateField("roomPreference", value)}
      departureCity={formData.departureCity}
      onDepartureCityChange={(value) => updateField("departureCity", value)}
      budgetRange={formData.budgetRange}
      onBudgetRangeChange={(value) => updateField("budgetRange", value)}
      quotaWaitlistInterest={formData.quotaWaitlistInterest}
      onQuotaWaitlistInterestChange={(value) =>
        updateField("quotaWaitlistInterest", value)
      }
    />,

    // 4 — Next Action
    <LeadNextAction
      key="action"
      nextFollowUpAt={formData.nextFollowUpAt}
      onNextFollowUpAtChange={updateFollowUpAt}
      followUpType={formData.followUpType}
      onFollowUpTypeChange={(value) => updateField("followUpType", value)}
      followUpOwnerId={formData.followUpOwnerId}
      onFollowUpOwnerChange={(value) => updateField("followUpOwnerId", value)}
      createFollowUpTask={formData.createFollowUpTask}
      onCreateFollowUpTaskChange={(value) =>
        updateField("createFollowUpTask", value)
      }
      notes={formData.notes}
      onNotesChange={(value) => updateField("notes", value)}
      errors={visibleErrors}
    />,

    // 5 — Review & Create
    <LeadReviewSummary
      key="review"
      formData={formData}
      packages={store.packages}
      // onEditStep={goToStep}
    />,
  ];

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (next) setOpen(true);
          else attemptClose();
        }}
      >
        <DialogContent
          showCloseButton={false}
          className="p-0! gap-0! w-full max-w-full! h-dvh flex flex-col overflow-hidden  md:max-w-3xl! md:h-[90vh] lg:max-w-4xl!"
        >
          {/* ── Accessible title / description (sr-only) ── */}
          <DialogTitle className="sr-only">Add New Lead</DialogTitle>
          <DialogDescription className="sr-only">
            Capture a new inquiry and schedule the next follow-up
          </DialogDescription>

          <SidebarStepperDialogBody
            title="Add New Lead"
            subtitle="Capture a new inquiry and schedule the first follow-up"
            steps={STEPS}
            activeStep={activeStep}
            direction={direction}
            onStepSelect={goToStep}
            getStepState={(index) => ({
              isLocked: index > highestReachedStep,
              isCompleted: stepIsCompleted(index, STEPS[index]),
              hasError: stepHasError(STEPS[index]),
            })}
            sidebarFooter={
              submitAttempted && !isFormValid ? (
                <p className="flex items-center gap-1.5 text-[11px] font-medium text-destructive">
                  <AlertCircle className="size-3.5 shrink-0" />
                  {Object.keys(errors).length === 1
                    ? "1 issue to fix"
                    : `${Object.keys(errors).length} issues to fix`}
                </p>
              ) : null
            }
            onCancel={attemptClose}
            onBack={() => goToStep(activeStep - 1)}
            onContinue={() => {
              setHighestReachedStep((prev) => Math.max(prev, activeStep + 1));
              goToStep(activeStep + 1);
            }}
            canContinue={stepCanContinue}
            footerHint={
              serverError || (submitAttempted && !isFormValid) ? (
                <span
                  role="alert"
                  className="hidden sm:flex text-[11px] text-destructive font-medium items-center gap-1 max-w-64 truncate"
                >
                  <AlertCircle className="size-3 shrink-0" />
                  {serverError ?? Object.values(errors)[0]}
                </span>
              ) : stepBlockedReason ? (
                <span className="hidden sm:flex text-[11px] text-muted-foreground items-center gap-1 max-w-64 truncate">
                  {stepBlockedReason}
                </span>
              ) : null
            }
            lastStepAction={
              <Button
                type="button"
                disabled={submitting}
                onClick={() => submit(false)}
              >
                Create Lead
              </Button>
            }
          >
            {stepContent[activeStep]}
          </SidebarStepperDialogBody>
        </DialogContent>
      </Dialog>

      <DiscardConfirmDialog
        open={showDiscardConfirm}
        onKeepEditing={() => setShowDiscardConfirm(false)}
        onConfirmDiscard={() => {
          setShowDiscardConfirm(false);
          setOpen(false);
          resetForm(false);
        }}
      />
    </>
  );
}
