import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createInboxMediaVaultSaver, type InboxMediaVaultDependencies, type InboxMediaVaultSource } from "./media-to-vault";

const AGENCY = "11111111-1111-4111-8111-111111111111";
const ATTACHMENT = "22222222-2222-4222-8222-222222222222";
const CONVERSATION = "33333333-3333-4333-8333-333333333333";
const GROUP = "44444444-4444-4444-8444-444444444444";

function source(overrides: Partial<InboxMediaVaultSource> = {}): InboxMediaVaultSource {
  return {
    attachmentId: ATTACHMENT,
    conversationId: CONVERSATION,
    kind: "BROCHURE",
    storagePath: `${AGENCY}/${ATTACHMENT}/brochure.pdf`,
    filename: "Umrah Plan.pdf",
    mimeType: "application/pdf",
    promotedDocumentId: null,
    ...overrides,
  };
}

function world(overrides: Partial<InboxMediaVaultDependencies> = {}, initial: Partial<InboxMediaVaultSource> = {}) {
  const documents: Array<Record<string, unknown>> = [];
  const objects = new Set<string>();
  let promoted: string | null = initial.promotedDocumentId ?? null;
  const dependencies: InboxMediaVaultDependencies = {
    loadSource: async (agencyId, attachmentId) => (agencyId === AGENCY && attachmentId === ATTACHMENT ? source({ ...initial, promotedDocumentId: promoted }) : null),
    loadDepartureGroupId: async () => GROUP,
    download: async () => new Uint8Array(2048),
    upload: async (path) => {
      objects.add(path);
      return { ok: true };
    },
    createDocument: async (row) => {
      documents.push({ ...row });
    },
    claim: async (_agencyId, _attachmentId, documentId) => {
      if (promoted) return false;
      promoted = documentId;
      return true;
    },
    currentPromoted: async () => promoted,
    removeDocument: async (id) => {
      const index = documents.findIndex((document) => document.id === id);
      if (index >= 0) documents.splice(index, 1);
    },
    removeObject: async (path) => {
      objects.delete(path);
    },
    ...overrides,
  };
  return { saver: createInboxMediaVaultSaver(dependencies), documents, objects, promoted: () => promoted };
}

const request = (overrides = {}) => ({
  agencyId: AGENCY,
  attachmentId: ATTACHMENT,
  destination: "PROPOSAL_COLLATERAL" as const,
  canSaveToVault: true,
  uploadedByName: "Amina",
  ...overrides,
});

describe("saveInboxMediaToVault", () => {
  it("saves a brochure into the vault as collateral linked to its departure group, and sends nothing", async () => {
    const { saver, documents, objects, promoted } = world();
    const result = await saver.save(request());
    expect(result).toMatchObject({ ok: true, alreadySaved: false, linkedDepartureGroup: true });
    expect(documents).toHaveLength(1);
    expect(documents[0]).toMatchObject({
      agencyId: AGENCY,
      category: "Brochure",
      title: "Umrah Plan",
      fileName: "Umrah Plan.pdf",
      mimeType: "application/pdf",
      fileSizeBytes: 2048,
      sourceDepartureGroupId: GROUP,
      uploadedByName: "Amina",
    });
    expect([...objects][0]).toMatch(new RegExp(`^${AGENCY}/inbox-media/`));
    expect(promoted()).toBe(documents[0].id);
  });

  it("files other media as an Other document and works without a linked departure group", async () => {
    const { saver, documents } = world({ loadDepartureGroupId: async () => null }, { kind: "OTHER" });
    const result = await saver.save(request({ destination: "DOCUMENTS" }));
    expect(result).toMatchObject({ ok: true, linkedDepartureGroup: false });
    expect(documents[0]).toMatchObject({ category: "Other", sourceDepartureGroupId: null });
  });

  it("refuses a role that cannot manage the vault before reading anything", async () => {
    const loadSource = vi.fn(async () => source());
    const { saver } = world({ loadSource });
    await expect(saver.save(request({ canSaveToVault: false }))).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(loadSource).not.toHaveBeenCalled();
  });

  it("cannot see an attachment from another agency", async () => {
    const { saver, documents } = world();
    await expect(saver.save(request({ agencyId: "99999999-9999-4999-8999-999999999999" }))).resolves.toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(documents).toEqual([]);
  });

  it("keeps passports and receipts out of the shared vault, whatever destination is requested", async () => {
    for (const kind of ["PASSPORT", "RECEIPT", "VOICE"] as const) {
      for (const destination of ["PROPOSAL_COLLATERAL", "DOCUMENTS"] as const) {
        const { saver, documents } = world({}, { kind });
        await expect(saver.save(request({ destination }))).resolves.toMatchObject({ ok: false, code: "NOT_ALLOWED" });
        expect(documents).toEqual([]);
      }
    }
  });

  it("refuses a destination that does not match the kind of media", async () => {
    const { saver } = world({}, { kind: "BROCHURE" });
    await expect(saver.save(request({ destination: "DOCUMENTS" }))).resolves.toMatchObject({ ok: false, code: "NOT_ALLOWED" });
  });

  it("refuses a file type the vault cannot hold and a file that is no longer stored", async () => {
    const text = world({}, { kind: "OTHER", mimeType: "text/plain", filename: "notes.txt" });
    await expect(text.saver.save(request({ destination: "DOCUMENTS" }))).resolves.toMatchObject({ ok: false, code: "NOT_ALLOWED" });
    const gone = world({}, { storagePath: null });
    await expect(gone.saver.save(request())).resolves.toMatchObject({ ok: false, code: "NOT_ALLOWED" });
  });

  it("refuses a download larger than the vault limit even if the stored size was wrong", async () => {
    const { saver, documents } = world({ download: async () => new Uint8Array(10 * 1024 * 1024 + 1) });
    await expect(saver.save(request())).resolves.toMatchObject({ ok: false, code: "NOT_ALLOWED" });
    expect(documents).toEqual([]);
  });

  it("is idempotent: saving again returns the same document without a second copy", async () => {
    const { saver, documents, objects } = world();
    const first = await saver.save(request());
    const second = await saver.save(request());
    expect(second).toMatchObject({ ok: true, alreadySaved: true });
    expect(second.ok && first.ok && second.documentId).toBe(first.ok && first.documentId);
    expect(documents).toHaveLength(1);
    expect(objects.size).toBe(1);
  });

  it("converges concurrent saves on one document and cleans up the loser's copy", async () => {
    const { saver, documents, objects } = world();
    const [first, second] = await Promise.all([saver.save(request()), saver.save(request())]);
    expect(first.ok && second.ok).toBe(true);
    expect(first.ok && second.ok && first.documentId === second.documentId).toBe(true);
    expect(documents).toHaveLength(1);
    expect(objects.size).toBe(1);
  });

  it("removes the uploaded file when the document row cannot be created", async () => {
    const { saver, objects } = world({
      createDocument: async () => {
        throw new Error("insert failed with internal detail");
      },
    });
    const result = await saver.save(request());
    expect(result).toMatchObject({ ok: false, code: "FAILED" });
    expect(JSON.stringify(result)).not.toContain("internal detail");
    expect(objects.size).toBe(0);
  });

  it("reports an unreadable Inbox copy and a failed upload plainly", async () => {
    await expect(world({ download: async () => null }).saver.save(request())).resolves.toMatchObject({ ok: false, code: "NOT_ALLOWED" });
    await expect(world({ upload: async () => ({ ok: false }) }).saver.save(request())).resolves.toMatchObject({ ok: false, code: "FAILED" });
  });
});
