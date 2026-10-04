import { describe, expect, it } from "vitest";
import { emailMetadataOf, parseAddressList } from "./email-message-metadata";

describe("emailMetadataOf", () => {
  it("reads subject/cc/bcc out of the stored metadata jsonb", () => {
    expect(emailMetadataOf({ subject: "Re: Trip", cc: ["a@example.com"], bcc: ["b@example.com"] })).toEqual({
      subject: "Re: Trip", cc: ["a@example.com"], bcc: ["b@example.com"],
    });
  });

  it("returns a subject of null and empty lists for a non-email message, never guessing", () => {
    expect(emailMetadataOf({})).toEqual({ subject: null, cc: [], bcc: [] });
    expect(emailMetadataOf(null)).toEqual({ subject: null, cc: [], bcc: [] });
  });

  it("ignores a malformed or blank subject/cc/bcc rather than throwing", () => {
    expect(emailMetadataOf({ subject: "   ", cc: "not-an-array", bcc: [1, 2] })).toEqual({ subject: null, cc: [], bcc: [] });
  });
});

describe("parseAddressList", () => {
  it("splits on commas and semicolons and drops blank entries", () => {
    expect(parseAddressList("a@example.com, b@example.com; c@example.com")).toEqual(["a@example.com", "b@example.com", "c@example.com"]);
    expect(parseAddressList("  ")).toEqual([]);
    expect(parseAddressList("")).toEqual([]);
  });
});
