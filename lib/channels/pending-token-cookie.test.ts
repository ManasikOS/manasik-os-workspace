import { describe, expect, it } from "vitest";

import { openPendingRef, sealPendingRef } from "./pending-token-cookie";

const SECRET = "app-secret";
const REF = "5f0c8a62-1b0e-4d0c-9d57-0c7d0d4e2a11";

describe("pending login cookie", () => {
  it("opens to the reference for the agency it was sealed for", () => {
    expect(openPendingRef(sealPendingRef(REF, "agency-a", SECRET), "agency-a", SECRET)).toBe(REF);
  });

  it("does NOT open for another agency, so one agency can never read the login another is choosing from", () => {
    expect(openPendingRef(sealPendingRef(REF, "agency-a", SECRET), "agency-b", SECRET)).toBeNull();
  });

  it("does not open a bare reference — the cookie a forger would set to name any Vault secret", () => {
    expect(openPendingRef(REF, "agency-a", SECRET)).toBeNull();
    expect(openPendingRef(`${REF}.`, "agency-a", SECRET)).toBeNull();
    expect(openPendingRef(`${REF}.${"0".repeat(32)}`, "agency-a", SECRET)).toBeNull();
  });

  it("does not open a cookie whose reference was swapped for another secret's", () => {
    const sealed = sealPendingRef(REF, "agency-a", SECRET);
    const swapped = sealed.replace(REF, "11111111-1111-4111-8111-111111111111");
    expect(openPendingRef(swapped, "agency-a", SECRET)).toBeNull();
  });

  it("does not open with another secret, and never with an empty one", () => {
    expect(openPendingRef(sealPendingRef(REF, "agency-a", SECRET), "agency-a", "other")).toBeNull();
    expect(openPendingRef(sealPendingRef(REF, "agency-a", SECRET), "agency-a", "")).toBeNull();
    expect(openPendingRef(sealPendingRef(REF, "agency-a", SECRET), "agency-a", undefined)).toBeNull();
    expect(() => sealPendingRef(REF, "agency-a", "")).toThrow();
  });

  it("opens nothing for a missing or malformed cookie", () => {
    for (const bad of [undefined, null, "", ".", "no-dot"]) expect(openPendingRef(bad, "agency-a", SECRET)).toBeNull();
  });
});
