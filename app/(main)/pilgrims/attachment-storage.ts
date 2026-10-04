"use server";

import { cookies } from "next/headers";

import { capabilitiesForPilgrims } from "@/lib/access/pilgrims-access";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { requireUser } from "@/lib/dal";
import { createClient } from "@/utils/supabase/server";

/**
 * Signed access to support-case attachments, staged in the same private
 * `pilgrim-documents` bucket every other pilgrim file uses (see
 * `app/(main)/departure-groups/document-storage.ts`) under a distinct
 * `support-cases/` path segment, gated by `manageSupportRequests`'s own role
 * set (ADMIN, OPERATIONS, GUIDE) rather than the document module's — see
 * `20261103090000_support_case_attachments.sql`.
 */

const BUCKET = "pilgrim-documents";
const DOWNLOAD_TTL_SECONDS = 120;
const MAX_BYTES = 10 * 1024 * 1024;

const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "application/pdf",
]);

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "application/pdf": "pdf",
};

export type SignedUploadResult =
  | { ok: true; path: string; token: string; fileName: string }
  | { ok: false; error: string };

/** Issues a one-shot upload URL for one support-case attachment. */
export async function createSupportCaseAttachmentUploadUrl(input: {
  pilgrimId: string;
  requestId: string;
  contentType: string;
  sizeBytes: number;
}): Promise<SignedUploadResult> {
  await requireUser();

  const { role, agencyId } = await getCurrentStaffRole();
  if (!capabilitiesForPilgrims(role).manageSupportRequests) {
    return { ok: false, error: "Your role cannot attach files to a case." };
  }
  if (!agencyId) {
    return { ok: false, error: "Your account is not linked to an agency." };
  }

  if (!ALLOWED_MIME.has(input.contentType)) {
    return { ok: false, error: "Upload a PDF or a photo (JPG, PNG, WEBP or HEIC)." };
  }
  if (!Number.isFinite(input.sizeBytes) || input.sizeBytes <= 0) {
    return { ok: false, error: "That file appears to be empty." };
  }
  if (input.sizeBytes > MAX_BYTES) {
    return { ok: false, error: "Files must be 10 MB or smaller." };
  }

  const ids = [input.pilgrimId, input.requestId];
  if (!ids.every((id) => /^[A-Za-z0-9_-]{1,64}$/.test(id))) {
    return { ok: false, error: "That case reference is invalid." };
  }

  const extension = EXTENSION_BY_MIME[input.contentType];
  const fileName = `${crypto.randomUUID()}.${extension}`;
  const path = `${agencyId}/support-cases/${input.pilgrimId}/${input.requestId}/${fileName}`;

  const supabase = createClient(await cookies());
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUploadUrl(path, { upsert: true });

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Could not start the upload. Try again." };
  }

  return { ok: true, path: data.path, token: data.token, fileName };
}

export type SignedDownloadResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

/** Exchanges a stored attachment path for a short-lived link to view it. */
export async function createSupportCaseAttachmentDownloadUrl(
  path: string,
): Promise<SignedDownloadResult> {
  await requireUser();

  const { role } = await getCurrentStaffRole();
  if (!capabilitiesForPilgrims(role).manageSupportRequests) {
    return { ok: false, error: "Your role cannot view case attachments." };
  }
  if (!path.trim() || path.includes("..")) {
    return { ok: false, error: "That attachment reference is invalid." };
  }

  const supabase = createClient(await cookies());
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, DOWNLOAD_TTL_SECONDS);

  if (error || !data) {
    return { ok: false, error: error?.message ?? "That attachment could not be opened." };
  }

  return { ok: true, url: data.signedUrl };
}

/** Deletes the underlying storage object for a removed attachment. Best-effort — the row is what matters. */
export async function deleteSupportCaseAttachmentObject(path: string): Promise<void> {
  if (!path.trim() || path.includes("..")) return;
  const supabase = createClient(await cookies());
  await supabase.storage.from(BUCKET).remove([path]);
}
