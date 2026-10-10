"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { SidebarStepperDialogBody } from "@/components/ui/sidebar-stepper-dialog-body";
import { cn } from "@/lib/utils";
import { TONE_TEXT } from "@/lib/ui/tone";
import { AlertCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { getPackageForEditAction } from "../actions";
import {
  INITIAL_PACKAGE_FORM_DATA,
  type PackageFormData,
} from "../create-package/types";
import PackageChangeReviewDialog from "./package-change-review-dialog";
import {
  PackageEditorNotices,
  type PendingChangeSummary,
} from "./package-editor/package-editor-notices";
import {
  PACKAGE_EDITOR_STEPS,
  PackageEditorStepPanel,
} from "./package-editor/package-editor-steps";
import { usePackageEditorForm } from "./package-editor/use-package-editor-form";
import { usePackageEditorSave } from "./package-editor/use-package-editor-save";
import { usePackageEditorSteps } from "./package-editor/use-package-editor-steps";
import { useUnsavedChangesGuard } from "./package-editor/use-unsaved-changes-guard";

interface CreatePackageDialogProps {
  open: boolean;
  setOpen: (open: boolean) => void;
  /** `"edit"` loads an existing package's data before showing the form. */
  mode?: "create" | "edit";
  /** Required when `mode` is `"edit"`. */
  packageId?: string | null;
}

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
  const isLive =
    initialStatus === "Open for Sale" || initialStatus === "Sales Closed";

  const form = usePackageEditorForm(initialFormData);
  useUnsavedChangesGuard(form.isDirty);
  const steps = usePackageEditorSteps(form.formData);
  const saving = usePackageEditorSave({
    initialPackageId,
    initialUpdatedAt,
    isLive,
    formData: form.formData,
    sensitiveChangeCount: form.sensitiveChanges.length,
    onSaved: form.markSaved,
    onOpenStepNumber: steps.openStepNumber,
    onClose,
  });

  const [leaveOpen, setLeaveOpen] = useState(false);

  // Leaving with unsaved edits asks first. Nothing was saved on the way, so the choice is the person's.
  const attemptClose = () => {
    if (form.isDirty) setLeaveOpen(true);
    else onClose();
  };

  const saveLabel = isLive ? "Save changes" : "Save draft";

  return (
    <>
      <SidebarStepperDialogBody
        title={mode === "edit" ? "Edit Package" : "Create Package"}
        subtitle={
          mode === "edit"
            ? "Update this package's commercial & operational template."
            : "Build a commercial & operational template for sales and Departure Groups."
        }
        steps={PACKAGE_EDITOR_STEPS}
        activeStep={steps.activeStep}
        direction={steps.direction}
        onStepSelect={steps.goToStep}
        getStepState={(index) => ({
          isLocked: !steps.canOpenStep(index),
          lockedReason: "Finish the earlier steps to unlock this one.",
          isCompleted: index < steps.activeStep && steps.stepValidity[index + 1],
        })}
        sidebarFooter={
          <p
            className={cn(
              "text-[11px] font-medium",
              form.isDirty ? TONE_TEXT.warning : "text-muted-foreground",
            )}
            role="status"
          >
            {form.isDirty
              ? saving.packageId
                ? "Unsaved changes"
                : "Not saved yet"
              : saving.packageId
                ? "All changes saved"
                : ""}
          </p>
        }
        panelBanner={
          <PackageEditorNotices
            mode={mode}
            isLive={isLive}
            canEditSensitiveTerms={canEditSensitiveTerms}
            liveGroupCount={initialLiveGroupCount}
            pendingChange={initialPendingChange}
          />
        }
        onCancel={attemptClose}
        onBack={() => steps.goToStep(steps.activeStep - 1)}
        onContinue={() => steps.goToStep(steps.activeStep + 1)}
        canContinue={steps.isCurrentStepValid}
        footerHint={
          !steps.isCurrentStepValid ? (
            <span
              role="status"
              className="flex min-w-0 items-center gap-1 text-xs font-medium text-destructive"
            >
              <AlertCircle className="size-3 shrink-0" />
              <span className="line-clamp-2">
                {steps.firstStepErrorMessage ??
                  "Complete the required fields to continue"}
              </span>
            </span>
          ) : null
        }
        secondaryAction={
          <Button
            type="button"
            variant="outline_without_border"
            disabled={saving.isWorking || !form.isDirty}
            onClick={saving.save}
          >
            {saving.isWorking ? "Saving…" : saveLabel}
          </Button>
        }
        lastStepAction={
          isLive ? (
            <Button
              type="button"
              disabled={saving.isWorking || !form.isDirty}
              onClick={saving.save}
            >
              {saving.isWorking ? "Saving…" : "Save changes"}
            </Button>
          ) : (
            <Button
              type="button"
              disabled={saving.isWorking || !steps.isCurrentStepValid}
              onClick={saving.publish}
            >
              {saving.isWorking ? "Publishing…" : "Publish package"}
            </Button>
          )
        }
      >
        <PackageEditorStepPanel
          activeStep={steps.activeStep}
          formData={form.formData}
          setFormData={form.setFormData}
          packageId={saving.packageId}
          fieldErrors={steps.inlineFieldErrors}
          onGoToStep={steps.openStepNumber}
        />
      </SidebarStepperDialogBody>

      <PackageChangeReviewDialog
        open={saving.review.open}
        packageTitle={form.formData.title}
        changes={form.changes}
        policy={saving.review.policy}
        canEditSensitiveTerms={canEditSensitiveTerms}
        pendingChangeExists={
          saving.review.pendingConflict || initialPendingChange !== null
        }
        isSaving={saving.isWorking}
        onCancel={saving.review.close}
        onConfirm={saving.review.confirm}
      />

      <Dialog
        open={leaveOpen}
        onOpenChange={(next) =>
          !next && !saving.isWorking && setLeaveOpen(false)
        }
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
              disabled={saving.isWorking}
              onClick={() => setLeaveOpen(false)}
            >
              Keep editing
            </Button>
            <Button
              variant="destructive"
              disabled={saving.isWorking}
              onClick={() => {
                setLeaveOpen(false);
                onClose();
              }}
            >
              Discard changes
            </Button>
            <Button
              disabled={saving.isWorking}
              onClick={() => saving.saveAndLeave(() => setLeaveOpen(false))}
            >
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
