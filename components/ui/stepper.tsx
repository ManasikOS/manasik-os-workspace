import React, {
  useState,
  Children,
  useRef,
  useLayoutEffect,
  useImperativeHandle,
  forwardRef,
  HTMLAttributes,
  ReactNode,
} from "react";
import { motion, AnimatePresence, Variants, useReducedMotion } from "motion/react";
import { Button } from "./button";

export interface StepperHandle {
  goNext: () => void;
  goBack: () => void;
  goComplete: () => void;
}

interface StepperProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  initialStep?: number;
  currentStep?: number;
  onStepChange?: (step: number) => void;
  onFinalStepCompleted?: () => void;
  stepCircleContainerClassName?: string;
  stepContainerClassName?: string;
  contentClassName?: string;
  footerClassName?: string;
  backButtonProps?: React.ButtonHTMLAttributes<HTMLButtonElement>;
  nextButtonProps?: React.ButtonHTMLAttributes<HTMLButtonElement>;
  backButtonText?: string;
  nextButtonText?: string;
  disableStepIndicators?: boolean;
  hideNavigation?: boolean;
  stepTitles?: string[];
  isStepClickable?: (step: number) => boolean;
  renderStepIndicator?: (props: {
    step: number;
    currentStep: number;
    onStepClick: (clicked: number) => void;
  }) => ReactNode;
}

