"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "motion/react";
import { AlertCircle, CheckCircle2, ChevronRight, Lock } from "lucide-react";
import type { ReactNode } from "react";

export interface SidebarStepperStep {
  id: string;
  label: string;
  description: string;
}

export interface SidebarStepperStepState {
  /** The step cannot be opened yet (shows a lock, not clickable). */
  isLocked: boolean;
  /** The step was finished and has no problems. */
  isCompleted: boolean;
  /** The step has a problem the user must fix (shows a warning icon). */
  hasError?: boolean;
}

export interface SidebarStepperDialogBodyProps {
  /** Heading shown in the sidebar (desktop) and the top strip (mobile). */
  title: string;
  /** Short helper text shown under the title in the sidebar. */
  subtitle: string;
  steps: SidebarStepperStep[];
  activeStep: number;
  /** `1` slides forward, `-1` slides back. Decided when the user navigates. */
  direction: number;
  onStepSelect: (index: number) => void;
  getStepState: (index: number) => SidebarStepperStepState;

  /** Content of the active step. */
  children: ReactNode;
  /** Optional banner shown above the step panel (for example a warning). */
  panelBanner?: ReactNode;
  /** Optional content pinned to the bottom of the sidebar. */
  sidebarFooter?: ReactNode;

  onCancel: () => void;
  onBack: () => void;
  onContinue: () => void;
  /** Whether the Continue button is enabled on the active step. */
  canContinue: boolean;
  /** Button(s) shown instead of Continue on the last step. */
  lastStepAction: ReactNode;
  /** Optional hint shown next to the buttons, such as a validation message. */
  footerHint?: ReactNode;
}

const stepPanelSlideVariants = {
  enter: (dir: number) => ({
    x: dir >= 0 ? "3%" : "-3%",
    opacity: 0,
  }),
  center: {
    x: "0%",
    opacity: 1,
  },
  exit: (dir: number) => ({
    x: dir >= 0 ? "-3%" : "3%",
    opacity: 0,
  }),
};

interface SidebarStepperNavItemProps {
  step: SidebarStepperStep;
  index: number;
  activeStep: number;
  state: SidebarStepperStepState;
  onSelect: () => void;
}

function SidebarStepperNavItem({
  step,
  index,
  activeStep,
  state,
  onSelect,
}: SidebarStepperNavItemProps) {
  const { isLocked, isCompleted, hasError = false } = state;
  const isActive = index === activeStep;

  return (
    <button
      type="button"
      onClick={isLocked ? undefined : onSelect}
      disabled={isLocked}
      aria-disabled={isLocked}
      aria-current={isActive ? "step" : undefined}
      className={cn(
        "group relative w-full flex items-center gap-3 rounded-sm px-3 py-2.5 text-left transition-all duration-150 outline-none",
        "focus-visible:ring-2 disabled:opacity-100 focus-visible:ring-primary/40",
        isLocked
          ? "cursor-not-allowed opacity-40"
          : isActive
            ? "bg-primary/6 text-primary"
            : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
      )}
    >
      <div
        className={cn(
          "relative flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-all duration-200",
          isLocked
            ? "bg-muted text-muted-foreground/50"
            : isActive
              ? "bg-primary text-primary-foreground shadow-sm shadow-primary/30 ring-4 ring-primary/15"
              : isCompleted
                ? "bg-primary/20 text-primary"
                : hasError
                  ? "bg-destructive/15 text-destructive"
                  : "bg-muted text-muted-foreground",
        )}
      >
        {isLocked ? (
          <Lock className="size-3" />
        ) : isCompleted && !hasError ? (
          <CheckCircle2 className="size-3.5" />
        ) : hasError ? (
          <AlertCircle className="size-3.5" />
        ) : (
          <span>{index + 1}</span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "text-sm font-medium leading-none truncate transition-colors",
            isLocked
              ? "text-muted-foreground/40"
              : isActive
                ? "text-primary"
                : hasError
                  ? "text-destructive"
                  : isCompleted
                    ? "text-foreground"
                    : "text-muted-foreground group-hover:text-foreground",
          )}
        >
          {step.label}
        </p>
        <p
          className={cn(
            "mt-0.5 text-[11px] leading-tight truncate transition-colors",
            isActive ? "text-primary/70" : "text-muted-foreground/60",
          )}
        >
          {step.description}
        </p>
      </div>

      {isActive && !isLocked && (
        <ChevronRight className="size-3.5 shrink-0 text-primary opacity-70" />
      )}
    </button>
  );
}

