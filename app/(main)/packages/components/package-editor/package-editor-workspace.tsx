"use client";

import { AlertCircle } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { SidebarStepperDialogBody } from "@/components/ui/sidebar-stepper-dialog-body";
import { TONE_TEXT } from "@/lib/ui/tone";
import { cn } from "@/lib/utils";

import type { PackageFormData } from "../../create-package/types";
import PackageChangeReviewSheet from "../package-change-review-sheet";
import { PackageLeaveConfirmDialog } from "./package-leave-confirm-dialog";
import { PackageEditorNotices, type PendingChangeSummary } from "./package-editor-notices";
import { PACKAGE_EDITOR_STEPS, PackageEditorStepPanel } from "./package-editor-steps";
import { usePackageEditorForm } from "./use-package-editor-form";
import { usePackageEditorSave } from "./use-package-editor-save";
import { usePackageEditorSteps } from "./use-package-editor-steps";
import { useUnsavedChangesGuard, type BlockedNavigation } from "./use-unsaved-changes-guard";

export interface PackageEditorWorkspaceProps {
  mode: "create" | "edit";
  initialPackageId: string | null;
  initialFormData: PackageFormData;
  initialUpdatedAt: string | null;
  initialStatus: string;
  initialLiveGroupCount: number;
  initialPendingChange: PendingChangeSummary | null;
  canEditSensitiveTerms: boolean;
  /** Leave the editor: Cancel with nothing to lose, Discard, or after a save from the prompt. */
  onClose: () => void;
  /** A draft was saved and the person stays on the form. */
  onDraftSaved: (input: { packageId: string; isFirstSave: boolean }) => void;
  /** The package was published. */
  onPublished: (packageId: string) => void;
}

/**
 * The package editor itself: the stepper, its footer actions, the change
 * review sheet and the "unsaved changes" prompt. The editor page places it in a
 * card and decides what "leaving" means through `onClose`.
 *
 * Nothing here saves on its own (TASK-043). The form lives in the browser until
 * the person presses Save draft, Save changes or Publish. A package that is
 * already on sale is saved through the review sheet when the change touches
 * payment, contract or booking terms.
 */
export function PackageEditorWorkspace({
  mode,
  initialPackageId,
  initialFormData,
  initialUpdatedAt,
  initialStatus,
  initialLiveGroupCount,
  initialPendingChange,
  canEditSensitiveTerms,
  onClose,
  onDraftSaved,
  onPublished,
}: PackageEditorWorkspaceProps) {
  const isLive = initialStatus === "Open for Sale" || initialStatus === "Sales Closed";

  const form = usePackageEditorForm(initialFormData);
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
    onDraftSaved,
    onPublished,
  });

  // Leaving with unsaved edits asks first. `blocked` is where the person was heading
  // (a link, or Back); it is null when they pressed Cancel.
  const [leavePromptOpen, setLeavePromptOpen] = useState(false);
  const [blocked, setBlocked] = useState<BlockedNavigation | null>(null);

  const guard = useUnsavedChangesGuard({
    isDirty: form.isDirty,
    onBlocked: (navigation) => {
      setBlocked(navigation);
      setLeavePromptOpen(true);
    },
  });

  const attemptCancel = () => {
    if (!form.isDirty) return onClose();
    setBlocked(null);
    setLeavePromptOpen(true);
  };

  const leaveWithoutSaving = () => {
    setLeavePromptOpen(false);
    if (blocked) guard.leave(blocked);
    else onClose();
  };

  const saveThenLeave = () => {
    const heading = blocked;
    saving.saveAndLeave(
      () => setLeavePromptOpen(false),
      heading ? () => guard.leave(heading) : onClose,
    );
  };

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
            className={cn("text-[11px] font-medium", form.isDirty ? TONE_TEXT.warning : "text-muted-foreground")}
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
        onCancel={attemptCancel}
        onBack={() => steps.goToStep(steps.activeStep - 1)}
        onContinue={() => steps.goToStep(steps.activeStep + 1)}
        canContinue={steps.isCurrentStepValid}
        footerHint={
          !steps.isCurrentStepValid ? (
            <span role="status" className="flex min-w-0 items-center gap-1 text-xs font-medium text-destructive">
              <AlertCircle className="size-3 shrink-0" />
              <span className="line-clamp-2">
                {steps.firstStepErrorMessage ?? "Complete the required fields to continue"}
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
            {saving.isWorking ? "Saving…" : isLive ? "Save changes" : "Save draft"}
          </Button>
        }
        lastStepAction={
          isLive ? (
            <Button type="button" disabled={saving.isWorking || !form.isDirty} onClick={saving.save}>
              {saving.isWorking ? "Saving…" : "Save changes"}
            </Button>
          ) : (
            <Button type="button" disabled={saving.isWorking || !steps.isCurrentStepValid} onClick={saving.publish}>
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

      <PackageChangeReviewSheet
        open={saving.review.open}
        packageTitle={form.formData.title}
        changes={form.changes}
        policy={saving.review.policy}
        canEditSensitiveTerms={canEditSensitiveTerms}
        pendingChangeExists={saving.review.pendingConflict || initialPendingChange !== null}
        isSaving={saving.isWorking}
        onCancel={saving.review.close}
        onConfirm={saving.review.confirm}
      />

      <PackageLeaveConfirmDialog
        open={leavePromptOpen}
        isLive={isLive}
        isWorking={saving.isWorking}
        onKeepEditing={() => setLeavePromptOpen(false)}
        onDiscard={leaveWithoutSaving}
        onSaveAndLeave={saveThenLeave}
      />
    </>
  );
}
