import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const session = { role: "ADMIN", agencyId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" as string | null, name: "Admin Anna" };
const GROUP = "11111111-1111-4111-8111-111111111111";

const loadBrochureSource = vi.fn(async () => ({
  ok: true,
  source: { group: { group_name: "Ramadan Umrah" }, snapshot: {}, pricing: {} },
}));
const buildBrochureViewModel = vi.fn(() => ({ groupName: "Ramadan Umrah", groupCode: "RU15D" }));
const renderBrochurePdf = vi.fn(async () => Buffer.from("pdf-bytes"));
const uploadVaultFile = vi.fn(async () => ({ ok: true }));
const vaultBrochurePath = vi.fn(() => "agency/brochures/item/file.pdf");
const createVaultDocument = vi.fn(async (_client: unknown, input: { id: string }) => ({ id: input.id }));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/dal", () => ({ requireUser: async () => ({ id: "staff-1" }) }));
vi.mock("@/utils/supabase/admin", () => ({ createAdminClient: () => ({ admin: true }) }));
vi.mock("@/lib/data/departure-groups", () => ({ getCurrentStaffRole: async () => ({ ...session }) }));
vi.mock("@/lib/content/brochure-source", () => ({ loadBrochureSource: (...args: unknown[]) => loadBrochureSource(...(args as [])) }));
vi.mock("@/lib/content/brochure-view-model", () => ({ buildBrochureViewModel: (...args: unknown[]) => buildBrochureViewModel(...(args as [])) }));
vi.mock("@/lib/content/brochure-pdf", () => ({ renderBrochurePdf: (...args: unknown[]) => renderBrochurePdf(...(args as [])) }));
vi.mock("@/lib/content/vault-storage", () => ({
  uploadVaultFile: (...args: unknown[]) => uploadVaultFile(...(args as [])),
  vaultBrochurePath: (...args: unknown[]) => vaultBrochurePath(...(args as [])),
}));
vi.mock("@/lib/data/vault-repository", () => ({
  createVaultDocument: (...args: unknown[]) => createVaultDocument(...(args as [unknown, { id: string }])),
}));

const { createDepartureGroupBrochureAction } = await import("./brochure-actions");

beforeEach(() => {
  for (const fn of [loadBrochureSource, buildBrochureViewModel, renderBrochurePdf, uploadVaultFile, vaultBrochurePath, createVaultDocument]) fn.mockClear();
  session.role = "ADMIN";
  session.agencyId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
});

describe("createDepartureGroupBrochureAction", () => {
  it.each(["GUIDE"])("refuses %s before touching the source, storage or repository", async (role) => {
    session.role = role;
    const result = await createDepartureGroupBrochureAction({ departureGroupId: GROUP });
    expect(result).toEqual({ ok: false, error: "Your role cannot generate brochures." });
    expect(loadBrochureSource).not.toHaveBeenCalled();
    expect(uploadVaultFile).not.toHaveBeenCalled();
  });

  it.each(["ADMIN", "CEO", "OPERATIONS", "VISA", "FINANCE", "MARKETING"])("allows %s to generate a brochure", async (role) => {
    session.role = role;
    const result = await createDepartureGroupBrochureAction({ departureGroupId: GROUP });
    expect(result).toEqual({ ok: true, documentId: expect.any(String) });
    expect(createVaultDocument).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ category: "Brochure" }));
  });

  it("refuses an account with no agency", async () => {
    session.agencyId = null;
    const result = await createDepartureGroupBrochureAction({ departureGroupId: GROUP });
    expect(result).toEqual({ ok: false, error: "Your account is not linked to an agency." });
    expect(loadBrochureSource).not.toHaveBeenCalled();
  });

  it("rejects a malformed departure group id at the boundary", async () => {
    const result = await createDepartureGroupBrochureAction({ departureGroupId: "not-a-uuid" });
    expect(result).toEqual({ ok: false, error: "That departure group could not be found." });
    expect(loadBrochureSource).not.toHaveBeenCalled();
  });

  it("propagates the source loader's error unchanged", async () => {
    loadBrochureSource.mockResolvedValueOnce({ ok: false, error: "This group has no pricing to build a brochure from." } as never);
    const result = await createDepartureGroupBrochureAction({ departureGroupId: GROUP });
    expect(result).toEqual({ ok: false, error: "This group has no pricing to build a brochure from." });
  });

  it("stops and reports a plain error when the upload fails, without inserting a vault document", async () => {
    uploadVaultFile.mockResolvedValueOnce({ ok: false, error: "The generated file could not be saved to the vault." } as never);
    const result = await createDepartureGroupBrochureAction({ departureGroupId: GROUP });
    expect(result).toEqual({ ok: false, error: "The generated file could not be saved to the vault." });
    expect(createVaultDocument).not.toHaveBeenCalled();
  });

  it("turns an unexpected rendering failure into a plain message, not a crash", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    renderBrochurePdf.mockRejectedValueOnce(new Error("renderer exploded"));
    const result = await createDepartureGroupBrochureAction({ departureGroupId: GROUP });
    expect(result).toEqual({ ok: false, error: "The brochure could not be generated. Please try again." });
  });
});
