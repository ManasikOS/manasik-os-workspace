import { describe, expect, it } from "vitest";

import type { ConversionFieldChoices } from "./catalogue";
import { validateConversionParams } from "./params";

const TRAVELLERS: ConversionFieldChoices[] = [
  { name: "fromTravellerId", options: [{ value: "t1", label: "Amina" }, { value: "t2", label: "Yusuf" }] },
  { name: "relationship", options: [{ value: "SPOUSE", label: "spouse" }, { value: "MAHRAM", label: "mahram" }] },
  { name: "toTravellerId", options: [{ value: "t1", label: "Amina" }, { value: "t2", label: "Yusuf" }] },
  { name: "isMahram", defaultValue: false },
];

describe("validateConversionParams", () => {
  it("accepts choices the server offered and turns each into its readable label", () => {
    const result = validateConversionParams("CONVERSATION_TRAVELLER_RELATIONSHIP", { fromTravellerId: "t1", relationship: "SPOUSE", toTravellerId: "t2", isMahram: true }, TRAVELLERS);
    expect(result).toEqual({
      ok: true,
      params: { fromTravellerId: "t1", relationship: "SPOUSE", toTravellerId: "t2", isMahram: true },
      labels: { fromTravellerId: "Amina", relationship: "spouse", toTravellerId: "Yusuf" },
    });
  });

  it("refuses an id the server never offered, so a forged request cannot name another customer's traveller", () => {
    const result = validateConversionParams("CONVERSATION_TRAVELLER_RELATIONSHIP", { fromTravellerId: "someone-elses", relationship: "SPOUSE", toTravellerId: "t2" }, TRAVELLERS);
    expect(result).toMatchObject({ ok: false });
  });

  it("reads a yes/no left blank as no", () => {
    const result = validateConversionParams("CONVERSATION_TRAVELLER_RELATIONSHIP", { fromTravellerId: "t1", relationship: "SPOUSE", toTravellerId: "t2" }, TRAVELLERS);
    expect(result).toMatchObject({ ok: true, params: { isMahram: false } });
  });

  it("holds a number to the bounds the server set", () => {
    const seats: ConversionFieldChoices[] = [{ name: "seats", min: 1, max: 4 }];
    expect(validateConversionParams("CONVERSATION_SEAT_HOLD", { seats: 3 }, seats)).toMatchObject({ ok: true, params: { seats: 3 } });
    for (const bad of [0, 5, 2.5, "3", null]) {
      expect(validateConversionParams("CONVERSATION_SEAT_HOLD", { seats: bad }, seats)).toMatchObject({ ok: false });
    }
  });

  it("says so plainly when no seats are available to hold", () => {
    const none: ConversionFieldChoices[] = [{ name: "seats", min: 1, max: 0 }];
    const result = validateConversionParams("CONVERSATION_SEAT_HOLD", { seats: 1 }, none);
    expect(result).toEqual({ ok: false, error: "Seats to hold is not available right now." });
  });

  it("refuses a package or survey that was not on offer, and ignores anything extra", () => {
    const packages: ConversionFieldChoices[] = [{ name: "packageId", options: [{ value: "p1", label: "Umrah Gold (UG-01)" }] }];
    expect(validateConversionParams("CONVERSATION_PACKAGE_RECOMMENDATION", { packageId: "p9" }, packages)).toMatchObject({ ok: false });
    expect(validateConversionParams("CONVERSATION_PACKAGE_RECOMMENDATION", { packageId: "p1", agencyId: "other", price: 1 }, packages)).toEqual({ ok: true, params: { packageId: "p1" }, labels: { packageId: "Umrah Gold (UG-01)" } });
  });

  it("asks for nothing on a one-tap conversion", () => {
    expect(validateConversionParams("CONVERSATION_VISA_TASK", { anything: "ignored" }, [])).toEqual({ ok: true, params: {}, labels: {} });
  });
});