const Stepper = forwardRef<StepperHandle, StepperProps>(function Stepper({
  children,
  initialStep = 1,
  currentStep: controlledStep,
  onStepChange = () => {},
  onFinalStepCompleted = () => {},
  stepCircleContainerClassName = "",
  stepContainerClassName = "",
  contentClassName = "",
  footerClassName = "",
  backButtonProps = {},
  nextButtonProps = {},
  backButtonText = "Back",
  nextButtonText = "Continue",
  disableStepIndicators = false,
  hideNavigation = false,
  stepTitles,
  isStepClickable,
  renderStepIndicator,
  className = "",
  ...rest
}: StepperProps, ref) {
  const [internalStep, setInternalStep] = useState<number>(initialStep);
  const [direction, setDirection] = useState<number>(0);
  const stepsArray = Children.toArray(children);
  const totalSteps = stepsArray.length;

  // Sync internal step when controlled step changes from outside. Adjusted
  // during render (comparing against the previous controlledStep, tracked in
  // state) rather than in an effect, so an external step change takes effect
  // in the same render pass instead of causing an extra one — see "Adjusting
  // some state when a prop changes" in the React docs.
  const [prevControlledStep, setPrevControlledStep] = useState(controlledStep);
  if (controlledStep !== undefined && controlledStep !== prevControlledStep) {
    setPrevControlledStep(controlledStep);
    if (controlledStep !== internalStep) {
      setDirection(controlledStep > internalStep ? 1 : -1);
      setInternalStep(controlledStep);
    }
  }

  // Use controlled step if provided, otherwise use internal
  const currentStep = controlledStep !== undefined ? controlledStep : internalStep;
  const isCompleted = currentStep > totalSteps;
  const isLastStep = currentStep === totalSteps;

  const updateStep = (newStep: number) => {
    setInternalStep(newStep);
    if (newStep > totalSteps) {
      onFinalStepCompleted();
    } else {
      onStepChange(newStep);
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setDirection(-1);
      updateStep(currentStep - 1);
    }
  };

  const handleNext = () => {
    if (!isLastStep) {
      setDirection(1);
      updateStep(currentStep + 1);
    }
  };

  const handleComplete = () => {
    setDirection(1);
    updateStep(totalSteps + 1);
  };

  // Expose navigation methods to parent via ref
  useImperativeHandle(ref, () => ({
    goNext: handleNext,
    goBack: handleBack,
    goComplete: handleComplete,
  }));

  return (
    <div
      className={`flex min-h-full flex-1 flex-col w-full   ${className}`}
      {...rest}
    >
      <div className={`mx-auto w-full  ${stepCircleContainerClassName}`}>
        <div
          className={`${stepContainerClassName} flex w-full items-center justify-between  sm:p-5 overflow-x-auto gap-2  `}
        >
          {stepsArray.map((_, index) => {
            const stepNumber = index + 1;
            const isNotLastStep = index < totalSteps - 1;
            const stepTitle = stepTitles?.[index];
            const clickable = isStepClickable
              ? isStepClickable(stepNumber)
              : true;

            return (
              <React.Fragment key={stepNumber}>
                {renderStepIndicator ? (
                  renderStepIndicator({
                    step: stepNumber,
                    currentStep,
                    onStepClick: (clicked) => {
                      if (isStepClickable && !isStepClickable(clicked)) return;
                      setDirection(clicked > currentStep ? 1 : -1);
                      updateStep(clicked);
                    },
                  })
                ) : (
                  <div className="flex items-center gap-2.5">
                    <StepIndicator
                      step={stepNumber}
                      disableStepIndicators={
                        disableStepIndicators || !clickable
                      }
                      currentStep={currentStep}
                      onClickStep={(clicked) => {
                        if (isStepClickable && !isStepClickable(clicked))
                          return;
                        setDirection(clicked > currentStep ? 1 : -1);
                        updateStep(clicked);
                      }}
                    />
                    {stepTitle && (
                      <span
                        onClick={() => {
                          if (
                            clickable &&
                            !disableStepIndicators &&
                            currentStep !== stepNumber
                          ) {
                            setDirection(stepNumber > currentStep ? 1 : -1);
                            if (!nextButtonProps.disabled) {
                              updateStep(stepNumber);
                            }
                          }
                        }}
                        className={`text-xs font-semibold whitespace-nowrap hidden md:inline-block transition-colors ${
                          !clickable || disableStepIndicators
                            ? "text-muted-foreground/40 cursor-not-allowed pointer-events-none"
                            : currentStep === stepNumber
                              ? "text-primary font-bold cursor-pointer"
                              : currentStep > stepNumber
                                ? "text-foreground cursor-pointer"
                                : "text-muted-foreground cursor-pointer"
                        }`}
                      >
                        {stepTitle}
                      </span>
                    )}
                  </div>
                )}
                {isNotLastStep && (
                  <StepConnector isComplete={currentStep > stepNumber} />
                )}
              </React.Fragment>
            );
          })}
        </div>

        <StepContentWrapper
          isCompleted={isCompleted}
          currentStep={currentStep}
          direction={direction}
          className={`space-y-4   sm:p-6 ${contentClassName}`}
        >
          {stepsArray[currentStep - 1]}
        </StepContentWrapper>

        {!isCompleted && !hideNavigation && (
          <div className={`p-4 sm:p-6 pt-5   ${footerClassName}`}>
            <div
              className={`flex items-center ${currentStep !== 1 ? "justify-between" : "justify-end"}`}
            >
              {currentStep !== 1 && (
                <Button
                  variant={"outline_without_border"}
                  onClick={handleBack}
                  {...backButtonProps}
                >
                  {backButtonText}
                </Button>
              )}
              <Button
                onClick={isLastStep ? handleComplete : handleNext}
                {...nextButtonProps}
              >
                {isLastStep ? "Complete & Publish" : nextButtonText}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

export default Stepper;

interface StepContentWrapperProps {
  isCompleted: boolean;
  currentStep: number;
  direction: number;
  children: ReactNode;
  className?: string;
}

function StepContentWrapper({
  isCompleted,
  currentStep,
  direction,
  children,
  className = "",
}: StepContentWrapperProps) {
  const [parentHeight, setParentHeight] = useState<number>(0);
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      style={{ position: "relative", overflow: "hidden" }}
      animate={{ height: isCompleted ? 0 : parentHeight }}
      transition={reduceMotion ? { duration: 0 } : { type: "spring", duration: 0.4 }}
      className={className}
    >
      <AnimatePresence initial={false} mode="sync" custom={direction}>
        {!isCompleted && (
          // `setParentHeight` is passed directly rather than wrapped in a new
          // arrow function each render — SlideTransition's effect depends on
          // this identity, and a stale wrapper forced the ResizeObserver to
          // disconnect and reconnect (plus a synchronous `offsetHeight`
          // reflow) on every keystroke inside the step.
          <SlideTransition
            key={currentStep}
            direction={direction}
            onHeightReady={setParentHeight}
          >
            {children}
          </SlideTransition>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

interface SlideTransitionProps {
  children: ReactNode;
  direction: number;
  onHeightReady: (height: number) => void;
}

function SlideTransition({
  children,
  direction,
  onHeightReady,
}: SlideTransitionProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (!containerRef.current) return;

    const updateHeight = () => {
      if (containerRef.current) {
        onHeightReady(containerRef.current.offsetHeight);
      }
    };

    updateHeight();

    const resizeObserver = new ResizeObserver(() => {
      updateHeight();
    });

    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
    };
    // `SlideTransition` is remounted (via the `key={currentStep}` above) on
    // every step change, so this effect only needs to run once per mount —
    // the ResizeObserver itself already reacts to `children`'s content
    // changing size. Re-running it on every `children` reference change (i.e.
    // every render caused by typing) was creating and destroying an observer,
    // plus a synchronous layout read, per keystroke.
  }, [onHeightReady]);

  return (
    <motion.div
      ref={containerRef}
      custom={direction}
      variants={stepVariants}
      initial="enter"
      animate="center"
      exit="exit"
      transition={{ duration: 0.4 }}
      style={{ position: "absolute", left: 0, right: 0, top: 0 }}
    >
      {children}
    </motion.div>
  );
}

const stepVariants: Variants = {
  enter: (dir: number) => ({
    x: dir >= 0 ? "-100%" : "100%",
    opacity: 0,
  }),
  center: {
    x: "0%",
    opacity: 1,
  },
  exit: (dir: number) => ({
    x: dir >= 0 ? "50%" : "-50%",
    opacity: 0,
  }),
};

interface StepProps {
  children: ReactNode;
}

export function Step({ children }: StepProps) {
  return <div className="px-5 mt-4 mb-10">{children}</div>;
}

interface StepIndicatorProps {
  step: number;
  currentStep: number;
  onClickStep: (clicked: number) => void;
  disableStepIndicators?: boolean;
}

function StepIndicator({
  step,
  currentStep,
  onClickStep,
  disableStepIndicators = false,
}: StepIndicatorProps) {
  const status =
    currentStep === step
      ? "active"
      : currentStep < step
        ? "inactive"
        : "complete";

  const handleClick = () => {
    if (step !== currentStep && !disableStepIndicators) {
      onClickStep(step);
    }
  };

  return (
    <motion.div
      onClick={handleClick}
      className={`relative outline-none focus:outline-none ${disableStepIndicators ? "pointer-events-none opacity-50" : "cursor-pointer"}`}
      initial={false}
    >
      <div
        className={`flex h-8 w-8 items-center justify-center rounded-full font-semibold text-xs transition-all duration-300 ${
          status === "complete"
            ? "bg-primary text-primary-foreground shadow-sm"
            : status === "active"
              ? "bg-primary text-primary-foreground ring-4 ring-primary/20 font-bold"
              : "bg-muted text-muted-foreground "
        }`}
      >
        {status === "complete" ? (
          <CheckIcon className="h-4 w-4 text-primary-foreground" />
        ) : (
          <span>{step}</span>
        )}
      </div>
    </motion.div>
  );
}

interface StepConnectorProps {
  isComplete: boolean;
}

function StepConnector({ isComplete }: StepConnectorProps) {
  return (
    <div className="relative mx-1 sm:mx-2 h-0.5 min-w-4 flex-1 overflow-hidden rounded bg-border">
      <motion.div
        className="absolute left-0 top-0 h-full bg-primary"
        initial={false}
        animate={{ width: isComplete ? "100%" : "0%" }}
        transition={{ duration: 0.3 }}
      />
    </div>
  );
}

type CheckIconProps = React.SVGProps<SVGSVGElement>;

function CheckIcon(props: CheckIconProps) {
  return (
    <svg
      {...props}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      viewBox="0 0 24 24"
    >
      <motion.path
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{
          delay: 0.1,
          type: "tween",
          ease: "easeOut",
          duration: 0.3,
        }}
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M5 13l4 4L19 7"
      />
    </svg>
  );
}
