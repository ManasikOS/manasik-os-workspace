"use client";

import { useCallback, useState, useTransition } from "react";

import { runWithLoadingToast, toast } from "@/components/ui/toast";
import { useProgressRouter } from "@/hooks/use-progress-router";

import {
  getPackageApprovalPolicyAction,
  publishPackageAction,
  savePackageAction,
  type SavePackageResult,
} from "../../actions";
import type { PackageFormData } from "../../create-package/types";
import type { PackageApprovalPolicy } from "../package-change-review-dialog";
import { decidePackageSaveRoute } from "./decide-package-save-route";

interface UsePackageEditorSaveParams {
  initialPackageId: string | null;
  initialUpdatedAt: string | null;
  isLive: boolean;
  formData: PackageFormData;
  sensitiveChangeCount: number;
  /** Called with the form that was just saved, so the editor knows what the database now holds. */
  onSaved: (form: PackageFormData) => void;
  /** Opens a step by its 1-based number, used to show the person which step a server error belongs to. */
  onOpenStepNumber: (step: number) => void;
  /** Called once the editor should actually close. */
  onClose: () => void;
}

/**
 * Everything that sends the form to the server: save draft, save changes,
 * the reviewed save of a package on sale, publish, and "save and leave".
 * `decidePackageSaveRoute` is the only place that picks between them.
 */
export function usePackageEditorSave({
  initialPackageId,
  initialUpdatedAt,
  isLive,
  formData,
  sensitiveChangeCount,
  onSaved,
  onOpenStepNumber,
  onClose,
}: UsePackageEditorSaveParams) {
  const router = useProgressRouter();
  const [isWorking, startWorking] = useTransition();
  const [packageId, setPackageId] = useState<string | null>(initialPackageId);
  const [updatedAt, setUpdatedAt] = useState<string | null>(initialUpdatedAt);

  const [reviewOpen, setReviewOpen] = useState(false);
  const [approvalPolicy, setApprovalPolicy] = useState<PackageApprovalPolicy | null>(null);
  // Another change for this package turned out to be waiting for approval when we tried to save.
  const [pendingConflict, setPendingConflict] = useState(false);

  /** Sends the form to the server. Resolves with the result, or undefined if the request itself failed. */
  const persist = useCallback(
    async (options?: { reason?: string; supersedePending?: boolean }): Promise<SavePackageResult | undefined> => {
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
          errorTitle: isLive ? "Could not save changes" : "Could not save draft",
          getFailureMessage: (response) => (response.ok ? undefined : response.error),
          shouldDismissSilently: (response) => response.ok,
        },
      );

      if (!result) return undefined;
      if (!result.ok) {
        if (result.code === "PENDING_EXISTS") setPendingConflict(true);
        if (result.step) onOpenStepNumber(result.step);
        return result;
      }

      setPackageId(result.packageId);
      setUpdatedAt(result.savedAt);
      if (result.kind === "SAVED" || result.kind === "APPLIED") onSaved(formData);
      return result;
    },
    [packageId, formData, updatedAt, isLive, onSaved, onOpenStepNumber],
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

  const saveDraft = () => {
    startWorking(async () => {
      const result = await persist();
      if (result?.ok) {
        toast.add({ title: "Draft saved" });
        router.refresh();
      }
    });
  };

  const openChangeReview = () => {
    setPendingConflict(false);
    setReviewOpen(true);
    void getPackageApprovalPolicyAction().then((policy) => {
      if (policy.ok) {
        setApprovalPolicy({
          moneyAndContract: policy.moneyAndContract,
          bookingsAndOperations: policy.bookingsAndOperations,
        });
      }
    });
  };

  /** The Save button: a draft save, a reviewed save, or a direct save, as `decidePackageSaveRoute` says. */
  const save = () => {
    const route = decidePackageSaveRoute({ isLive, sensitiveChangeCount });
    if (route === "save-draft") return saveDraft();
    if (route === "review-first") return openChangeReview();
    startWorking(async () => {
      const result = await persist();
      if (result?.ok) finishAfterLiveSave(result);
    });
  };

  const confirmReview = (input: { reason: string; supersedePending: boolean }) => {
    startWorking(async () => {
      const result = await persist({ reason: input.reason, supersedePending: input.supersedePending });
      if (result?.ok) {
        setReviewOpen(false);
        finishAfterLiveSave(result);
      }
    });
  };

  const publish = () => {
    startWorking(async () => {
      const result = await runWithLoadingToast(
        () => publishPackageAction({ packageId, form: formData, expectedUpdatedAt: updatedAt ?? undefined }),
        {
          loadingTitle: "Publishing package…",
          successTitle: "Package published",
          errorTitle: "Could not publish package",
          getFailureMessage: (response) => (response.ok ? undefined : response.error),
          shouldDismissSilently: (response) => response.ok,
        },
      );
      if (!result) return;
      if (!result.ok) {
        if (result.step) onOpenStepNumber(result.step);
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

  /** "Save and leave" from the unsaved-changes prompt. `closePrompt` hides that prompt once it has done its part. */
  const saveAndLeave = (closePrompt: () => void) => {
    startWorking(async () => {
      if (decidePackageSaveRoute({ isLive, sensitiveChangeCount }) === "review-first") {
        closePrompt();
        save();
        return;
      }
      const result = await persist();
      if (result?.ok) {
        closePrompt();
        onClose();
        router.refresh();
      }
    });
  };

  return {
    packageId,
    isWorking,
    save,
    publish,
    saveAndLeave,
    review: {
      open: reviewOpen,
      policy: approvalPolicy,
      pendingConflict,
      close: () => setReviewOpen(false),
      confirm: confirmReview,
    },
  };
}
