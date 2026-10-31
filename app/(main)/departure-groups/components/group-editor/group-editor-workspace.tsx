"use client";

import { MotionConfig, motion } from "motion/react";
import { useEffect, useRef, useState, useTransition } from "react";

import { Card } from "@/components/ui/card";
import { HorizontalStepper } from "@/components/ui/horizontal-stepper";
import { toast } from "@/components/ui/toast";
import {
  useUnsavedChangesGuard,
  type BlockedNavigation,
} from "@/hooks/use-unsaved-changes-guard";
import type { StaffRole } from "@/lib/access/departure-groups-access";
import {
  createDepartureGroupSchema,
  toDepartureGroupFieldErrors,
} from "@/lib/validations/departure-groups";

import { createDepartureGroupAction } from "../../actions";
import type { PackageTemplateOption } from "../../types";
import { GroupEditorFooter } from "./group-editor-footer";
import { GROUP_EDITOR_STEPS } from "./group-editor-steps";
import { GroupLeaveConfirmDialog } from "./group-leave-confirm-dialog";
import StepDetails from "./step-details";
import StepPricing from "./step-pricing";
import StepReview from "./step-review";
import StepTemplate from "./step-template";
import { useGroupEditorForm } from "./use-group-editor-form";

/** Field keys on step 2; any other schema error belongs to the pricing step. */
const DETAILS_FIELD_KEYS = new Set([
  "packageTemplateId",
  "groupName",
  "groupCode",
  "departureDate",
  "returnDate",
  "capacity",
  "minimumGroupSize",
  "salesStatus",
  "branch",
  "operationsOwnerName",
  "primaryGuideName",
  "waitlistEnabled",
  "seatHoldExpiryHours",
  "copyOptions",
]);

const LAST_STEP = GROUP_EDITOR_STEPS.length - 1;

interface GroupEditorWorkspaceProps {
  templates: PackageTemplateOption[];
  role: StaffRole;
  branches: string[];
  initialTemplateId: string | null;
  /** Leave the editor: Cancel with nothing to lose, or Discard. */
  onClose: () => void;
  /** The group was created. Where to go is the page's decision. */
  onCreated: (groupId: string) => void;
}

/**
 * The departure group editor: a horizontal stepper across the top, the open
 * step below it, and the actions pinned to the bottom of the screen, plus the
 * "unsaved changes" prompt.
 *
 * Nothing is saved until the person creates the group; there are no drafts.
 * The form lives in the browser, and leaving with edits asks first.
 */
