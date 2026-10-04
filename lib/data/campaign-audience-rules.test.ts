import { describe, expect, it } from "vitest";

import { missingContactExclusion, NO_PHONE_EXCLUSION } from "./campaign-audience-rules";

describe("missingContactExclusion", () => {
  it("excludes a subject with no phone number from a WhatsApp campaign — the lead who only ever wrote on Messenger or Instagram", () => {
    for (const contact of ["", "   ", null, undefined]) expect(missingContactExclusion("WHATSAPP", contact)).toBe(NO_PHONE_EXCLUSION);
  });

  it("keeps a subject who has a number", () => {
    expect(missingContactExclusion("WHATSAPP", "771234567")).toBeNull();
  });

  it("does not demand a phone number for channels that are not delivered to one", () => {
    for (const channel of ["FACEBOOK", "INSTAGRAM", "GOOGLE", "WEBSITE"]) expect(missingContactExclusion(channel, "")).toBeNull();
  });
});
