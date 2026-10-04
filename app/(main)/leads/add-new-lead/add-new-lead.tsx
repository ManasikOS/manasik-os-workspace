"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { normaliseMobile } from "@/lib/data/leads";
import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "motion/react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Eye,
  Lock,
  Phone,
  Search,
  Settings2,
  Tent,
} from "lucide-react";
import React, { useCallback, useMemo, useState } from "react";

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
  icon: React.ReactNode;
  /** Which error keys live on this step (used to show the error dot). */
  errorKeys: string[];
}

const STEPS: StepDef[] = [
  {
    id: "duplicate",
    label: "Duplicate Check",
    description: "Verify the lead is new",
    icon: <Search className="size-4" />,
    errorKeys: ["duplicate"],
  },
  {
    id: "contact",
    label: "Contact Details",
    description: "Name, mobile & preferences",
    icon: <Phone className="size-4" />,
    errorKeys: ["fullName", "mobile", "email"],
  },
  {
    id: "sales",
    label: "Sales Setup",
    description: "Source, stage & assignment",
    icon: <Settings2 className="size-4" />,
    errorKeys: [],
  },
  {
    id: "travel",
    label: "Travel Interest",
    description: "Journey type & packages",
    icon: <Tent className="size-4" />,
    errorKeys: [],
  },
  {
    id: "action",
    label: "Next Action",
    description: "Follow-up task & notes",
    icon: <ClipboardCheck className="size-4" />,
    errorKeys: ["nextFollowUpAt"],
  },
  {
    id: "review",
    label: "Review & Create",
    description: "Confirm before saving",
    icon: <Eye className="size-4" />,
    errorKeys: [],
  },
];

// ---------------------------------------------------------------------------
// Panel slide animation variants
// ---------------------------------------------------------------------------

const panelVariants = {
  enter: (dir: number) => ({
    x: dir >= 0 ? "3%" : "-3%",
    opacity: 0,
  }),
  center: {
    x: "0%",
    opacity: 1,
  },
  exit: (dir: number) => ({
    x: dir >= 0 ? "-3%" : "3%",
    opacity: 0,
  }),
};

// ---------------------------------------------------------------------------
// Sidebar step item
// ---------------------------------------------------------------------------

interface SidebarStepProps {
  step: StepDef;
  index: number;
  current: number;
  hasError: boolean;
  isCompleted: boolean;
  isLocked: boolean;
  onClick: () => void;
}

