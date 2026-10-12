import { describe, expect, it, vi } from "vitest";

import { describeLeadFailure } from "./lead-errors";

describe("describeLeadFailure", () => {
  it("maps a known database code to a fixed sentence and logs nothing", () => {
    const log = vi.fn();
    const failure = describeLeadFailure(
      { code: "23505", message: 'duplicate key value violates unique constraint "leads_reference_agency_unique"' },
      "createLead",
      log,
    );
    expect(failure.message).not.toMatch(/constraint|leads_reference/i);
    expect(failure.reference).toBeNull();
    expect(log).not.toHaveBeenCalled();
  });

  it("reports a version conflict plainly", () => {
    const conflict = Object.assign(new Error("Someone else changed this lead just now."), { name: "LeadConflictError" });
    expect(describeLeadFailure(conflict, "changeStage").message).toMatch(/someone else/i);
  });

  it("hides an unrecognised error behind a reference and logs the real one", () => {
    const log = vi.fn();
    const cause = new Error('relation "public.secret_table" does not exist');
    const failure = describeLeadFailure(cause, "importLeads", log);

    expect(failure.message).not.toMatch(/secret_table|relation/i);
    expect(failure.reference).toMatch(/^[A-Z0-9]{4,}$/);
    expect(failure.message).toContain(failure.reference!);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toContain(failure.reference);
    expect(log.mock.calls[0][1]).toBe(cause);
  });

  it("copes with a thrown string or null", () => {
    const log = vi.fn();
    expect(describeLeadFailure("boom", "x", log).reference).not.toBeNull();
    expect(describeLeadFailure(null, "x", log).reference).not.toBeNull();
  });
});
