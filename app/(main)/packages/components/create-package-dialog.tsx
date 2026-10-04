"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "motion/react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Compass,
  CreditCard,
  Eye,
  FileCheck2,
  Lock,
  Package,
  ShieldCheck,
  TriangleAlert,
  Users,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";

import { getPackageForEditAction, publishPackageAction } from "../actions";
import {
  INITIAL_PACKAGE_FORM_DATA,
  PackageFormData,
} from "../create-package/types";
import { isStepValid } from "../create-package/schemas";
import { useDraftAutosave } from "../create-package/use-draft-autosave";
import { TONE_CLASS } from "@/lib/ui/tone";

interface CreatePackageDialogProps {
  open: boolean;
  setOpen: (open: boolean) => void;
  /** `"edit"` loads an existing package's data before showing the form. */
  mode?: "create" | "edit";
  /** Required when `mode` is `"edit"`. */
  packageId?: string | null;
}

// ---------------------------------------------------------------------------
// Step content — each is only fetched when the step is actually opened. See
// create-package-wizard.tsx for the same rationale (avoids bundling all
// seven forms into the first chunk this dialog needs).
// ---------------------------------------------------------------------------

const stepLoaders = [
  () => import("../create-package/components/step-1-commercial-identity"),
  () => import("../create-package/components/step-2-sales-offer-pricing"),
  () => import("../create-package/components/step-3-journey-template"),
  () => import("../create-package/components/step-4-service-standards"),
  () => import("../create-package/components/step-5-traveller-requirements"),
  () => import("../create-package/components/step-6-group-defaults"),
  () => import("../create-package/components/step-7-review-publish"),
] as const;

function StepSkeleton() {
  return (
    <div className="flex flex-col gap-4 py-2">
      <Skeleton className="h-6 w-64" />
      <Skeleton className="h-4 w-96" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    </div>
  );
}

const StepCommercialIdentity = dynamic(stepLoaders[0], {
  loading: StepSkeleton,
});
const StepSalesOfferPricing = dynamic(stepLoaders[1], {
  loading: StepSkeleton,
});
const StepJourneyTemplate = dynamic(stepLoaders[2], { loading: StepSkeleton });
const StepServiceStandards = dynamic(stepLoaders[3], { loading: StepSkeleton });
const StepTravellerRequirements = dynamic(stepLoaders[4], {
  loading: StepSkeleton,
});
const StepGroupDefaults = dynamic(stepLoaders[5], { loading: StepSkeleton });
const StepReviewPublish = dynamic(stepLoaders[6], { loading: StepSkeleton });

// ---------------------------------------------------------------------------
// Step definitions
// ---------------------------------------------------------------------------

interface StepDef {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
}

const STEPS: StepDef[] = [
  {
    id: "commercial",
    label: "Commercial Identity",
    description:
      "Define what the agency is selling and how this package appears to sales staff, customers, and Manasik Copilot.",
    icon: <Package className="size-4" />,
  },
  {
    id: "pricing",
    label: "Sales Pricing Policy",
    description: "Set the reusable payment schedule and customer-facing terms.",
    icon: <CreditCard className="size-4" />,
  },
  {
    id: "journey",
    label: "Journey Template",
    description:
      "Define the standard pilgrimage journey shown to pilgrims. Exact operational dates and flight bookings are confirmed later in Departure Groups.",
    icon: <Compass className="size-4" />,
  },
  {
    id: "service",
    label: "Service Standards",
    description:
      "Define what the package promises and what each Departure Group must later arrange and confirm.",
    icon: <ShieldCheck className="size-4" />,
  },
  {
    id: "traveller",
    label: "Traveller Requirements",
    description:
      "Choose the requirements automatically applied when a customer books a Departure Group.",
    icon: <FileCheck2 className="size-4" />,
  },
  {
    id: "groups",
    label: "Group Creation Defaults",
    description:
      "Define what is copied into every real Departure Group created from this package.",
    icon: <Users className="size-4" />,
  },
  {
    id: "review",
    label: "Review & Publish",
    description:
      "Confirm that this package template is ready for sales staff, AI Sales Agent inquiries, and group creation.",
    icon: <Eye className="size-4" />,
  },
];

