import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const session = { role: "ADMIN", agencyId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" as string | null };
const CONVERSATION = "11111111-1111-4111-8111-111111111111";
const DOCUMENT = "22222222-2222-4222-8222-222222222222";

let vaultDocumentRow: Record<string, unknown> | null = {
  id: DOCUMENT,
  storage_path: "agency/passport/doc/file.jpg",
  file_name: "passport.jpg",
  mime_type: "image/jpeg",
  file_size_bytes: 512_000,
};

const maybeSingle = vi.fn(async () => ({ data: vaultDocumentRow, error: null }));
const eqSecond = vi.fn(() => ({ maybeSingle }));
const eqFirst = vi.fn(() => ({ eq: eqSecond }));
const select = vi.fn(() => ({ eq: eqFirst }));
const from = vi.fn(() => ({ select }));

const stageVaultFileForConversation = vi.fn(async () => ({ ok: true, ref: { path: "a/outbound/c/x.jpg", filename: "passport.jpg", mimeType: "image/jpeg" } }));

vi.mock("@/lib/dal", () => ({ requireUser: async () => ({ id: "staff-1" }) }));
vi.mock("@/utils/supabase/admin", () => ({ createAdminClient: () => ({ from: (...args: unknown[]) => from(...(args as [])) }) }));
vi.mock("@/lib/data/departure-groups", () => ({ getCurrentStaffRole: async () => ({ ...session }) }));
vi.mock("@/lib/content/vault-storage", () => ({ stageVaultFileForConversation: (...args: unknown[]) => stageVaultFileForConversation(...(args as [])) }));

const mediaSaver = { save: vi.fn() };
vi.mock("@/lib/inbox/media/media-to-vault", () => ({ createInboxMediaVaultSaver: () => mediaSaver }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/inbox/media/context", () => ({ loadInboxMediaContext: vi.fn(async () => ({ departureGroupId: null })) }));

const { stageVaultDocumentForComposerAction, saveInboxMediaToVaultAction } = await import("./vault-actions");

beforeEach(() => {
  for (const fn of [maybeSingle, eqSecond, eqFirst, select, from, stageVaultFileForConversation, mediaSaver.save]) fn.mockClear();
  mediaSaver.save.mockResolvedValue({ ok: true, documentId: "doc-1", alreadySaved: false, linkedDepartureGroup: true });
  session.role = "ADMIN";
  session.agencyId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  vaultDocumentRow = {
    id: DOCUMENT,
    storage_path: "agency/passport/doc/file.jpg",
    file_name: "passport.jpg",
    mime_type: "image/jpeg",
    file_size_bytes: 512_000,
  };
});

describe("stageVaultDocumentForComposerAction", () => {
  it.each(["CEO", "FINANCE", "VISA", "GUIDE"])("refuses %s before looking up the document", async (role) => {
    session.role = role;
    const result = await stageVaultDocumentForComposerAction({ conversationId: CONVERSATION, vaultDocumentId: DOCUMENT });
    expect(result).toEqual({ ok: false, error: "Not permitted." });
    expect(from).not.toHaveBeenCalled();
    expect(stageVaultFileForConversation).not.toHaveBeenCalled();
  });

  it.each(["ADMIN", "MARKETING", "OPERATIONS"])("allows %s to stage a vault document for a conversation", async (role) => {
    session.role = role;
    const result = await stageVaultDocumentForComposerAction({ conversationId: CONVERSATION, vaultDocumentId: DOCUMENT });
    expect(result).toEqual({
      ok: true,
      ref: { path: "a/outbound/c/x.jpg", filename: "passport.jpg", mimeType: "image/jpeg" },
      fileName: "passport.jpg",
      fileSizeBytes: 512_000,
    });
    expect(stageVaultFileForConversation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ agencyId: session.agencyId, conversationId: CONVERSATION, storagePath: vaultDocumentRow!.storage_path }),
    );
  });

  it("refuses an account with no agency", async () => {
    session.agencyId = null;
    const result = await stageVaultDocumentForComposerAction({ conversationId: CONVERSATION, vaultDocumentId: DOCUMENT });
    expect(result).toEqual({ ok: false, error: "Your account is not linked to an agency." });
    expect(from).not.toHaveBeenCalled();
  });

  it("rejects a malformed id at the boundary", async () => {
    const result = await stageVaultDocumentForComposerAction({ conversationId: "nope", vaultDocumentId: DOCUMENT });
    expect(result.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it("refuses when the document does not exist (wrong agency, or deleted)", async () => {
    vaultDocumentRow = null;
    const result = await stageVaultDocumentForComposerAction({ conversationId: CONVERSATION, vaultDocumentId: DOCUMENT });
    expect(result).toEqual({ ok: false, error: "That document could not be found." });
    expect(stageVaultFileForConversation).not.toHaveBeenCalled();
  });

  it("propagates a staging failure unchanged", async () => {
    stageVaultFileForConversation.mockResolvedValueOnce({ ok: false, error: "The file could not be read from the vault." } as never);
    const result = await stageVaultDocumentForComposerAction({ conversationId: CONVERSATION, vaultDocumentId: DOCUMENT });
    expect(result).toEqual({ ok: false, error: "The file could not be read from the vault." });
  });
});

const ATTACHMENT = "33333333-3333-4333-8333-333333333333";

describe("saveInboxMediaToVaultAction", () => {
  it.each(["ADMIN", "MARKETING", "OPERATIONS", "CEO", "FINANCE", "VISA"])("passes the %s role's own vault permission to the saver", async (role) => {
    session.role = role;
    await saveInboxMediaToVaultAction({ attachmentId: ATTACHMENT, destination: "PROPOSAL_COLLATERAL" });
    const expected = ["ADMIN", "MARKETING", "OPERATIONS", "CEO", "FINANCE", "VISA"].includes(role);
    expect(mediaSaver.save).toHaveBeenCalledWith(expect.objectContaining({ canSaveToVault: expected }));
  });

  it("never lets a role with no Inbox access save anything", async () => {
    session.role = "GUIDE";
    await saveInboxMediaToVaultAction({ attachmentId: ATTACHMENT, destination: "DOCUMENTS" });
    expect(mediaSaver.save).toHaveBeenCalledWith(expect.objectContaining({ canSaveToVault: false }));
  });

  it("takes the agency from the session and ignores anything the client claims", async () => {
    await saveInboxMediaToVaultAction({ attachmentId: ATTACHMENT, destination: "DOCUMENTS" });
    expect(mediaSaver.save).toHaveBeenCalledWith(expect.objectContaining({ agencyId: session.agencyId, attachmentId: ATTACHMENT, destination: "DOCUMENTS" }));
    const smuggled = await saveInboxMediaToVaultAction({ attachmentId: ATTACHMENT, destination: "DOCUMENTS", agencyId: "other" });
    expect(smuggled.ok).toBe(false);
    expect(mediaSaver.save).toHaveBeenCalledTimes(1);
  });

  it("rejects a malformed id or an unknown destination at the boundary", async () => {
    expect((await saveInboxMediaToVaultAction({ attachmentId: "nope", destination: "DOCUMENTS" })).ok).toBe(false);
    expect((await saveInboxMediaToVaultAction({ attachmentId: ATTACHMENT, destination: "FINANCE_INTAKE" })).ok).toBe(false);
    expect((await saveInboxMediaToVaultAction({ attachmentId: ATTACHMENT, destination: "SEND_TO_CUSTOMER" })).ok).toBe(false);
    expect(mediaSaver.save).not.toHaveBeenCalled();
  });

  it("refuses an account with no agency", async () => {
    session.agencyId = null;
    await expect(saveInboxMediaToVaultAction({ attachmentId: ATTACHMENT, destination: "DOCUMENTS" })).resolves.toMatchObject({ ok: false });
    expect(mediaSaver.save).not.toHaveBeenCalled();
  });

  it("says plainly whether the file was linked to a departure group, and that nothing was sent", async () => {
    const linked = await saveInboxMediaToVaultAction({ attachmentId: ATTACHMENT, destination: "PROPOSAL_COLLATERAL" });
    expect(linked).toMatchObject({ ok: true, message: expect.stringMatching(/departure group/i) });
    expect(linked.ok && linked.message).toMatch(/not been sent|nothing was sent/i);
    mediaSaver.save.mockResolvedValueOnce({ ok: true, documentId: "doc-1", alreadySaved: false, linkedDepartureGroup: false });
    const unlinked = await saveInboxMediaToVaultAction({ attachmentId: ATTACHMENT, destination: "DOCUMENTS" });
    expect(unlinked.ok && unlinked.message).not.toMatch(/linked to/i);
  });

  it("returns the saver's refusal in plain words and hides unexpected errors", async () => {
    mediaSaver.save.mockResolvedValueOnce({ ok: false, code: "NOT_ALLOWED", error: "This file cannot be saved to Documents." });
    await expect(saveInboxMediaToVaultAction({ attachmentId: ATTACHMENT, destination: "DOCUMENTS" })).resolves.toEqual({ ok: false, error: "This file cannot be saved to Documents." });
    mediaSaver.save.mockRejectedValueOnce(new Error('relation "vault_documents" does not exist'));
    const failed = await saveInboxMediaToVaultAction({ attachmentId: ATTACHMENT, destination: "DOCUMENTS" });
    expect(failed.ok).toBe(false);
    expect(JSON.stringify(failed)).not.toContain("vault_documents");
  });
});
