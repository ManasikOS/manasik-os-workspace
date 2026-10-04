/**
 * Manifest export and pilgrim import for a single departure group.
 *
 * Sibling of `csv.ts`, which does the same job for the groups list: this module
 * owns the column contracts, `csv.ts`/`xlsx.ts` own the file formats. Client-safe
 * — no server imports — because both the export handler and the import dialog run
 * in the browser.
 *
 * Two shapes are deliberately different:
 *   * the export is one row per pilgrim (a manifest is a list of people), and
 *   * the import is also one row per pilgrim, but rows are grouped into bookings,
 *     because a booking — not a pilgrim — is what holds seats, money and a room
 *     preference. `booking_reference` is that grouping key.
 */

import type { DepartureGroupCapabilities } from "@/lib/access/departure-groups-access";

import { toCsv } from "./csv";
import type {
  BookingStatus,
  CreateGroupBookingInput,
  DepartureGroupBooking,
  DepartureGroupManifestRow,
  DepartureGroupPricing,
  RoomType,
} from "./types";
import {
  BOOKING_STATUS_LABELS,
  FLIGHT_PILGRIM_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  ROOM_TYPE_LABELS,
  SEAT_STATUS_LABELS,
  VISA_STATUS_LABELS,
} from "./utils";

/* ── Export ───────────────────────────────────────────────────────────────── */

interface ManifestColumn {
  header: string;
  value: (
    row: DepartureGroupManifestRow,
    booking: DepartureGroupBooking | undefined,
  ) => string;
  /** Columns the role may not see are left out of the file entirely. */
  visible?: (can: DepartureGroupCapabilities) => boolean;
}

const EMERGENCY_LABELS: Record<string, string> = {
  COMPLETE: "Complete",
  INCOMPLETE: "Incomplete",
  MISSING: "Missing",
};

/**
 * The manifest as an operator would want it in Excel: the on-screen table plus
 * the fields that only live in the booking (contact, traveller count, money).
 * Enums are written as their human labels, and every date stays ISO so a
 * spreadsheet can sort it.
 *
 * Sensitive and finance columns are dropped for roles without the capability.
 * The values are already nulled upstream by the data layer, so this is about not
 * shipping a wall of empty columns rather than about hiding data.
 */
const MANIFEST_COLUMNS: ManifestColumn[] = [
  { header: "Pilgrim Name", value: (row) => row.fullName },
  {
    header: "Passport Number",
    value: (row) => row.passportNumber ?? "",
    visible: (can) => can.viewSensitiveTravellerData,
  },
  { header: "Phone", value: (row) => row.phone ?? "" },
  { header: "Booking Reference", value: (row) => row.bookingReference },
  { header: "Booking / Family", value: (row) => row.bookingLabel },
  {
    header: "Booking Status",
    value: (row) => BOOKING_STATUS_LABELS[row.bookingStatus],
  },
  {
    header: "Primary Contact",
    value: (_row, booking) => booking?.primaryContactName ?? "",
  },
  {
    header: "Primary Contact Phone",
    value: (_row, booking) => booking?.primaryContactPhone ?? "",
  },
  {
    header: "Travellers On Booking",
    value: (_row, booking) =>
      booking ? String(booking.travellerCount) : "",
  },
  {
    header: "Room Type",
    value: (row) => ROOM_TYPE_LABELS[row.roomTypePreference],
  },
  { header: "Room Assigned", value: (row) => row.roomLabel ?? "" },
  { header: "Seat Status", value: (row) => SEAT_STATUS_LABELS[row.seatStatus] },
  {
    header: "Flight Status",
    value: (row) => FLIGHT_PILGRIM_STATUS_LABELS[row.flightStatus],
  },
  { header: "Visa Status", value: (row) => VISA_STATUS_LABELS[row.visaStatus] },
  {
    header: "Visa ID",
    value: (row) => row.visaId ?? "",
    visible: (can) => can.viewSensitiveTravellerData,
  },
  {
    header: "Documents Completed",
    value: (row) => String(row.documentsCompleted),
  },
  {
    header: "Documents Required",
    value: (row) => String(row.documentsRequired),
  },
  {
    header: "Documents %",
    value: (row) => String(row.documentCompletionPercent),
  },
  {
    header: "Payment Status",
    value: (row) => PAYMENT_STATUS_LABELS[row.paymentStatus],
  },
  {
    header: "Total Booking Value",
    value: (_row, booking) => (booking ? String(booking.totalBookingValue) : ""),
    visible: (can) => can.viewFinance,
  },
  {
    header: "Amount Paid",
    value: (_row, booking) => (booking ? String(booking.amountPaid) : ""),
    visible: (can) => can.viewFinance,
  },
  {
    header: "Outstanding Balance",
    value: (row) => String(row.outstandingBalance),
    visible: (can) => can.viewFinance,
  },
  {
    header: "Next Payment Due",
    value: (row) => (row.nextDueAt ? row.nextDueAt.slice(0, 10) : ""),
    visible: (can) => can.viewFinance,
  },
  {
    header: "Emergency Contact",
    value: (row) => EMERGENCY_LABELS[row.emergencyContactStatus] ?? "",
  },
];