/**
 * The inside of a full-screen "stepper" dialog: a mobile progress strip, a
 * desktop sidebar listing every step, an animated step panel and a footer with
 * Cancel / Back / Continue. It renders no `Dialog` itself — place it inside a
 * `DialogContent` so each dialog keeps control of its own size and title.
 */
export function SidebarStepperDialogBody({
  title,
  subtitle,
  steps,
  activeStep,
  direction,
  onStepSelect,
  getStepState,
  children,
  panelBanner,
  sidebarFooter,
  onCancel,
  onBack,
  onContinue,
  canContinue,
  lastStepAction,
  footerHint,
}: SidebarStepperDialogBodyProps) {
  const currentStep = steps[activeStep];
  const isLastStep = activeStep === steps.length - 1;

  return (
    <>
      {/* Mobile header + progress strip (hidden on md+) */}
      <div className="md:hidden flex flex-col bg-muted/30">
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <div>
            <h2 className="font-heading text-base font-semibold leading-tight">
              {title}
            </h2>
            <p className="text-[11px] text-muted-foreground">
              Step {activeStep + 1} of {steps.length} — {currentStep.label}
            </p>
          </div>
          <span className="text-xs font-medium text-muted-foreground tabular-nums bg-muted rounded-full px-2.5 py-0.5">
            {activeStep + 1}/{steps.length}
          </span>
        </div>

        <div className="flex items-center gap-1.5 px-4 pb-3">
          {steps.map((step, index) => (
            <div
              key={step.id}
              className={cn(
                "h-1 rounded-full transition-all duration-300",
                index === activeStep
                  ? "bg-primary flex-3"
                  : index < activeStep
                    ? "bg-primary/40 flex-1"
                    : "bg-muted-foreground/20 flex-1",
              )}
            />
          ))}
        </div>
      </div>

      {/* Sidebar (md+) + step panel */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <aside className="hidden md:flex w-44 lg:w-70 shrink-0 flex-col gap-0.5 border-r border-border/50 bg-muted/30 px-2 lg:px-3 py-4">
          <div className="mb-5 px-1">
            <h2 className="font-heading text-base lg:text-xl font-semibold leading-tight tracking-tight">
              {title}
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground leading-snug">
              {subtitle}
            </p>
          </div>

          <nav aria-label="Form sections" className="flex flex-col gap-0.5">
            {steps.map((step, index) => (
              <SidebarStepperNavItem
                key={step.id}
                step={step}
                index={index}
                activeStep={activeStep}
                state={getStepState(index)}
                onSelect={() => onStepSelect(index)}
              />
            ))}
          </nav>

          {sidebarFooter && (
            <div className="mt-auto pt-4 px-1">{sidebarFooter}</div>
          )}
        </aside>

        <div className="flex flex-1 min-w-0 flex-col">
          {panelBanner}

          <div className="relative flex-1 min-h-0 overflow-hidden">
            <AnimatePresence initial={false} mode="wait" custom={direction}>
              <motion.div
                key={activeStep}
                custom={direction}
                variants={stepPanelSlideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.18, ease: "easeInOut" }}
                className="absolute inset-0 p-4 sm:p-5 flex flex-col gap-4 sm:gap-5 text-sm"
              >
                <div className="hidden md:flex items-center gap-2.5 pb-1">
                  <div>
                    <h3 className="font-semibold text-base lg:text-lg leading-tight">
                      {currentStep.label}
                    </h3>
                    <p className="text-[11px] text-muted-foreground">
                      {currentStep.description}
                    </p>
                  </div>
                  <span className="ml-auto text-[11px] text-muted-foreground font-medium tabular-nums">
                    {activeStep + 1} / {steps.length}
                  </span>
                </div>

                <div className="overflow-y-auto custom-scroll px-1">
                  {children}
                </div>
              </motion.div>
            </AnimatePresence>
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-border/40 bg-card/90 backdrop-blur-md px-4 sm:px-5 py-3">
            <Button
              type="button"
              variant="outline_without_border"
              onClick={onCancel}
            >
              Cancel
            </Button>

            <div className="flex items-center gap-2 min-w-0">
              {footerHint}

              {activeStep > 0 && (
                <Button type="button" variant="ghost" onClick={onBack}>
                  Back
                </Button>
              )}

              {isLastStep ? (
                lastStepAction
              ) : (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={!canContinue}
                  onClick={onContinue}
                >
                  Continue
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
