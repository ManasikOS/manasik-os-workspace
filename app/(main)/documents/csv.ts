import { toCsv as toCsvMatrix, downloadTextFile } from "@/lib/csv";

import type { DocumentListItem } from "./types";
import { STAGE_LABELS, STATUS_LABELS, documentTypeLabel, formatDate } from "./utils";

export { downloadTextFile };

function toCsv(items: DocumentListItem[], columns: [string, (item: DocumentListItem) => string][]): string {
  const headers = columns.map(([label]) => label);
  const rows = items.map((item) => columns.map(([, get]) => String(get(item))));
  return toCsvMatrix([headers, ...rows]);
}

export function documentsToChecklistCsv(items: DocumentListItem[]): string {
  return toCsv(items, [
    ["Pilgrim", (i) => i.fullName],
    ["Pilgrim Reference", (i) => i.pilgrimReference],
    ["Departure Group", (i) => i.groupName],
    ["Departure Date", (i) => i.departureDate],
    ["Document Requirement", (i) => i.name],
    ["Document Type", (i) => documentTypeLabel(i.documentType)],
    ["Stage", (i) => STAGE_LABELS[i.requiredByStage] ?? i.requiredByStage],
    ["Status", (i) => STATUS_LABELS[i.status] ?? i.status],
    ["Due Date", (i) => formatDate(i.dueAt)],
    ["Expiry", (i) => formatDate(i.expiresAt)],
    ["Assigned To", (i) => i.assignedToName ?? ""],
  ]);
}

export function documentsToVisaPackCsv(items: DocumentListItem[]): string {
  return toCsv(
    items.filter((i) => i.requiredByStage === "BEFORE_VISA_SUBMISSION"),
    [
      ["Pilgrim", (i) => i.fullName],
      ["Passport Number", (i) => i.passportNumber ?? "Restricted"],
      ["Departure Group", (i) => i.groupName],
      ["Document Requirement", (i) => i.name],
      ["Status", (i) => STATUS_LABELS[i.status] ?? i.status],
      ["Verified", (i) => formatDate(i.verifiedAt)],
    ],
  );
}

export function timestampedFilename(prefix: string): string {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return `${prefix}-${stamp}.csv`;
}