/**
 * The manifest as a string matrix (header + one row per pilgrim). Shared by the
 * CSV and XLSX exporters so both formats carry identical data.
 */
export function manifestToMatrix(
  rows: DepartureGroupManifestRow[],
  bookings: DepartureGroupBooking[],
  can: DepartureGroupCapabilities,
): string[][] {
  const columns = MANIFEST_COLUMNS.filter(
    (column) => !column.visible || column.visible(can),
  );
  const bookingsById = new Map(
    bookings.map((booking) => [booking.id, booking] as const),
  );

  const header = columns.map((column) => column.header);
  const body = rows.map((row) =>
    columns.map((column) => column.value(row, bookingsById.get(row.bookingId))),
  );
  return [header, ...body];
}

export function manifestToCsv(
  rows: DepartureGroupManifestRow[],
  bookings: DepartureGroupBooking[],
  can: DepartureGroupCapabilities,
): string {
  return toCsv(manifestToMatrix(rows, bookings, can));
}

/* ── Import ───────────────────────────────────────────────────────────────── */

/** Column keys the pilgrim importer understands, in template order. */
export const PILGRIM_IMPORT_COLUMNS = [
  "booking_reference",
  "full_name",
  "phone",
  "passport_number",
  "primary_contact_name",
  "primary_contact_phone",
  "room_type",
  "booking_status",
  "price_per_person",
  "amount_paid",
] as const;

/**
 * A starter template: the header, then one two-traveller family sharing a
 * booking reference and one lone traveller, which is the shape operators get
 * wrong most often.
 */
export function pilgrimImportTemplateMatrix(
  pricing?: DepartureGroupPricing,
): string[][] {
  // The 485,000 / 615,000 fallbacks only fire when no group is in context at
  // all (there is no real departure to price from) — they are placeholder
  // example values for the blank template, never a substitute for a real
  // group's current price.
  const quad = pricing?.quadPrice ?? 485000;
  const double = pricing?.doublePrice ?? 615000;

  return [
    [...PILGRIM_IMPORT_COLUMNS],
    [
      "FAMILY-01",
      "Ahmed Yoosuf",
      "+94 77 123 4567",
      "N7123456",
      "Ahmed Yoosuf",
      "+94 77 123 4567",
      "Quad",
      "Confirmed",
      String(quad),
      "150000",
    ],
    [
      "FAMILY-01",
      "Fathima Yoosuf",
      "+94 77 123 4568",
      "N7123457",
      "",
      "",
      "",
      "",
      "",
      "",
    ],
    [
      "",
      "Ibrahim Nazeer",
      "+94 71 555 8899",
      "N7654321",
      "",
      "",
      "Double",
      "Deposit Pending",
      String(double),
      "0",
    ],
  ];
}

export function pilgrimImportTemplateCsv(
  pricing?: DepartureGroupPricing,
): string {
  return toCsv(pilgrimImportTemplateMatrix(pricing));
}

export interface PilgrimImportTraveller {
  rowNumber: number;
  fullName: string;
  phone?: string;
  passportNumber?: string;
}

