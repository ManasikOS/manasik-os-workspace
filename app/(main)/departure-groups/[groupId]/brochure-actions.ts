"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import { capabilitiesForVault } from "@/lib/access/vault-access";
import { buildBrochureViewModel } from "@/lib/content/brochure-view-model";
import { renderBrochurePdf } from "@/lib/content/brochure-pdf";
import { loadBrochureSource } from "@/lib/content/brochure-source";
import { uploadVaultFile, vaultBrochurePath } from "@/lib/content/vault-storage";
import { createVaultDocument } from "@/lib/data/vault-repository";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { requireUser } from "@/lib/dal";
import { createDepartureGroupBrochureInputSchema } from "@/lib/validations/vault";
import { createAdminClient } from "@/utils/supabase/admin";

export type CreateDepartureGroupBrochureResult =
  | { ok: true; documentId: string }
  | { ok: false; error: string };

/**
 * Generates a brochure PDF from this departure group's live pricing and
 * frozen package snapshot, and saves it into the Document Vault under the
 * "Brochure" category. Restricted to the same operational roles as any
 * other vault upload — see `lib/access/vault-access.ts`.
 */
export async function createDepartureGroupBrochureAction(
  input: unknown,
): Promise<CreateDepartureGroupBrochureResult> {
  await requireUser();
  const parsed = createDepartureGroupBrochureInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That departure group could not be found." };

  const { role, agencyId, name } = await getCurrentStaffRole();
  if (!agencyId) return { ok: false, error: "Your account is not linked to an agency." };
  if (!capabilitiesForVault(role).manageVault) {
    return { ok: false, error: "Your role cannot generate brochures." };
  }

  const admin = createAdminClient();
  const source = await loadBrochureSource(admin, agencyId, parsed.data.departureGroupId);
  if (!source.ok) return { ok: false, error: source.error };

  try {
    const model = buildBrochureViewModel(source.source);
    const pdf = await renderBrochurePdf(model);

    const documentId = randomUUID();
    const storagePath = vaultBrochurePath({ agencyId, contentItemId: documentId, extension: "pdf" });
    const uploaded = await uploadVaultFile(admin, { path: storagePath, bytes: pdf, contentType: "application/pdf" });
    if (!uploaded.ok) return { ok: false, error: uploaded.error };

    const fileName = `${model.groupCode}-brochure.pdf`;
    const document = await createVaultDocument(admin, {
      id: documentId,
      agencyId,
      category: "Brochure",
      title: `${model.groupName} — Brochure`,
      storagePath,
      fileName,
      mimeType: "application/pdf",
      fileSizeBytes: pdf.byteLength,
      sourceDepartureGroupId: parsed.data.departureGroupId,
      uploadedByName: name ?? "Staff",
    });

    revalidatePath(`/departure-groups/${parsed.data.departureGroupId}`);
    return { ok: true, documentId: document.id };
  } catch (cause) {
    console.error("createDepartureGroupBrochureAction failed", cause);
    return { ok: false, error: "The brochure could not be generated. Please try again." };
  }
}
