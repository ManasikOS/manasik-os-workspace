import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const session = { role: "ADMIN", agencyId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" as string | null, name: "Admin Anna" };
const DOCUMENT = "22222222-2222-4222-8222-222222222222";

const listVaultDocuments = vi.fn(async () => [{ id: DOCUMENT, category: "Passport" }]);
const createVaultDocument = vi.fn(async (_client: unknown, input: { id: string }) => ({ id: input.id }));
const deleteVaultDocument = vi.fn(async () => undefined);
const createVaultUploadUrl = vi.fn(async () => ({ ok: true, path: "a/passport/x.jpg", token: "tok", filename: "passport.jpg" }));
const verifyVaultUpload = vi.fn(async () => ({ ok: true, path: "a/passport/x.jpg", mimeType: "image/jpeg", byteSize: 1024 }));
const resolveVaultFileSignedUrl = vi.fn(async () => "https://signed.example/file");

let vaultDocumentRow: Record<string, unknown> | null = { storage_path: "a/passport/x.jpg" };
const maybeSingle = vi.fn(async () => ({ data: vaultDocumentRow, error: null }));
const eqChain = vi.fn(() => ({ maybeSingle }));
const selectChain = vi.fn(() => ({ eq: eqChain }));
const fromChain = vi.fn(() => ({ select: selectChain }));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/headers", () => ({ cookies: async () => ({}) }));
vi.mock("@/lib/dal", () => ({ requireUser: async () => ({ id: "staff-1" }) }));
vi.mock("@/utils/supabase/admin", () => ({ createAdminClient: () => ({ admin: true }) }));
vi.mock("@/utils/supabase/server", () => ({ createClient: () => ({ from: (...args: unknown[]) => fromChain(...(args as [])) }) }));
vi.mock("@/lib/data/departure-groups", () => ({ getCurrentStaffRole: async () => ({ ...session }) }));
vi.mock("@/lib/content/vault-storage", () => ({
  createVaultUploadUrl: (...args: unknown[]) => createVaultUploadUrl(...(args as [])),
  verifyVaultUpload: (...args: unknown[]) => verifyVaultUpload(...(args as [])),
  resolveVaultFileSignedUrl: (...args: unknown[]) => resolveVaultFileSignedUrl(...(args as [])),
}));
vi.mock("@/lib/data/vault-repository", () => ({
  listVaultDocuments: (...args: unknown[]) => listVaultDocuments(...(args as [])),
  createVaultDocument: (...args: unknown[]) => createVaultDocument(...(args as [unknown, { id: string }])),
  deleteVaultDocument: (...args: unknown[]) => deleteVaultDocument(...(args as [])),
}));

const {
  confirmVaultUploadAction,
  deleteVaultDocumentAction,
  getVaultDocumentDownloadUrlAction,
  listVaultDocumentsAction,
  requestVaultUploadUrlAction,
} = await import("./actions");

beforeEach(() => {
  for (const fn of [listVaultDocuments, createVaultDocument, deleteVaultDocument, createVaultUploadUrl, verifyVaultUpload, resolveVaultFileSignedUrl, maybeSingle, eqChain, selectChain, fromChain]) {
    fn.mockClear();
  }
  session.role = "ADMIN";
  session.agencyId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  vaultDocumentRow = { storage_path: "a/passport/x.jpg" };
});

describe("listVaultDocumentsAction", () => {
  it("is open to every signed-in role, not just manageVault roles", async () => {
    session.role = "GUIDE";
    const result = await listVaultDocumentsAction({});
    expect(result).toEqual({ ok: true, documents: [{ id: DOCUMENT, category: "Passport" }] });
  });
});

describe("requestVaultUploadUrlAction", () => {
  it.each(["GUIDE"])("refuses %s", async (role) => {
    session.role = role;
    const result = await requestVaultUploadUrlAction({ category: "Passport", filename: "a.jpg", mimeType: "image/jpeg", byteSize: 100 });
    expect(result).toEqual({ ok: false, error: "Your role cannot upload to the vault." });
    expect(createVaultUploadUrl).not.toHaveBeenCalled();
  });

  it.each(["ADMIN", "CEO", "OPERATIONS", "VISA", "FINANCE", "MARKETING"])("allows %s", async (role) => {
    session.role = role;
    const result = await requestVaultUploadUrlAction({ category: "Passport", filename: "a.jpg", mimeType: "image/jpeg", byteSize: 100 });
    expect(result).toEqual({ ok: true, path: "a/passport/x.jpg", token: "tok", filename: "passport.jpg" });
  });

  it("refuses an account with no agency", async () => {
    session.agencyId = null;
    const result = await requestVaultUploadUrlAction({ category: "Passport", filename: "a.jpg", mimeType: "image/jpeg", byteSize: 100 });
    expect(result).toEqual({ ok: false, error: "Your account is not linked to an agency." });
  });

  it("rejects a zero-byte file at the boundary", async () => {
    const result = await requestVaultUploadUrlAction({ category: "Passport", filename: "a.jpg", mimeType: "image/jpeg", byteSize: 0 });
    expect(result.ok).toBe(false);
    expect(createVaultUploadUrl).not.toHaveBeenCalled();
  });
});

describe("confirmVaultUploadAction", () => {
  it("refuses a role without manageVault", async () => {
    session.role = "GUIDE";
    const result = await confirmVaultUploadAction({ category: "Passport", title: "Passport scan", path: "a/passport/x.jpg", filename: "x.jpg", mimeType: "image/jpeg" });
    expect(result).toEqual({ ok: false, error: "Your role cannot upload to the vault." });
    expect(verifyVaultUpload).not.toHaveBeenCalled();
  });

  it("inserts a document after the upload verifies", async () => {
    const result = await confirmVaultUploadAction({ category: "Passport", title: "Passport scan", path: "a/passport/x.jpg", filename: "x.jpg", mimeType: "image/jpeg" });
    expect(result).toEqual({ ok: true, documentId: expect.any(String) });
    expect(createVaultDocument).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ agencyId: session.agencyId, category: "Passport" }));
  });

  it("does not insert when the uploaded bytes fail verification", async () => {
    verifyVaultUpload.mockResolvedValueOnce({ ok: false, error: "That file is empty or too large." } as never);
    const result = await confirmVaultUploadAction({ category: "Passport", title: "Passport scan", path: "a/passport/x.jpg", filename: "x.jpg", mimeType: "image/jpeg" });
    expect(result).toEqual({ ok: false, error: "That file is empty or too large." });
    expect(createVaultDocument).not.toHaveBeenCalled();
  });
});

describe("deleteVaultDocumentAction", () => {
  it("refuses a role without manageVault", async () => {
    session.role = "GUIDE";
    const result = await deleteVaultDocumentAction({ id: DOCUMENT });
    expect(result).toEqual({ ok: false, error: "Your role cannot delete vault documents." });
    expect(deleteVaultDocument).not.toHaveBeenCalled();
  });

  it("deletes for a manageVault role", async () => {
    const result = await deleteVaultDocumentAction({ id: DOCUMENT });
    expect(result).toEqual({ ok: true });
    expect(deleteVaultDocument).toHaveBeenCalled();
  });
});

describe("getVaultDocumentDownloadUrlAction", () => {
  it("is open to every signed-in role", async () => {
    session.role = "GUIDE";
    const result = await getVaultDocumentDownloadUrlAction({ id: DOCUMENT });
    expect(result).toEqual({ ok: true, url: "https://signed.example/file" });
  });

  it("refuses when the document does not exist", async () => {
    vaultDocumentRow = null;
    const result = await getVaultDocumentDownloadUrlAction({ id: DOCUMENT });
    expect(result).toEqual({ ok: false, error: "That document could not be found." });
  });
});