export function GroupEditorWorkspace({
  templates,
  role,
  branches,
  initialTemplateId,
  onClose,
  onCreated,
}: GroupEditorWorkspaceProps) {
  const form = useGroupEditorForm({ templates, role, branches, initialTemplateId });
  const [isCreating, startCreate] = useTransition();

  // --- Stepper ----------------------------------------------------------
  // A template picked from the Packages screen starts on the details step.
  const [activeStep, setActiveStep] = useState(form.selected ? 1 : 0);
  const [direction, setDirection] = useState(1);
  // Steps where the person pressed Continue/Create with problems, or that a save error pointed at.
  const [triedSteps, setTriedSteps] = useState<ReadonlySet<number>>(() => new Set());
  const [revealCount, setRevealCount] = useState(0);
  const [formError, setFormError] = useState<string | null>(null);

  const firstInvalidStep = form.stepValidity.findIndex((valid) => !valid);
  /** Every step before a later one must be complete before it opens. */
  const isStepLocked = (index: number) =>
    form.stepValidity.slice(0, Math.min(index, LAST_STEP)).some((valid) => !valid);

  const goToStep = (index: number) => {
    if (index < 0 || index > LAST_STEP || isStepLocked(index)) return;
    setDirection(index >= activeStep ? 1 : -1);
    setActiveStep(index);
  };

  const revealProblems = (step: number) => {
    setTriedSteps((previous) => new Set(previous).add(step));
    setRevealCount((count) => count + 1);
  };

  const showStep = (step: number) => {
    setDirection(step >= activeStep ? 1 : -1);
    setActiveStep(step);
    revealProblems(step);
  };

  const attemptContinue = () => {
    if (form.stepValidity[activeStep]) return goToStep(activeStep + 1);
    revealProblems(activeStep);
  };

  /** Takes the person to the step that owns the first field the schema or server complained about. */
  const showFieldErrors = (fieldErrors: Record<string, string[] | undefined>) => {
    form.setServerErrors(fieldErrors);
    const onDetails = Object.keys(fieldErrors).some((key) => DETAILS_FIELD_KEYS.has(key));
    showStep(onDetails ? 1 : 2);
  };

  const attemptCreate = () => {
    setFormError(null);
    // Any earlier step with a problem is the place to go, not a toast.
    if (firstInvalidStep !== -1) return showStep(firstInvalidStep);

    const payload = form.buildPayload();
    if (!payload) return;

    // Run the same schema client-side first so errors land on the fields.
    const parsed = createDepartureGroupSchema.safeParse(payload);
    if (!parsed.success) {
      setFormError("Check the highlighted fields and try again.");
      return showFieldErrors(toDepartureGroupFieldErrors(parsed.error));
    }

    startCreate(async () => {
      const result = await createDepartureGroupAction(payload);
      if (!result.ok) {
        setFormError(result.error);
        if (result.fieldErrors) showFieldErrors(result.fieldErrors);
        return;
      }
      toast.add({
        title: "Departure Group created",
        description: `Departure Group created from ${result.packageName}.`,
      });
      onCreated(result.groupId);
    });
  };

  // --- Leaving ----------------------------------------------------------
  // `blocked` is where the person was heading (a link, or Back); null when they pressed Cancel.
  const [leavePromptOpen, setLeavePromptOpen] = useState(false);
  const [blocked, setBlocked] = useState<BlockedNavigation | null>(null);

  const guard = useUnsavedChangesGuard({
    isDirty: form.isDirty && !isCreating,
    onBlocked: (navigation) => {
      setBlocked(navigation);
      setLeavePromptOpen(true);
    },
  });

  const attemptCancel = () => {
    if (!form.isDirty) return onClose();
    setBlocked(null);
    setLeavePromptOpen(true);
  };

  const leaveWithoutSaving = () => {
    setLeavePromptOpen(false);
    if (blocked) guard.leave(blocked);
    else onClose();
  };

  // --- Focus and scroll -------------------------------------------------
  // On a step change, bring the stepper bar into view and focus the step's
  // heading. Compared with the previous step so Strict Mode's second effect
  // run does not move focus.
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);
  const previousStepRef = useRef(activeStep);
  useEffect(() => {
    if (previousStepRef.current === activeStep) return;
    previousStepRef.current = activeStep;
    const heading = stepHeadingRef.current;
    heading?.closest<HTMLElement>('[data-slot="card"]')?.scrollIntoView({ block: "start" });
    heading?.focus({ preventScroll: true });
  }, [activeStep]);

  // Once the messages have rendered, scroll to the first one and focus it when
  // it is a field. Declared after the step-change effect so this wins.
  const stepContentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (revealCount === 0) return;
    const firstProblem = stepContentRef.current?.querySelector<HTMLElement>(
      '[aria-invalid="true"], [role="alert"], .text-destructive',
    );
    if (!firstProblem) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    firstProblem.scrollIntoView({
      block: "center",
      behavior: reduceMotion ? "auto" : "smooth",
    });
    if (firstProblem.matches("input, textarea, select, button, [tabindex]")) {
      firstProblem.focus({ preventScroll: true });
    }
  }, [revealCount]);

  const currentStep = GROUP_EDITOR_STEPS[activeStep];
  const showErrors = triedSteps.has(activeStep);
  const stepProblem = form.stepProblems[activeStep];

  const hint = formError
    ? { tone: "error" as const, text: formError }
    : showErrors && stepProblem
      ? { tone: "error" as const, text: stepProblem }
      : null;

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex flex-col gap-4">
        {/* One bar holds the stepper and the open step's title, so the form
            starts as high as it can. */}
        <Card className="w-full scroll-mt-20 gap-4 py-4">
          <HorizontalStepper
            steps={[...GROUP_EDITOR_STEPS]}
            activeStep={activeStep}
            onStepSelect={goToStep}
            getStepState={(index) => ({
              isLocked: isStepLocked(index),
              lockedReason: isStepLocked(index)
                ? `Finish "${GROUP_EDITOR_STEPS[firstInvalidStep]?.label}" first.`
                : undefined,
              isCompleted:
                index < activeStep && index < LAST_STEP && form.stepValidity[index],
              hasError:
                index !== activeStep &&
                index < LAST_STEP &&
                triedSteps.has(index) &&
                !form.stepValidity[index],
            })}
          />
          <header className="flex flex-col gap-0.5 border-t border-border/50 pt-4">
            <h2
              ref={stepHeadingRef}
              tabIndex={-1}
              className="rounded-sm text-xl font-medium leading-tight tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              {currentStep.label}
            </h2>
            <p className="text-sm text-muted-foreground">{currentStep.description}</p>
          </header>
        </Card>

        <motion.div
          ref={stepContentRef}
          key={activeStep}
          initial={{ opacity: 0, x: direction >= 0 ? 16 : -16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          className="w-full"
        >
          {activeStep === 0 ? (
            <StepTemplate
              form={form}
              templates={templates}
              role={role}
              problem={showErrors ? stepProblem : undefined}
            />
          ) : activeStep === 1 ? (
            <StepDetails form={form} showErrors={showErrors} />
          ) : activeStep === 2 ? (
            <StepPricing form={form} showErrors={showErrors} />
          ) : (
            <StepReview form={form} onEditStep={goToStep} />
          )}
        </motion.div>

        <GroupEditorFooter
          isWorking={isCreating}
          isFirstStep={activeStep === 0}
          isLastStep={activeStep === LAST_STEP}
          hint={hint}
          onCancel={attemptCancel}
          onBack={() => goToStep(activeStep - 1)}
          onContinue={attemptContinue}
          onCreate={attemptCreate}
        />

        <GroupLeaveConfirmDialog
          open={leavePromptOpen}
          onKeepEditing={() => setLeavePromptOpen(false)}
          onConfirmDiscard={leaveWithoutSaving}
        />
      </div>
    </MotionConfig>
  );
}
