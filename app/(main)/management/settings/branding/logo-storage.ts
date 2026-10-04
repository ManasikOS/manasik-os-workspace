"use server";

import { cookies } from "next/headers";

import { capabilitiesForSettings } from "@/lib/access/settings-access";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { requireUser } from "@/lib/dal";
import { createClient } from "@/utils/supabase/server";

/**
 * Signed upload to the private `agency-assets` bucket. Same shape as
 * `app/(main)/suppliers/supplier-storage.ts`: the client never
 * holds a bucket credential, it asks for a one-shot signed upload URL, PUTs
 * the file straight to storage, and hands the resulting object path back to
 * the Settings action that records it. See the Settings plan F8.
 *
 * The bucket moved from public to private in
 * docs/architecture/multi-tenancy-implementation-plan.md Phase 1 — a public bucket
 * cannot be tenant-isolated, since `getPublicUrl()` returns a stable,
 * unauthenticated URL that bypasses `storage.objects` policies entirely.
 * Every object path is also prefixed with the owning agency's id, matching
 * every other bucket in the app, so the same RLS-style prefix check applies
 * uniformly.
 */

const BUCKET = "agency-assets";
const MAX_BYTES = 5 * 1024 * 1024;

/** Long enough to render the logo across a page load, short enough not to be shareable. */
const DOWNLOAD_TTL_SECONDS = 3600;

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/svg+xml"]);

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

export type SignedUploadResult =
  | { ok: true; path: string; token: string; signedUrl: string }
  | { ok: false; error: string };

export async function createAgencyLogoUploadUrl(input: {
  contentType: string;
  sizeBytes: number;
}): Promise<SignedUploadResult> {
  await requireUser();

  const { role, agencyId } = await getCurrentStaffRole();
  const can = capabilitiesForSettings(role);
  if (!can.editBranding) {
    return { ok: false, error: "Your role cannot change the agency logo." };
  }
  if (!agencyId) {
    return { ok: false, error: "Your account is not linked to an agency." };
  }

  if (!ALLOWED_MIME.has(input.contentType)) {
    return { ok: false, error: "Upload a JPG, PNG, WEBP or SVG image." };
  }
  if (!Number.isFinite(input.sizeBytes) || input.sizeBytes <= 0) {
    return { ok: false, error: "That file appears to be empty." };
  }
  if (input.sizeBytes > MAX_BYTES) {
    return { ok: false, error: "Logo files must be 5 MB or smaller." };
  }

  const extension = EXTENSION_BY_MIME[input.contentType];
  const path = `${agencyId}/logo/${crypto.randomUUID()}.${extension}`;

  const supabase = createClient(await cookies());
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: true });
  if (error || !data) {
    return { ok: false, error: error?.message ?? "Could not start the upload. Try again." };
  }

  const { data: signedUrlData, error: signError } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(data.path, DOWNLOAD_TTL_SECONDS);
  if (signError || !signedUrlData) {
    return { ok: false, error: signError?.message ?? "Could not preview the logo. Try again." };
  }

  return { ok: true, path: data.path, token: data.token, signedUrl: signedUrlData.signedUrl };
}

/** Resolves a stored object path to a short-lived signed URL, or null once it has none. */
export async function agencyAssetSignedUrl(path: string): Promise<string | null> {
  if (!path.trim()) return null;
  const supabase = createClient(await cookies());
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, DOWNLOAD_TTL_SECONDS);
  return data?.signedUrl ?? null;
}
