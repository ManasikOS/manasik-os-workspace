"use client";

import { AlertCircle, CheckCircle2, Lock } from "lucide-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface HorizontalStepperStep {
  id: string;
  label: string;
}

export interface HorizontalStepperStepState {
  /** The step cannot be opened yet (shows a lock, not clickable). */
  isLocked: boolean;
  /** Why the step is locked, shown in a tooltip on hover or focus. */
  lockedReason?: string;
  /** The step was finished and has no problems. */
  isCompleted: boolean;
  /** The step has a problem the person must fix. */
  hasError?: boolean;
}

interface HorizontalStepperProps {
  steps: HorizontalStepperStep[];
  /** 0-based index of the open step. */
  activeStep: number;
  getStepState: (index: number) => HorizontalStepperStepState;
  onStepSelect: (index: number) => void;
  className?: string;
}

/**
 * A row of numbered steps joined by lines, with the open step highlighted.
 * Finished steps show a check, locked ones a lock.
 *
 * What it shows depends on the width of the space it is placed in (a container
 * query), not the screen: the app sidebar takes room, so a 1024 px screen can
 * leave less width than a phone-sized layout would suggest. Below 48rem it
 * becomes "Step 2 of 7 — Name" above a segmented bar whose segments are buttons.
 */
export function HorizontalStepper({
  steps,
  activeStep,
  getStepState,
  onStepSelect,
  className,
}: HorizontalStepperProps) {
  const current = steps[activeStep];

  return (
    <nav aria-label="Progress" className={cn("@container", className)}>
      {/* Narrow space: a title and a segmented bar. */}
      <div className="flex flex-col gap-2 @3xl:hidden">
        <div className="flex items-baseline justify-between gap-3">
          <p className="min-w-0 truncate text-sm font-medium">
            <span className="text-muted-foreground">
              Step {activeStep + 1} of {steps.length} —{" "}
            </span>
            {current?.label}
          </p>
          <span className="shrink-0 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
            {activeStep + 1}/{steps.length}
          </span>
        </div>
        <ol className="flex items-center gap-1.5">
          {steps.map((step, index) => {
            const { isLocked, hasError = false } = getStepState(index);
            return (
              <li
                key={step.id}
                className={cn("transition-all duration-300", index === activeStep ? "flex-3" : "flex-1")}
              >
                <button
                  type="button"
                  disabled={isLocked}
                  onClick={() => onStepSelect(index)}
                  aria-label={`Step ${index + 1}: ${step.label}${isLocked ? " (locked)" : ""}${hasError ? " (has problems)" : ""}`}
                  aria-current={index === activeStep ? "step" : undefined}
                  // A tall touch target around a thin bar.
                  className="group flex h-6 w-full items-center outline-none disabled:cursor-not-allowed"
                >
                  <span
                    className={cn(
                      "h-1 w-full rounded-full transition-colors group-focus-visible:ring-2 group-focus-visible:ring-primary/40",
                      hasError
                        ? "bg-destructive/70"
                        : index === activeStep
                          ? "bg-primary"
                          : index < activeStep
                            ? "bg-primary/40"
                            : "bg-muted-foreground/20",
                    )}
                  />
                </button>
              </li>
            );
          })}
        </ol>
      </div>

      {/* Wide space: every step, joined by lines. */}
      <ol className="hidden items-start @3xl:flex">
        {steps.map((step, index) => (
          <HorizontalStepperItem
            key={step.id}
            step={step}
            index={index}
            isActive={index === activeStep}
            isLast={index === steps.length - 1}
            isBeforeActive={index < activeStep}
            state={getStepState(index)}
            onSelect={() => onStepSelect(index)}
          />
        ))}
      </ol>
    </nav>
  );
}

interface HorizontalStepperItemProps {
  step: HorizontalStepperStep;
  index: number;
  isActive: boolean;
  isLast: boolean;
  isBeforeActive: boolean;
  state: HorizontalStepperStepState;
  onSelect: () => void;
}

function HorizontalStepperItem({
  step,
  index,
  isActive,
  isLast,
  isBeforeActive,
  state,
  onSelect,
}: HorizontalStepperItemProps) {
  const { isLocked, isCompleted, hasError = false, lockedReason } = state;

  const stepButton = (
    <button
      type="button"
      onClick={isLocked ? undefined : onSelect}
      disabled={isLocked}
      aria-current={isActive ? "step" : undefined}
      className={cn(
        "group flex w-full flex-col items-center gap-2 rounded-sm px-1 py-1 text-center outline-none",
        "focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-100",
        isLocked && "pointer-events-none opacity-50",
      )}
    >
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums transition-colors",
          isActive
            ? "bg-primary text-primary-foreground ring-4 ring-primary/15"
            : hasError
              ? "bg-destructive/15 text-destructive"
              : isCompleted
                ? "bg-primary/15 text-primary"
                : "bg-muted text-muted-foreground",
        )}
      >
        {isLocked ? (
          <Lock className="size-3.5" aria-hidden />
        ) : hasError ? (
          <AlertCircle className="size-4" aria-hidden />
        ) : isCompleted && !isActive ? (
          <CheckCircle2 className="size-4" aria-hidden />
        ) : (
          index + 1
        )}
      </span>
      <span
        className={cn(
          "text-xs font-medium leading-tight text-balance transition-colors",
          isActive
            ? "text-primary"
            : hasError
              ? "text-destructive"
              : "text-muted-foreground group-hover:text-foreground",
        )}
      >
        {step.label}
      </span>
      {isCompleted && !isActive ? <span className="sr-only">completed</span> : null}
      {isLocked ? <span className="sr-only">locked</span> : null}
    </button>
  );

  return (
    <li className={cn("flex min-w-0 items-start", isLast ? "flex-none" : "flex-1")}>
      <div className="w-24 shrink-0 @5xl:w-28">
        {isLocked && lockedReason ? (
          <Tooltip>
            <TooltipTrigger render={<span className="block cursor-not-allowed" tabIndex={0} />}>
              {stepButton}
            </TooltipTrigger>
            <TooltipContent side="bottom">{lockedReason}</TooltipContent>
          </Tooltip>
        ) : (
          stepButton
        )}
      </div>
      {!isLast ? (
        <div
          aria-hidden
          className={cn(
            "mt-4 h-px min-w-3 flex-1 transition-colors",
            isBeforeActive || isCompleted ? "bg-primary/40" : "bg-border",
          )}
        />
      ) : null}
    </li>
  );
}
