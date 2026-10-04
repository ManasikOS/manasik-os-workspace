import { describe, expect, it } from "vitest";

import { inboxAddress, parseViewTotal, pngLikeBuffer, requireOwnerFixture, requireSearchFixtures, requireTemplateFixture } from "./inbox-test-inputs";
import { inboxPageHref, inboxPageRequestFromSearchParams } from "../../lib/inbox/page-request";

describe("inboxAddress", () => {
  it("is /inbox with no view or conversation", () => {
    expect(inboxAddress()).toBe("/inbox");
  });

  it("carries a view and a conversation, and encodes them", () => {
    expect(inboxAddress({ view: "needs-reply" })).toBe("/inbox?view=needs-reply");
    expect(inboxAddress({ view: "all", conversationId: "a b" })).toBe("/inbox?view=all&conversation=a+b");
  });

  it("is read back by the app's own request parser, so the tests and the page agree on the address", () => {
    const id = "9b1d4e0a-2c7f-4f3b-8a55-6d2e1c0b9f77";
    const address = new URL(inboxAddress({ view: "closed", conversationId: id }), "https://example.test");
    expect(inboxPageRequestFromSearchParams({ view: address.searchParams.get("view") ?? undefined, conversation: address.searchParams.get("conversation") ?? undefined })).toEqual({
      view: "closed",
      conversationId: id,
    });
    expect(inboxPageHref({ view: "closed", conversationId: id })).toContain("view=closed");
  });
});

describe("requireSearchFixtures", () => {
  it("returns both terms, trimmed", () => {
    expect(requireSearchFixtures({ INBOX_E2E_A_SEARCH_TERM: " Alpha ", INBOX_E2E_B_SEARCH_TERM: "Bravo" })).toEqual({ agencyATerm: "Alpha", agencyBTerm: "Bravo" });
  });

  it("fails loudly, naming the missing variable, instead of letting a search test pass or skip", () => {
    expect(() => requireSearchFixtures({ INBOX_E2E_A_SEARCH_TERM: "Alpha" })).toThrow(/INBOX_E2E_B_SEARCH_TERM/);
    expect(() => requireSearchFixtures({})).toThrow(/INBOX_E2E_A_SEARCH_TERM, INBOX_E2E_B_SEARCH_TERM/);
  });

  it("refuses two identical terms, which could not prove isolation", () => {
    expect(() => requireSearchFixtures({ INBOX_E2E_A_SEARCH_TERM: "Same", INBOX_E2E_B_SEARCH_TERM: "same" })).toThrow(/different/);
  });
});

describe("parseViewTotal", () => {
  it("reads the plain count, singular and plural", () => {
    expect(parseViewTotal("0 conversations")).toBe(0);
    expect(parseViewTotal("1 conversation")).toBe(1);
    expect(parseViewTotal("12 conversations")).toBe(12);
  });

  it("reads the true total from the Showing form, not the rows loaded", () => {
    expect(parseViewTotal("Showing 50 of 120")).toBe(120);
  });

  it("refuses text it does not recognise rather than guessing", () => {
    expect(() => parseViewTotal("Loading…")).toThrow(/Unrecognised/);
  });
});

describe("pngLikeBuffer", () => {
  it("starts with the PNG signature and has exactly the requested size", () => {
    const buffer = pngLikeBuffer(6 * 1024 * 1024);
    expect(buffer.length).toBe(6 * 1024 * 1024);
    expect([...buffer.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });

  it("refuses a size too small to hold the signature", () => {
    expect(() => pngLikeBuffer(4)).toThrow(/8 bytes/);
  });
});

describe("fixture requirements", () => {
  it("names the missing colleague and template variables", () => {
    expect(() => requireOwnerFixture({})).toThrow(/INBOX_E2E_A2_NAME/);
    expect(() => requireTemplateFixture({})).toThrow(/INBOX_E2E_TEMPLATE_NAME/);
    expect(requireOwnerFixture({ INBOX_E2E_A2_NAME: " Amina " })).toEqual({ colleagueName: "Amina" });
    expect(requireTemplateFixture({ INBOX_E2E_TEMPLATE_NAME: "payment_reminder" })).toEqual({ templateName: "payment_reminder" });
  });
});
