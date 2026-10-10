"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { isStepValid, stepFieldErrors } from "../../create-package/schemas";
import type { PackageFormData } from "../../create-package/types";
import { canOpenPackageEditorStep } from "./decide-package-save-route";
import { PACKAGE_EDITOR_STEPS, preloadPackageEditorStep } from "./package-editor-steps";

/**
 * Which step is open, which steps are valid, and which messages to show.
 *
 * `activeStep` is 0-based to match `PACKAGE_EDITOR_STEPS`; the validation
 * helpers and the server use 1-based step numbers, so we add 1 when calling them.
 */
export function usePackageEditorStepper(formData: PackageFormData) {
  const [activeStep, setActiveStep] = useState(0);
  // The slide direction, decided when the person navigates.
  const [direction, setDirection] = useState(1);
  // Steps already left. Their messages show, so a first visit never opens with a wall of red.
  const [leftSteps, setLeftSteps] = useState<ReadonlySet<number>>(() => new Set());
  // Steps where the person pressed Continue or Publish while they had problems, or that a save error pointed at.
  const [triedSteps, setTriedSteps] = useState<ReadonlySet<number>>(() => new Set());
  // Bumped each time messages are asked for, so the page can scroll to the first one once it has rendered.
  const [revealCount, setRevealCount] = useState(0);

  const goToStep = useCallback(
    (index: number) => {
      setDirection(index >= activeStep ? 1 : -1);
      setLeftSteps((previous) => new Set(previous).add(activeStep));
      setActiveStep(index);
    },
    [activeStep],
  );

  /** Shows the open step's messages now, instead of waiting until it is left. */
  const revealCurrentStepErrors = useCallback(() => {
    setTriedSteps((previous) => new Set(previous).add(activeStep));
    setRevealCount((count) => count + 1);
  }, [activeStep]);

  /** Opens a step by its 1-based number, as the server and the review step report it, with its messages showing. */
  const openStepNumber = useCallback(
    (step: number) => {
      setLeftSteps((previous) => new Set(previous).add(activeStep));
      setTriedSteps((previous) => new Set(previous).add(step - 1));
      setRevealCount((count) => count + 1);
      setActiveStep(step - 1);
    },
    [activeStep],
  );

  // Download the neighbouring steps once the browser is idle.
  useEffect(() => {
    const idleWindow = window as typeof window & {
      requestIdleCallback?: (callback: () => void) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    const schedule = idleWindow.requestIdleCallback ?? ((callback: () => void) => window.setTimeout(callback, 200));
    const cancel = idleWindow.cancelIdleCallback ?? window.clearTimeout;

    const handle = schedule(() => {
      preloadPackageEditorStep(activeStep + 1);
      preloadPackageEditorStep(activeStep - 1);
    });
    return () => cancel(handle as number);
  }, [activeStep]);

  const stepValidity = useMemo(() => {
    const validity: Record<number, boolean> = {};
    for (let step = 1; step <= PACKAGE_EDITOR_STEPS.length; step++) {
      validity[step] = isStepValid(step, formData);
    }
    return validity;
  }, [formData]);

  const isCurrentStepValid = stepValidity[activeStep + 1];

  // The footer always names the first problem; the step itself only shows them once it has been left.
  const currentStepErrors = useMemo(() => stepFieldErrors(activeStep + 1, formData), [activeStep, formData]);
  const firstStepErrorMessage = currentStepErrors ? Object.values(currentStepErrors).flat()[0] : undefined;
  const inlineFieldErrors = leftSteps.has(activeStep) || triedSteps.has(activeStep) ? currentStepErrors : null;

  // The first earlier step that is incomplete, by its 1-based number. The review step uses it to say where to go.
  const firstIncompleteStepNumber = useMemo(() => {
    for (let step = 1; step < PACKAGE_EDITOR_STEPS.length; step++) {
      if (!stepValidity[step]) return step;
    }
    return null;
  }, [stepValidity]);

  /** A step the person has been through (or was pointed at) that still has problems. The review step has no fields. */
  const stepShowsProblem = useCallback(
    (index: number) =>
      index < PACKAGE_EDITOR_STEPS.length - 1 &&
      (leftSteps.has(index) || triedSteps.has(index)) &&
      !stepValidity[index + 1],
    [leftSteps, triedSteps, stepValidity],
  );

  /** Why a locked step is locked: the first earlier step that is not complete, by name. */
  const lockedReasonFor = useCallback(
    (index: number) => {
      for (let earlier = 0; earlier < index; earlier++) {
        if (!stepValidity[earlier + 1]) return `Finish "${PACKAGE_EDITOR_STEPS[earlier].label}" first.`;
      }
      return undefined;
    },
    [stepValidity],
  );

  const canOpenStep = useCallback(
    (targetIndex: number) => canOpenPackageEditorStep({ targetIndex, activeStep, stepValidity }),
    [activeStep, stepValidity],
  );

  return {
    activeStep,
    isLastStep: activeStep === PACKAGE_EDITOR_STEPS.length - 1,
    direction,
    goToStep,
    openStepNumber,
    revealCurrentStepErrors,
    revealCount,
    firstIncompleteStepNumber,
    stepValidity,
    isCurrentStepValid,
    firstStepErrorMessage,
    inlineFieldErrors,
    canOpenStep,
    stepShowsProblem,
    lockedReasonFor,
  };
}
