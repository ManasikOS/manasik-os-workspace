import { describe, expect, it } from "vitest";

import {
  checkErasure,
  collectTravellerFilePaths,
  eraseTravellerSensitiveFieldsInStore,
  retentionCutoffDate,
  type ErasureSubject,
} from "./departure-groups-erasure";
import { emptyStore } from "./departure-groups-repository";
import type { DepartureGroupStore, GroupActor } from "@/lib/types/departure-groups";

const NOW = new Date("2026-10-06T10:00:00Z");
const actor: GroupActor = { id: "staff-1", name: "Admin", agencyId: "agency-1" };

const GROUP = "11111111-1111-4111-8111-111111111111";
const PILGRIM = "22222222-2222-4222-8222-222222222222";
const OTHER_PILGRIM = "33333333-3333-4333-8333-333333333333";
const BOOKING = "44444444-4444-4444-8444-444444444444";

const subject = (overrides: Partial<ErasureSubject> = {}): ErasureSubject => ({
  returnDate: "2024-06-01",
  groupStatus: "COMPLETED",
  seatStatus: "TICKETED",
  bookingStatus: "CONFIRMED",
  outstandingBalance: 0,
  alreadyErased: false,
  ...overrides,
});

describe("retentionCutoffDate", () => {
  it("is 24 months before today", () => {
    expect(retentionCutoffDate(NOW)).toBe("2024-10-06");
  });
});

describe("checkErasure", () => {
  it("retention: due only 24+ months after the return date", () => {
    expect(checkErasure(subject({ returnDate: "2024-10-05" }), "RETENTION", NOW).ok).toBe(true);
    expect(checkErasure(subject({ returnDate: "2024-10-06" }), "RETENTION", NOW).ok).toBe(false);
    expect(checkErasure(subject({ returnDate: "2026-01-01" }), "RETENTION", NOW).ok).toBe(false);
  });

  it("retention: waits while money or a refund is still open", () => {
    expect(checkErasure(subject({ outstandingBalance: 10 }), "RETENTION", NOW).ok).toBe(false);
    expect(checkErasure(subject({ seatStatus: "REFUND_PENDING" }), "RETENTION", NOW).ok).toBe(false);
  });

  it("request: refused while the trip has not finished, allowed after it or once cancelled", () => {
    expect(checkErasure(subject({ returnDate: "2026-12-01", groupStatus: "READY" }), "REQUEST", NOW).ok).toBe(false);
    expect(checkErasure(subject({ returnDate: "2026-10-06", groupStatus: "READY" }), "REQUEST", NOW).ok).toBe(false);
    expect(checkErasure(subject({ returnDate: "2026-09-01" }), "REQUEST", NOW).ok).toBe(true);
    expect(checkErasure(subject({ returnDate: "2026-12-01", bookingStatus: "CANCELLED" }), "REQUEST", NOW).ok).toBe(true);
    expect(checkErasure(subject({ returnDate: "2026-12-01", groupStatus: "CANCELLED" }), "REQUEST", NOW).ok).toBe(true);
  });

  it("request: money owed does not block a person's request once the trip is over", () => {
    expect(checkErasure(subject({ returnDate: "2026-09-01", outstandingBalance: 500 }), "REQUEST", NOW).ok).toBe(true);
  });

  it("never erases twice", () => {
    expect(checkErasure(subject({ alreadyErased: true }), "REQUEST", NOW).ok).toBe(false);
    expect(checkErasure(subject({ alreadyErased: true }), "RETENTION", NOW).ok).toBe(false);
  });
});

function fixture(): DepartureGroupStore {
  const data = emptyStore();
  data.groups.push({ id: GROUP, group_status: "COMPLETED", return_date: "2024-06-01" } as never);
  data.bookings.push({ id: BOOKING, booking_status: "CONFIRMED", outstanding_balance: 0 } as never);
  data.pilgrims.push(
    {
      id: PILGRIM,
      departure_group_id: GROUP,
      booking_id: BOOKING,
      pilgrim_id: "person-1",
      full_name_snapshot: "Aisha Rahman",
      phone_snapshot: "+94771234567",
      passport_number_snapshot: "N1234567",
      passport_expiry: "2030-01-01",
      passport_issue_country: "LK",
      date_of_birth: "1980-01-01",
      seat_status: "TICKETED",
      visa_id: "V-998",
      visa_file_path: "agency/group/pilgrim/visa-1.pdf",
      visa_ai_extracted: { passport: "N1234567" },
      ticket_file_path: "agency/group/pilgrim/ticket-1.pdf",
      ticket_file_name: "ticket.pdf",
      ticket_ai_extracted: { name: "AISHA RAHMAN" },
      emergency_contact_name: "Bilal",
      emergency_contact_phone: "+94770000000",
      emergency_contact_relationship: "Brother",
    } as never,
    {
      id: OTHER_PILGRIM,
      departure_group_id: GROUP,
      booking_id: BOOKING,
      pilgrim_id: "person-2",
      full_name_snapshot: "Zayd Rahman",
      passport_number_snapshot: "N7654321",
      seat_status: "TICKETED",
    } as never,
  );
  data.pilgrimDocuments.push(
    { id: "d1", pilgrim_id: PILGRIM, status: "VERIFIED", file_path: "agency/group/pilgrim/passport-1.jpg", file_name: "p.jpg", file_size_bytes: 10, notes: "scan ok" } as never,
    { id: "d2", pilgrim_id: PILGRIM, status: "NOT_SUBMITTED", file_path: null, file_name: null, file_size_bytes: null, notes: null } as never,
    { id: "d3", pilgrim_id: OTHER_PILGRIM, status: "VERIFIED", file_path: "agency/group/other/passport-2.jpg", file_name: "q.jpg", file_size_bytes: 11, notes: null } as never,
  );
  return data;
}

