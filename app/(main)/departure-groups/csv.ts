/**
 * CSV import/export for the Departure Groups list.
 *
 * Client-safe — no server imports — because both the export handler and the
 * import dialog run in the browser. The CSV primitives themselves
 * (`toCsv`/`parseCsv`/`downloadTextFile`/`timestampedFilename`) live in
 * `@/lib/csv` and are re-exported here so existing imports keep working.
 */

import { toCsv, parseCsv, downloadTextFile, timestampedFilename } from "@/lib/csv";

import type {
  CreateDepartureGroupInput,
  DepartureGroupListItem,
  GroupSalesStatus,
  PackageTemplateOption,
} from "./types";
import {
  GROUP_STATUS_LABELS,
  JOURNEY_TYPE_LABELS,
  READINESS_STATUS_LABELS,
  SALES_STATUS_LABELS,
} from "./utils";

export { toCsv, parseCsv, downloadTextFile, timestampedFilename };

/** Triggers a browser download of raw bytes (used for the .xlsx export). */
export function downloadBinaryFile(
  filename: string,
  bytes: Uint8Array,
  mime: string,
): void {
  const blob = new Blob([bytes as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ── Export ───────────────────────────────────────────────────────────────── */

interface ExportColumn {
  header: string;
  value: (group: DepartureGroupListItem) => string;
}

/**
 * The export mirrors the list table plus the fields an operator would want in a
 * spreadsheet (owners, minimum size, exact seat counts). Enums are written as
 * their human labels, not the raw upper-case codes.
 */
const EXPORT_COLUMNS: ExportColumn[] = [
  { header: "Group Name", value: (g) => g.groupName },
  { header: "Group Code", value: (g) => g.groupCode },
  { header: "Package Template", value: (g) => g.packageTemplateName },
  { header: "Package Code", value: (g) => g.packageTemplateCode },
  { header: "Journey Type", value: (g) => JOURNEY_TYPE_LABELS[g.journeyType] },
  { header: "Departure Date", value: (g) => g.departureDate },
  { header: "Return Date", value: (g) => g.returnDate },
  { header: "Duration (days)", value: (g) => String(g.durationDays) },
  { header: "Capacity", value: (g) => String(g.capacity) },
  { header: "Minimum Group Size", value: (g) => String(g.minimumGroupSize) },
  { header: "Booked Seats", value: (g) => String(g.bookedSeats) },
  { header: "Held Seats", value: (g) => String(g.heldSeats) },
  { header: "Available Seats", value: (g) => String(g.availableSeats) },
  { header: "Sales Status", value: (g) => SALES_STATUS_LABELS[g.salesStatus] },
  {
    header: "Operations Status",
    value: (g) => GROUP_STATUS_LABELS[g.groupStatus],
  },
  { header: "Readiness Score", value: (g) => `${g.readinessScore}%` },
  {
    header: "Readiness Status",
    value: (g) => READINESS_STATUS_LABELS[g.readinessStatus],
  },
  { header: "Primary Blocker", value: (g) => g.primaryBlocker },
  { header: "Branch", value: (g) => g.branch },
  { header: "Primary Guide", value: (g) => g.primaryGuideName ?? "Unassigned" },
  {
    header: "Operations Owner",
    value: (g) => g.operationsOwnerName ?? "Unassigned",
  },
  { header: "Waitlist Enabled", value: (g) => (g.waitlistEnabled ? "Yes" : "No") },
  {
    header: "Days Until Departure",
    value: (g) => String(g.daysUntilDeparture),
  },
];

/**
 * The export as a plain string matrix (header + one row per group). Shared by
 * the CSV and XLSX exporters so both formats carry identical data.
 */
export function groupsToMatrix(groups: DepartureGroupListItem[]): string[][] {
  const header = EXPORT_COLUMNS.map((column) => column.header);
  const rows = groups.map((group) =>
    EXPORT_COLUMNS.map((column) => column.value(group)),
  );
  return [header, ...rows];
}

export function groupsToCsv(groups: DepartureGroupListItem[]): string {
  return toCsv(groupsToMatrix(groups));
}

/* ── Import ───────────────────────────────────────────────────────────────── */

/** Column keys the importer understands, in template order. */
export const IMPORT_COLUMNS = [
  "group_name",
  "group_code",
  "package_code",
  "departure_date",
  "return_date",
  "capacity",
  "minimum_group_size",
  "sales_status",
  "branch",
  "operations_owner",
  "primary_guide",
  "waitlist_enabled",
  "seat_hold_expiry_hours",
] as const;

/** A starter template (header + one worked example row) as a string matrix. */
export function importTemplateMatrix(
  example?: PackageTemplateOption,
): string[][] {
  const header = [...IMPORT_COLUMNS];
  const sample = [
    "September Umrah Group 09",
    "UM-SEP-26-09",
    example?.code ?? "RF-PKG-2026-UM01",
    "2026-09-20",
    "2026-09-30",
    String(example?.defaultCapacity ?? 40),
    String(example?.minGroupSize ?? 15),
    "Selling",
    "Colombo",
    "M. Rameez",
    "Imran R.",
    "true",
    String(example?.seatHoldExpiryHours ?? 24),
  ];
  return [header, sample];
}

/** The template as CSV text. */
export function importTemplateCsv(example?: PackageTemplateOption): string {
  return toCsv(importTemplateMatrix(example));
}

export type ImportPayload = CreateDepartureGroupInput & {
  allowDraftTemplate: boolean;
};

export interface ImportCandidate {
  /** 1-based position among the data rows, for the preview and error messages. */
  rowNumber: number;
  groupName: string;
  groupCode: string;
  packageLabel: string;
  /** Best-effort payload; may still fail schema validation downstream. */
  payload: ImportPayload;
  /** Structural problems the Zod schema cannot express (e.g. unknown package). */
  mappingErrors: string[];
}

const ALL_COPY_OPTIONS = {
  itinerary: true,
  inclusionsAndExclusions: true,
  travellerRequirements: true,
  readinessChecklist: true,
  accommodation: true,
  transport: true,
  flights: true,
};

/** Accepts both the enum (`SELLING`) and the label (`Selling`). */
function normalizeSalesStatus(raw: string): GroupSalesStatus | null {
  const value = raw.trim();
  if (!value) return "SELLING";
  const upper = value.toUpperCase().replace(/\s+/g, "_");
  const enums: GroupSalesStatus[] = [
    "SELLING",
    "LIMITED_AVAILABILITY",
    "WAITLIST",
    "SALES_CLOSED",
    "CANCELLED",
  ];
  if (enums.includes(upper as GroupSalesStatus)) return upper as GroupSalesStatus;

  const byLabel = Object.entries(SALES_STATUS_LABELS).find(
    ([, label]) => label.toLowerCase() === value.toLowerCase(),
  );
  return byLabel ? (byLabel[0] as GroupSalesStatus) : null;
}

function parseBoolean(raw: string, fallback: boolean): boolean {
  const value = raw.trim().toLowerCase();
  if (value === "") return fallback;
  return ["true", "yes", "y", "1"].includes(value);
}

function parseInteger(raw: string): number | null {
  const value = raw.trim();
  if (value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

/** Normalizes a header cell to one of `IMPORT_COLUMNS`. */
function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/\s+/g, "_");
}

/**
 * Maps parsed CSV rows to create-group payloads, resolving `package_code`
 * against the available templates. Returns one candidate per data row, with any
 * structural problems collected in `mappingErrors`; full field validation is
 * left to `createDepartureGroupSchema` so the rules stay in one place.
 */
export function buildImportCandidates(
  rows: string[][],
  templates: PackageTemplateOption[],
): { candidates: ImportCandidate[]; headerError: string | null } {
  if (rows.length === 0) {
    return { candidates: [], headerError: "The file is empty." };
  }

  const headers = rows[0].map(normalizeHeader);
  const missing = ["group_name", "group_code", "package_code"].filter(
    (required) => !headers.includes(required),
  );
  if (missing.length > 0) {
    return {
      candidates: [],
      headerError: `Missing required column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}. Download the template for the expected format.`,
    };
  }

  const index = (key: string) => headers.indexOf(key);
  const cell = (row: string[], key: string) => {
    const at = index(key);
    return at === -1 ? "" : (row[at] ?? "").trim();
  };

  const templatesByCode = new Map(
    templates.map((template) => [template.code.toUpperCase(), template]),
  );

  const candidates: ImportCandidate[] = rows.slice(1).map((row, i) => {
    const mappingErrors: string[] = [];

    const packageCode = cell(row, "package_code");
    const template = templatesByCode.get(packageCode.toUpperCase());
    if (!template) {
      mappingErrors.push(
        packageCode
          ? `Unknown package code "${packageCode}".`
          : "Package code is required.",
      );
    }

    const salesStatus = normalizeSalesStatus(cell(row, "sales_status"));
    if (salesStatus === null) {
      mappingErrors.push(`Unrecognised sales status "${cell(row, "sales_status")}".`);
    }

    if (!template && !cell(row, "capacity")) {
      // Without a template we have no default capacity to fall back on.
      mappingErrors.push("Capacity is required when the package is unknown.");
    }

    const capacity =
      parseInteger(cell(row, "capacity")) ?? template?.defaultCapacity ?? 0;
    const minimumGroupSize =
      parseInteger(cell(row, "minimum_group_size")) ??
      template?.minGroupSize ??
      0;
    const seatHold =
      parseInteger(cell(row, "seat_hold_expiry_hours")) ??
      template?.seatHoldExpiryHours ??
      24;

    const payload: ImportPayload = {
      packageTemplateId: template?.id ?? "",
      groupName: cell(row, "group_name"),
      groupCode: cell(row, "group_code").toUpperCase(),
      departureDate: cell(row, "departure_date"),
      returnDate: cell(row, "return_date"),
      capacity,
      minimumGroupSize,
      salesStatus: salesStatus ?? "SELLING",
      branch: cell(row, "branch") || "Colombo",
      operationsOwnerName: cell(row, "operations_owner") || undefined,
      primaryGuideName: cell(row, "primary_guide") || undefined,
      waitlistEnabled: parseBoolean(
        cell(row, "waitlist_enabled"),
        template?.waitlistEnabled ?? true,
      ),
      seatHoldExpiryHours: seatHold,
      copyOptions: ALL_COPY_OPTIONS,
      allowDraftTemplate: template ? !template.isOpenForSale : false,
      // Bulk CSV import has no columns for per-departure pricing/cost/flight
      // facts yet — created groups start blank and are priced afterward.
      pricing: {
        currency: "LKR",
        quadPrice: null,
        triplePrice: null,
        doublePrice: null,
        singlePrice: null,
        childPrice: null,
        infantPrice: null,
        earlyBirdPrice: null,
        advanceDeposit: null,
      },
      costEstimate: {
        flightCostPerPilgrim: null,
        accommodationCostPerPilgrim: null,
        transportCostPerPilgrim: null,
        visaInsuranceCostPerPilgrim: null,
        cateringCostPerPilgrim: null,
        guideOperationsCostPerPilgrim: null,
        contingencyCostPerPilgrim: null,
        fixedCostPerDeparture: 0,
      },
      flightRouting: {
        flightsIncluded: false,
        departureOrigin: "",
        arrivalGateway: "",
        returnGateway: "",
        preferredAirline: "",
        cabinClass: "Economy",
      },
    };

    return {
      rowNumber: i + 1,
      groupName: payload.groupName || "(unnamed)",
      groupCode: payload.groupCode || "—",
      packageLabel: template?.name ?? packageCode ?? "—",
      payload,
      mappingErrors,
    };
  });

  return { candidates, headerError: null };
}
