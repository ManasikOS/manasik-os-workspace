import { describe, expect, it } from "vitest";

import {
  ALLOWED_STAFF_ATTACHMENT_TYPES,
  channelAcceptsAttachment,
  findAllowedType,
  isStagedPathFor,
  prepareStaffAttachmentSchema,
  sanitizeAttachmentFilename,
  stagedAttachmentPath,
  verifyStagedBytes,
} from "./staff-attachment";

const AGENCY = "0b8e7c3a-1f4d-4e6a-9d2b-7a1c5e3f9b10";
const CONVERSATION = "5d2f9a41-8c7e-4b3a-a6d1-2e9f0c7b4a83";
const OBJECT = "9c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f";
const OTHER_AGENCY = "1b8e7c3a-1f4d-4e6a-9d2b-7a1c5e3f9b10";
const OTHER_CONVERSATION = "6d2f9a41-8c7e-4b3a-a6d1-2e9f0c7b4a83";

const bytes = (...values: number[]) => new Uint8Array(values);
const ascii = (text: string) => new Uint8Array(Buffer.from(text, "latin1"));
const withTail = (head: Uint8Array, tail: string) => new Uint8Array([...head, ...ascii(tail)]);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0);
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 16);
const PDF = ascii("%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n");
const ZIP = bytes(0x50, 0x4b, 0x03, 0x04, 0, 0);
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

describe("the allow-list", () => {
  it("allows photos, PDFs and Office files, and nothing that runs", () => {
    expect(ALLOWED_STAFF_ATTACHMENT_TYPES.map((type) => type.mimeType)).toEqual(
      expect.arrayContaining(["image/jpeg", "image/png", "application/pdf", DOCX]),
    );
    for (const dangerous of ["application/x-msdownload", "application/zip", "text/html", "image/svg+xml", "application/javascript", "application/msword", "application/vnd.ms-excel", "video/mp4", "application/octet-stream"]) {
      expect(findAllowedType(dangerous)).toBeNull();
    }
  });

  it("matches a type regardless of case", () => {
    expect(findAllowedType("IMAGE/PNG")?.mimeType).toBe("image/png");
  });

  it("sends images everywhere and documents on WhatsApp, Messenger and Email, but not Instagram", () => {
    expect(channelAcceptsAttachment("WHATSAPP", "document")).toBe(true);
    expect(channelAcceptsAttachment("MESSENGER", "document")).toBe(true);
    expect(channelAcceptsAttachment("INSTAGRAM", "image")).toBe(true);
    expect(channelAcceptsAttachment("INSTAGRAM", "document")).toBe(false);
    expect(channelAcceptsAttachment("GMAIL", "image")).toBe(true);
    expect(channelAcceptsAttachment("GMAIL", "document")).toBe(true);
  });
});

describe("prepareStaffAttachmentSchema (the browser's request)", () => {
  const ok = { conversationId: CONVERSATION, filename: "Umrah itinerary.pdf", mimeType: "application/pdf", byteSize: 200_000 };

  it("accepts an allowed type within its size", () => {
    expect(prepareStaffAttachmentSchema.safeParse(ok).success).toBe(true);
  });

  it("refuses a type that is not on the list, in plain words", () => {
    const result = prepareStaffAttachmentSchema.safeParse({ ...ok, mimeType: "application/x-msdownload" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].message).toContain("can't be sent");
  });

  it("holds photos to 5 MB and documents to 10 MB", () => {
    const image = { ...ok, mimeType: "image/png", filename: "a.png" };
    expect(prepareStaffAttachmentSchema.safeParse({ ...image, byteSize: 5 * 1024 * 1024 }).success).toBe(true);
    expect(prepareStaffAttachmentSchema.safeParse({ ...image, byteSize: 5 * 1024 * 1024 + 1 }).success).toBe(false);
    expect(prepareStaffAttachmentSchema.safeParse({ ...ok, byteSize: 10 * 1024 * 1024 }).success).toBe(true);
    expect(prepareStaffAttachmentSchema.safeParse({ ...ok, byteSize: 10 * 1024 * 1024 + 1 }).success).toBe(false);
  });

  it("refuses an empty file, a non-uuid conversation and a missing name", () => {
    expect(prepareStaffAttachmentSchema.safeParse({ ...ok, byteSize: 0 }).success).toBe(false);
    expect(prepareStaffAttachmentSchema.safeParse({ ...ok, conversationId: "not-a-uuid" }).success).toBe(false);
    expect(prepareStaffAttachmentSchema.safeParse({ ...ok, filename: "" }).success).toBe(false);
  });
});

