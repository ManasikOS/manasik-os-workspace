"use client";

import { MotionConfig, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { HorizontalStepper } from "@/components/ui/horizontal-stepper";
import {
  useUnsavedChangesGuard,
  type BlockedNavigation,
} from "@/hooks/use-unsaved-changes-guard";
import { isLeadDuplicateResolved } from "@/lib/data/lead-duplicate-gate";
import type { LeadPackageRow, StaffRow } from "@/lib/types/leads";

import { createLeadAction } from "../../actions";
import { LeadEditorFooter } from "./lead-editor-footer";
import { LEAD_EDITOR_STEPS, LeadEditorStepContent } from "./lead-editor-steps";
import LeadLeaveConfirmDialog from "./lead-leave-confirm-dialog";
import { useLeadDuplicateCheck } from "./use-lead-duplicate-check";
import { useLeadEditorForm } from "./use-lead-editor-form";
import { useLeadEditorStepper } from "./use-lead-editor-stepper";
import { useLeadEditorSubmit } from "./use-lead-editor-submit";
import { validateLeadForm } from "./validate-lead-form";

interface LeadEditorWorkspaceProps {
  currentStaffId: string;
  staffOptions: StaffRow[];
  packages: LeadPackageRow[];
  /** Leave the editor: Cancel with nothing to lose, or Discard. */
  onClose: () => void;
  /** A lead was created and the person is done. Where to go is the page's decision. */
  onCreated: (leadId: string | undefined) => void;
}

/**
 * The Add Lead editor: a horizontal stepper across the top, the open step
 * below it, and the actions pinned to the bottom of the screen, plus the
 * "unsaved changes" prompt.
 *
 * Nothing is saved until the person creates the lead; there are no drafts. The
 * form lives in the browser, and leaving with edits asks first.
 */
export function LeadEditorWorkspace({
  currentStaffId,
  staffOptions,
  packages,
  onClose,
  onCreated,
}: LeadEditorWorkspaceProps) {
  const form = useLeadEditorForm(currentStaffId);
  const { formData } = form;

  const lookup = useLeadDuplicateCheck({
    mobile: formData.mobile,
    email: formData.email,
  });
  const duplicate = lookup.duplicate;

  const errors = useMemo(
    () =>
      validateLeadForm({
        formData,
        hasDuplicate: duplicate !== null,
        pastFollowUp: form.pastFollowUp,
      }),
    [formData, duplicate, form.pastFollowUp],
  );

  const stepper = useLeadEditorStepper({
    formData,
    hasDuplicate: duplicate !== null,
    isCheckingDuplicate: lookup.status === "checking",
    errors,
    isDirty: form.isDirty,
    submitAttempted: form.submitAttempted,
  });

  // Leaving with unsaved edits asks first. `blocked` is where the person was
  // heading (a link, or Back); it is null when they pressed Cancel.
  const [leavePromptOpen, setLeavePromptOpen] = useState(false);
  const [blocked, setBlocked] = useState<BlockedNavigation | null>(null);

  const guard = useUnsavedChangesGuard({
    isDirty: form.isDirty,
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

  const submitting = useLeadEditorSubmit({
    formData,
    errors,
    currentStaffId,
    createLead: createLeadAction,
    checkFollowUpTime: form.checkFollowUpTime,
    markSubmitAttempted: form.markSubmitAttempted,
    onCreated: ({ keepOpen, result }) => {
      if (keepOpen) {
        form.reset(true);
        stepper.reset();
        return;
      }
      onCreated(result.leadId);
    },
  });

  // When the step changes, bring the stepper bar into view and focus the new
  // step's heading. Compared with the previous step rather than "is this the
  // first run", so React Strict Mode's second effect run does not move focus.
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);
  const previousStepRef = useRef(stepper.activeStep);
  useEffect(() => {
    if (previousStepRef.current === stepper.activeStep) return;
    previousStepRef.current = stepper.activeStep;

    const heading = stepHeadingRef.current;
    heading
      ?.closest<HTMLElement>('[data-slot="card"]')
      ?.scrollIntoView({ block: "start" });
    heading?.focus({ preventScroll: true });
  }, [stepper.activeStep]);

  // Continue stays available on an incomplete step: pressing it shows what is
  // missing and takes the person to the first problem, instead of leaving a
  // greyed-out button to puzzle over.
  const stepContentRef = useRef<HTMLDivElement>(null);
  const [revealCount, setRevealCount] = useState(0);
  const attemptContinue = () => {
    if (stepper.canContinue) return stepper.continueToNextStep();
    form.markSubmitAttempted();
    setRevealCount((count) => count + 1);
  };

  // Once the messages have rendered, scroll to the first one and, when it is a
  // field, focus it. Declared after the step-change effect so this wins.
  useEffect(() => {
    if (revealCount === 0) return;
    const firstProblem = stepContentRef.current?.querySelector<HTMLElement>(
      '[aria-invalid="true"], [role="alert"], .text-destructive',
    );
    if (!firstProblem) return;
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    firstProblem.scrollIntoView({
      block: "center",
      behavior: prefersReducedMotion ? "auto" : "smooth",
    });
    if (firstProblem.matches("input, textarea, select, button, [tabindex]")) {
      firstProblem.focus({ preventScroll: true });
    }
  }, [revealCount]);

  const currentStep = LEAD_EDITOR_STEPS[stepper.activeStep];
  const firstError = Object.values(errors)[0];
  const hint = submitting.serverError
    ? { tone: "error" as const, text: submitting.serverError }
    : form.submitAttempted && firstError
      ? { tone: "error" as const, text: firstError }
      : stepper.blockedReason
        ? { tone: "info" as const, text: stepper.blockedReason }
        : null;

  // The duplicate answer is given on step 1, but an email typed on step 2 can
  // also match an existing lead; say so where the person is looking.
  const emailDuplicateNotice =
    duplicate &&
    duplicate.matchedOn === "email" &&
    stepper.stepId !== "duplicate" &&
    !isLeadDuplicateResolved(true, formData)
      ? `This email already belongs to ${duplicate.lead.name} (${duplicate.lead.reference}). Confirm it is a separate person before creating the lead.`
      : null;

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex flex-col gap-4">
        {/* One bar holds the stepper and the open step's title, so the form
            starts as high as it can. */}
        <Card className="scroll-mt-20 gap-4 py-4 w-full">
          <HorizontalStepper
            steps={LEAD_EDITOR_STEPS}
            activeStep={stepper.activeStep}
            onStepSelect={stepper.goToStep}
            getStepState={(index) => ({
              isLocked: stepper.isStepLocked(index),
              lockedReason: stepper.isStepLocked(index)
                ? "Press Continue to reach this step."
                : undefined,
              isCompleted: stepper.stepIsCompleted(
                index,
                LEAD_EDITOR_STEPS[index],
              ),
              hasError:
                index !== stepper.activeStep &&
                stepper.stepHasError(LEAD_EDITOR_STEPS[index]),
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
            <p className="text-sm text-muted-foreground">
              {currentStep.description}
            </p>
          </header>
        </Card>

        {emailDuplicateNotice ? (
          <div
            role="alert"
            className="flex w-full flex-wrap items-center justify-between gap-2 rounded-md border border-border/50 bg-card p-3 text-sm"
          >
            <span>{emailDuplicateNotice}</span>
            <Button
              type="button"
              variant="outline_without_border"
              onClick={() => stepper.goToStep(0)}
            >
              Review duplicate
            </Button>
          </div>
        ) : null}

        <motion.div
          ref={stepContentRef}
          key={stepper.activeStep}
          initial={{ opacity: 0, x: stepper.direction >= 0 ? 16 : -16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          className="w-full"
        >
          {/* The review step is already made of cards; wrapping it would nest them. */}
          {stepper.stepId === "review" ? (
            <LeadEditorStepContent
              stepId={stepper.stepId}
              form={form}
              duplicate={duplicate}
              duplicateCheckStatus={lookup.status}
              visibleErrors={stepper.visibleErrors}
              packages={packages}
              staffOptions={staffOptions}
            />
          ) : (
            <Card className="w-full">
              <LeadEditorStepContent
                stepId={stepper.stepId}
                form={form}
                duplicate={duplicate}
                duplicateCheckStatus={lookup.status}
                visibleErrors={stepper.visibleErrors}
                packages={packages}
                staffOptions={staffOptions}
              />
            </Card>
          )}
        </motion.div>

        <LeadEditorFooter
          isWorking={submitting.submitting}
          isFirstStep={stepper.activeStep === 0}
          isLastStep={stepper.isLastStep}
          hint={hint}
          onCancel={attemptCancel}
          onBack={stepper.goBack}
          onContinue={attemptContinue}
          onCreate={() => submitting.submit(false)}
          onCreateAndAddAnother={() => submitting.submit(true)}
        />

        <LeadLeaveConfirmDialog
          open={leavePromptOpen}
          onKeepEditing={() => setLeavePromptOpen(false)}
          onConfirmDiscard={leaveWithoutSaving}
        />
      </div>
    </MotionConfig>
  );
}
