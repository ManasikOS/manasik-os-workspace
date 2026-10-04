/**
 * Staff review of what the model read from a passport photo, before it touches a traveller's record. The read values only
 * pre-fill the form; nothing is saved until a person confirms the number and the expiry date, and the record's own
 * rules (for example an expiry before departure is refused) still apply on the server.
 */

export interface PassportFormValues {
  passportNumber: string;
  /** YYYY-MM-DD, or empty when the read value could not be trusted as a date. */
  expiryDate: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isRealIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** What the form starts with: the read passport number and expiry, kept only when they look usable. */
export function passportFormDefaults(candidate: Record<string, unknown>): PassportFormValues {
  const rawNumber = typeof candidate.passportNumber === "string" ? candidate.passportNumber : "";
  const rawExpiry = typeof candidate.expiryDate === "string" ? candidate.expiryDate.trim() : "";
  return {
    passportNumber: rawNumber.replace(/\s+/g, "").toUpperCase(),
    expiryDate: isRealIsoDate(rawExpiry) ? rawExpiry : "",
  };
}

export type ParsedPassportDetails =
  | { ok: true; passportNumber: string; passportExpiry: string }
  | { ok: false; error: string };

/** The checked values that may be saved: an upper-case number of 5–20 letters and digits, and a real date. */
export function parsePassportDetails(input: { passportNumber: string; expiryDate: string }): ParsedPassportDetails {
  const passportNumber = input.passportNumber.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z0-9]{5,20}$/.test(passportNumber)) {
    return { ok: false, error: "The passport number must be 5 to 20 letters and digits." };
  }
  const expiry = input.expiryDate.trim();
  if (!isRealIsoDate(expiry)) return { ok: false, error: "Enter the expiry date as it appears on the passport." };
  return { ok: true, passportNumber, passportExpiry: expiry };
}
