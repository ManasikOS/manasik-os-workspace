"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { runWithLoadingToast, toast } from "@/components/ui/toast";
import {
  SidebarStepperDialogBody,
  type SidebarStepperStep,
} from "@/components/ui/sidebar-stepper-dialog-body";
import { cn } from "@/lib/utils";
import { AlertCircle, ShieldAlert, TriangleAlert } from "lucide-react";
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

import {
  getPackageApprovalPolicyAction,
  getPackageForEditAction,
  publishPackageAction,
  savePackageAction,
  type SavePackageResult,
} from "../actions";
import { computePackageChanges } from "@/lib/packages/change-diff";
import PackageChangeReviewDialog, {
  type PackageApprovalPolicy,
} from "./package-change-review-dialog";
import {
  INITIAL_PACKAGE_FORM_DATA,
  PackageFormData,
} from "../create-package/types";
import { isStepValid, stepFieldErrors } from "../create-package/schemas";
import { TONE_CLASS, TONE_TEXT } from "@/lib/ui/tone";

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
// Body — everything that depends on the form state. Mounted fresh (via a
// `key` on the parent) every time a new session starts, so a previous
// package's row id never leaks into the next session.
//
// Nothing here saves on its own (TASK-043). The form lives in the browser until
// the person presses Save draft, Save changes or Publish. A package that is
// already on sale is saved through the comparison dialog when the change
// touches payment, contract or booking terms.
// ---------------------------------------------------------------------------

interface CreatePackageDialogBodyProps {
  mode: "create" | "edit";
  initialPackageId: string | null;
  initialFormData: PackageFormData;
  initialUpdatedAt: string | null;
  initialStatus: string;
  initialLiveGroupCount: number;
  initialPendingChange: PendingChangeSummary | null;
  canEditSensitiveTerms: boolean;
  /** Called once the dialog should actually close. */
  onClose: () => void;
}

interface PendingChangeSummary {
  id: string;
  requestedByName: string;
  createdAt: string;
  columns: string[];
}

