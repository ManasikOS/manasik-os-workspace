import { describe, expect, it } from "vitest";

import { cleanEnvValue, resolveConnectorAvailability } from "./connector-availability";

describe("cleanEnvValue", () => {
  it("trims whitespace and one layer of matching quotes", () => {
    expect(cleanEnvValue('  "v25.0" ')).toBe("v25.0");
    expect(cleanEnvValue("'abc'")).toBe("abc");
    expect(cleanEnvValue(" abc ")).toBe("abc");
  });

  it("returns null for unset, blank or empty-quoted values", () => {
    expect(cleanEnvValue(undefined)).toBeNull();
    expect(cleanEnvValue("   ")).toBeNull();
    expect(cleanEnvValue('""')).toBeNull();
  });
});

describe("resolveConnectorAvailability", () => {
  it("offers only email on a deployment with no platform credentials", () => {
    expect(resolveConnectorAvailability({})).toEqual({
      whatsapp: false,
      messenger: false,
      instagram: false,
      instagramPageFlow: false,
      metaAds: false,
      googleAds: false,
      email: true,
      whatsappAppId: null,
      whatsappConfigId: null,
    });
  });

  it("needs both the Meta app id and the Embedded Signup config id for WhatsApp", () => {
    expect(resolveConnectorAvailability({ META_APP_ID: "1" }).whatsapp).toBe(false);
    expect(resolveConnectorAvailability({ META_CONFIG_ID: "2" }).whatsapp).toBe(false);
    const both = resolveConnectorAvailability({ META_APP_ID: "1", META_CONFIG_ID: "2" });
    expect(both.whatsapp).toBe(true);
    expect(both.whatsappAppId).toBe("1");
    expect(both.whatsappConfigId).toBe("2");
  });

  it("needs the Meta app id plus that channel's own config id for Messenger", () => {
    expect(resolveConnectorAvailability({ META_MESSENGER_CONFIG_ID: "m" }).messenger).toBe(false);
    expect(resolveConnectorAvailability({ META_APP_ID: "1" }).messenger).toBe(false);
    expect(resolveConnectorAvailability({ META_APP_ID: "1", META_MESSENGER_CONFIG_ID: "m" }).messenger).toBe(true);
  });

  it("signs Instagram in with its own app id and secret, with the Page route as a separate option", () => {
    expect(resolveConnectorAvailability({ INSTAGRAM_APP_ID: "i" }).instagram).toBe(false);
    expect(resolveConnectorAvailability({ INSTAGRAM_APP_ID: "i", INSTAGRAM_APP_SECRET: "s" }).instagram).toBe(true);
    const pageOnly = resolveConnectorAvailability({ META_APP_ID: "1", META_INSTAGRAM_CONFIG_ID: "c" });
    expect(pageOnly.instagram).toBe(false);
    expect(pageOnly.instagramPageFlow).toBe(true);
  });

  it("enables the ad connectors only with their platform credentials", () => {
    expect(resolveConnectorAvailability({ META_ADS_APP_ID: "a" }).metaAds).toBe(true);
    expect(resolveConnectorAvailability({ GOOGLE_ADS_CLIENT_ID: "c" }).googleAds).toBe(false);
    expect(resolveConnectorAvailability({ GOOGLE_ADS_CLIENT_ID: "c", GOOGLE_ADS_DEVELOPER_TOKEN: "t" }).googleAds).toBe(true);
  });

  it("treats blank or quote-only values as missing", () => {
    expect(resolveConnectorAvailability({ META_APP_ID: '""', META_CONFIG_ID: "  " }).whatsapp).toBe(false);
  });
});