export interface PilgrimImportCandidate {
  /** 1-based position among the bookings the file describes. */
  bookingNumber: number;
  /** Data-row numbers that fed this booking, for error messages. */
  rowNumbers: number[];
  /** Empty when the file left it blank and a reference was generated. */
  suppliedReference: string;
  referenceGenerated: boolean;
  travellers: PilgrimImportTraveller[];
  /** Best-effort payload; may still fail schema validation downstream. */
  payload: CreateGroupBookingInput;
  /** Structural problems the Zod schema cannot express. */
  mappingErrors: string[];
}

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/\s+/g, "_");
}

function parseNumber(raw: string): number | null {
  const value = raw.trim().replace(/[, ]/g, "");
  if (value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Accepts the enum (`QUAD`), the label (`Quad`) and bare occupancy counts. */
function normalizeRoomType(raw: string): RoomType | null {
  const value = raw.trim();
  if (!value) return null;

  const upper = value.toUpperCase();
  if (["QUAD", "TRIPLE", "DOUBLE", "SINGLE", "OTHER"].includes(upper)) {
    return upper as RoomType;
  }
  const byCount: Record<string, RoomType> = {
    "1": "SINGLE",
    "2": "DOUBLE",
    "3": "TRIPLE",
    "4": "QUAD",
  };
  if (byCount[upper]) return byCount[upper];

  const byLabel = Object.entries(ROOM_TYPE_LABELS).find(
    ([, label]) => label.toLowerCase() === value.toLowerCase(),
  );
  return byLabel ? (byLabel[0] as RoomType) : null;
}

/** Accepts the enum (`DEPOSIT_PENDING`) and the label (`Deposit Pending`). */
function normalizeBookingStatus(raw: string): BookingStatus | null {
  const value = raw.trim();
  if (!value) return "CONFIRMED";

  const upper = value.toUpperCase().replace(/\s+/g, "_");
  const enums: BookingStatus[] = [
    "HELD",
    "DEPOSIT_PENDING",
    "CONFIRMED",
    "CANCELLED",
    "WAITLIST",
  ];
  if (enums.includes(upper as BookingStatus)) return upper as BookingStatus;

  const byLabel = Object.entries(BOOKING_STATUS_LABELS).find(
    ([, label]) => label.toLowerCase() === value.toLowerCase(),
  );
  return byLabel ? (byLabel[0] as BookingStatus) : null;
}

export interface PilgrimImportContext {
  departureGroupId: string;
  groupCode: string;
  /** The group's CURRENT price — never the frozen template snapshot. */
  pricing: DepartureGroupPricing;
  /** Bookings already on the group — used to number generated references. */
  existingBookingCount: number;
}

/**
 * Maps parsed spreadsheet rows into one create-booking payload per booking.
 *
 * Rows are grouped by `booking_reference`; a row that leaves it blank becomes a
 * booking of its own, which is what a file of unrelated single travellers looks
 * like. Booking-level fields (contact, room type, status, price, deposit) are
 * taken from the first row of each group that supplies them, so a family only
 * has to fill them in once — the shape the template demonstrates.
 *
 * Only structural problems are reported here; field validation is left to
 * `groupBookingSchema` so the rules stay in one place.
 */
export function buildPilgrimImportCandidates(
  rows: string[][],
  context: PilgrimImportContext,
): { candidates: PilgrimImportCandidate[]; headerError: string | null } {
  if (rows.length === 0) {
    return { candidates: [], headerError: "The file is empty." };
  }

  const headers = rows[0].map(normalizeHeader);
  if (!headers.includes("full_name")) {
    return {
      candidates: [],
      headerError:
        'Missing required column: full_name. Download the template for the expected format.',
    };
  }

  const cell = (row: string[], key: string) => {
    const at = headers.indexOf(key);
    return at === -1 ? "" : (row[at] ?? "").trim();
  };

  const priceByTier: Record<RoomType, number | null> = {
    QUAD: context.pricing.quadPrice,
    TRIPLE: context.pricing.triplePrice,
    DOUBLE: context.pricing.doublePrice,
    SINGLE: context.pricing.singlePrice,
    OTHER: null,
  };

  interface Bucket {
    suppliedReference: string;
    rows: { rowNumber: number; row: string[] }[];
  }

  // Group rows into bookings, preserving file order. A blank reference gets a
  // unique key so it cannot be merged with another blank row.
  const buckets = new Map<string, Bucket>();
  rows.slice(1).forEach((row, i) => {
    const rowNumber = i + 1;
    const supplied = cell(row, "booking_reference");
    const key = supplied ? `ref:${supplied.toUpperCase()}` : `row:${rowNumber}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.rows.push({ rowNumber, row });
    else
      buckets.set(key, {
        suppliedReference: supplied,
        rows: [{ rowNumber, row }],
      });
  });

  let generatedCursor = context.existingBookingCount;

  const candidates = [...buckets.values()].map((bucket, index) => {
    const mappingErrors: string[] = [];

    /** First non-empty value for a column across the booking's rows. */
    const shared = (key: string) => {
      for (const entry of bucket.rows) {
        const value = cell(entry.row, key);
        if (value) return value;
      }
      return "";
    };

    const travellers: PilgrimImportTraveller[] = bucket.rows.map((entry) => ({
      rowNumber: entry.rowNumber,
      fullName: cell(entry.row, "full_name"),
      phone: cell(entry.row, "phone") || undefined,
      passportNumber: cell(entry.row, "passport_number") || undefined,
    }));

    const unnamed = travellers.filter((traveller) => !traveller.fullName);
    if (unnamed.length > 0) {
      mappingErrors.push(
        `Row${unnamed.length > 1 ? "s" : ""} ${unnamed
          .map((traveller) => traveller.rowNumber)
          .join(", ")}: full_name is required.`,
      );
    }

    const rawRoomType = shared("room_type");
    const roomType = normalizeRoomType(rawRoomType);
    if (rawRoomType && roomType === null) {
      mappingErrors.push(`Unrecognised room type "${rawRoomType}".`);
    }

    const rawStatus = shared("booking_status");
    const bookingStatus = normalizeBookingStatus(rawStatus);
    if (bookingStatus === null) {
      mappingErrors.push(`Unrecognised booking status "${rawStatus}".`);
    } else if (bookingStatus === "CANCELLED") {
      mappingErrors.push("Bookings cannot be imported as cancelled.");
    }

    const occupancy = roomType ?? "QUAD";
    const rawPrice = shared("price_per_person");
    const parsedPrice = parseNumber(rawPrice);
    if (rawPrice && parsedPrice === null) {
      mappingErrors.push(`"${rawPrice}" is not a valid price per person.`);
    }
    const pricePerPerson = parsedPrice ?? priceByTier[occupancy] ?? 0;

    const rawPaid = shared("amount_paid");
    const parsedPaid = parseNumber(rawPaid);
    if (rawPaid && parsedPaid === null) {
      mappingErrors.push(`"${rawPaid}" is not a valid amount paid.`);
    }

    const primaryContactName =
      shared("primary_contact_name") || travellers[0]?.fullName || "";
    const primaryContactPhone =
      shared("primary_contact_phone") || travellers[0]?.phone || "";
    if (!primaryContactPhone) {
      mappingErrors.push(
        "A contact number is required — fill primary_contact_phone or phone.",
      );
    }

    // A blank reference is numbered on from the group's existing bookings; the
    // store re-numbers if the guess collides, so a clash is not an error.
    let reference = bucket.suppliedReference.toUpperCase();
    const referenceGenerated = reference === "";
    if (referenceGenerated) {
      generatedCursor += 1;
      reference = `${context.groupCode}-BK${String(generatedCursor).padStart(3, "0")}`;
    }

    const payload: CreateGroupBookingInput = {
      departureGroupId: context.departureGroupId,
      bookingReference: reference,
      bookingStatus: bookingStatus ?? "CONFIRMED",
      primaryContactName,
      primaryContactPhone,
      travellerCount: travellers.length,
      roomOccupancyPreference: occupancy,
      packagePricePerPerson: Math.max(0, pricePerPerson),
      amountPaid: Math.max(0, parsedPaid ?? 0),
      travellers: travellers.map((traveller) => ({
        fullName: traveller.fullName,
        phone: traveller.phone,
        passportNumber: traveller.passportNumber,
      })),
    };

    return {
      bookingNumber: index + 1,
      rowNumbers: bucket.rows.map((entry) => entry.rowNumber),
      suppliedReference: bucket.suppliedReference,
      referenceGenerated,
      travellers,
      payload,
      mappingErrors,
    };
  });

  return { candidates, headerError: null };
}
