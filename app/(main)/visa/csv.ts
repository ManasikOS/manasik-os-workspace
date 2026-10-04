import type { VisaListItem } from "./types";
import { VISA_STATUS_LABELS, formatDate } from "./utils";

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function toCsv(items: VisaListItem[], columns: [string, (item: VisaListItem) => string][]): string {
  const headers = columns.map(([label]) => label);
  const rows = items.map((item) => columns.map(([, get]) => get(item)));
  return [headers, ...rows].map((row) => row.map((v) => csvEscape(String(v))).join(",")).join("\n");
}

export function visaApplicationsToManifestCsv(items: VisaListItem[]): string {
  return toCsv(items, [
    ["Pilgrim", (i) => i.fullName],
    ["Pilgrim Reference", (i) => i.pilgrimReference],
    ["Passport Number", (i) => i.passportMasked],
    ["Departure Group", (i) => i.groupName],
    ["Departure Date", (i) => i.departureDate],
    ["Visa Type", (i) => i.visaType],
    ["Application Status", (i) => VISA_STATUS_LABELS[i.visaStatus] ?? i.visaStatus],
    ["Application Reference", (i) => i.applicationReference ?? ""],
    ["Batch", (i) => i.batchReference ?? ""],
    ["Assigned Officer", (i) => i.assignedToName ?? ""],
  ]);
}

export function visaApplicationsToSubmissionPackCsv(items: VisaListItem[]): string {
  return toCsv(
    items.filter((i) => i.visaStatus !== "NOT_STARTED" && i.visaStatus !== "DOCUMENTS_PENDING"),
    [
      ["Pilgrim", (i) => i.fullName],
      ["Passport Number", (i) => i.passportMasked],
      ["Departure Group", (i) => i.groupName],
      ["Visa Type", (i) => i.visaType],
      ["Application Reference", (i) => i.applicationReference ?? ""],
      ["Status", (i) => VISA_STATUS_LABELS[i.visaStatus] ?? i.visaStatus],
      ["Submitted", (i) => formatDate(i.submittedAt)],
    ],
  );
}

export function visaApplicationsToRiskReportCsv(items: VisaListItem[]): string {
  return toCsv(items, [
    ["Departure Group", (i) => i.groupName],
    ["Pilgrim", (i) => i.fullName],
    ["Status", (i) => VISA_STATUS_LABELS[i.visaStatus] ?? i.visaStatus],
    ["Risk Band", (i) => i.riskBand],
    ["Days to Departure", (i) => String(i.daysToDeparture)],
    ["Visa Expiry", (i) => formatDate(i.expiryDate)],
    ["Rejection Reason", (i) => i.rejectionReason ?? ""],
  ]);
}

export function timestampedFilename(prefix: string): string {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return `${prefix}-${stamp}.csv`;
}

export function downloadTextFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
