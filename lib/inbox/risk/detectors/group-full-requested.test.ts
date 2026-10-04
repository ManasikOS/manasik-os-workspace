import { describe, expect, it } from "vitest";

import { facts } from "../fixtures";
import { detectGroupFullRequested } from "./group-full-requested";

const group = (availableSeats: number, sellable = true) => ({ name: "Nov Umrah", availableSeats, sellable });

describe("GROUP_FULL_REQUESTED", () => {
  it("fires when the requested group has fewer seats than the party", () => {
    const finding = detectGroupFullRequested(facts({ requestedGroup: group(2), partySize: 4 }));
    expect(finding).toMatchObject({ code: "GROUP_FULL_REQUESTED", messageId: null });
    expect(finding?.evidence[0].snippet).toBe("Nov Umrah has 2 seats left for a party of 4");
  });

  it("fires when the group is no longer open for sale, whatever seats remain", () => {
    expect(detectGroupFullRequested(facts({ requestedGroup: group(30, false), partySize: 2 }))?.evidence[0].snippet).toContain("not open for sale");
  });

  it("near-miss: exactly enough seats is not full", () => {
    expect(detectGroupFullRequested(facts({ requestedGroup: group(4), partySize: 4 }))).toBeNull();
  });

  it("an unknown party counts as one traveller, so a group with no seats fires and one with a seat does not", () => {
    expect(detectGroupFullRequested(facts({ requestedGroup: group(0) }))).not.toBeNull();
    expect(detectGroupFullRequested(facts({ requestedGroup: group(1) }))).toBeNull();
  });

  it("negative: no requested group", () => {
    expect(detectGroupFullRequested(facts({ partySize: 9 }))).toBeNull();
  });
});
