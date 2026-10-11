import { describe, expect, it } from "vitest";

import type { AddLeadFormData } from "../../types";
import { buildBlankLeadForm } from "./lead-editor-defaults";
import { decideLeadStepGate } from "./decide-lead-step-gate";

const form = (changes: Partial<AddLeadFormData> = {}): AddLeadFormData => ({
  ...buildBlankLeadForm("staff-1"),
  ...changes,
});

describe("decideLeadStepGate: duplicate check", () => {
  it("blocks until a mobile number has been entered", () => {
    const gate = decideLeadStepGate({
      stepId: "duplicate",
      formData: form({ mobile: "77 12" }),
      hasDuplicate: false,
      errors: {},
    });
    expect(gate).toEqual({
      canContinue: false,
      reason: "Enter the mobile number first to check for duplicates",
    });
  });

  it("waits while the lookup is still running", () => {
    const gate = decideLeadStepGate({
      stepId: "duplicate",
      formData: form({ mobile: "771234567" }),
      hasDuplicate: false,
      isCheckingDuplicate: true,
      errors: {},
    });
    expect(gate).toEqual({
      canContinue: false,
      reason: "Checking for an existing lead…",
    });
  });

  it("continues when the number is entered and nobody else uses it", () => {
    const gate = decideLeadStepGate({
      stepId: "duplicate",
      formData: form({ mobile: "771234567" }),
      hasDuplicate: false,
      errors: {},
    });
    expect(gate.canContinue).toBe(true);
  });

  it("asks for a reason when the number is already in use", () => {
    const gate = decideLeadStepGate({
      stepId: "duplicate",
      formData: form({ mobile: "771234567" }),
      hasDuplicate: true,
      errors: {},
    });
    expect(gate).toEqual({
      canContinue: false,
      reason: "Select a reason for the duplicate before continuing",
    });
  });

  it("asks for confirmation once a reason is chosen", () => {
    const gate = decideLeadStepGate({
      stepId: "duplicate",
      formData: form({ mobile: "771234567", duplicateReason: "family-member" }),
      hasDuplicate: true,
      errors: {},
    });
    expect(gate).toEqual({
      canContinue: false,
      reason: "Confirm you want to create a separate lead",
    });
  });

  it("continues once the duplicate is answered and confirmed", () => {
    const gate = decideLeadStepGate({
      stepId: "duplicate",
      formData: form({
        mobile: "771234567",
        duplicateReason: "family-member",
        createAnyway: true,
      }),
      hasDuplicate: true,
      errors: {},
    });
    expect(gate.canContinue).toBe(true);
  });
});

describe("decideLeadStepGate: other steps", () => {
  it("names the first contact problem, name before mobile before email", () => {
    const gate = decideLeadStepGate({
      stepId: "contact",
      formData: form(),
      hasDuplicate: false,
      errors: {
        mobile: "Mobile number is required",
        email: "Please enter a valid email address",
      },
    });
    expect(gate).toEqual({
      canContinue: false,
      reason: "Mobile number is required",
    });
  });

  it("continues from contact details with no contact problems", () => {
    const gate = decideLeadStepGate({
      stepId: "contact",
      formData: form(),
      hasDuplicate: false,
      errors: { nextFollowUpAt: "x" },
    });
    expect(gate.canContinue).toBe(true);
  });

  it("blocks the next action step on a missing or past follow-up", () => {
    const gate = decideLeadStepGate({
      stepId: "action",
      formData: form(),
      hasDuplicate: false,
      errors: { nextFollowUpAt: "Follow-up time cannot be in the past" },
    });
    expect(gate).toEqual({
      canContinue: false,
      reason: "Follow-up time cannot be in the past",
    });
  });

  it.each(["sales", "travel", "review"] as const)(
    "never blocks the %s step",
    (stepId) => {
      expect(
        decideLeadStepGate({
          stepId,
          formData: form(),
          hasDuplicate: true,
          errors: { fullName: "x" },
        }).canContinue,
      ).toBe(true);
    },
  );
});
