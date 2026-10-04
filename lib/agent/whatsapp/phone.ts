/**
 * Phone-number bridge between WhatsApp's wire format and the CRM's stored
 * format.
 *
 * `leads.mobile` stores a normalised subscriber number with no country code
 * (see `normaliseMobile()` in `lib/data/leads.ts`) — a human typed it into a
 * form. WhatsApp's Cloud API sends and expects `wa_id` in full E.164 with no
 * `+` (`94771234567`). `normaliseMobile()` already collapses that shape
 * correctly (it strips a leading `94` when the input is longer than nine
 * digits), so this file does not re-implement normalisation — it only adds
 * the round trip back to a dialable `wa_id` for outbound sends, which
 * `lib/data/leads.ts` has no reason to do.
 */

import { normaliseMobile } from "@/lib/data/leads";

/** `94771234567` (WhatsApp's wa_id) → `771234567` (the stored subscriber number). */
export function waIdToMobile(waId: string): string {
  return normaliseMobile(waId);
}

/**
 * `771234567` + country code `"94"` → `94771234567`, dialable as a WhatsApp
 * `to` parameter. `countryCode` comes from `agency_settings` in production
 * (via `dialingCodeForCountry()`); the default matches the country every
 * other normaliser in this codebase already assumes (`+94`, Sri Lanka).
 */
export function mobileToWaId(mobile: string, countryCode = "94"): string {
  const digits = normaliseMobile(mobile);
  return `${countryCode}${digits}`;
}

/**
 * Maps `agency_settings.default_country` (an ISO 3166-1 alpha-2 code, e.g.
 * `"LK"`) to the E.164 dialing code used to reconstruct a `wa_id`. Extend
 * this map before onboarding an agency outside the covered set — an unknown
 * country falls back to `"94"` rather than throwing, since a wrong-but-fixed
 * prefix is recoverable in the Inbox and a thrown error mid-send is not.
 */
const DIALING_CODES: Record<string, string> = {
  LK: "94",
  IN: "91",
  AE: "971",
  SA: "966",
  GB: "44",
  US: "1",
};

export function dialingCodeForCountry(countryIso2: string): string {
  return DIALING_CODES[countryIso2.toUpperCase()] ?? "94";
}

/**
 * The reverse lookup — a `wa_id`'s leading digits back to an ISO 3166-1
 * alpha-2 code, best-effort. Used only to group billing rows by country
 * (§5 E5/E10 of docs/modules/whatsapp-meta-connection-implementation-plan.md — the
 * `recipient_country` column on `whatsapp_message_charges`), never for a
 * dialing decision, so an unmatched prefix returning `null` is fine: the
 * charge row is still written, just ungrouped by country until Meta's own
 * `pricing_analytics` fills that dimension in on the billing side.
 */
export function countryForWaId(waId: string): string | null {
  const sorted = Object.entries(DIALING_CODES).sort((a, b) => b[1].length - a[1].length);
  for (const [iso2, code] of sorted) {
    if (waId.startsWith(code)) return iso2;
  }
  return null;
}
