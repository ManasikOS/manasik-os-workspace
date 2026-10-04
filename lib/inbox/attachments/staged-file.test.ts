import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { Db } from "@/lib/ai/db";
import { createStaffAttachmentUpload, verifyStagedAttachment } from "./staged-file";

const AGENCY = "0b8e7c3a-1f4d-4e6a-9d2b-7a1c5e3f9b10";
const CONVERSATION = "5d2f9a41-8c7e-4b3a-a6d1-2e9f0c7b4a83";
const OBJECT = "9c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f";
const PDF_PATH = `${AGENCY}/outbound/${CONVERSATION}/${OBJECT}.pdf`;
const PNG_PATH = `${AGENCY}/outbound/${CONVERSATION}/${OBJECT}.png`;

const ascii = (text: string) => new Uint8Array(Buffer.from(text, "latin1"));
const PDF = ascii("%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n");

function storage(objects: Record<string, Uint8Array>) {
  const removed: string[][] = [];
  const uploads: string[] = [];
  const bucket = {
    download: async (path: string) => {
      const bytes = objects[path];
      return bytes ? { data: new Blob([bytes as BlobPart]), error: null } : { data: null, error: { message: "not found" } };
    },
    remove: async (paths: string[]) => {
      removed.push(paths);
      return { data: null, error: null };
    },
    createSignedUploadUrl: async (path: string) => {
      uploads.push(path);
      return { data: { token: "upload-token", path, signedUrl: "https://x" }, error: null };
    },
  };
  return { db: { storage: { from: () => bucket } } as unknown as Db, removed, uploads };
}

describe("createStaffAttachmentUpload", () => {
  it("names the path itself, from ids and a fresh uuid, and returns a token for exactly that path", async () => {
    const world = storage({});
    const result = await createStaffAttachmentUpload(world.db, { agencyId: AGENCY, conversationId: CONVERSATION, channel: "WHATSAPP", filename: "../../Umrah Itinerary.PDF", mimeType: "application/pdf" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.path).toMatch(new RegExp(`^${AGENCY}/outbound/${CONVERSATION}/[0-9a-f-]{36}\\.pdf$`));
    expect(world.uploads).toEqual([result.path]);
    expect(result.token).toBe("upload-token");
    expect(result.filename).not.toMatch(/[\\/]/);
    expect(result.filename.endsWith(".pdf")).toBe(true);
  });

  it("refuses a type that is not allowed, and a document on Instagram, before issuing anything", async () => {
    const world = storage({});
    expect((await createStaffAttachmentUpload(world.db, { agencyId: AGENCY, conversationId: CONVERSATION, channel: "WHATSAPP", filename: "a.exe", mimeType: "application/x-msdownload" })).ok).toBe(false);
    const instagram = await createStaffAttachmentUpload(world.db, { agencyId: AGENCY, conversationId: CONVERSATION, channel: "INSTAGRAM", filename: "a.pdf", mimeType: "application/pdf" });
    expect(instagram).toEqual({ ok: false, error: expect.stringContaining("only carry photos") });
    expect(world.uploads).toHaveLength(0);
  });
});

describe("verifyStagedAttachment", () => {
  const ref = { path: PDF_PATH, filename: "Itinerary.pdf", mimeType: "application/pdf" };

  it("accepts a real stored file and reports the stored object's size and checksum, not the browser's", async () => {
    const world = storage({ [PDF_PATH]: PDF });
    const result = await verifyStagedAttachment(world.db, { agencyId: AGENCY, conversationId: CONVERSATION, channel: "WHATSAPP", ref });
    expect(result).toEqual({ ok: true, path: PDF_PATH, filename: "Itinerary.pdf", mimeType: "application/pdf", byteSize: PDF.byteLength, checksumSha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
  });

  it("refuses another conversation's or another agency's path without touching storage", async () => {
    const world = storage({ [PDF_PATH]: PDF });
    const otherConversation = await verifyStagedAttachment(world.db, { agencyId: AGENCY, conversationId: "6d2f9a41-8c7e-4b3a-a6d1-2e9f0c7b4a83", channel: "WHATSAPP", ref });
    const otherAgency = await verifyStagedAttachment(world.db, { agencyId: "1b8e7c3a-1f4d-4e6a-9d2b-7a1c5e3f9b10", conversationId: CONVERSATION, channel: "WHATSAPP", ref });
    expect(otherConversation.ok).toBe(false);
    expect(otherAgency.ok).toBe(false);
    expect(world.removed).toHaveLength(0);
  });

  it("refuses a file that was never uploaded", async () => {
    const world = storage({});
    expect(await verifyStagedAttachment(world.db, { agencyId: AGENCY, conversationId: CONVERSATION, channel: "WHATSAPP", ref })).toEqual({ ok: false, error: expect.stringContaining("wasn't uploaded") });
  });

  it("refuses a file that is not what it says and deletes it, so it cannot be sent by a later request", async () => {
    const world = storage({ [PNG_PATH]: ascii("MZ this is an executable") });
    const result = await verifyStagedAttachment(world.db, { agencyId: AGENCY, conversationId: CONVERSATION, channel: "WHATSAPP", ref: { path: PNG_PATH, filename: "photo.png", mimeType: "image/png" } });
    expect(result.ok).toBe(false);
    expect(world.removed).toEqual([[PNG_PATH]]);
  });

  it("refuses a PDF carrying a script and deletes it", async () => {
    const world = storage({ [PDF_PATH]: new Uint8Array([...PDF, ...ascii("<< /S /JavaScript /JS (x) >>")]) });
    const result = await verifyStagedAttachment(world.db, { agencyId: AGENCY, conversationId: CONVERSATION, channel: "MESSENGER", ref });
    expect(result).toEqual({ ok: false, error: expect.stringContaining("script") });
    expect(world.removed).toEqual([[PDF_PATH]]);
  });

  it("refuses a document on Instagram", async () => {
    const world = storage({ [PDF_PATH]: PDF });
    expect((await verifyStagedAttachment(world.db, { agencyId: AGENCY, conversationId: CONVERSATION, channel: "INSTAGRAM", ref })).ok).toBe(false);
  });
});
