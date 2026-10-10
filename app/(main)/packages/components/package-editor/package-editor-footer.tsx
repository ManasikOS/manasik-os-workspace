"use client";

import { AlertCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { TONE_TEXT } from "@/lib/ui/tone";
import { cn } from "@/lib/utils";

const STEP_PROBLEM_ID = "package-editor-step-problem";

interface PackageEditorFooterProps {
  isLive: boolean;
  isDirty: boolean;
  /** The package already has a row in the database. */
  hasSavedPackage: boolean;
  isWorking: boolean;
  isFirstStep: boolean;
  isLastStep: boolean;
  /** The open step is complete. When it is not, Continue and Publish still work: they show what is missing. */
  isStepValid: boolean;
  /** The first message about the open step, shown while it is incomplete. */
  stepProblem: string | undefined;
  onCancel: () => void;
  onBack: () => void;
  onContinue: () => void;
  onSave: () => void;
  onPublish: () => void;
}

/**
 * The editor's actions, kept in view at the bottom of the screen.
 *
 * One row on wide screens: Cancel and the save status on the left, the problem
 * note and the step buttons on the right. On a phone it is three short rows in
 * the order they are used: the problem note, then Back and the main action
 * (full width, easy to reach), then Cancel, the save status and Save draft.
 * The same elements are re-ordered with CSS, not duplicated.
 */
export function PackageEditorFooter({
  isLive,
  isDirty,
  hasSavedPackage,
  isWorking,
  isFirstStep,
  isLastStep,
  isStepValid,
  stepProblem,
  onCancel,
  onBack,
  onContinue,
  onSave,
  onPublish,
}: PackageEditorFooterProps) {
  const saveStatus = isDirty
    ? hasSavedPackage
      ? "Unsaved changes"
      : "Not saved yet"
    : hasSavedPackage
      ? "All changes saved"
      : "";
  const saveLabel = isLive ? "Save changes" : "Save draft";
  const describedBy = isStepValid ? undefined : STEP_PROBLEM_ID;

  return (
    <div
      className={cn(
        "sticky bottom-2 z-20 flex flex-col gap-2 rounded-md px-3 py-3 sm:bottom-4",
        "border border-border/50 bg-card/90 shadow-sm backdrop-blur-md",
        "sm:flex-row sm:flex-wrap sm:items-center sm:gap-3 sm:px-4",
      )}
    >
      {!isStepValid ? (
        <span
          id={STEP_PROBLEM_ID}
          role="status"
          className="order-1 flex min-w-0 items-center gap-1.5 text-xs font-medium text-destructive sm:order-3 sm:ml-auto"
        >
          <AlertCircle className="size-3.5 shrink-0" aria-hidden />
          <span className="line-clamp-1 sm:line-clamp-2">
            {stepProblem ?? "Complete the required fields to continue"}
          </span>
        </span>
      ) : null}

      {/* Phone: Back and the main action. Wide screens: the children join the bar directly (`contents`). */}
      <div className="order-2 flex items-center gap-2 sm:contents">
        {!isFirstStep ? (
          <Button type="button" variant="ghost" onClick={onBack} className="sm:order-4">
            Back
          </Button>
        ) : null}

        {!isLastStep ? (
          <Button
            type="button"
            onClick={onContinue}
            aria-describedby={describedBy}
            className="flex-1 sm:order-6 sm:flex-none"
          >
            Continue
          </Button>
        ) : isLive ? (
          <Button
            type="button"
            disabled={isWorking || !isDirty}
            onClick={onSave}
            className="flex-1 sm:order-6 sm:flex-none"
          >
            {isWorking ? "Saving…" : "Save changes"}
          </Button>
        ) : (
          <Button
            type="button"
            disabled={isWorking}
            onClick={onPublish}
            aria-describedby={describedBy}
            className="flex-1 sm:order-6 sm:flex-none"
          >
            {isWorking ? "Publishing…" : "Publish package"}
          </Button>
        )}
      </div>

      {/* Phone: Cancel, the save status and Save draft. Wide screens: they join the bar directly. */}
      <div className="order-3 flex items-center justify-between gap-2 sm:contents">
        <Button type="button" variant="ghost" onClick={onCancel} className="sm:order-1">
          Cancel
        </Button>
        <p
          role="status"
          className={cn(
            "min-w-0 flex-1 truncate text-center text-xs font-medium sm:order-2 sm:flex-none sm:text-left",
            isDirty ? TONE_TEXT.warning : "text-muted-foreground",
          )}
        >
          {saveStatus}
        </p>
        {isLive && isLastStep ? null : (
          <Button
            type="button"
            variant="outline_without_border"
            disabled={isWorking || !isDirty}
            onClick={onSave}
            className="sm:order-5"
          >
            {isWorking ? "Saving…" : saveLabel}
          </Button>
        )}
      </div>
    </div>
  );
}