function SidebarStep({
  step,
  index,
  current,
  hasError,
  isCompleted,
  isLocked,
  onClick,
}: SidebarStepProps) {
  const isActive = index === current;

  return (
    <button
      type="button"
      onClick={isLocked ? undefined : onClick}
      disabled={isLocked}
      aria-disabled={isLocked}
      className={cn(
        "group relative w-full flex items-center gap-3 rounded-sm px-3 py-2.5 text-left transition-all duration-150 outline-none",
        "focus-visible:ring-2 disabled:opacity-100 focus-visible:ring-primary/40",
        isLocked
          ? "cursor-not-allowed opacity-40"
          : isActive
            ? "bg-primary/6 text-primary"
            : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
      )}
    >
      {/* Step number / status indicator */}
      <div
        className={cn(
          "relative flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-all duration-200",
          isLocked
            ? "bg-muted text-muted-foreground/50"
            : isActive
              ? "bg-primary text-primary-foreground shadow-sm shadow-primary/30 ring-4 ring-primary/15"
              : isCompleted
                ? "bg-primary/20 text-primary"
                : hasError
                  ? "bg-destructive/15 text-destructive"
                  : "bg-muted text-muted-foreground",
        )}
      >
        {isLocked ? (
          <Lock className="size-3" />
        ) : isCompleted && !hasError ? (
          <CheckCircle2 className="size-3.5" />
        ) : hasError ? (
          <AlertCircle className="size-3.5" />
        ) : (
          <span>{index + 1}</span>
        )}
      </div>

      {/* Label & description */}
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "text-sm font-medium leading-none truncate transition-colors",
            isLocked
              ? "text-muted-foreground/40"
              : isActive
                ? "text-primary"
                : hasError
                  ? "text-destructive"
                  : isCompleted
                    ? "text-foreground"
                    : "text-muted-foreground group-hover:text-foreground",
          )}
        >
          {step.label}
        </p>
        <p
          className={cn(
            "mt-0.5 text-[11px] leading-tight truncate transition-colors",
            isActive ? "text-primary/70" : "text-muted-foreground/60",
          )}
        >
          {step.description}
        </p>
      </div>

      {/* Active chevron — hidden when locked */}
      {isActive && !isLocked && (
        <ChevronRight className="size-3.5 shrink-0 text-primary opacity-70" />
      )}
    </button>
  );
}

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
  const visibleErrors = submitAttempted || isDirty ? errors : {};

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

          {/* ═══════════════════════════════════════════════════════════════
              MOBILE top header + step strip (hidden on md+)
          ═══════════════════════════════════════════════════════════════ */}
          <div className="md:hidden flex flex-col borde  bg-muted/30">
            {/* Title row */}
            <div className="flex items-center justify-between px-4 pt-4 pb-2">
              <div>
                <h2 className="font-heading text-base font-semibold leading-tight">
                  Add New Lead
                </h2>
                <p className="text-[11px] text-muted-foreground">
                  Step {activeStep + 1} of {STEPS.length} —{" "}
                  {STEPS[activeStep].label}
                </p>
              </div>
              {/* Compact fraction counter */}
              <span className="text-xs font-medium text-muted-foreground tabular-nums bg-muted rounded-full px-2.5 py-0.5">
                {activeStep + 1}/{STEPS.length}
              </span>
            </div>

            {/* Progress dots */}
            <div className="flex items-center gap-1.5 px-4 pb-3">
              {STEPS.map((_, i) => (
                <div
                  key={i}
                  className={`h-1 rounded-full transition-all duration-300 ${
                    i === activeStep
                      ? "bg-primary flex-3"
                      : i < activeStep
                        ? "bg-primary/40 flex-1"
                        : "bg-muted-foreground/20 flex-1"
                  }`}
                />
              ))}
            </div>
          </div>

          {/* ═══════════════════════════════════════════════════════════════
              Main body: sidebar (md+) + content panel
          ═══════════════════════════════════════════════════════════════ */}
          <div className="flex flex-1 min-h-0 overflow-hidden">
            {/* ── Left sidebar — md+ only ─────────────────────────────────── */}
            <aside className="hidden md:flex w-44 lg:w-56 shrink-0 flex-col gap-0.5 border-r border-border/50 bg-muted/30 px-2 lg:px-3 py-4">
              {/* Dialog header */}
              <div className="mb-5 px-1">
                <h2 className="font-heading text-base lg:text-xl font-semibold leading-tight tracking-tight">
                  Add New Lead
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground leading-snug">
                  Capture a new inquiry and schedule the first follow-up
                </p>
              </div>

              {/* Step list */}
              <nav aria-label="Form sections" className="flex flex-col gap-0.5">
                {STEPS.map((step, index) => (
                  <SidebarStep
                    key={step.id}
                    step={step}
                    index={index}
                    current={activeStep}
                    hasError={stepHasError(step)}
                    isCompleted={stepIsCompleted(index, step)}
                    isLocked={index > highestReachedStep}
                    onClick={() => goToStep(index)}
                  />
                ))}
              </nav>

              {/* Overall error count (visible post-submit) */}
              {submitAttempted && !isFormValid && (
                <div className="mt-auto pt-4 px-1">
                  <p className="flex items-center gap-1.5 text-[11px] font-medium text-destructive">
                    <AlertCircle className="size-3.5 shrink-0" />
                    {Object.keys(errors).length === 1
                      ? "1 issue to fix"
                      : `${Object.keys(errors).length} issues to fix`}
                  </p>
                </div>
              )}
            </aside>

            {/* ── Right content panel ───────────────────────────────────────── */}
            <div className="flex flex-1 min-w-0 flex-col">
              {/* Scrollable step content */}
              <div className="relative flex-1 min-h-0 overflow-hidden">
                <AnimatePresence initial={false} mode="wait" custom={direction}>
                  <motion.div
                    key={activeStep}
                    custom={direction}
                    variants={panelVariants}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    transition={{ duration: 0.18, ease: "easeInOut" }}
                    className="absolute inset-0 overflow-y-auto custom-scroll p-4 sm:p-5 flex flex-col gap-4 sm:gap-5 text-sm"
                  >
                    {/* Step header — visible on md+ (mobile uses the top strip) */}
                    <div className="hidden md:flex items-center gap-2.5 pb-1 border- border-border/40">
                      <div>
                        <h3 className="font-semibold text-base lg:text-lg leading-tight">
                          {STEPS[activeStep].label}
                        </h3>
                        <p className="text-[11px] text-muted-foreground">
                          {STEPS[activeStep].description}
                        </p>
                      </div>
                      <span className="ml-auto text-[11px] text-muted-foreground font-medium tabular-nums">
                        {activeStep + 1} / {STEPS.length}
                      </span>
                    </div>

                    {/* Active step content */}
                    {stepContent[activeStep]}
                  </motion.div>
                </AnimatePresence>
              </div>

              {/* ── Footer ──────────────────────────────────────────────────── */}
              <div className="flex items-center justify-between gap-2 border-t border-border/40 bg-card/90 backdrop-blur-md px-4 sm:px-5 py-3">
                {/* Cancel */}
                <Button
                  type="button"
                  variant="outline_without_border"
                  onClick={attemptClose}
                >
                  Cancel
                </Button>

                {/* Right side */}
                <div className="flex items-center gap-2 min-w-0">
                  {/* Inline error hint — hidden on mobile to save space */}
                  {((submitAttempted && !isFormValid) || serverError) && (
                    <span
                      role="alert"
                      className="hidden sm:flex text-[11px] text-destructive font-medium items-center gap-1 max-w-40 truncate"
                    >
                      <AlertCircle className="size-3 shrink-0" />
                      {serverError ?? Object.values(errors)[0]}
                    </span>
                  )}

                  {/* Back */}
                  {activeStep > 0 && (
                    <Button
                      variant="ghost"
                      onClick={() => goToStep(activeStep - 1)}
                    >
                      Back
                    </Button>
                  )}

                  {/* Continue / Save actions */}
                  {activeStep < STEPS.length - 1 ? (
                    <div className="flex flex-col items-end gap-1">
                      <Button
                        variant="secondary"
                        disabled={!stepCanContinue}
                        onClick={() => {
                          setHighestReachedStep((prev) =>
                            Math.max(prev, activeStep + 1),
                          );
                          goToStep(activeStep + 1);
                        }}
                      >
                        Continue
                      </Button>
                      {/* {stepBlockedReason && (
                        <p className="text-[10px] text-muted-foreground text-right max-w-40 leading-tight">
                          {stepBlockedReason}
                        </p>
                      )} */}
                    </div>
                  ) : (
                    /* Final step — save actions */
                    <>
                      {/* "Save & Add Another" hidden on mobile — too cramped */}

                      <Button
                        type="button"
                        disabled={submitting}
                        onClick={() => submit(false)}
                      >
                        Create Lead
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
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
