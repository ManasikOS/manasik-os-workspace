"use client";

import { useCallback, useMemo, useState } from "react";

import type { AddLeadFormData } from "../../types";

import { decideLeadStepGate } from "./decide-lead-step-gate";
import { LEAD_EDITOR_STEPS, type LeadEditorStep } from "./lead-editor-steps";

interface UseLeadEditorStepperParams {
  formData: AddLeadFormData;
  hasDuplicate: boolean;
  isCheckingDuplicate?: boolean;
  /** Result of `validateLeadForm`. */
  errors: Record<string, string>;
  isDirty: boolean;
  submitAttempted: boolean;
}

/**
 * Which step is open, which are reachable, and what each shows.
 *
 * Later steps stay locked until the person has pressed Continue to reach them.
 * `activeStep` is 0-based, matching `LEAD_EDITOR_STEPS`.
 */
export function useLeadEditorStepper({
  formData,
  hasDuplicate,
  isCheckingDuplicate,
  errors,
  isDirty,
  submitAttempted,
}: UseLeadEditorStepperParams) {
  const [activeStep, setActiveStep] = useState(0);
  // The furthest step reached by Continue. Steps past it are locked.
  const [highestReachedStep, setHighestReachedStep] = useState(0);
  // Which way the step transition animates. Decided in the event handler, not
  // derived from a ref during render.
  const [direction, setDirection] = useState(1);

  const goToStep = useCallback(
    (index: number) => {
      setDirection(index >= activeStep ? 1 : -1);
      setActiveStep(index);
    },
    [activeStep],
  );

  const continueToNextStep = useCallback(() => {
    setHighestReachedStep((previous) => Math.max(previous, activeStep + 1));
    goToStep(activeStep + 1);
  }, [activeStep, goToStep]);

  const goBack = useCallback(
    () => goToStep(activeStep - 1),
    [activeStep, goToStep],
  );

  const reset = useCallback(() => {
    setDirection(1);
    setActiveStep(0);
    setHighestReachedStep(0);
  }, []);

  // Messages show once the person has tried to create, or has edited something.
  const visibleErrors = useMemo(
    () => (submitAttempted || isDirty ? errors : {}),
    [submitAttempted, isDirty, errors],
  );

  const stepHasError = useCallback(
    (step: LeadEditorStep) =>
      step.errorKeys.some((key) => Boolean(visibleErrors[key])),
    [visibleErrors],
  );

  // "Completed" uses submitAttempted as the signal: once they have tried,
  // every error-free step they have moved past lights up.
  const stepIsCompleted = useCallback(
    (index: number, step: LeadEditorStep) =>
      submitAttempted && index < activeStep && !stepHasError(step),
    [submitAttempted, activeStep, stepHasError],
  );

  const stepId = LEAD_EDITOR_STEPS[activeStep].id;
  const gate = useMemo(
    () =>
      decideLeadStepGate({
        stepId,
        formData,
        hasDuplicate,
        isCheckingDuplicate,
        errors,
      }),
    [stepId, formData, hasDuplicate, isCheckingDuplicate, errors],
  );

  return {
    activeStep,
    stepId,
    direction,
    isLastStep: activeStep === LEAD_EDITOR_STEPS.length - 1,
    isStepLocked: (index: number) => index > highestReachedStep,
    goToStep,
    goBack,
    continueToNextStep,
    reset,
    visibleErrors,
    stepHasError,
    stepIsCompleted,
    canContinue: gate.canContinue,
    blockedReason: gate.reason,
  };
}
