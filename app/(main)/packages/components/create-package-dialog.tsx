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
import {
  SidebarStepperDialogBody,
  type SidebarStepperStep,
} from "@/components/ui/sidebar-stepper-dialog-body";
import { cn } from "@/lib/utils";
import { AlertCircle, TriangleAlert } from "lucide-react";
import dynamic from "next/dynamic";
import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";

import { getPackageForEditAction, publishPackageAction } from "../actions";
import {
  INITIAL_PACKAGE_FORM_DATA,
  PackageFormData,
} from "../create-package/types";
import { isStepValid, stepFieldErrors } from "../create-package/schemas";
import { decidePublishAfterDraftSave } from "../create-package/publish-guard";
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

const STEPS: SidebarStepperStep[] = [
  {
    id: "commercial",
    label: "Commercial Identity",
    description:
      "Define what the agency is selling and how this package appears to sales staff, customers, and Manasik Copilot.",
  },
  {
    id: "pricing",
    label: "Sales Pricing Policy",
    description: "Set the reusable payment schedule and customer-facing terms.",
  },
  {
    id: "journey",
    label: "Journey Template",
    description:
      "Define the standard pilgrimage journey shown to pilgrims. Exact operational dates and flight bookings are confirmed later in Departure Groups.",
  },
  {
    id: "service",
    label: "Service Standards",
    description:
      "Define what the package promises and what each Departure Group must later arrange and confirm.",
  },
  {
    id: "traveller",
    label: "Traveller Requirements",
    description:
      "Choose the requirements automatically applied when a customer books a Departure Group.",
  },
  {
    id: "groups",
    label: "Group Creation Defaults",
    description:
      "Define what is copied into every real Departure Group created from this package.",
  },
  {
    id: "review",
    label: "Review & Publish",
    description:
      "Confirm that this package template is ready for sales staff, AI Sales Agent inquiries, and group creation.",
  },
];

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

  // Steps the user has already left. Inline field errors only appear on these,
  // so a first visit to a step never opens with a wall of red.
  const [leftSteps, setLeftSteps] = useState<ReadonlySet<number>>(
    () => new Set(),
  );

  const goToStep = useCallback(
    (index: number) => {
      setDirection(index >= activeStep ? 1 : -1);
      setLeftSteps((prev) => new Set(prev).add(activeStep));
      setActiveStep(index);
    },
    [activeStep],
  );

  const {
    status: saveStatus,
    errorMessage: saveErrorMessage,
    packageId: draftPackageId,
    saveNow,
  } = useDraftAutosave({
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

  // Field-level messages for the open step. The footer always names the first
  // one; the step itself only shows them once it has been visited and left.
  const currentStepErrors = useMemo(
    () => stepFieldErrors(activeStep + 1, formData),
    [activeStep, formData],
  );
  const firstStepErrorMessage = currentStepErrors
    ? Object.values(currentStepErrors).flat()[0]
    : undefined;
  const inlineFieldErrors = leftSteps.has(activeStep) ? currentStepErrors : null;

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
    const outcome = await saveNow();
    if (!outcome.ok) {
      toast.add({
        title: "Could not save draft",
        description:
          outcome.error ?? "Your changes were not saved. Please try again.",
      });
      if (outcome.step) setActiveStep(outcome.step - 1);
      return;
    }
    toast.add({ title: "Package template saved as Draft" });
  };

  // The first close with unsaved changes only warns; closing again leaves
  // anyway, so a save that keeps failing (offline, say) can never trap anyone.
  const closeWarningShown = useRef(false);
  const attemptClose = useCallback(async () => {
    const outcome = await saveNow();
    if (!outcome.ok && !closeWarningShown.current) {
      closeWarningShown.current = true;
      toast.add({
        title: "Your latest changes were not saved",
        description: `${outcome.error ?? "The draft could not be saved."} Close again to leave without saving them.`,
      });
      if (outcome.step) setActiveStep(outcome.step - 1);
      return;
    }
    onClose();
  }, [saveNow, onClose]);

  /** Returns true only once the package is actually persisted as published. */
  const handlePublish = useCallback((): Promise<boolean> => {
    return new Promise((resolve) => {
      startPublishing(async () => {
        // Flush pending edits first and use the id it resolves with — if
        // this save is what created the row, `packageId` from the hook is
        // still null and publishing with it would insert a duplicate row.
        const flushed = await saveNow();

        // If that save failed there may be no row yet; publishing anyway would
        // attempt a second insert and show the user a second, raw error.
        const decision = decidePublishAfterDraftSave(flushed);
        if (!decision.proceed) {
          toast.add({
            title: "Could not publish package",
            description: decision.message,
          });
          if (decision.step) setActiveStep(decision.step - 1);
          resolve(false);
          return;
        }

        const result = await publishPackageAction({
          packageId: decision.packageId,
          form: formData,
          expectedUpdatedAt: decision.updatedAt ?? undefined,
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
      fieldErrors={inlineFieldErrors}
      formData={formData}
      setFormData={setFormData}
      currentPackageId={draftPackageId}
    />,
    <StepSalesOfferPricing
      key="pricing"
      fieldErrors={inlineFieldErrors}
      formData={formData}
      setFormData={setFormData}
    />,
    <StepJourneyTemplate
      key="journey"
      fieldErrors={inlineFieldErrors}
      formData={formData}
      setFormData={setFormData}
    />,
    <StepServiceStandards
      key="service"
      fieldErrors={inlineFieldErrors}
      formData={formData}
      setFormData={setFormData}
    />,
    <StepTravellerRequirements
      key="traveller"
      fieldErrors={inlineFieldErrors}
      formData={formData}
      setFormData={setFormData}
    />,
    <StepGroupDefaults
      key="groups"
      fieldErrors={inlineFieldErrors}
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
        ? saveErrorMessage
          ? `Could not save: ${saveErrorMessage}`
          : "Could not save"
        : saveStatus === "saved"
          ? "Draft saved"
          : "";

  const dialogTitle = mode === "edit" ? "Edit Package" : "Create Package";

  return (
    <SidebarStepperDialogBody
      title={dialogTitle}
      subtitle={
        mode === "edit"
          ? "Update this package's commercial & operational template."
          : "Build a commercial & operational template for sales and Departure Groups."
      }
      steps={STEPS}
      activeStep={activeStep}
      direction={direction}
      onStepSelect={handleStepChange}
      getStepState={(index) => ({
        isLocked: !checkStepClickable(index),
        lockedReason: "Finish the earlier steps to unlock this one.",
        isCompleted: index < activeStep && stepValidity[index + 1],
      })}
      sidebarFooter={
        saveIndicator ? (
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
        ) : null
      }
      panelBanner={
        mode === "edit" && initialLiveGroupCount > 0 ? (
          <div
            className={cn(
              "flex items-start gap-2 px-4 sm:px-5 py-2 text-[11px] shrink-0",
              TONE_CLASS.warning,
            )}
          >
            <TriangleAlert className="size-3.5 mt-0.5 shrink-0" />
            <span>
              {initialLiveGroupCount} live departure group
              {initialLiveGroupCount === 1 ? " is" : "s are"} already running
              off this template. Saving here never rewrites them — each keeps
              its own independent price and configuration — it only changes
              what the NEXT group created from this package copies.
            </span>
          </div>
        ) : null
      }
      onCancel={() => void attemptClose()}
      onBack={() => handleStepChange(activeStep - 1)}
      onContinue={() => handleStepChange(activeStep + 1)}
      canContinue={isCurrentStepValid}
      footerHint={
        !isCurrentStepValid ? (
          <span
            role="status"
            className="flex min-w-0 items-center gap-1 text-xs font-medium text-destructive"
          >
            <AlertCircle className="size-3 shrink-0" />
            <span className="line-clamp-2">
              {firstStepErrorMessage ?? "Complete the required fields to continue"}
            </span>
          </span>
        ) : null
      }
      lastStepAction={
        <Button
          type="button"
          disabled={isPublishing || !isCurrentStepValid}
          onClick={() => void handlePublish()}
        >
          {isPublishing ? "Publishing…" : "Save Package"}
        </Button>
      }
    >
      {stepContent[activeStep]}
    </SidebarStepperDialogBody>
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
