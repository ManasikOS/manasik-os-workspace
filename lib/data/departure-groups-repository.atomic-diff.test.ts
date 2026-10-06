import { describe, expect, it } from "vitest";

import { buildAtomicDiff, emptyStore } from "./departure-groups-repository";
import type { DepartureGroupBookingRow, DepartureGroupRow, DepartureGroupStore } from "@/lib/types/departure-groups";

const AGENCY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const GROUP = "11111111-1111-4111-8111-111111111111";
const BOOKING = "22222222-2222-4222-8222-222222222222";
const NEW_BOOKING = "33333333-3333-4333-8333-333333333333";

const group = (overrides: Partial<DepartureGroupRow> = {}) =>
  ({ id: GROUP, agency_id: AGENCY, group_name: "Umrah A", booked_seats: 2, available_seats: 38, ...overrides }) as unknown as DepartureGroupRow;

const booking = (overrides: Record<string, unknown> = {}) =>
  ({
    id: BOOKING,
    agency_id: AGENCY,
    departure_group_id: GROUP,
    amount_paid: 100,
    row_version: 4,
    ...overrides,
  }) as unknown as DepartureGroupBookingRow;

function storeWith(parts: Partial<DepartureGroupStore>): DepartureGroupStore {
  return { ...emptyStore(), ...parts };
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

describe("buildAtomicDiff", () => {
  it("is empty when nothing changed", () => {
    const before = storeWith({ groups: [group()], bookings: [booking()] });
    const diff = buildAtomicDiff(before, clone(before), AGENCY);
    expect(diff).toEqual({ changes: {}, deletes: {}, newBookingIds: [], expectedVersions: {} });
  });

  it("records the version it loaded for an updated booking, and not for other tables", () => {
    const before = storeWith({ groups: [group()], bookings: [booking({ amount_paid: 100, row_version: 4 })] });
    const after = clone(before);
    after.bookings[0].amount_paid = 250;
    after.groups[0].group_name = "Umrah A (renamed)";

    const diff = buildAtomicDiff(before, after, AGENCY);
    expect(diff.expectedVersions).toEqual({ [BOOKING]: 4 });
    expect(Object.keys(diff.changes).sort()).toEqual(["departure_group_bookings", "departure_groups"]);
    expect(diff.newBookingIds).toEqual([]);
  });

  it("never sends the version column or the generated seat column", () => {
    const before = storeWith({ groups: [group()], bookings: [booking()] });
    const after = clone(before);
    after.bookings[0].amount_paid = 1;
    after.groups[0].booked_seats = 5;

    const diff = buildAtomicDiff(before, after, AGENCY);
    expect(diff.changes.departure_group_bookings[0]).not.toHaveProperty("row_version");
    expect(diff.changes.departure_groups[0]).not.toHaveProperty("available_seats");
  });

  it("treats a new booking as an insert: stamped with the agency, queued for finance seeding, no version expected", () => {
    const before = storeWith({ groups: [group()] });
    const after = clone(before);
    after.bookings.push(booking({ id: NEW_BOOKING, agency_id: null, row_version: undefined }));

    const diff = buildAtomicDiff(before, after, AGENCY);
    expect(diff.newBookingIds).toEqual([NEW_BOOKING]);
    expect(diff.expectedVersions).toEqual({});
    expect(diff.changes.departure_group_bookings[0].agency_id).toBe(AGENCY);
  });

  it("lists removed rows as deletes", () => {
    const before = storeWith({ groups: [group()], bookings: [booking()] });
    const after = clone(before);
    after.bookings = [];
    expect(buildAtomicDiff(before, after, AGENCY).deletes).toEqual({ departure_group_bookings: [BOOKING] });
  });

  it("only ever appends to the activity log", () => {
    const entry = { id: "44444444-4444-4444-8444-444444444444", departure_group_id: GROUP, message: "x" };
    const before = storeWith({ groups: [group()], activity: [entry as never] });
    const after = clone(before);
    after.activity[0].message = "edited";
    after.activity.push({ ...entry, id: "55555555-5555-4555-8555-555555555555" } as never);

    const diff = buildAtomicDiff(before, after, AGENCY);
    expect(diff.changes.departure_group_activity_logs).toHaveLength(1);
    expect(diff.deletes.departure_group_activity_logs).toBeUndefined();
  });
});
