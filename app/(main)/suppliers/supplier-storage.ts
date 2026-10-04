"use server";

import { cookies } from "next/headers";

import { capabilitiesForSuppliers } from "@/lib/access/suppliers-access";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { requireUser } from "@/lib/dal";
import { createClient } from "@/utils/supabase/server";

/**
 * Signed access to the private `supplier-evidence` bucket — vouchers, supplier
 * confirmations and invoices/receipts. Separate from `pilgrim-documents`
 * (different sensitivity class, different retention). Same pattern as
 * `app/(main)/departure-groups/document-storage.ts`: the client never holds a
 * bucket credential, it asks for a one-shot signed upload URL, PUTs the file
 * straight to storage, and hands the resulting object path back to the Server
 * Action that records it.
 */

const BUCKET = "supplier-evidence";
const DOWNLOAD_TTL_SECONDS = 120;
const MAX_BYTES = 10 * 1024 * 1024;

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

export type SignedUploadResult =
  | { ok: true; path: string; token: string; fileName: string }
  | { ok: false; error: string };

export async function createSupplierEvidenceUploadUrl(input: {
  supplierId: string;
  commitmentId: string;
  contentType: string;
  sizeBytes: number;
}): Promise<SignedUploadResult> {
  await requireUser();

  const { role, agencyId } = await getCurrentStaffRole();
  const can = capabilitiesForSuppliers(role);
  if (!can.uploadEvidence) {
    return { ok: false, error: "Your role cannot upload supplier evidence." };
  }
  if (!agencyId) {
    return { ok: false, error: "Your account is not linked to an agency." };
  }

  if (!ALLOWED_MIME.has(input.contentType)) {
    return { ok: false, error: "Upload a PDF or a photo (JPG, PNG or WEBP)." };
  }
  if (!Number.isFinite(input.sizeBytes) || input.sizeBytes <= 0) {
    return { ok: false, error: "That file appears to be empty." };
  }
  if (input.sizeBytes > MAX_BYTES) {
    return { ok: false, error: "Files must be 10 MB or smaller." };
  }

  const ids = [input.supplierId, input.commitmentId];
  if (!ids.every((id) => /^[A-Za-z0-9_-]{1,64}$/.test(id))) {
    return { ok: false, error: "That reference is invalid." };
  }

  const extension = EXTENSION_BY_MIME[input.contentType];
  const fileName = `${crypto.randomUUID()}.${extension}`;
  const path = `${agencyId}/${input.supplierId}/${input.commitmentId}/${fileName}`;

  const supabase = createClient(await cookies());
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: true });

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Could not start the upload. Try again." };
  }

  return { ok: true, path: data.path, token: data.token, fileName };
}

export type SignedDownloadResult = { ok: true; url: string } | { ok: false; error: string };

/** Exchanges a stored object path for a short-lived link — used for vouchers and invoices/receipts. */
export async function createSupplierEvidenceDownloadUrl(path: string): Promise<SignedDownloadResult> {
  await requireUser();

  const { role } = await getCurrentStaffRole();
  const can = capabilitiesForSuppliers(role);
  if (!can.viewCommitments) {
    return { ok: false, error: "Your role cannot view supplier evidence." };
  }

  if (!path.trim() || path.includes("..")) {
    return { ok: false, error: "That reference is invalid." };
  }

  const supabase = createClient(await cookies());
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, DOWNLOAD_TTL_SECONDS);

  if (error || !data) {
    return { ok: false, error: error?.message ?? "That file could not be opened." };
  }

  return { ok: true, url: data.signedUrl };
}
