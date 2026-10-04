"use server";

import { cookies } from "next/headers";

import { capabilitiesForFinance } from "@/lib/access/finance-access";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { requireUser } from "@/lib/dal";
import { createClient } from "@/utils/supabase/server";

/**
 * Signed access to the private `payment-proofs` bucket.
 *
 * Bank slips and receipts are commercially sensitive, so the bucket is
 * private and nothing is ever served from a public URL. The client never
 * holds a bucket credential: it asks for a one-shot signed upload URL, PUTs
 * the file straight to storage, and hands the resulting object path back to
 * `recordPaymentAction`. Reads work the same way in reverse. Copied from
 * `app/(main)/departure-groups/document-storage.ts` — a separate bucket from
 * `pilgrim-documents` and `supplier-evidence`, since payment proofs have a
 * different retention and a different audience.
 *
 * Every entry point re-authenticates and re-checks the role, because a
 * Server Action is a public POST endpoint no matter which component calls
 * it.
 */

const BUCKET = "payment-proofs";

/** Long enough to open and read a proof, short enough not to be shareable. */
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

/**
 * Issues a one-shot upload URL for one payment proof.
 *
 * The object key is composed server-side from ids the caller cannot forge
 * into another booking's folder, and the extension comes from the declared
 * MIME type rather than the original filename.
 */
export async function createPaymentProofUploadUrl(input: {
  bookingId: string;
  uploadId: string;
  contentType: string;
  sizeBytes: number;
}): Promise<SignedUploadResult> {
  await requireUser();

  const { role, agencyId } = await getCurrentStaffRole();
  if (!capabilitiesForFinance(role).recordPayments) {
    return { ok: false, error: "Your role cannot record payments." };
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

  const ids = [input.bookingId, input.uploadId];
  if (!ids.every((id) => /^[A-Za-z0-9_-]{1,64}$/.test(id))) {
    return { ok: false, error: "That payment reference is invalid." };
  }

  const extension = EXTENSION_BY_MIME[input.contentType];
  const fileName = `${input.uploadId}.${extension}`;
  const path = `${agencyId}/${input.bookingId}/${fileName}`;

  const supabase = createClient(await cookies());
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUploadUrl(path, { upsert: true });

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Could not start the upload. Try again." };
  }

  return { ok: true, path: data.path, token: data.token, fileName };
}

export type SignedDownloadResult = { ok: true; url: string } | { ok: false; error: string };

/** Exchanges a stored object path for a short-lived link to view the file. */
export async function createPaymentProofDownloadUrl(path: string): Promise<SignedDownloadResult> {
  await requireUser();

  const { role } = await getCurrentStaffRole();
  const can = capabilitiesForFinance(role);
  if (!can.viewLedger && !can.viewReceivables) {
    return { ok: false, error: "Your role cannot view payment proofs." };
  }

  if (!path.trim() || path.includes("..")) {
    return { ok: false, error: "That payment reference is invalid." };
  }

  const supabase = createClient(await cookies());
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, DOWNLOAD_TTL_SECONDS);

  if (error || !data) {
    return { ok: false, error: error?.message ?? "That file could not be opened." };
  }

  return { ok: true, url: data.signedUrl };
}