describe("verifyStagedBytes (the server's decision, from the file itself)", () => {
  it("accepts a real JPEG, PNG, PDF and Office file", () => {
    expect(verifyStagedBytes({ mimeType: "image/jpeg", bytes: JPEG }).ok).toBe(true);
    expect(verifyStagedBytes({ mimeType: "image/png", bytes: PNG }).ok).toBe(true);
    expect(verifyStagedBytes({ mimeType: "application/pdf", bytes: PDF }).ok).toBe(true);
    expect(verifyStagedBytes({ mimeType: DOCX, bytes: withTail(ZIP, "word/document.xml") }).ok).toBe(true);
  });

  it("refuses a file that is not what it says: an executable renamed .pdf, or a PNG declared as JPEG", () => {
    const exe = ascii("MZ\u0090\u0000\u0003");
    expect(verifyStagedBytes({ mimeType: "application/pdf", bytes: exe }).ok).toBe(false);
    expect(verifyStagedBytes({ mimeType: "image/jpeg", bytes: PNG }).ok).toBe(false);
    expect(verifyStagedBytes({ mimeType: "image/png", bytes: ascii("<svg onload=alert(1)>") }).ok).toBe(false);
  });

  it("refuses an Office file that carries macros, and a PDF with a launch action or script", () => {
    const macro = verifyStagedBytes({ mimeType: DOCX, bytes: withTail(ZIP, "word/vbaProject.bin") });
    expect(macro.ok).toBe(false);
    if (!macro.ok) expect(macro.error).toContain("macros");
    expect(verifyStagedBytes({ mimeType: "application/pdf", bytes: withTail(PDF, "<< /S /Launch /F (cmd.exe) >>") }).ok).toBe(false);
    expect(verifyStagedBytes({ mimeType: "application/pdf", bytes: withTail(PDF, "<< /S /JavaScript /JS (app.alert(1)) >>") }).ok).toBe(false);
  });

  it("refuses an empty file, an oversized file and an unknown type", () => {
    expect(verifyStagedBytes({ mimeType: "image/png", bytes: new Uint8Array(0) }).ok).toBe(false);
    const big = new Uint8Array(5 * 1024 * 1024 + 1);
    big.set(PNG);
    expect(verifyStagedBytes({ mimeType: "image/png", bytes: big }).ok).toBe(false);
    expect(verifyStagedBytes({ mimeType: "application/zip", bytes: ZIP }).ok).toBe(false);
  });
});

describe("names and paths", () => {
  const pdf = findAllowedType("application/pdf")!;

  it("keeps a display name that is safe: no path, no control characters, the right extension", () => {
    expect(sanitizeAttachmentFilename("..\\..\\etc/passwd.pdf", pdf)).not.toMatch(/[\\/]/);
    expect(sanitizeAttachmentFilename("../../evil.pdf", pdf)).not.toMatch(/[\\/]/);
    expect(sanitizeAttachmentFilename("quote\u0000\u0007.pdf", pdf)).toBe("quote.pdf");
    expect(sanitizeAttachmentFilename("itinerary.exe", pdf)).toBe("itinerary.pdf");
    expect(sanitizeAttachmentFilename("Umrah Quote.PDF", pdf)).toBe("Umrah Quote.pdf");
    expect(sanitizeAttachmentFilename("", pdf)).toBe("file.pdf");
    expect(sanitizeAttachmentFilename(`${"a".repeat(300)}.pdf`, pdf).length).toBeLessThanOrEqual(104);
  });

  it("builds the stored path from ids and a fresh uuid, never from the file's own name", () => {
    const path = stagedAttachmentPath({ agencyId: AGENCY, conversationId: CONVERSATION, objectId: OBJECT, type: pdf });
    expect(path).toBe(`${AGENCY}/outbound/${CONVERSATION}/${OBJECT}.pdf`);
  });

  it("accepts a staged path only for the exact agency and conversation, and refuses look-alikes", () => {
    const path = `${AGENCY}/outbound/${CONVERSATION}/${OBJECT}.pdf`;
    expect(isStagedPathFor(path, AGENCY, CONVERSATION)).toBe(true);
    expect(isStagedPathFor(path, OTHER_AGENCY, CONVERSATION)).toBe(false);
    expect(isStagedPathFor(path, AGENCY, OTHER_CONVERSATION)).toBe(false);
    expect(isStagedPathFor(`${AGENCY}/outbound/${CONVERSATION}/../${OBJECT}.pdf`, AGENCY, CONVERSATION)).toBe(false);
    expect(isStagedPathFor(`${AGENCY}/outbound/${CONVERSATION}/${OBJECT}.exe`, AGENCY, CONVERSATION)).toBe(false);
    expect(isStagedPathFor(`${AGENCY}/inbound/${CONVERSATION}/${OBJECT}.pdf`, AGENCY, CONVERSATION)).toBe(false);
    // An attacker-controlled id can never become part of a pattern.
    expect(isStagedPathFor(path, ".*", CONVERSATION)).toBe(false);
  });

  it("still accepts a seed/system agency id whose version nibble isn't RFC 4122-conformant (a real Postgres uuid, just not one gen_random_uuid() would produce)", () => {
    const seedAgency = "00000000-0000-0000-0000-000000000001";
    const path = `${seedAgency}/outbound/${CONVERSATION}/${OBJECT}.pdf`;
    expect(isStagedPathFor(path, seedAgency, CONVERSATION)).toBe(true);
  });
});
