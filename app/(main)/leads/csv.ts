/**
 * CSV export and import for the Leads list.
 *
 * Client-safe: both the export handler and the import dialog run in the
 * browser, and nothing leaves the machine — the file is built from data the
 * page already holds.
 *
 * Enums are written as their human labels rather than the raw upper-case codes,
 * and read back through a tolerant lookup, so a file can survive a round trip
 * through Excel and a bit of manual editing.
 */

import { normaliseMobile, type CreateLeadInput, type LeadListItem } from "@/lib/data/leads";
import { toCsv } from "@/lib/csv";
import type {
  FollowUpType,
  LeadJourneyType,
  LeadPackageRow,
  StaffRow,
  LeadSource,
  LeadStage,
  LeadTemperature,
} from "@/lib/types/leads";
import {
  FOLLOW_UP_STATUS_LABELS,
  FOLLOW_UP_TYPE_LABELS,
  JOURNEY_TYPE_LABELS,
  LOST_REASON_LABELS,
  SOURCE_LABELS,
  STAGE_LABELS,
  TEMPERATURE_LABELS,
  formatDateTime,
  localInputToIso,
} from "./utils";

export { downloadTextFile, parseCsv, timestampedFilename } from "@/lib/csv";

/* ── Export ───────────────────────────────────────────────────────────────── */

interface ExportColumn {
  header: string;
  value: (lead: LeadListItem) => string;
}

const EXPORT_COLUMNS: ExportColumn[] = [
  { header: "Lead ID", value: (l) => l.reference },
  { header: "Full Name", value: (l) => l.name },
  { header: "Mobile", value: (l) => l.mobile },
  { header: "Email", value: (l) => l.email ?? "" },
  { header: "City", value: (l) => l.city },
  { header: "Preferred Language", value: (l) => l.preferredLanguage },
  { header: "Journey Type", value: (l) => JOURNEY_TYPE_LABELS[l.journeyType] },
  { header: "Interested In", value: (l) => l.interestedIn },
  { header: "Package", value: (l) => l.packageName },
  { header: "Preferred Period", value: (l) => l.preferredPeriod },
  { header: "Adults", value: (l) => String(l.adults) },
  { header: "Children", value: (l) => String(l.children) },
  { header: "Party Size", value: (l) => String(l.partySize) },
  { header: "Departure City", value: (l) => l.departureCity },
  { header: "Budget Range", value: (l) => l.budgetRange },
  { header: "Source", value: (l) => SOURCE_LABELS[l.source] },
  { header: "Campaign / Reference", value: (l) => l.campaignReference ?? "" },
  { header: "Referred By", value: (l) => l.referralName ?? "" },
  { header: "Assigned Owner", value: (l) => l.assignedToName },
  { header: "Pipeline Stage", value: (l) => STAGE_LABELS[l.stage] },
  { header: "Temperature", value: (l) => TEMPERATURE_LABELS[l.temperature] },
  // Unformatted so the column totals in a spreadsheet.
  { header: "Estimated Value (LKR)", value: (l) => String(l.estimatedValueLkr) },
  {
    header: "Next Follow-Up",
    value: (l) => (l.nextFollowUpAt ? formatDateTime(l.nextFollowUpAt) : ""),
  },
  {
    header: "Follow-Up Type",
    value: (l) => (l.followUpType ? FOLLOW_UP_TYPE_LABELS[l.followUpType] : ""),
  },
  {
    header: "Follow-Up Status",
    value: (l) => FOLLOW_UP_STATUS_LABELS[l.followUpStatus],
  },
  {
    header: "Last Contacted",
    value: (l) => (l.lastContactedAt ? formatDateTime(l.lastContactedAt) : ""),
  },
  { header: "Days Since Contact", value: (l) => l.daysSinceLastContact?.toString() ?? "" },
  { header: "Age (days)", value: (l) => String(l.ageInDays) },
  {
    header: "Hajj Quota Waitlist",
    value: (l) => (l.quotaWaitlistInterest ? "Yes" : "No"),
  },
  {
    header: "Lost Reason",
    value: (l) => (l.lostReason ? LOST_REASON_LABELS[l.lostReason] : ""),
  },
  { header: "Notes", value: (l) => l.notes.map((note) => note.body).join(" | ") },
  { header: "Created", value: (l) => formatDateTime(l.createdAt) },
];

