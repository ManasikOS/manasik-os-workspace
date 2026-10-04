import { describe, expect, it } from "vitest";

import { mergeBasicsIntoOrganisationSettings, pickLocaleDefaults, type LocaleDefaultRow } from "./locale-detection";

const rows: LocaleDefaultRow[] = [
  { countryCode: "GB", currency: "GBP", timezone: "Europe/London", supportedLanguages: ["en"] },
  { countryCode: "LK", currency: "LKR", timezone: "Asia/Colombo", supportedLanguages: ["en", "si", "ta"] },
];

describe("pickLocaleDefaults", () => {
  it("returns the country whose timezone matches the browser's", () => {
    expect(pickLocaleDefaults(rows, "Europe/London")?.countryCode).toBe("GB");
    expect(pickLocaleDefaults(rows, "Asia/Colombo")?.currency).toBe("LKR");
  });

  it("returns null for an unknown, empty or missing timezone", () => {
    expect(pickLocaleDefaults(rows, "Pacific/Fiji")).toBeNull();
    expect(pickLocaleDefaults(rows, "")).toBeNull();
    expect(pickLocaleDefaults(rows, null)).toBeNull();
  });
});

describe("mergeBasicsIntoOrganisationSettings", () => {
  const current = {
    agency_name: "Old Name",
    legal_name: "Old Name Ltd",
    registration_number: "REG-1",
    default_country: "LK",
    default_currency: "LKR",
    timezone: "Asia/Colombo",
    default_language: "en",
    supported_languages: ["en", "si"],
    primary_email: "hello@old.example",
    primary_whatsapp: "+94110000000",
    office_address: "1 Galle Road",
  };
  const basics = {
    agencyName: "Al-Noor Travels",
    defaultCountry: "GB",
    defaultCurrency: "GBP",
    timezone: "Europe/London",
    defaultLanguage: "en",
  };

  it("applies the basics and keeps every other organisation field", () => {
    const merged = mergeBasicsIntoOrganisationSettings(current, basics);
    expect(merged).toMatchObject({
      agencyName: "Al-Noor Travels",
      defaultCountry: "GB",
      defaultCurrency: "GBP",
      timezone: "Europe/London",
      defaultLanguage: "en",
      legalName: "Old Name Ltd",
      registrationNumber: "REG-1",
      primaryEmail: "hello@old.example",
      primaryWhatsapp: "+94110000000",
      officeAddress: "1 Galle Road",
    });
  });

  it("makes sure the default language is among the supported ones", () => {
    const merged = mergeBasicsIntoOrganisationSettings({ ...current, supported_languages: ["si"] }, basics);
    expect(merged.supportedLanguages).toContain("en");
    expect(merged.supportedLanguages).toContain("si");
  });

  it("turns missing optional fields into empty strings the schema accepts", () => {
    const merged = mergeBasicsIntoOrganisationSettings(
      { ...current, legal_name: null, registration_number: null, primary_email: null, primary_whatsapp: null, office_address: null },
      basics,
    );
    expect(merged.primaryEmail).toBe("");
    expect(merged.legalName).toBe("");
  });
});
