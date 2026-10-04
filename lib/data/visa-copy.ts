/**
 * Configuration and copy for the Visa Operations module: risk thresholds,
 * the visa-type catalogue, issue-type and evidence-source labels, and rework
 * / escalation message templates. Kept as one adjustable table rather than
 * literals scattered through components — an agency that submits visas 30
 * days out, or treats "departing soon" as 10 days instead of 14, changes one
 * place. Mirrors `lib/data/documents-copy.ts`.
 */

import type { GroupJourneyType } from "@/lib/types/departure-groups";

/** Days before departure a visa application is considered at risk if unissued. */
export const VISA_DEPARTURE_RISK_DAYS = 14;

/** Days before departure a group is flagged "departing soon" on alerts and the board. */
export const VISA_GROUP_RISK_DAYS = 7;

/** Days before an issued visa's expiry/valid-until it is flagged Expiring Soon. */
export const VISA_VALIDITY_RISK_DAYS = 14;

/** Days with no status movement before a lodged application is chased. */
export const VISA_NO_UPDATE_CHASE_DAYS = 3;

/** Default submission deadline offset from batch creation. */
export const VISA_BATCH_DEFAULT_HOURS = 8;

/** Months of passport validity required beyond the group's return date —
 *  mirrors PASSPORT_VALIDITY_MONTHS in departure-groups-documents.ts. */
export const PASSPORT_VALIDITY_MONTHS = 6;

export const VISA_TYPE_CATALOGUE: Record<GroupJourneyType, string[]> = {
  UMRAH: ["Umrah Visa", "Family Visit Visa"],
  HAJJ: ["Hajj Visa"],
  EARLY_REGISTRATION: ["Umrah Visa", "Hajj Visa", "Family Visit Visa"],
};

export function defaultVisaTypeFor(journeyType: GroupJourneyType): string {
  return VISA_TYPE_CATALOGUE[journeyType]?.[0] ?? "Umrah Visa";
}

export function allVisaTypes(): string[] {
  return [...new Set(Object.values(VISA_TYPE_CATALOGUE).flat())];
}

export const VISA_REWORK_MESSAGE_TEMPLATES: Record<string, (name: string) => string> = {
  DOCUMENT_BLOCKER: (name) =>
    `Assalamu Alaikum ${name}. Your visa application cannot proceed until the outstanding document(s) are verified. Please check the Documents tab for what is needed.`,
  PHOTO_REJECTED: (name) =>
    `Assalamu Alaikum ${name}. The photograph on file does not meet the visa requirements. Please upload a fresh white-background photo.`,
  NAME_MISMATCH: (name) =>
    `Assalamu Alaikum ${name}. The name on your documents does not match your passport. Please confirm the correct spelling.`,
  DOB_MISMATCH: (name) =>
    `Assalamu Alaikum ${name}. The date of birth on your documents does not match your passport. Please confirm and re-upload.`,
  PASSPORT_VALIDITY: (name) =>
    `Assalamu Alaikum ${name}. Your passport does not meet the ${PASSPORT_VALIDITY_MONTHS}-month validity requirement for this journey. Please renew and re-upload.`,
  PORTAL_ERROR: (name) =>
    `Assalamu Alaikum ${name}. There was an issue lodging your visa application. We are resolving it and will update you shortly.`,
  REFUSED: (name) =>
    `Assalamu Alaikum ${name}. Your visa application was not approved. Our team will contact you to discuss next steps.`,
  OTHER: (name) =>
    `Assalamu Alaikum ${name}. There is an outstanding item on your visa application. Our team will follow up with details.`,
};

export function reworkMessageFor(issueType: string, fullName: string): string {
  const template = VISA_REWORK_MESSAGE_TEMPLATES[issueType] ?? VISA_REWORK_MESSAGE_TEMPLATES.OTHER;
  return template(fullName);
}

export function batchDeadlineDefault(fromIso: string = new Date().toISOString()): string {
  const d = new Date(fromIso);
  d.setUTCHours(d.getUTCHours() + VISA_BATCH_DEFAULT_HOURS);
  return d.toISOString();
}