describe("eraseTravellerSensitiveFieldsInStore", () => {
  it("collects every stored file for the traveller and no one else's", () => {
    expect(collectTravellerFilePaths(fixture(), PILGRIM).sort()).toEqual([
      "agency/group/pilgrim/passport-1.jpg",
      "agency/group/pilgrim/ticket-1.pdf",
      "agency/group/pilgrim/visa-1.pdf",
    ]);
  });

  it("clears the sensitive columns, keeps the name and the document status, and stamps the erasure", () => {
    const data = fixture();
    const outcome = eraseTravellerSensitiveFieldsInStore(data, { departureGroupId: GROUP, pilgrimId: PILGRIM, reason: "RETENTION" }, actor, NOW);
    expect(outcome.ok).toBe(true);

    const pilgrim = data.pilgrims.find((p) => p.id === PILGRIM)!;
    expect(pilgrim.full_name_snapshot).toBe("Aisha Rahman");
    for (const field of ["phone_snapshot", "passport_number_snapshot", "passport_expiry", "date_of_birth", "visa_id", "visa_file_path", "visa_ai_extracted", "ticket_file_path", "ticket_ai_extracted", "emergency_contact_name", "emergency_contact_phone"] as const) {
      expect(pilgrim[field], field).toBeNull();
    }
    expect(pilgrim.sensitive_data_erased_at).toBe(NOW.toISOString());

    const documents = data.pilgrimDocuments.filter((d) => d.pilgrim_id === PILGRIM);
    expect(documents.every((d) => d.file_path === null && d.file_name === null && d.notes === null)).toBe(true);
    expect(documents.find((d) => d.id === "d1")!.status).toBe("VERIFIED");
  });

  it("leaves the other traveller on the booking untouched", () => {
    const data = fixture();
    eraseTravellerSensitiveFieldsInStore(data, { departureGroupId: GROUP, pilgrimId: PILGRIM, reason: "RETENTION" }, actor, NOW);
    const other = data.pilgrims.find((p) => p.id === OTHER_PILGRIM)!;
    expect(other.passport_number_snapshot).toBe("N7654321");
    expect(other.sensitive_data_erased_at).toBeUndefined();
    expect(data.pilgrimDocuments.find((d) => d.id === "d3")!.file_path).toBe("agency/group/other/passport-2.jpg");
  });

  it("writes an audit entry that names no personal detail", () => {
    const data = fixture();
    eraseTravellerSensitiveFieldsInStore(data, { departureGroupId: GROUP, pilgrimId: PILGRIM, reason: "REQUEST" }, actor, NOW);
    const entry = data.activity.at(-1)!;
    expect(entry.action_type).toBe("TRAVELLER_DATA_ERASED");
    const text = JSON.stringify(entry);
    for (const secret of ["N1234567", "+94771234567", "V-998", "1980-01-01"]) expect(text).not.toContain(secret);
  });

  it("refuses without changing anything when the rules say no", () => {
    const data = fixture();
    data.groups[0].return_date = "2026-01-01";
    const outcome = eraseTravellerSensitiveFieldsInStore(data, { departureGroupId: GROUP, pilgrimId: PILGRIM, reason: "RETENTION" }, actor, NOW);
    expect(outcome.ok).toBe(false);
    expect(data.pilgrims.find((p) => p.id === PILGRIM)!.passport_number_snapshot).toBe("N1234567");
    expect(data.activity).toHaveLength(0);
  });

  it("refuses a second erasure", () => {
    const data = fixture();
    const input = { departureGroupId: GROUP, pilgrimId: PILGRIM, reason: "RETENTION" as const };
    expect(eraseTravellerSensitiveFieldsInStore(data, input, actor, NOW).ok).toBe(true);
    expect(eraseTravellerSensitiveFieldsInStore(data, input, actor, NOW).ok).toBe(false);
  });

  it("reports a traveller who is not on the group", () => {
    const outcome = eraseTravellerSensitiveFieldsInStore(fixture(), { departureGroupId: GROUP, pilgrimId: "nope", reason: "REQUEST" }, actor, NOW);
    expect(outcome).toEqual({ ok: false, error: "That traveller is no longer on this group." });
  });
});
