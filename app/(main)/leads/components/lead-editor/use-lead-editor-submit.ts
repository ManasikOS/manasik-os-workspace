"use client";

import { useCallback, useState } from "react";

import { runWithLoadingToast, toast } from "@/components/ui/toast";

import type { CreateLeadActionResult } from "../../actions";
import type { AddLeadFormData } from "../../types";

import { buildCreateLeadPayload } from "./lead-editor-payload";

interface UseLeadEditorSubmitParams {
  formData: AddLeadFormData;
  /** Result of `validateLeadForm`. */
  errors: Record<string, string>;
  currentStaffId: string;
  createLead: (input: unknown) => Promise<CreateLeadActionResult>;
  /** Re-checks the follow-up time against the clock; true when it is still in the future. */
  checkFollowUpTime: (localValue: string) => boolean;
  markSubmitAttempted: () => void;
  /** The lead was created. `keepOpen` is "create and add another". */
  onCreated: (outcome: {
    keepOpen: boolean;
    result: CreateLeadActionResult;
  }) => void;
}

/** Validates, creates the lead, tells the person what happened. */
export function useLeadEditorSubmit({
  formData,
  errors,
  currentStaffId,
  createLead,
  checkFollowUpTime,
  markSubmitAttempted,
  onCreated,
}: UseLeadEditorSubmitParams) {
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const submit = useCallback(
    async (keepOpen: boolean) => {
      markSubmitAttempted();
      setServerError(null);

      // Re-check the clock here rather than trusting a value computed when the
      // field was last touched: a form left open long enough drifts past the
      // time the operator chose.
      const followUpStillValid = checkFollowUpTime(formData.nextFollowUpAt);

      if (Object.keys(errors).length > 0 || !followUpStillValid) {
        toast.add({
          title: "Check the form",
          description:
            Object.values(errors)[0] ?? "Follow-up time cannot be in the past",
        });
        return;
      }

      setSubmitting(true);
      // The loading toast shows at once and becomes the error toast on failure.
      // On success it just closes, and the toast below names the new lead.
      const result = await runWithLoadingToast(
        () => createLead(buildCreateLeadPayload(formData)),
        {
          loadingTitle: "Creating lead…",
          successTitle: "Lead created",
          errorTitle: "Could not create lead",
          getFailureMessage: (response) =>
            response.ok ? undefined : response.error,
          shouldDismissSilently: (response) => response.ok,
        },
      );
      setSubmitting(false);

      if (!result || !result.ok) {
        setServerError(result?.error ?? "Could not create lead.");
        return;
      }

      toast.add({
        title: `Lead ${result.reference} created`,
        description: `${formData.fullName.trim()} assigned to ${
          formData.assignedToId === currentStaffId
            ? "you"
            : "the selected owner"
        }.`,
      });
      onCreated({ keepOpen, result });
    },
    [
      checkFollowUpTime,
      createLead,
      currentStaffId,
      errors,
      formData,
      markSubmitAttempted,
      onCreated,
    ],
  );

  return { submit, submitting, serverError };
}
