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
 * helpers are 1-based, so we add 1 wherever they are called.
 */
export function usePackageEditorSteps(formData: PackageFormData) {
  const [activeStep, setActiveStep] = useState(0);
  // The panel slide direction, decided when the person navigates (not derived from a ref read during render).
  const [direction, setDirection] = useState(1);
  // Steps already left. Inline field errors only appear on these, so a first visit never opens with a wall of red.
  const [leftSteps, setLeftSteps] = useState<ReadonlySet<number>>(() => new Set());

  const goToStep = useCallback(
    (index: number) => {
      setDirection(index >= activeStep ? 1 : -1);
      setLeftSteps((previous) => new Set(previous).add(activeStep));
      setActiveStep(index);
    },
    [activeStep],
  );

  /** Opens a step by its 1-based number, as the server and the review step report it. */
  const openStepNumber = useCallback((step: number) => setActiveStep(step - 1), []);

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

  // The footer always names the first problem; the step itself only shows them once it has been visited and left.
  const currentStepErrors = useMemo(() => stepFieldErrors(activeStep + 1, formData), [activeStep, formData]);
  const firstStepErrorMessage = currentStepErrors ? Object.values(currentStepErrors).flat()[0] : undefined;
  const inlineFieldErrors = leftSteps.has(activeStep) ? currentStepErrors : null;

  const canOpenStep = useCallback(
    (targetIndex: number) => canOpenPackageEditorStep({ targetIndex, activeStep, stepValidity }),
    [activeStep, stepValidity],
  );

  return {
    activeStep,
    direction,
    goToStep,
    openStepNumber,
    stepValidity,
    isCurrentStepValid,
    firstStepErrorMessage,
    inlineFieldErrors,
    canOpenStep,
  };
}
