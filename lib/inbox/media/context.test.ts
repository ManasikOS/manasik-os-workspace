import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { loadInboxMediaContext } from "./context";

const AGENCY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_AGENCY = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

type Row = Record<string, unknown>;

function fakeDb(seed: Record<string, Row[]>) {
  const queries: Array<{ table: string; filters: Array<[string, unknown]> }> = [];
  return {
    queries,
    db: {
      from(table: string) {
        const filters: Array<[string, unknown]> = [];
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: (column: string, value: unknown) => (filters.push([column, value]), chain),
          in: (column: string, values: unknown[]) => (filters.push([column, values]), chain),
          maybeSingle: () => {
            queries.push({ table, filters });
            const row = (seed[table] ?? []).find((entry) => filters.every(([column, value]) => Array.isArray(value) ? value.includes(entry[column]) : entry[column] === value)) ?? null;
            return Promise.resolve({ data: row, error: null });
          },
          then: (resolve: (value: unknown) => unknown) => {
            queries.push({ table, filters });
            const rows = (seed[table] ?? []).filter((entry) => filters.every(([column, value]) => Array.isArray(value) ? value.includes(entry[column]) : entry[column] === value));
            return resolve({ data: rows, error: null });
          },
        };
        return chain;
      },
    } as never,
  };
}

describe("loadInboxMediaContext", () => {
  it("loads the linked booking's travellers once and excludes another agency", async () => {
    const { db, queries } = fakeDb({
      conversations: [{ id: "conversation-1", agency_id: AGENCY, lead_id: "lead-1" }],
      leads: [{ id: "lead-1", agency_id: AGENCY, booking_id: "booking-1", selected_departure_group_id: "group-2" }],
      departure_group_bookings: [{ id: "booking-1", agency_id: AGENCY, departure_group_id: "group-1" }],
      departure_group_pilgrims: [
        { id: "traveller-1", agency_id: AGENCY, booking_id: "booking-1", full_name_snapshot: "Aisha", passport_number_snapshot: "N1" },
        { id: "foreign-traveller", agency_id: OTHER_AGENCY, booking_id: "booking-1", full_name_snapshot: "Foreign", passport_number_snapshot: "N2" },
      ],
      departure_groups: [{ id: "group-1", agency_id: AGENCY, departure_date: "2026-12-01" }],
      agency_settings: [{ agency_id: AGENCY, passport_validity_months: 9 }],
    });

    await expect(loadInboxMediaContext(db, { agencyId: AGENCY, conversationId: "conversation-1" })).resolves.toMatchObject({
      leadId: "lead-1",
      bookingId: "booking-1",
      departureDate: "2026-12-01",
      departureGroupId: "group-1",
      passportValidityMonths: 9,
      travellers: [{ id: "traveller-1", fullName: "Aisha", passportNumber: "N1" }],
    });
    expect(queries.filter((query) => query.table === "departure_group_pilgrims")).toHaveLength(1);
    expect(queries.find((query) => query.table === "departure_group_pilgrims")?.filters).toContainEqual(["agency_id", AGENCY]);
  });

  it("links the booking's departure group, falling back to the lead's selected group", async () => {
    const seed = {
      conversations: [{ id: "conversation-1", agency_id: AGENCY, lead_id: "lead-1" }],
      leads: [{ id: "lead-1", agency_id: AGENCY, booking_id: null, selected_departure_group_id: "group-2" }],
      departure_groups: [{ id: "group-2", agency_id: AGENCY, departure_date: "2027-01-10" }],
    };
    const { db } = fakeDb(seed);
    await expect(loadInboxMediaContext(db, { agencyId: AGENCY, conversationId: "conversation-1" })).resolves.toMatchObject({
      departureGroupId: "group-2",
      departureDate: "2027-01-10",
    });
  });

  it("never links a departure group from another agency, or when the chat has no lead", async () => {
    const { db: foreign } = fakeDb({
      conversations: [{ id: "conversation-1", agency_id: AGENCY, lead_id: "lead-1" }],
      leads: [{ id: "lead-1", agency_id: AGENCY, booking_id: null, selected_departure_group_id: "foreign-group" }],
      departure_groups: [{ id: "foreign-group", agency_id: OTHER_AGENCY, departure_date: "2027-01-10" }],
    });
    await expect(loadInboxMediaContext(foreign, { agencyId: AGENCY, conversationId: "conversation-1" })).resolves.toMatchObject({ departureGroupId: null });

    const { db: unlinked } = fakeDb({ conversations: [{ id: "conversation-1", agency_id: AGENCY, lead_id: null }] });
    await expect(loadInboxMediaContext(unlinked, { agencyId: AGENCY, conversationId: "conversation-1" })).resolves.toMatchObject({ leadId: null, departureGroupId: null });
  });
});
