import type { PilgrimListItem } from "./types";
import { JOURNEY_STATUS_LABELS, VISA_STATUS_LABELS, PAYMENT_STATUS_LABELS } from "./utils";

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function pilgrimsToCsv(items: PilgrimListItem[]): string {
  const headers = [
    "Pilgrim Reference",
    "Full Name",
    "City",
    "WhatsApp",
    "Passport Number",
    "Departure Group",
    "Departure Date",
    "Booking Reference",
    "Journey Type",
    "Status",
    "Documents",
    "Visa Status",
    "Payment Status",
    "Outstanding Balance",
    "Room",
    "Flight",
  ];

  const rows = items.map((item) => [
    item.reference,
    item.fullName,
    item.city,
    item.whatsappNumber,
    item.passportNumber ?? "",
    item.groupName,
    item.departureDate,
    item.bookingReference,
    item.journeyType,
    JOURNEY_STATUS_LABELS[item.journeyStatus],
    `${item.documentsCompleted}/${item.documentsRequired}`,
    VISA_STATUS_LABELS[item.visaStatus] ?? item.visaStatus,
    PAYMENT_STATUS_LABELS[item.paymentStatus] ?? item.paymentStatus,
    String(item.outstandingBalance),
    item.roomAssignmentStatus,
    item.flightStatus,
  ]);

  return [headers, ...rows].map((row) => row.map((v) => csvEscape(String(v))).join(",")).join("\n");
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