export function leadsToMatrix(leads: LeadListItem[]): string[][] {
  return [
    EXPORT_COLUMNS.map((column) => column.header),
    ...leads.map((lead) => EXPORT_COLUMNS.map((column) => column.value(lead))),
  ];
}

export function leadsToCsv(leads: LeadListItem[]): string {
  return toCsv(leadsToMatrix(leads));
}

/* ── Import ───────────────────────────────────────────────────────────────── */

/**
 * The columns an import file may carry. Only the first three are required;
 * everything else falls back to a sensible default so a two-column contact list
 * pasted out of WhatsApp still imports.
 */
export const IMPORT_TEMPLATE_HEADERS = [
  "Full Name",
  "Mobile",
  "Journey Type",
  "Email",
  "City",
  "Interested In",
  "Package",
  "Preferred Period",
  "Adults",
  "Children",
  "Source",
  "Campaign / Reference",
  "Assigned Owner",
  "Pipeline Stage",
  "Temperature",
  "Next Follow-Up",
  "Follow-Up Type",
  "Notes",
];

export function importTemplateCsv(): string {
  return toCsv([
    IMPORT_TEMPLATE_HEADERS,
    [
      "Ayesha Mariyam",
      "0772105543",
      "Umrah",
      "ayesha.m@gmail.com",
      "Kalutara",
      "School Holiday Umrah",
      "12 Days Economy Group Umrah",
      "Dec 2026 (School Holidays)",
      "2",
      "1",
      "Walk-in",
      "December Flyer",
      "H. Irfan",
      "New Lead",
      "Warm",
      "2026-12-01T10:00",
      "Call",
      "Asked about child pricing.",
    ],
  ]);
}

export interface ImportIssue {
  /** 1-based row number in the source file, counting the header. */
  row: number;
  message: string;
}

export interface ImportPreview {
  rows: CreateLeadInput[];
  issues: ImportIssue[];
  /** Rows skipped because a lead with the same mobile is already on file. */
  duplicates: { row: number; name: string; existingReference: string }[];
}

/** Case- and punctuation-insensitive lookup of an enum by its label. */
function decodeLabel<T extends string>(
  labels: Record<T, string>,
  raw: string,
): T | null {
  const needle = raw.trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (!needle) return null;

  for (const [code, label] of Object.entries(labels) as [T, string][]) {
    if (label.toLowerCase().replace(/[\s_-]+/g, "") === needle) return code;
    if (code.toLowerCase().replace(/[\s_-]+/g, "") === needle) return code;
  }
  return null;
}

