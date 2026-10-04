import type { OrganisationSettingsInput } from "@/lib/validations/settings";

/** One row of `country_locale_defaults` (supabase/migrations/20261206090000). */
export interface LocaleDefaultRow {
  countryCode: string;
  currency: string;
  timezone: string;
  supportedLanguages: string[];
}

/**
 * The country whose starting timezone matches the one the browser reports, so
 * the basics step can arrive pre-filled. Null when nothing matches — the form
 * then simply keeps the agency's current values and the owner picks.
 */
export function pickLocaleDefaults(rows: LocaleDefaultRow[], detectedTimezone: string | null | undefined): LocaleDefaultRow | null {
  if (!detectedTimezone) return null;
  return rows.find((row) => row.timezone === detectedTimezone) ?? null;
}

export interface AgencyBasics {
  agencyName: string;
  defaultCountry: string;
  defaultCurrency: string;
  timezone: string;
  defaultLanguage: string;
}

/** The organisation fields this merge reads from the stored `agency_settings` row. */
export interface StoredOrganisationSettings {
  legal_name: string | null;
  registration_number: string | null;
  supported_languages: string[];
  primary_email: string | null;
  primary_whatsapp: string | null;
  office_address: string | null;
}

/**
 * Builds the full input `updateOrganisationSettingsAction` expects from the few
 * fields the setup step edits plus everything already stored, so confirming the
 * basics never blanks the legal name, address or contact details.
 */
export function mergeBasicsIntoOrganisationSettings(
  current: StoredOrganisationSettings,
  basics: AgencyBasics,
): OrganisationSettingsInput {
  const supported = current.supported_languages.includes(basics.defaultLanguage)
    ? current.supported_languages
    : [...current.supported_languages, basics.defaultLanguage];

  return {
    agencyName: basics.agencyName,
    legalName: current.legal_name ?? "",
    registrationNumber: current.registration_number ?? "",
    defaultCountry: basics.defaultCountry,
    defaultCurrency: basics.defaultCurrency,
    timezone: basics.timezone,
    defaultLanguage: basics.defaultLanguage,
    supportedLanguages: supported,
    primaryEmail: current.primary_email ?? "",
    primaryWhatsapp: current.primary_whatsapp ?? "",
    officeAddress: current.office_address ?? "",
  };
}
