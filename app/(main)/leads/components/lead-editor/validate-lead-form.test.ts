import { describe, expect, it } from "vitest";

import type { AddLeadFormData } from "../../types";
import { buildBlankLeadForm } from "./lead-editor-defaults";
import { validateLeadForm } from "./validate-lead-form";

const complete = (changes: Partial<AddLeadFormData> = {}): AddLeadFormData => ({
  ...buildBlankLeadForm("staff-1"),
  fullName: "Fathima Rizwan",
  mobile: "077 123 4567",
  nextFollowUpAt: "2030-01-01T09:00",
  ...changes,
});

const check = (
  formData: AddLeadFormData,
  hasDuplicate = false,
  pastFollowUp: string | null = null,
) => validateLeadForm({ formData, hasDuplicate, pastFollowUp });

describe("validateLeadForm", () => {
  it("accepts a complete form", () => {
    expect(check(complete())).toEqual({});
  });

  it("asks for a name and a mobile on a blank form", () => {
    const errors = check(buildBlankLeadForm("staff-1"));
    expect(errors.fullName).toBeTruthy();
    expect(errors.mobile).toBe("Mobile number is required");
  });

  it("accepts every common way of writing the same mobile", () => {
    for (const mobile of [
      "0771234567",
      "077 123 4567",
      "+94 77 123 4567",
      "94771234567",
      "771234567",
    ]) {
      expect(check(complete({ mobile })).mobile).toBeUndefined();
    }
  });

  it("rejects a mobile that is not nine digits", () => {
    expect(check(complete({ mobile: "77 123" })).mobile).toMatch(/nine-digit/);
  });

  it("only checks an email that was typed", () => {
    expect(check(complete({ email: "" })).email).toBeUndefined();
    expect(check(complete({ email: "not-an-email" })).email).toBeTruthy();
    expect(check(complete({ email: "a@b.lk" })).email).toBeUndefined();
  });

  it("always requires a next follow-up", () => {
    expect(check(complete({ nextFollowUpAt: "" })).nextFollowUpAt).toBe(
      "Next follow-up date and time is required",
    );
  });

  it("reports a follow-up the caller found to be in the past", () => {
    expect(
      check(complete(), false, "Follow-up time cannot be in the past")
        .nextFollowUpAt,
    ).toBe("Follow-up time cannot be in the past");
  });

  it("blocks an unanswered duplicate, and lets an answered one through", () => {
    expect(check(complete(), true).duplicate).toBeTruthy();
    expect(
      check(
        complete({ duplicateReason: "family-member", createAnyway: true }),
        true,
      ).duplicate,
    ).toBeUndefined();
  });
});