function CreatePackageDialogBody({
  mode,
  initialPackageId,
  initialFormData,
  initialUpdatedAt,
  initialStatus,
  initialLiveGroupCount,
  initialPendingChange,
  canEditSensitiveTerms,
  onClose,
}: CreatePackageDialogBodyProps) {
  const router = useRouter();
  const [formData, setFormData] = useState<PackageFormData>(initialFormData);
  // What the database holds right now, as far as this browser knows: the form as loaded, then as last saved.
  const [savedForm, setSavedForm] = useState<PackageFormData>(initialFormData);
  const [packageId, setPackageId] = useState<string | null>(initialPackageId);
  const [packageStatus] = useState(initialStatus);
  const [updatedAt, setUpdatedAt] = useState<string | null>(initialUpdatedAt);
  const [pendingChange] = useState<PendingChangeSummary | null>(
    initialPendingChange,
  );
  const [isWorking, startWorking] = useTransition();

  const [reviewOpen, setReviewOpen] = useState(false);
  const [approvalPolicy, setApprovalPolicy] =
    useState<PackageApprovalPolicy | null>(null);
  const [pendingConflict, setPendingConflict] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);

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

  const isLive =
    packageStatus === "Open for Sale" || packageStatus === "Sales Closed";
  const changes = useMemo(
    () => computePackageChanges(savedForm, formData),
    [savedForm, formData],
  );
  const isDirty = changes.length > 0;
  const sensitiveChanges = useMemo(
    () => changes.filter((change) => change.tier > 0),
    [changes],
  );

  // Closing the tab or navigating away with edits that were never saved asks first.
  useEffect(() => {
    if (!isDirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [isDirty]);

  const goToStep = useCallback(
    (index: number) => {
      setDirection(index >= activeStep ? 1 : -1);
      setLeftSteps((prev) => new Set(prev).add(activeStep));
      setActiveStep(index);
    },
    [activeStep],
  );

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
  const inlineFieldErrors = leftSteps.has(activeStep)
    ? currentStepErrors
    : null;

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

  /** Sends the form to the server. Resolves with the result, or undefined if the request itself failed. */
  const persist = useCallback(
    async (options?: {
      reason?: string;
      supersedePending?: boolean;
    }): Promise<SavePackageResult | undefined> => {
      const result = await runWithLoadingToast(
        () =>
          savePackageAction({
            packageId,
            form: formData,
            expectedUpdatedAt: updatedAt ?? undefined,
            reason: options?.reason,
            supersedePending: options?.supersedePending,
          }),
        {
          loadingTitle: isLive ? "Saving changes…" : "Saving draft…",
          successTitle: "Saved",
          errorTitle: isLive
            ? "Could not save changes"
            : "Could not save draft",
          getFailureMessage: (response) =>
            response.ok ? undefined : response.error,
          shouldDismissSilently: (response) => response.ok,
        },
      );

      if (!result) return undefined;
      if (!result.ok) {
        if (result.code === "PENDING_EXISTS") setPendingConflict(true);
        if (result.step) setActiveStep(result.step - 1);
        return result;
      }

      setPackageId(result.packageId);
      setUpdatedAt(result.savedAt);
      if (result.kind === "SAVED" || result.kind === "APPLIED")
        setSavedForm(formData);
      return result;
    },
    [packageId, formData, updatedAt, isLive],
  );

  const finishAfterLiveSave = (result: SavePackageResult & { ok: true }) => {
    if (result.kind === "PENDING") {
      toast.add({
        title: "Sent for approval",
        description:
          result.appliedColumns.length > 0
            ? "Display-only changes were saved. The payment and booking changes wait for an administrator; the package stays as it is until then."
            : "An administrator must approve the changes before they take effect. The package stays as it is until then.",
      });
    } else if (result.kind === "APPLIED") {
      toast.add({
        title: "Changes applied",
        description: "They were recorded with your name and reason.",
      });
    } else {
      toast.add({ title: "Changes saved" });
    }
    onClose();
    router.refresh();
  };

  const handleSaveDraft = () => {
    startWorking(async () => {
      const result = await persist();
      if (result?.ok) {
        toast.add({ title: "Draft saved" });
        router.refresh();
      }
    });
  };

  const handleSaveChanges = () => {
    if (sensitiveChanges.length > 0) {
      setPendingConflict(false);
      setReviewOpen(true);
      void getPackageApprovalPolicyAction().then((policy) => {
        if (policy.ok)
          setApprovalPolicy({
            moneyAndContract: policy.moneyAndContract,
            bookingsAndOperations: policy.bookingsAndOperations,
          });
      });
      return;
    }
    startWorking(async () => {
      const result = await persist();
      if (result?.ok) finishAfterLiveSave(result);
    });
  };

  const handleConfirmReview = (input: {
    reason: string;
    supersedePending: boolean;
  }) => {
    startWorking(async () => {
      const result = await persist({
        reason: input.reason,
        supersedePending: input.supersedePending,
      });
      if (result?.ok) {
        setReviewOpen(false);
        finishAfterLiveSave(result);
      }
    });
  };

  const handlePublish = () => {
    startWorking(async () => {
      const result = await runWithLoadingToast(
        () =>
          publishPackageAction({
            packageId,
            form: formData,
            expectedUpdatedAt: updatedAt ?? undefined,
          }),
        {
          loadingTitle: "Publishing package…",
          successTitle: "Package published",
          errorTitle: "Could not publish package",
          getFailureMessage: (response) =>
            response.ok ? undefined : response.error,
          shouldDismissSilently: (response) => response.ok,
        },
      );
      if (!result) return;
      if (!result.ok) {
        if (result.step) setActiveStep(result.step - 1);
        return;
      }
      toast.add({
        title: "Package published",
        description: formData.title.trim() || undefined,
      });
      onClose();
      router.push(`/packages/${result.packageId}`);
      router.refresh();
    });
  };

  // Leaving with unsaved edits asks first. Nothing was saved on the way, so the choice is the person's.
  const attemptClose = () => {
    if (isDirty) setLeaveOpen(true);
    else onClose();
  };

  const saveAndLeave = () => {
    startWorking(async () => {
      if (isLive && sensitiveChanges.length > 0) {
        setLeaveOpen(false);
        handleSaveChanges();
        return;
      }
      const result = await persist();
      if (result?.ok) {
        setLeaveOpen(false);
        onClose();
        router.refresh();
      }
    });
  };

  const stepContent = [
    <StepCommercialIdentity
      key="commercial"
      fieldErrors={inlineFieldErrors}
      formData={formData}
      setFormData={setFormData}
      currentPackageId={packageId}
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
    />,
  ];

  const dialogTitle = mode === "edit" ? "Edit Package" : "Create Package";
  const saveLabel = isLive ? "Save changes" : "Save draft";

  return (
    <>
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
        onStepSelect={goToStep}
        getStepState={(index) => ({
          isLocked: !checkStepClickable(index),
          lockedReason: "Finish the earlier steps to unlock this one.",
          isCompleted: index < activeStep && stepValidity[index + 1],
        })}
        sidebarFooter={
          <p
            className={cn(
              "text-[11px] font-medium",
              isDirty ? TONE_TEXT.warning : "text-muted-foreground",
            )}
            role="status"
          >
            {isDirty
              ? packageId
                ? "Unsaved changes"
                : "Not saved yet"
              : packageId
                ? "All changes saved"
                : ""}
          </p>
        }
        panelBanner={
          <>
            {pendingChange ? (
              <div
                className={cn(
                  "flex items-start gap-2 px-4 sm:px-5 py-2 text-[11px] shrink-0",
                  TONE_CLASS.info,
                )}
              >
                <ShieldAlert className="size-3.5 mt-0.5 shrink-0" />
                <span>
                  A change requested by {pendingChange.requestedByName} is
                  waiting for approval. Fields it changes will show the values
                  saved today until it is decided.
                </span>
              </div>
            ) : null}
            {mode === "edit" && initialLiveGroupCount > 0 ? (
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
            ) : null}
            {isLive && !canEditSensitiveTerms ? (
              <div
                className={cn(
                  "flex items-start gap-2 px-4 sm:px-5 py-2 text-[11px] shrink-0",
                  TONE_CLASS.warning,
                )}
              >
                <TriangleAlert className="size-3.5 mt-0.5 shrink-0" />
                <span>
                  This package is on sale. You can edit its display text, but
                  your role cannot change its payment or booking terms.
                </span>
              </div>
            ) : null}
          </>
        }
        onCancel={attemptClose}
        onBack={() => goToStep(activeStep - 1)}
        onContinue={() => goToStep(activeStep + 1)}
        canContinue={isCurrentStepValid}
        footerHint={
          !isCurrentStepValid ? (
            <span
              role="status"
              className="flex min-w-0 items-center gap-1 text-xs font-medium text-destructive"
            >
              <AlertCircle className="size-3 shrink-0" />
              <span className="line-clamp-2">
                {firstStepErrorMessage ??
                  "Complete the required fields to continue"}
              </span>
            </span>
          ) : null
        }
        secondaryAction={
          <Button
            type="button"
            variant="outline_without_border"
            disabled={isWorking || !isDirty}
            onClick={isLive ? handleSaveChanges : handleSaveDraft}
          >
            {isWorking ? "Saving…" : saveLabel}
          </Button>
        }
        lastStepAction={
          isLive ? (
            <Button
              type="button"
              disabled={isWorking || !isDirty}
              onClick={handleSaveChanges}
            >
              {isWorking ? "Saving…" : "Save changes"}
            </Button>
          ) : (
            <Button
              type="button"
              disabled={isWorking || !isCurrentStepValid}
              onClick={handlePublish}
            >
              {isWorking ? "Publishing…" : "Publish package"}
            </Button>
          )
        }
      >
        {stepContent[activeStep]}
      </SidebarStepperDialogBody>

      <PackageChangeReviewDialog
        open={reviewOpen}
        packageTitle={formData.title}
        changes={changes}
        policy={approvalPolicy}
        canEditSensitiveTerms={canEditSensitiveTerms}
        pendingChangeExists={pendingConflict || pendingChange !== null}
        isSaving={isWorking}
        onCancel={() => setReviewOpen(false)}
        onConfirm={handleConfirmReview}
      />

      <Dialog
        open={leaveOpen}
        onOpenChange={(next) => !next && !isWorking && setLeaveOpen(false)}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>You have unsaved changes</DialogTitle>
            <DialogDescription>
              Nothing is saved until you choose to. If you leave now, the
              changes you made in this window are lost.
            </DialogDescription>
          </DialogHeader>
          <div className="gap-3 items-start justify-start flex flex-row w-full">
            <Button
              variant="outline_without_border"
              disabled={isWorking}
              onClick={() => setLeaveOpen(false)}
            >
              Keep editing
            </Button>
            <Button
              variant="destructive"
              disabled={isWorking}
              onClick={() => {
                setLeaveOpen(false);
                onClose();
              }}
            >
              Discard changes
            </Button>
            <Button disabled={isWorking} onClick={saveAndLeave}>
              {isLive ? "Review and save changes" : "Save draft and close"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
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
  status: string;
  pendingChange: PendingChangeSummary | null;
  canEditSensitiveTerms: boolean;
}

export default function CreatePackageDialog({
  open,
  setOpen,
  mode = "create",
  packageId = null,
}: CreatePackageDialogProps) {
  // Bumped every time a session ends (cancel or publish) so the body below
  // remounts from scratch next time the dialog opens, instead of resuming the
  // previous package's row id.
  const [sessionId, setSessionId] = useState(0);
  const [editData, setEditData] = useState<EditData | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  const handleClose = useCallback(() => {
    setOpen(false);
    setSessionId((id) => id + 1);
    setEditData(null);
    setEditError(null);
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
        status: result.status,
        pendingChange: result.pendingChange,
        canEditSensitiveTerms: result.canEditSensitiveTerms,
      });
    });

    return () => {
      cancelled = true;
    };
  }, [open, mode, packageId, sessionId]);

  const isEditLoading = mode === "edit" && !editData && !editError;

  return (
    <Dialog
      open={open}
      // The body asks about unsaved changes itself; closing from outside (Escape, backdrop) is handled by its Cancel, so only an explicit open is honoured here.
      onOpenChange={(next) => {
        if (next) setOpen(true);
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
            initialStatus="Draft"
            initialLiveGroupCount={0}
            initialPendingChange={null}
            canEditSensitiveTerms
            onClose={handleClose}
          />
        )}

        {open && mode === "edit" && editError && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
            <p className="text-sm text-destructive font-medium">{editError}</p>
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
            initialStatus={editData.status}
            initialLiveGroupCount={editData.liveGroupCount}
            initialPendingChange={editData.pendingChange}
            canEditSensitiveTerms={editData.canEditSensitiveTerms}
            onClose={handleClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
