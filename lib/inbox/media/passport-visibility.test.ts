import { describe, expect, it } from "vitest";

import { STAFF_ROLES } from "@/lib/access/departure-groups-access";

import { canViewPassportMedia, withholdPassportMedia } from "./passport-visibility";

describe("canViewPassportMedia", () => {
  it("is the traveller-data rule: administrators, CEO, Operations and Visa yes; Marketing, Finance and Guide no", () => {
    const allowed = STAFF_ROLES.filter((role) => canViewPassportMedia(role));
    expect([...allowed].sort()).toEqual(["ADMIN", "CEO", "OPERATIONS", "VISA"]);
  });
});

describe("withholdPassportMedia", () => {
  const attachments = [
    { id: "a-passport", original_href: "https://signed/passport", filename: "passport.jpg" },
    { id: "a-photo", original_href: "https://signed/photo", filename: "hotel.jpg" },
  ];
  const mediaAnalyses = [
    { attachment_id: "a-passport", kind: "PASSPORT", candidate_fields: { passportNumber: "N1234567" } },
    { attachment_id: "a-photo", kind: "OTHER", candidate_fields: {} },
  ];

  it("strips the link and name from a passport, marks it restricted and drops its read-out; other files are untouched", () => {
    const result = withholdPassportMedia({ attachments, mediaAnalyses, passportAttachmentIds: new Set(["a-passport"]) });
    expect(result.attachments[0]).toEqual({ id: "a-passport", original_href: null, filename: null, restricted: true });
    expect(result.attachments[1]).toEqual({ ...attachments[1], restricted: false });
    expect(result.mediaAnalyses).toEqual([mediaAnalyses[1]]);
    expect(JSON.stringify(result)).not.toContain("N1234567");
    expect(JSON.stringify(result)).not.toContain("signed/passport");
  });

  it("drops a PASSPORT read-out even if its attachment was not in the id set", () => {
    const result = withholdPassportMedia({ attachments, mediaAnalyses, passportAttachmentIds: new Set() });
    expect(result.mediaAnalyses.map((analysis) => analysis.attachment_id)).toEqual(["a-photo"]);
  });

  it("changes nothing when there are no passports", () => {
    const result = withholdPassportMedia({ attachments: [attachments[1]], mediaAnalyses: [mediaAnalyses[1]], passportAttachmentIds: new Set() });
    expect(result.attachments).toEqual([{ ...attachments[1], restricted: false }]);
    expect(result.mediaAnalyses).toEqual([mediaAnalyses[1]]);
  });
});