function toPositiveInt(raw: string, fallback: number): number {
  const parsed = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/**
 * Turns a parsed CSV matrix into create-lead inputs, collecting per-row
 * problems rather than throwing — an operator importing 200 rows needs to see
 * every bad row at once, not the first one.
 */
export function matrixToLeadInputs(
  matrix: string[][],
  options: {
    existingMobiles: Map<string, string>;
    defaultAssigneeId: string;
    defaultAssigneeName: string;
    packages: LeadPackageRow[];
    staffOptions: StaffRow[];
  },
): ImportPreview {
  const issues: ImportIssue[] = [];
  const duplicates: ImportPreview["duplicates"] = [];
  const rows: CreateLeadInput[] = [];

  if (matrix.length < 2) {
    return {
      rows,
      issues: [{ row: 1, message: "The file has no data rows." }],
      duplicates,
    };
  }

  const headers = matrix[0].map((header) => header.trim().toLowerCase());
  const columnOf = (name: string) => headers.indexOf(name.toLowerCase());

  const nameIndex = columnOf("Full Name");
  const mobileIndex = columnOf("Mobile");
  if (nameIndex === -1 || mobileIndex === -1) {
    return {
      rows,
      issues: [
        {
          row: 1,
          message: 'The file must have a "Full Name" and a "Mobile" column.',
        },
      ],
      duplicates,
    };
  }

  const cell = (row: string[], header: string) => {
    const index = columnOf(header);
    return index === -1 ? "" : (row[index] ?? "").trim();
  };

  // Mobiles seen earlier in this same file, so a file that repeats a row does
  // not import it twice.
  const seen = new Map(options.existingMobiles);

  matrix.slice(1).forEach((row, offset) => {
    const rowNumber = offset + 2;
    const fullName = (row[nameIndex] ?? "").trim();
    const mobile = normaliseMobile(row[mobileIndex] ?? "");

    if (!fullName) {
      issues.push({ row: rowNumber, message: "Missing full name." });
      return;
    }
    if (mobile.length !== 9) {
      issues.push({
        row: rowNumber,
        message: `"${fullName}": mobile must be a nine-digit Sri Lankan number.`,
      });
      return;
    }

    const existingReference = seen.get(mobile);
    if (existingReference) {
      duplicates.push({ row: rowNumber, name: fullName, existingReference });
      return;
    }

    const journeyType =
      decodeLabel<LeadJourneyType>(JOURNEY_TYPE_LABELS, cell(row, "Journey Type")) ??
      "UMRAH";

    const packageName = cell(row, "Package");
    const pkg = packageName
      ? options.packages.find(
          (entry) => entry.name.toLowerCase() === packageName.toLowerCase(),
        )
      : undefined;
    if (packageName && !pkg) {
      issues.push({
        row: rowNumber,
        message: `"${fullName}": unknown package "${packageName}" — imported without one.`,
      });
    }

    const ownerName = cell(row, "Assigned Owner");
    const owner = ownerName
      ? options.staffOptions.find(
          (staff) => staff.name.toLowerCase() === ownerName.toLowerCase(),
        )
      : undefined;
    if (ownerName && !owner) {
      issues.push({
        row: rowNumber,
        message: `"${fullName}": unknown owner "${ownerName}" — assigned to you instead.`,
      });
    }

    const followUpRaw = cell(row, "Next Follow-Up");
    const followUpIso = followUpRaw ? localInputToIso(followUpRaw.slice(0, 16)) : null;
    if (followUpRaw && !followUpIso) {
      issues.push({
        row: rowNumber,
        message: `"${fullName}": could not read the follow-up date "${followUpRaw}".`,
      });
    }

    seen.set(mobile, fullName);

    rows.push({
      fullName,
      mobile,
      email: cell(row, "Email"),
      city: cell(row, "City") || "Colombo",
      preferredLanguage: "English",
      preferredChannel: "WHATSAPP",

      journeyType,
      interestedIn:
        cell(row, "Interested In") || JOURNEY_TYPE_LABELS[journeyType],
      packageId: pkg?.id ?? null,
      preferredPeriod: cell(row, "Preferred Period") || "Flexible / Next Group",
      adults: Math.max(1, toPositiveInt(cell(row, "Adults"), 1)),
      children: toPositiveInt(cell(row, "Children"), 0),
      roomPreference: "UNDECIDED",
      departureCity: "Colombo",
      budgetRange: "Not discussed",
      quotaWaitlistInterest: false,

      source:
        decodeLabel<LeadSource>(SOURCE_LABELS, cell(row, "Source")) ?? "OTHER",
      campaignReference: cell(row, "Campaign / Reference"),
      referralName: "",
      assignedToId: owner?.id ?? options.defaultAssigneeId,
      assignedToName: owner?.name ?? options.defaultAssigneeName,
      stage:
        decodeLabel<LeadStage>(STAGE_LABELS, cell(row, "Pipeline Stage")) ??
        "NEW_LEAD",
      temperature:
        decodeLabel<LeadTemperature>(
          TEMPERATURE_LABELS,
          cell(row, "Temperature"),
        ) ?? "WARM",

      nextFollowUpAt: followUpIso,
      followUpType:
        decodeLabel<FollowUpType>(
          FOLLOW_UP_TYPE_LABELS,
          cell(row, "Follow-Up Type"),
        ) ?? "CALL",
      followUpOwnerId: owner?.id ?? options.defaultAssigneeId,
      followUpOwnerName: owner?.name ?? options.defaultAssigneeName,
      notes: cell(row, "Notes"),
    });
  });

  return { rows, issues, duplicates };
}
