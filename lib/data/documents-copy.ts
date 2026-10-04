/**
 * Configuration and copy for the Documents Operations module: due-date
 * offsets, readiness weights, rework message templates. Kept as one
 * adjustable table rather than literals scattered through the mutators — an
 * agency that submits visas 30 days out instead of 21 changes one place.
 */

import type { DocumentStage, DocumentType } from "@/lib/types/documents";

/** Days before departure a requirement in this stage is due. `ON_BOOKING` is
 *  measured from booking creation instead — see `dueAtFor` below. */
export const STAGE_DUE_OFFSET_DAYS: Record<DocumentStage, number> = {
  ON_BOOKING: 0, // handled specially: booking date + ON_BOOKING_GRACE_DAYS
  BEFORE_VISA_SUBMISSION: 21,
  BEFORE_FINAL_PAYMENT: 14,
  BEFORE_DEPARTURE: 7,
};

export const ON_BOOKING_GRACE_DAYS = 3;

/** Weight of each stage in the group document-readiness score — a missing
 *  visa-gating document counts for more than an unsubmitted hotel voucher. */
export const STAGE_READINESS_WEIGHT: Record<DocumentStage, number> = {
  BEFORE_VISA_SUBMISSION: 3,
  ON_BOOKING: 2,
  BEFORE_FINAL_PAYMENT: 2,
  BEFORE_DEPARTURE: 1,
};

/** Months of passport validity required beyond the group's return date —
 *  mirrors `PASSPORT_VALIDITY_MONTHS` in `departure-groups-documents.ts` so
 *  the Documents page and the visa gate never disagree. */
export const PASSPORT_VALIDITY_MONTHS = 6;

/** Documents flagged as "Expiring Soon" this many days before they lapse. */
export const EXPIRY_WARNING_DAYS = 30;

export function dueAtFor(
  stage: DocumentStage,
  departureDate: string,
  bookingCreatedAt: string,
): string {
  if (stage === "ON_BOOKING") {
    const d = new Date(bookingCreatedAt);
    d.setUTCDate(d.getUTCDate() + ON_BOOKING_GRACE_DAYS);
    return d.toISOString();
  }
  const d = new Date(`${departureDate}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - STAGE_DUE_OFFSET_DAYS[stage]);
  return d.toISOString();
}

export function documentTypeLabel(type: string): string {
  return DOCUMENT_TYPE_LABELS[type as DocumentType] ?? type;
}

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  PASSPORT_BIO: "Passport bio page",
  PASSPORT_ADDITIONAL: "Passport additional pages",
  PASSPORT_PHOTO: "Passport-size photo",
  NATIONAL_ID: "National ID / NIC",
  VISA_COPY: "Visa document / visa copy",
  INSURANCE: "Travel / medical insurance",
  VACCINATION: "Vaccination / health certificate",
  MEDICAL: "Medical document",
  EMERGENCY_CONTACT: "Emergency contact form",
  PAYMENT_PROOF: "Payment proof",
  FLIGHT_TICKET: "Flight ticket",
  HOTEL_VOUCHER: "Hotel voucher",
  OTHER: "Other agency-required document",
};

/** Day-one AI extraction scope. Every other type is classified and quality-
 *  checked only — the AI card must say so rather than show an empty table. */
export const AI_EXTRACTION_SUPPORTED: ReadonlySet<DocumentType> = new Set([
  "PASSPORT_BIO",
  "PASSPORT_PHOTO",
  "NATIONAL_ID",
  "INSURANCE",
  "PAYMENT_PROOF",
]);

export const REWORK_REASON_MESSAGE_TEMPLATES: Record<string, (documentName: string) => string> = {
  BLURRED: (name) =>
    `Assalamu Alaikum. Please upload a clearer scan of your ${name} — the current copy is too blurred to verify.`,
  EXPIRY_INSUFFICIENT: (name) =>
    `Assalamu Alaikum. Your ${name} does not meet the minimum ${PASSPORT_VALIDITY_MONTHS}-month validity required for this journey. Please renew and re-upload.`,
  MISSING_PAGE: (name) =>
    `Assalamu Alaikum. Please upload the full ${name} — a page appears to be missing from the copy received.`,
  NAME_MISMATCH: (name) =>
    `Assalamu Alaikum. The name on your ${name} does not match your profile. Please confirm the correct spelling and re-upload.`,
  OTHER: (name) => `Assalamu Alaikum. Please re-submit your ${name} — the current copy could not be accepted.`,
};

export function reworkMessageFor(reasonCode: string, documentName: string): string {
  const template = REWORK_REASON_MESSAGE_TEMPLATES[reasonCode] ?? REWORK_REASON_MESSAGE_TEMPLATES.OTHER;
  return template(documentName);
}
