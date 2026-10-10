"use client";

import { AlertCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { TONE_TEXT } from "@/lib/ui/tone";
import { cn } from "@/lib/utils";

interface PackageEditorFooterProps {
  isLive: boolean;
  isDirty: boolean;
  /** The package already has a row in the database. */
  hasSavedPackage: boolean;
  isWorking: boolean;
  isFirstStep: boolean;
  isLastStep: boolean;
  /** The open step is complete, so Continue and Publish may be used. */
  isStepValid: boolean;
  /** The first message about the open step, shown while it is incomplete. */
  stepProblem: string | undefined;
  onCancel: () => void;
  onBack: () => void;
  onContinue: () => void;
  onSave: () => void;
  onPublish: () => void;
}

/** The editor's actions, kept in view at the bottom of the screen. */
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

  return (
    <div
      className={cn(
        "sticky bottom-4 z-20 flex flex-wrap items-center justify-between gap-3 rounded-md",
        "border border-border/50 bg-card/90 px-4 py-3 shadow-sm backdrop-blur-md",
      )}
    >
      <div className="flex min-w-0 items-center gap-4">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <p role="status" className={cn("text-xs font-medium", isDirty ? TONE_TEXT.warning : "text-muted-foreground")}>
          {saveStatus}
        </p>
      </div>

      <div className="flex min-w-0 flex-wrap items-center justify-end gap-3">
        {!isStepValid ? (
          <span role="status" className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-destructive">
            <AlertCircle className="size-3.5 shrink-0" aria-hidden />
            <span className="line-clamp-2">{stepProblem ?? "Complete the required fields to continue"}</span>
          </span>
        ) : null}

        {!isFirstStep ? (
          <Button type="button" variant="ghost" onClick={onBack}>
            Back
          </Button>
        ) : null}

        {isLive && isLastStep ? null : (
          <Button type="button" variant="outline_without_border" disabled={isWorking || !isDirty} onClick={onSave}>
            {isWorking ? "Saving…" : saveLabel}
          </Button>
        )}

        {!isLastStep ? (
          <Button type="button" disabled={!isStepValid} onClick={onContinue}>
            Continue
          </Button>
        ) : isLive ? (
          <Button type="button" disabled={isWorking || !isDirty} onClick={onSave}>
            {isWorking ? "Saving…" : "Save changes"}
          </Button>
        ) : (
          <Button type="button" disabled={isWorking || !isStepValid} onClick={onPublish}>
            {isWorking ? "Publishing…" : "Publish package"}
          </Button>
        )}
      </div>
    </div>
  );
}
