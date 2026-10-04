import { describe, expect, it } from "vitest";

import { colomboDateTimeInput, colomboLocalDateTimeToIso } from "./date";

describe("Colombo datetime-local helpers", () => {
  it("keeps a follow-up's displayed time and saved instant in Colombo time", () => {
    expect(colomboDateTimeInput(new Date("2026-09-26T18:45:00.000Z"))).toBe(
      "2026-09-27T00:15",
    );
    expect(colomboLocalDateTimeToIso("2026-09-27T00:15")).toBe(
      "2026-09-26T18:45:00.000Z",
    );
  });
});
