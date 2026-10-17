"use client";

import { AlertCircle, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface GroupEditorFooterProps {
  isWorking: boolean;
  isFirstStep: boolean;
  isLastStep: boolean;
  /** One line about the open step or a failed create; null when there is nothing to say. */
  hint: { tone: "error" | "info"; text: string } | null;
  onCancel: () => void;
  onBack: () => void;
  onContinue: () => void;
  onCreate: () => void;
}

const HINT_ID = "group-editor-hint";

/**
 * The editor's actions, kept in view at the bottom of the screen.
 *
 * One row on wide screens: Cancel, the hint, then Back and the main action. On
 * a phone: the hint, then the main action (full width), then Cancel. The same
 * elements are re-ordered with CSS, not duplicated.
 */
export function GroupEditorFooter({
  isWorking,
  isFirstStep,
  isLastStep,
  hint,
  onCancel,
  onBack,
  onContinue,
  onCreate,
}: GroupEditorFooterProps) {
  return (
    <div
      className={cn(
        "sticky bottom-2 z-20 flex flex-col gap-2 rounded-md px-3 py-3 sm:bottom-4",
        "border border-border/50 bg-card/90 shadow-sm backdrop-blur-md",
        "sm:flex-row sm:items-center sm:gap-3 sm:px-4",
      )}
    >
      {hint ? (
        <p
          id={HINT_ID}
          role={hint.tone === "error" ? "alert" : "status"}
          className={cn(
            "order-1 flex min-w-0 items-center gap-1.5 text-xs font-medium sm:order-2 sm:flex-1",
            hint.tone === "error" ? "text-destructive" : "text-muted-foreground",
          )}
        >
          <AlertCircle className="size-3.5 shrink-0" aria-hidden />
          <span className="line-clamp-2">{hint.text}</span>
        </p>
      ) : (
        <span className="hidden sm:order-2 sm:block sm:flex-1" />
      )}

      <div className="order-2 flex items-center gap-2 sm:order-3">
        {!isFirstStep ? (
          <Button type="button" variant="ghost" onClick={onBack} disabled={isWorking}>
            Back
          </Button>
        ) : null}

        {!isLastStep ? (
          <Button
            type="button"
            onClick={onContinue}
            aria-describedby={hint ? HINT_ID : undefined}
            className="flex-1 sm:flex-none"
          >
            Continue
          </Button>
        ) : (
          <Button
            type="button"
            disabled={isWorking}
            onClick={onCreate}
            aria-describedby={hint ? HINT_ID : undefined}
            className="flex-1 sm:flex-none"
          >
            {isWorking ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {isWorking ? "Creating…" : "Create departure group"}
          </Button>
        )}
      </div>

      <Button
        type="button"
        variant="ghost"
        onClick={onCancel}
        className="order-3 self-start sm:order-1 sm:self-auto"
      >
        Cancel
      </Button>
    </div>
  );
}
