"use client";

import { MotionConfig, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";

import { Card } from "@/components/ui/card";
import { HorizontalStepper } from "@/components/ui/horizontal-stepper";

import type { PackageFormData } from "../../create-package/types";
import PackageChangeReviewSheet from "../package-change-review-sheet";
import { PackageEditorFooter } from "./package-editor-footer";
import { PackageEditorNotices, type PendingChangeSummary } from "./package-editor-notices";
import { PACKAGE_EDITOR_STEPS, PackageEditorStepContent } from "./package-editor-steps";
import { PackageLeaveConfirmDialog } from "./package-leave-confirm-dialog";
import { usePackageEditorForm } from "./use-package-editor-form";
import { usePackageEditorSave } from "./use-package-editor-save";
import { usePackageEditorStepper } from "./use-package-editor-stepper";
import { useUnsavedChangesGuard, type BlockedNavigation } from "./use-unsaved-changes-guard";

export interface PackageEditorWorkspaceProps {
  mode: "create" | "edit";
  initialPackageId: string | null;
  initialFormData: PackageFormData;
  initialUpdatedAt: string | null;
  initialStatus: string;
  initialLiveGroupCount: number;
  initialPendingChange: PendingChangeSummary | null;
  canEditSensitiveTerms: boolean;
  /** Leave the editor: Cancel with nothing to lose, Discard, or after a save from the prompt. */
  onClose: () => void;
  /** A draft was saved and the person stays on the form. */
  onDraftSaved: (input: { packageId: string; isFirstSave: boolean }) => void;
  /** The package was published. */
  onPublished: (packageId: string) => void;
}

/**
 * The package editor: a horizontal stepper across the top, the open step at
 * full width below it, and the actions pinned to the bottom of the screen —
 * plus the change review sheet and the "unsaved changes" prompt. The editor
 * page decides what "leaving" means through `onClose`.
 *
 * Nothing here saves on its own (TASK-043). The form lives in the browser until
 * the person presses Save draft, Save changes or Publish. A package that is
 * already on sale is saved through the review sheet when the change touches
 * payment, contract or booking terms.
 */
export function PackageEditorWorkspace({
  mode,
  initialPackageId,
  initialFormData,
  initialUpdatedAt,
  initialStatus,
  initialLiveGroupCount,
  initialPendingChange,
  canEditSensitiveTerms,
  onClose,
  onDraftSaved,
  onPublished,
}: PackageEditorWorkspaceProps) {
  const isLive = initialStatus === "Open for Sale" || initialStatus === "Sales Closed";

  const form = usePackageEditorForm(initialFormData);
  const steps = usePackageEditorStepper(form.formData);
  const saving = usePackageEditorSave({
    initialPackageId,
    initialUpdatedAt,
    isLive,
    formData: form.formData,
    sensitiveChangeCount: form.sensitiveChanges.length,
    onSaved: form.markSaved,
    onOpenStepNumber: steps.openStepNumber,
    onClose,
    onDraftSaved,
    onPublished,
  });

  // Leaving with unsaved edits asks first. `blocked` is where the person was heading
  // (a link, or Back); it is null when they pressed Cancel.
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

  const saveThenLeave = () => {
    const heading = blocked;
    saving.saveAndLeave(
      () => setLeavePromptOpen(false),
      heading ? () => guard.leave(heading) : onClose,
    );
  };

  // When the step changes, show the stepper bar at the top of the screen and focus the new step's heading.
  // Compared with the previous step rather than "is this the first run", so React Strict Mode's second
  // effect run on load does not move focus.
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);
  const previousStepRef = useRef(steps.activeStep);
  useEffect(() => {
    if (previousStepRef.current === steps.activeStep) return;
    previousStepRef.current = steps.activeStep;

    const heading = stepHeadingRef.current;
    const stepperBar = heading?.closest<HTMLElement>('[data-slot="card"]');
    stepperBar?.scrollIntoView({ block: "start" });
    heading?.focus({ preventScroll: true });
  }, [steps.activeStep]);

  // Continue and Publish stay available on an incomplete step: pressing them shows what is missing and takes the
  // person to the first problem, instead of leaving a greyed-out button to puzzle over.
  const stepContentRef = useRef<HTMLDivElement>(null);
  const attemptContinue = () => {
    if (steps.isCurrentStepValid) return steps.goToStep(steps.activeStep + 1);
    steps.revealCurrentStepErrors();
  };
  const attemptPublish = () => {
    if (steps.isCurrentStepValid) return saving.publish();
    // On the review step the problem is on an earlier step, so go there.
    if (steps.firstIncompleteStepNumber !== null) return steps.openStepNumber(steps.firstIncompleteStepNumber);
    steps.revealCurrentStepErrors();
  };

  // Once the messages have rendered, scroll to the first one and, when it is a field, focus it.
  // Declared after the step-change effect above so this wins when both run.
  useEffect(() => {
    if (steps.revealCount === 0) return;
    const firstProblem = stepContentRef.current?.querySelector<HTMLElement>(
      '[aria-invalid="true"], [role="alert"], .text-destructive',
    );
    if (!firstProblem) return;
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    firstProblem.scrollIntoView({ block: "center", behavior: prefersReducedMotion ? "auto" : "smooth" });
    if (firstProblem.matches("input, textarea, select, button, [tabindex]")) {
      firstProblem.focus({ preventScroll: true });
    }
  }, [steps.revealCount]);

  const currentStep = PACKAGE_EDITOR_STEPS[steps.activeStep];

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col overflow-hidden rounded-md empty:hidden">
          <PackageEditorNotices
            mode={mode}
            isLive={isLive}
            canEditSensitiveTerms={canEditSensitiveTerms}
            liveGroupCount={initialLiveGroupCount}
            pendingChange={initialPendingChange}
          />
        </div>

        {/* One bar holds the stepper and the open step's title, so the form starts as high as it can.
            The step's content sits directly on the page below it: each step already builds its content
            out of cards, so wrapping it in another one would nest them. */}
        <Card className="scroll-mt-20 gap-4 py-4">
          <HorizontalStepper
            steps={PACKAGE_EDITOR_STEPS}
            activeStep={steps.activeStep}
            onStepSelect={steps.goToStep}
            getStepState={(index) => ({
              isLocked: !steps.canOpenStep(index),
              lockedReason: steps.lockedReasonFor(index),
              isCompleted: index < steps.activeStep && steps.stepValidity[index + 1],
              // The open step shows its problems in the footer and on its fields.
              hasError: index !== steps.activeStep && steps.stepShowsProblem(index),
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
          key={steps.activeStep}
          initial={{ opacity: 0, x: steps.direction >= 0 ? 16 : -16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          className="flex flex-col gap-4"
        >
          <PackageEditorStepContent
            stepIndex={steps.activeStep}
            formData={form.formData}
            setFormData={form.setFormData}
            packageId={saving.packageId}
            fieldErrors={steps.inlineFieldErrors}
            onGoToStep={steps.openStepNumber}
          />
        </motion.div>

        <PackageEditorFooter
          isLive={isLive}
          isDirty={form.isDirty}
          hasSavedPackage={saving.packageId !== null}
          isWorking={saving.isWorking}
          isFirstStep={steps.activeStep === 0}
          isLastStep={steps.isLastStep}
          isStepValid={steps.isCurrentStepValid}
          stepProblem={steps.firstStepErrorMessage}
          onCancel={attemptCancel}
          onBack={() => steps.goToStep(steps.activeStep - 1)}
          onContinue={attemptContinue}
          onSave={saving.save}
          onPublish={attemptPublish}
        />

        <PackageChangeReviewSheet
          open={saving.review.open}
          packageTitle={form.formData.title}
          changes={form.changes}
          policy={saving.review.policy}
          canEditSensitiveTerms={canEditSensitiveTerms}
          pendingChangeExists={saving.review.pendingConflict || initialPendingChange !== null}
          isSaving={saving.isWorking}
          onCancel={saving.review.close}
          onConfirm={saving.review.confirm}
        />

        <PackageLeaveConfirmDialog
          open={leavePromptOpen}
          isLive={isLive}
          isWorking={saving.isWorking}
          onKeepEditing={() => setLeavePromptOpen(false)}
          onDiscard={leaveWithoutSaving}
          onSaveAndLeave={saveThenLeave}
        />
      </div>
    </MotionConfig>
  );
}
