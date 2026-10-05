import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { Db } from "@/lib/ai/db";
import { STAFF_ATTACHMENT_MAX_BYTES } from "./staff-attachment";
import { createStaffAttachmentUpload, INBOX_ATTACHMENT_BUCKET, verifyStagedAttachment } from "./staged-file";

const AGENCY = "0b8e7c3a-1f4d-4e6a-9d2b-7a1c5e3f9b10";
const CONVERSATION = "5d2f9a41-8c7e-4b3a-a6d1-2e9f0c7b4a83";
const OBJECT = "9c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f";
const PDF_PATH = `${AGENCY}/outbound/${CONVERSATION}/${OBJECT}.pdf`;
const PNG_PATH = `${AGENCY}/outbound/${CONVERSATION}/${OBJECT}.png`;

const ascii = (text: string) => new Uint8Array(Buffer.from(text, "latin1"));
const PDF = ascii("%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n");

function storage(objects: Record<string, Uint8Array>, options: { sizes?: Record<string, number>; listError?: boolean; hideFromList?: boolean } = {}) {
  const removed: string[][] = [];
  const uploads: string[] = [];
  const downloads: string[] = [];
  const bucket = {
    // The object's own record in the bucket, which is where its size is read from before anything is downloaded.
    list: async (folder: string, listOptions?: { search?: string }) => {
      if (options.listError) return { data: null, error: { message: "boom" } };
      if (options.hideFromList) return { data: [], error: null };
      const found = Object.entries(objects)
        .filter(([path]) => path.startsWith(`${folder}/`) && path.slice(folder.length + 1).includes(listOptions?.search ?? ""))
        .map(([path, bytes]) => ({ name: path.slice(folder.length + 1), metadata: { size: options.sizes?.[path] ?? bytes.byteLength } }));
      return { data: found, error: null };
    },
    download: async (path: string) => {
      downloads.push(path);
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
  return { db: { storage: { from: () => bucket } } as unknown as Db, removed, uploads, downloads };
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

  it("SEC-8: reads the size from the stored object first, and downloads nothing that is over the limit", async () => {
    const world = storage({ [PDF_PATH]: PDF }, { sizes: { [PDF_PATH]: 11 * 1024 * 1024 } });
    const result = await verifyStagedAttachment(world.db, { agencyId: AGENCY, conversationId: CONVERSATION, channel: "WHATSAPP", ref });
    expect(result).toEqual({ ok: false, error: expect.stringContaining("too large") });
    expect(world.downloads).toEqual([]);
    expect(world.removed).toEqual([[PDF_PATH]]);
  });

  it("SEC-8: holds photos to their own smaller limit before downloading", async () => {
    const world = storage({ [PNG_PATH]: ascii("x") }, { sizes: { [PNG_PATH]: 6 * 1024 * 1024 } });
    const result = await verifyStagedAttachment(world.db, { agencyId: AGENCY, conversationId: CONVERSATION, channel: "WHATSAPP", ref: { path: PNG_PATH, filename: "photo.png", mimeType: "image/png" } });
    expect(result).toEqual({ ok: false, error: expect.stringContaining("5 MB") });
    expect(world.downloads).toEqual([]);
  });

  it("SEC-8: treats a size it cannot read as 'not uploaded', and downloads nothing", async () => {
    for (const options of [{ listError: true }, { hideFromList: true }]) {
      const world = storage({ [PDF_PATH]: PDF }, options);
      expect(await verifyStagedAttachment(world.db, { agencyId: AGENCY, conversationId: CONVERSATION, channel: "WHATSAPP", ref })).toEqual({ ok: false, error: expect.stringContaining("wasn't uploaded") });
      expect(world.downloads).toEqual([]);
    }
  });

  it("SEC-8: a PDF that hides its script as /Java#53cript is refused and deleted", async () => {
    const world = storage({ [PDF_PATH]: new Uint8Array([...PDF, ...ascii("<< /S /Java#53cript /JS (x) >>")]) });
    const result = await verifyStagedAttachment(world.db, { agencyId: AGENCY, conversationId: CONVERSATION, channel: "WHATSAPP", ref });
    expect(result).toEqual({ ok: false, error: expect.stringContaining("script") });
    expect(world.removed).toEqual([[PDF_PATH]]);
  });

  it("SEC-8: a ZIP that is not an Office file is refused when it is sent as a Word file, and deleted", async () => {
    const docxPath = `${AGENCY}/outbound/${CONVERSATION}/${OBJECT}.docx`;
    const world = storage({ [docxPath]: new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]) });
    const result = await verifyStagedAttachment(world.db, {
      agencyId: AGENCY,
      conversationId: CONVERSATION,
      channel: "WHATSAPP",
      ref: { path: docxPath, filename: "Letter.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
    });
    expect(result.ok).toBe(false);
    expect(world.removed).toEqual([[docxPath]]);
  });

  it("refuses a document on Instagram", async () => {
    const world = storage({ [PDF_PATH]: PDF });
    expect((await verifyStagedAttachment(world.db, { agencyId: AGENCY, conversationId: CONVERSATION, channel: "INSTAGRAM", ref })).ok).toBe(false);
  });
});

describe("SEC-8: the storage bucket's own upload limit", () => {
  const migration = readFileSync(join(process.cwd(), "supabase/migrations/20261202092400_mi5_4_message_media_analyses.sql"), "utf8").replace(/--.*$/gm, "");

  it("is set by a migration, is private, and equals the largest file the code allows, so storage refuses an oversize upload before the server ever reads it", () => {
    const row = new RegExp(String.raw`insert into storage\.buckets \(id, name, public, file_size_limit\)\s*values \('${INBOX_ATTACHMENT_BUCKET}', '${INBOX_ATTACHMENT_BUCKET}', false, (\d+)\)`).exec(migration);
    expect(row, "the migration that creates the bucket").not.toBeNull();
    expect(Number(row![1])).toBe(STAFF_ATTACHMENT_MAX_BYTES);
  });

  it("is re-applied if the bucket already existed, so a hand-made bucket cannot keep an old or missing limit", () => {
    expect(migration).toMatch(/on conflict \(id\) do update set public = false, file_size_limit = excluded\.file_size_limit/);
  });
});
