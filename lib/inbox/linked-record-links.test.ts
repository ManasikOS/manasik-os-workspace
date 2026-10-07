import { describe, expect, it } from "vitest";

import { linkedRecordLinks, type LinkedRecordInput } from "./linked-record-links";

const GROUP = "10000000-0000-4000-8000-000000000001";
const OTHER_GROUP = "20000000-0000-4000-8000-000000000002";
const LEAD = "30000000-0000-4000-8000-000000000003";
const BOOKING = "40000000-0000-4000-8000-000000000004";

const full: LinkedRecordInput = {
  leadId: LEAD,
  bookingId: BOOKING,
  bookingDepartureGroupId: GROUP,
  selectedDepartureGroupId: OTHER_GROUP,
  can: { openLead: true, openBooking: true, openDepartureGroup: true },
};

describe("linkedRecordLinks", () => {
  it("links the lead, the booking and the departure group with the shortcuts that open them", () => {
    expect(linkedRecordLinks(full)).toEqual([
      { id: "OPEN_LEAD", label: "Open lead", href: `/leads?open=${LEAD}`, shortcutKey: "e" },
      { id: "OPEN_BOOKING", label: "Open booking", href: `/bookings?booking=${BOOKING}`, shortcutKey: "b" },
      { id: "OPEN_DEPARTURE_GROUP", label: "Open departure group", href: `/departure-groups/${GROUP}`, shortcutKey: "g then d" },
    ]);
  });

  it("prefers the booked departure over the one merely selected on the lead", () => {
    const group = linkedRecordLinks(full).find((link) => link.id === "OPEN_DEPARTURE_GROUP");
    expect(group?.href).toBe(`/departure-groups/${GROUP}`);
  });

  it("falls back to the selected departure when there is no booking", () => {
    const links = linkedRecordLinks({ ...full, bookingId: null, bookingDepartureGroupId: null });
    expect(links.map((link) => link.id)).toEqual(["OPEN_LEAD", "OPEN_DEPARTURE_GROUP"]);
    expect(links[1].href).toBe(`/departure-groups/${OTHER_GROUP}`);
  });

  it("opens a booking in the booking dialog even when its departure is not known", () => {
    const booking = linkedRecordLinks({ ...full, bookingDepartureGroupId: null }).find((link) => link.id === "OPEN_BOOKING");
    expect(booking?.href).toBe(`/bookings?booking=${BOOKING}`);
  });

  it("offers nothing the person's role cannot open", () => {
    expect(linkedRecordLinks({ ...full, can: { openLead: false, openBooking: false, openDepartureGroup: false } })).toEqual([]);
    expect(linkedRecordLinks({ ...full, can: { openLead: true, openBooking: false, openDepartureGroup: false } }).map((link) => link.id)).toEqual(["OPEN_LEAD"]);
  });

  it("offers nothing for a record that is not linked", () => {
    expect(linkedRecordLinks({ ...full, leadId: null, bookingId: null, bookingDepartureGroupId: null, selectedDepartureGroupId: null })).toEqual([]);
  });

  it("never builds a link from an id that is not a UUID", () => {
    const links = linkedRecordLinks({ ...full, leadId: "../admin", bookingId: "x?y=1", bookingDepartureGroupId: "1/2", selectedDepartureGroupId: "<script>" });
    expect(links).toEqual([]);
  });
});
