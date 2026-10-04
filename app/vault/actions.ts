"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

import { capabilitiesForVault } from "@/lib/access/vault-access";
import { createVaultUploadUrl, resolveVaultFileSignedUrl, verifyVaultUpload } from "@/lib/content/vault-storage";
import { createVaultDocument, deleteVaultDocument, listVaultDocuments } from "@/lib/data/vault-repository";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { requireUser } from "@/lib/dal";
import type { VaultDocumentRow } from "@/lib/types/vault";
import {
  confirmVaultUploadSchema,
  deleteVaultDocumentSchema,
  getVaultDocumentUrlSchema,
  listVaultDocumentsSchema,
  requestVaultUploadUrlSchema,
} from "@/lib/validations/vault";
import { createAdminClient } from "@/utils/supabase/admin";
import { createClient } from "@/utils/supabase/server";

async function db() {
  return createClient(await cookies());
}

async function requireAgency() {
  await requireUser();
  const { role, name, agencyId } = await getCurrentStaffRole();
  return { role, name, agencyId };
}

export type ListVaultDocumentsResult = { ok: true; documents: VaultDocumentRow[] } | { ok: false; error: string };

/** Every signed-in role can browse/download the vault (RLS scopes reads to the agency); only `manageVault` roles can change it. */
export async function listVaultDocumentsAction(input: unknown): Promise<ListVaultDocumentsResult> {
  await requireUser();
  const parsed = listVaultDocumentsSchema.safeParse(input ?? {});
  if (!parsed.success) return { ok: false, error: "That category could not be read." };
  try {
    const documents = await listVaultDocuments(await db(), parsed.data.category);
    return { ok: true, documents };
  } catch (cause) {
    console.error("listVaultDocumentsAction failed", cause);
    return { ok: false, error: "The vault could not be loaded. Please try again." };
  }
}

export type RequestVaultUploadUrlResult = { ok: true; path: string; token: string; filename: string } | { ok: false; error: string };

export async function requestVaultUploadUrlAction(input: unknown): Promise<RequestVaultUploadUrlResult> {
  const { role, agencyId } = await requireAgency();
  if (!agencyId) return { ok: false, error: "Your account is not linked to an agency." };
  if (!capabilitiesForVault(role).manageVault) return { ok: false, error: "Your role cannot upload to the vault." };
  const parsed = requestVaultUploadUrlSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the file." };

  return createVaultUploadUrl(createAdminClient(), {
    agencyId,
    category: parsed.data.category,
    filename: parsed.data.filename,
    mimeType: parsed.data.mimeType,
  });
}

export type ConfirmVaultUploadResult = { ok: true; documentId: string } | { ok: false; error: string };

export async function confirmVaultUploadAction(input: unknown): Promise<ConfirmVaultUploadResult> {
  const { role, agencyId, name } = await requireAgency();
  if (!agencyId) return { ok: false, error: "Your account is not linked to an agency." };
  if (!capabilitiesForVault(role).manageVault) return { ok: false, error: "Your role cannot upload to the vault." };
  const parsed = confirmVaultUploadSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the upload." };

  try {
    const verified = await verifyVaultUpload(createAdminClient(), { path: parsed.data.path, mimeType: parsed.data.mimeType });
    if (!verified.ok) return { ok: false, error: verified.error };

    const document = await createVaultDocument(await db(), {
      id: randomUUID(),
      agencyId,
      category: parsed.data.category,
      title: parsed.data.title,
      storagePath: verified.path,
      fileName: parsed.data.filename,
      mimeType: verified.mimeType,
      fileSizeBytes: verified.byteSize,
      uploadedByName: name ?? "Staff",
    });
    revalidatePath("/");
    return { ok: true, documentId: document.id };
  } catch (cause) {
    console.error("confirmVaultUploadAction failed", cause);
    return { ok: false, error: "The document could not be saved. Please try again." };
  }
}

export type DeleteVaultDocumentResult = { ok: true } | { ok: false; error: string };

export async function deleteVaultDocumentAction(input: unknown): Promise<DeleteVaultDocumentResult> {
  const { role } = await requireAgency();
  if (!capabilitiesForVault(role).manageVault) return { ok: false, error: "Your role cannot delete vault documents." };
  const parsed = deleteVaultDocumentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That document could not be found." };

  try {
    await deleteVaultDocument(await db(), parsed.data.id);
    revalidatePath("/");
    return { ok: true };
  } catch (cause) {
    console.error("deleteVaultDocumentAction failed", cause);
    return { ok: false, error: "The document could not be deleted. Please try again." };
  }
}

export type VaultDownloadUrlResult = { ok: true; url: string } | { ok: false; error: string };

/** A fresh, short-lived link — never stored, always resolved at click time. */
export async function getVaultDocumentDownloadUrlAction(input: unknown): Promise<VaultDownloadUrlResult> {
  await requireUser();
  const parsed = getVaultDocumentUrlSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That document could not be found." };

  const supabase = await db();
  const { data: document, error } = await supabase.from("vault_documents").select("storage_path").eq("id", parsed.data.id).maybeSingle();
  if (error || !document) return { ok: false, error: "That document could not be found." };

  const url = await resolveVaultFileSignedUrl(createAdminClient(), document.storage_path as string);
  if (!url) return { ok: false, error: "The file could not be opened. Try again." };
  return { ok: true, url };
}
