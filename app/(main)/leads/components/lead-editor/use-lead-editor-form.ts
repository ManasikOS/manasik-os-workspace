"use client";

import { useCallback, useState } from "react";

import type { AddLeadFormData, LeadJourneyType, LeadSource } from "../../types";
import { defaultFollowUpInput, localInputToIso } from "../../utils";

import { buildBlankLeadForm, buildNextLeadForm } from "./lead-editor-defaults";
import { DEFAULT_INTEREST, DEFAULT_PERIOD } from "./lead-travel-interest";

/**
 * The Add Lead form's values and the rules for changing them.
 *
 * `isDirty` turns true only on a real change, so re-picking the value a select
 * already had does not trigger the leave prompt.
 */
export function useLeadEditorForm(currentStaffId: string) {
  const [formData, setFormData] = useState<AddLeadFormData>(() =>
    buildBlankLeadForm(currentStaffId),
  );
  const [isDirty, setIsDirty] = useState(false);
  // Messages stay hidden on an untouched blank form; they show after a first
  // attempt to create, or once something has been edited.
  const [submitAttempted, setSubmitAttempted] = useState(false);
  // "Is this time already past?" cannot be answered during render: reading the
  // clock there makes the result unstable. It is checked in the change handler
  // and again on submit, which is when it matters.
  const [pastFollowUp, setPastFollowUp] = useState<string | null>(null);

  const applyChange = useCallback(
    (change: (previous: AddLeadFormData) => AddLeadFormData) => {
      setFormData((previous) => {
        const next = change(previous);
        if (next === previous) return previous;
        setIsDirty(true);
        return next;
      });
    },
    [],
  );

  const updateField = useCallback(
    <K extends keyof AddLeadFormData>(field: K, value: AddLeadFormData[K]) =>
      applyChange((previous) =>
        Object.is(previous[field], value)
          ? previous
          : { ...previous, [field]: value },
      ),
    [applyChange],
  );

  /** Reassigning the lead moves the follow-up task too, unless it was split. */
  const updateAssignedTo = useCallback(
    (staffId: string) =>
      applyChange((previous) =>
        previous.assignedToId === staffId
          ? previous
          : {
              ...previous,
              assignedToId: staffId,
              followUpOwnerId:
                previous.followUpOwnerId === previous.assignedToId
                  ? staffId
                  : previous.followUpOwnerId,
            },
      ),
    [applyChange],
  );

  /** The source dictates how quickly the first follow-up should happen. */
  const updateSource = useCallback(
    (source: LeadSource) =>
      applyChange((previous) =>
        previous.source === source
          ? previous
          : {
              ...previous,
              source,
              nextFollowUpAt: defaultFollowUpInput(source),
            },
      ),
    [applyChange],
  );

  /** Switching journey type resets what depended on it; a Hajj package cannot stay on an Umrah enquiry. */
  const updateJourneyType = useCallback(
    (journeyType: LeadJourneyType) =>
      applyChange((previous) =>
        previous.journeyType === journeyType
          ? previous
          : {
              ...previous,
              journeyType,
              interestedIn: DEFAULT_INTEREST[journeyType],
              preferredPeriod: DEFAULT_PERIOD[journeyType],
              packageId: null,
              quotaWaitlistInterest:
                journeyType === "HAJJ" ? previous.quotaWaitlistInterest : false,
            },
      ),
    [applyChange],
  );

  /** Records whether a follow-up time has passed and returns true when it has not. */
  const checkFollowUpTime = useCallback((localValue: string) => {
    const iso = localInputToIso(localValue);
    const isPast = iso !== null && Date.parse(iso) < Date.now() - 60_000;
    setPastFollowUp(isPast ? "Follow-up time cannot be in the past" : null);
    return !isPast;
  }, []);

  const updateFollowUpAt = useCallback(
    (value: string) => {
      updateField("nextFollowUpAt", value);
      checkFollowUpTime(value);
    },
    [checkFollowUpTime, updateField],
  );

  const markSubmitAttempted = useCallback(() => setSubmitAttempted(true), []);

  /** Back to a blank form; `keepPreferences` is "create and add another". */
  const reset = useCallback(
    (keepPreferences: boolean) => {
      setFormData((previous) =>
        keepPreferences
          ? buildNextLeadForm(previous, currentStaffId)
          : buildBlankLeadForm(currentStaffId),
      );
      setIsDirty(false);
      setSubmitAttempted(false);
      setPastFollowUp(null);
    },
    [currentStaffId],
  );

  return {
    formData,
    isDirty,
    submitAttempted,
    pastFollowUp,
    updateField,
    updateAssignedTo,
    updateSource,
    updateJourneyType,
    updateFollowUpAt,
    checkFollowUpTime,
    markSubmitAttempted,
    reset,
  };
}

export type LeadEditorForm = ReturnType<typeof useLeadEditorForm>;