// ---------------------------------------------------------------------------
// Panel slide animation variants — same feel as the Add New Lead dialog.
// ---------------------------------------------------------------------------

const panelVariants = {
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

// ---------------------------------------------------------------------------
// Sidebar step item
// ---------------------------------------------------------------------------

interface SidebarStepProps {
  step: StepDef;
  index: number;
  current: number;
  isCompleted: boolean;
  isLocked: boolean;
  onClick: () => void;
}

function SidebarStep({
  step,
  index,
  current,
  isCompleted,
  isLocked,
  onClick,
}: SidebarStepProps) {
  const isActive = index === current;

  return (
    <button
      type="button"
      onClick={isLocked ? undefined : onClick}
      disabled={isLocked}
      aria-disabled={isLocked}
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
      {/* Step number / status indicator */}
      <div
        className={cn(
          "relative flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-all duration-200",
          isLocked
            ? "bg-muted text-muted-foreground/50"
            : isActive
              ? "bg-primary text-primary-foreground shadow-sm shadow-primary/30 ring-4 ring-primary/15"
              : isCompleted
                ? "bg-primary/20 text-primary"
                : "bg-muted text-muted-foreground",
        )}
      >
        {isLocked ? (
          <Lock className="size-3" />
        ) : isCompleted ? (
          <CheckCircle2 className="size-3.5" />
        ) : (
          <span>{index + 1}</span>
        )}
      </div>

      {/* Label & description */}
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "text-sm font-medium leading-none truncate transition-colors",
            isLocked
              ? "text-muted-foreground/40"
              : isActive
                ? "text-primary"
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

      {/* Active chevron — hidden when locked */}
      {isActive && !isLocked && (
        <ChevronRight className="size-3.5 shrink-0 text-primary opacity-70" />
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Body — everything that depends on autosave/form state. Mounted fresh (via a
// `key` on the parent) every time a new creation session starts, so a
// previous draft's row id never leaks into the next session.
// ---------------------------------------------------------------------------

interface CreatePackageDialogBodyProps {
  mode: "create" | "edit";
  initialPackageId: string | null;
  initialFormData: PackageFormData;
  initialUpdatedAt: string | null;
  initialLiveGroupCount: number;
  /** Called once the dialog should actually close (after flushing the draft). */
  onClose: () => void;
}

function CreatePackageDialogBody({
  mode,
  initialPackageId,
  initialFormData,
  initialUpdatedAt,
  initialLiveGroupCount,
  onClose,
}: CreatePackageDialogBodyProps) {
  const router = useRouter();
  const [formData, setFormData] = useState<PackageFormData>(initialFormData);
  const [isPublishing, startPublishing] = useTransition();

  // Stepper state — 0-based to match the STEPS array; the wizard's own
  // validation helpers are 1-based, so we add 1 wherever they're called.
  const [activeStep, setActiveStep] = useState(0);
  // The panel slide direction, decided at the moment of navigation (not
  // derived from a ref read during render — reading a ref's `.current`
  // synchronously in the render body is flagged by
  // `react-hooks`/React Compiler as unsafe under concurrent rendering).
  const [direction, setDirection] = useState(1);

  const goToStep = useCallback(
    (index: number) => {
      setDirection(index >= activeStep ? 1 : -1);
      setActiveStep(index);
    },
    [activeStep],
  );

  const { status: saveStatus, saveNow } = useDraftAutosave({
    formData,
    initialPackageId,
    initialUpdatedAt,
  });

  // Prefetch the neighbouring steps' chunks once the browser is idle.
  useEffect(() => {
    const w = window as typeof window & {
      requestIdleCallback?: (cb: () => void) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    const schedule =
      w.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 200));
    const cancel = w.cancelIdleCallback ?? window.clearTimeout;

    const handle = schedule(() => {
      stepLoaders[activeStep + 1]?.();
      stepLoaders[activeStep - 1]?.();
    });
    return () => cancel(handle as number);
  }, [activeStep]);

  // Cache per-step validity for the current formData.
  const stepValidity = useMemo(() => {
    const validity: Record<number, boolean> = {};
    for (let s = 1; s <= STEPS.length; s++) {
      validity[s] = isStepValid(s, formData);
    }
    return validity;
  }, [formData]);

  const isCurrentStepValid = stepValidity[activeStep + 1];
  const isLastStep = activeStep === STEPS.length - 1;

  const checkStepClickable = useCallback(
    (targetIndex: number) => {
      if (targetIndex <= activeStep) return true;
      for (let s = 1; s <= targetIndex; s++) {
        if (!stepValidity[s]) return false;
      }
      return true;
    },
    [activeStep, stepValidity],
  );

  // Moving between steps is a natural commit point for the draft.
  const handleStepChange = (index: number) => {
    goToStep(index);
    void saveNow();
  };

  const handleSaveDraft = async () => {
    await saveNow();
    toast.add({ title: "Package template saved as Draft" });
  };

  const attemptClose = useCallback(() => {
    void saveNow();
    onClose();
  }, [saveNow, onClose]);

  /** Returns true only once the package is actually persisted as published. */
  const handlePublish = useCallback((): Promise<boolean> => {
    return new Promise((resolve) => {
      startPublishing(async () => {
        // Flush pending edits first and use the id it resolves with — if
        // this save is what created the row, `packageId` from the hook is
        // still null and publishing with it would insert a duplicate row.
        const { packageId: currentId, updatedAt } = await saveNow();

        const result = await publishPackageAction({
          packageId: currentId,
          form: formData,
          expectedUpdatedAt: updatedAt ?? undefined,
        });

        if (!result.ok) {
          toast.add({
            title: "Could not publish package",
            description: result.error,
          });
          if (result.step) setActiveStep(result.step - 1);
          resolve(false);
          return;
        }

        toast.add({
          title: "Package created successfully",
          description: formData.title.trim() || undefined,
        });
        onClose();
        router.push(`/packages/${result.packageId}`);
        router.refresh();
        resolve(true);
      });
    });
  }, [formData, saveNow, onClose, router]);

  const stepContent = [
    <StepCommercialIdentity
      key="commercial"
      formData={formData}
      setFormData={setFormData}
    />,
    <StepSalesOfferPricing
      key="pricing"
      formData={formData}
      setFormData={setFormData}
    />,
    <StepJourneyTemplate
      key="journey"
      formData={formData}
      setFormData={setFormData}
    />,
    <StepServiceStandards
      key="service"
      formData={formData}
      setFormData={setFormData}
    />,
    <StepTravellerRequirements
      key="traveller"
      formData={formData}
      setFormData={setFormData}
    />,
    <StepGroupDefaults
      key="groups"
      formData={formData}
      setFormData={setFormData}
    />,
    <StepReviewPublish
      key="review"
      formData={formData}
      onGoToStep={(step) => setActiveStep(step - 1)}
      onSaveDraft={handleSaveDraft}
      onPublish={handlePublish}
    />,
  ];

  const saveIndicator =
    saveStatus === "saving"
      ? "Saving…"
      : saveStatus === "error"
        ? "Could not save"
        : saveStatus === "saved"
          ? "Draft saved"
          : "";

  const dialogTitle = mode === "edit" ? "Edit Package" : "Create Package";

  return (
    <>
      {/* ═══════════════════════════════════════════════════════════════
          MOBILE top header + step strip (hidden on md+)
      ═══════════════════════════════════════════════════════════════ */}
      <div className="md:hidden flex flex-col bg-muted/30">
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <div>
            <h2 className="font-heading text-base font-semibold leading-tight">
              {dialogTitle}
            </h2>
            <p className="text-[11px] text-muted-foreground">
              Step {activeStep + 1} of {STEPS.length} —{" "}
              {STEPS[activeStep].label}
            </p>
          </div>
          <span className="text-xs font-medium text-muted-foreground tabular-nums bg-muted rounded-full px-2.5 py-0.5">
            {activeStep + 1}/{STEPS.length}
          </span>
        </div>

        <div className="flex items-center gap-1.5 px-4 pb-3">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={cn(
                "h-1 rounded-full transition-all duration-300",
                i === activeStep
                  ? "bg-primary flex-3"
                  : i < activeStep
                    ? "bg-primary/40 flex-1"
                    : "bg-muted-foreground/20 flex-1",
              )}
            />
          ))}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          Main body: sidebar (md+) + content panel
      ═══════════════════════════════════════════════════════════════ */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* ── Left sidebar — md+ only ─────────────────────────────────── */}
        <aside className="hidden md:flex w-44 lg:w-56 shrink-0 flex-col gap-0.5 border-r border-border/50 bg-muted/30 px-2 lg:px-3 py-4">
          <div className="mb-5 px-1">
            <h2 className="font-heading text-base lg:text-xl font-semibold leading-tight tracking-tight">
              {dialogTitle}
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground leading-snug">
              {mode === "edit"
                ? "Update this package's commercial & operational template."
                : "Build a commercial & operational template for sales and Departure Groups."}
            </p>
          </div>

          <nav aria-label="Form sections" className="flex flex-col gap-0.5">
            {STEPS.map((step, index) => (
              <SidebarStep
                key={step.id}
                step={step}
                index={index}
                current={activeStep}
                isCompleted={index < activeStep && stepValidity[index + 1]}
                isLocked={!checkStepClickable(index)}
                onClick={() => handleStepChange(index)}
              />
            ))}
          </nav>

          {saveIndicator && (
            <div className="mt-auto pt-4 px-1">
              <p
                className={cn(
                  "text-[11px] font-medium",
                  saveStatus === "error"
                    ? "text-destructive"
                    : "text-muted-foreground",
                )}
              >
                {saveIndicator}
              </p>
            </div>
          )}
        </aside>

        {/* ── Right content panel ───────────────────────────────────────── */}
        <div className="flex flex-1 min-w-0 flex-col">
          {mode === "edit" && initialLiveGroupCount > 0 && (
            <div
              className={cn(
                "flex items-start gap-2 px-4 sm:px-5 py-2 text-[11px] shrink-0",
                TONE_CLASS.warning,
              )}
            >
              <TriangleAlert className="size-3.5 mt-0.5 shrink-0" />
              <span>
                {initialLiveGroupCount} live departure group
                {initialLiveGroupCount === 1 ? " is" : "s are"} already
                running off this template. Saving here never rewrites them —
                each keeps its own independent price and configuration — it
                only changes what the NEXT group created from this package
                copies.
              </span>
            </div>
          )}
          <div className="relative flex-1 min-h-0 overflow-hidden">
            <AnimatePresence initial={false} mode="wait" custom={direction}>
              <motion.div
                key={activeStep}
                custom={direction}
                variants={panelVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.18, ease: "easeInOut" }}
                className="absolute inset-0  p-4 sm:p-5 flex flex-col gap-4 sm:gap-5 text-sm"
              >
                <div className="hidden md:flex items-center border- border-muted-foreground/10 gap-2.5 pb-1">
                  <div>
                    <h3 className="font-semibold text-base lg:text-lg leading-tight">
                      {STEPS[activeStep].label}
                    </h3>
                    <p className="text-[11px] text-muted-foreground">
                      {STEPS[activeStep].description}
                    </p>
                  </div>
                  <span className="ml-auto text-[11px] text-muted-foreground font-medium tabular-nums">
                    {activeStep + 1} / {STEPS.length}
                  </span>
                </div>

                <div className="overflow-y-auto custom-scroll px-1">
                  {stepContent[activeStep]}
                </div>
              </motion.div>
            </AnimatePresence>
          </div>

          {/* ── Footer ──────────────────────────────────────────────────── */}
          <div className="flex items-center justify-between gap-2 border-t border-border/40 bg-card/90 backdrop-blur-md px-4 sm:px-5 py-3">
            <Button
              type="button"
              variant="outline_without_border"
              onClick={attemptClose}
            >
              Cancel
            </Button>

            <div className="flex items-center gap-2 min-w-0">
              {!isCurrentStepValid && (
                <span
                  role="alert"
                  className="hidden sm:flex text-[11px] text-destructive font-medium items-center gap-1 max-w-56 truncate"
                >
                  <AlertCircle className="size-3 shrink-0" />
                  Complete the required fields to continue
                </span>
              )}

              {activeStep > 0 && (
                <Button
                  variant="ghost"
                  onClick={() => handleStepChange(activeStep - 1)}
                >
                  Back
                </Button>
              )}

              {!isLastStep ? (
                <Button
                  variant="secondary"
                  disabled={!isCurrentStepValid}
                  onClick={() => handleStepChange(activeStep + 1)}
                >
                  Continue
                </Button>
              ) : (
                <Button
                  type="button"
                  disabled={isPublishing || !isCurrentStepValid}
                  onClick={() => void handlePublish()}
                >
                  {isPublishing ? "Publishing…" : "Save Package"}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface EditData {
  formData: PackageFormData;
  updatedAt: string | null;
  liveGroupCount: number;
}

export default function CreatePackageDialog({
  open,
  setOpen,
  mode = "create",
  packageId = null,
}: CreatePackageDialogProps) {
  // Bumped every time a session ends (cancel or publish) so the body below —
  // and the autosave hook inside it — remounts from scratch next time the
  // dialog opens, instead of resuming the previous draft's row id.
  const [sessionId, setSessionId] = useState(0);
  const [editData, setEditData] = useState<EditData | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  const handleClose = useCallback(() => {
    setOpen(false);
    setSessionId((id) => id + 1);
  }, [setOpen]);

  // Edit mode only has the narrow list-row projection to start from, so the
  // full ~120-column wizard form is fetched the moment the dialog opens.
  useEffect(() => {
    if (!open || mode !== "edit" || !packageId) return;
    let cancelled = false;

    getPackageForEditAction(packageId).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setEditError(result.error);
        return;
      }
      setEditData({
        formData: result.formData,
        updatedAt: result.updatedAt,
        liveGroupCount: result.liveGroupCount,
      });
    });

    return () => {
      cancelled = true;
    };
  }, [open, mode, packageId]);

  const isEditLoading = mode === "edit" && !editData && !editError;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setOpen(true);
        else handleClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="p-0! gap-0! w-full max-w-full! h-dvh flex flex-col overflow-hidden md:max-w-3xl! md:h-[90vh] lg:max-w-6xl!"
      >
        <DialogTitle className="sr-only">
          {mode === "edit" ? "Edit Package" : "Create Package"}
        </DialogTitle>
        <DialogDescription className="sr-only">
          Build a commercial & operational package template
        </DialogDescription>

        {open && mode === "create" && (
          <CreatePackageDialogBody
            key={sessionId}
            mode="create"
            initialPackageId={null}
            initialFormData={INITIAL_PACKAGE_FORM_DATA}
            initialUpdatedAt={null}
            initialLiveGroupCount={0}
            onClose={handleClose}
          />
        )}

        {open && mode === "edit" && editError && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
            <p className="text-sm text-destructive font-medium">
              {editError}
            </p>
            <Button variant="outline_without_border" onClick={handleClose}>
              Close
            </Button>
          </div>
        )}

        {open && mode === "edit" && isEditLoading && (
          <div className="flex flex-1 flex-col gap-4 p-6">
            <Skeleton className="h-6 w-64" />
            <Skeleton className="h-4 w-96" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          </div>
        )}

        {open && mode === "edit" && editData && (
          <CreatePackageDialogBody
            key={`${packageId}-${sessionId}`}
            mode="edit"
            initialPackageId={packageId}
            initialFormData={editData.formData}
            initialUpdatedAt={editData.updatedAt}
            initialLiveGroupCount={editData.liveGroupCount}
            onClose={handleClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
