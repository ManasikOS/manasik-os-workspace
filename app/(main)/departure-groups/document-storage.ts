"use server";

import { cookies } from "next/headers";

import { capabilitiesFor } from "@/lib/access/departure-groups-access";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { requireUser } from "@/lib/dal";
import { createClient } from "@/utils/supabase/server";

/**
 * Signed access to the private `pilgrim-documents` bucket.
 *
 * Passport scans, NICs and vaccination certificates are traveller PII, so the
 * bucket is private and nothing is ever served from a public URL. The client
 * never holds a bucket credential: it asks for a one-shot signed upload URL,
 * PUTs the file straight to storage, and hands the resulting object path back
 * to `submitDocumentAction`. Reads work the same way in reverse, and the signed
 * link is deliberately short-lived.
 *
 * Every entry point re-authenticates and re-checks the role, because a Server
 * Action is a public POST endpoint no matter which component calls it.
 */

const BUCKET = "pilgrim-documents";

/** Long enough to open and read a document, short enough not to be shareable. */
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
 * Issues a one-shot upload URL for one document.
 *
 * The object key is composed server-side from ids the caller cannot forge into
 * another group's folder, and the extension comes from the declared MIME type
 * rather than the original filename — an uploaded `passport.pdf.exe` is stored
 * as a pdf or refused, never kept under its own name.
 */
export async function createDocumentUploadUrl(input: {
  departureGroupId: string;
  pilgrimId: string;
  documentId: string;
  contentType: string;
  sizeBytes: number;
}): Promise<SignedUploadResult> {
  await requireUser();

  const { role, agencyId } = await getCurrentStaffRole();
  const can = capabilitiesFor(role);
  if (!can.manageDocumentsAndVisa || !can.viewSensitiveTravellerData) {
    return { ok: false, error: "Your role cannot upload traveller documents." };
  }
  if (!agencyId) {
    return { ok: false, error: "Your account is not linked to an agency." };
  }

  if (!ALLOWED_MIME.has(input.contentType)) {
    return {
      ok: false,
      error: "Upload a PDF or a photo (JPG, PNG, WEBP or HEIC).",
    };
  }
  if (!Number.isFinite(input.sizeBytes) || input.sizeBytes <= 0) {
    return { ok: false, error: "That file appears to be empty." };
  }
  if (input.sizeBytes > MAX_BYTES) {
    return { ok: false, error: "Files must be 10 MB or smaller." };
  }

  const ids = [input.departureGroupId, input.pilgrimId, input.documentId];
  if (!ids.every((id) => /^[A-Za-z0-9_-]{1,64}$/.test(id))) {
    return { ok: false, error: "That document reference is invalid." };
  }

  const extension = EXTENSION_BY_MIME[input.contentType];
  const fileName = `${input.documentId}.${extension}`;
  const path = `${agencyId}/${input.departureGroupId}/${input.pilgrimId}/${fileName}`;

  const supabase = createClient(await cookies());
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUploadUrl(path, { upsert: true });

  if (error || !data) {
    return {
      ok: false,
      error: error?.message ?? "Could not start the upload. Try again.",
    };
  }

  return { ok: true, path: data.path, token: data.token, fileName };
}

/**
 * Issues a one-shot upload URL for one pilgrim's ticket or visa file — same
 * bucket and validation as `createDocumentUploadUrl()`, but keyed by a fixed
 * `kind` rather than a document-requirement id, since a ticket/visa isn't a
 * checklist item.
 */
export async function createPilgrimFileUploadUrl(input: {
  departureGroupId: string;
  pilgrimId: string;
  kind: "ticket" | "visa";
  contentType: string;
  sizeBytes: number;
}): Promise<SignedUploadResult> {
  await requireUser();

  const { role, agencyId } = await getCurrentStaffRole();
  const can = capabilitiesFor(role);
  const allowed =
    input.kind === "ticket" ? can.manageFlights : can.manageDocumentsAndVisa;
  if (!allowed || !can.viewSensitiveTravellerData) {
    return {
      ok: false,
      error:
        input.kind === "ticket"
          ? "Your role cannot upload flight tickets."
          : "Your role cannot upload traveller documents.",
    };
  }
  if (!agencyId) {
    return { ok: false, error: "Your account is not linked to an agency." };
  }

  if (!ALLOWED_MIME.has(input.contentType)) {
    return {
      ok: false,
      error: "Upload a PDF or a photo (JPG, PNG, WEBP or HEIC).",
    };
  }
  if (!Number.isFinite(input.sizeBytes) || input.sizeBytes <= 0) {
    return { ok: false, error: "That file appears to be empty." };
  }
  if (input.sizeBytes > MAX_BYTES) {
    return { ok: false, error: "Files must be 10 MB or smaller." };
  }

  const ids = [input.departureGroupId, input.pilgrimId];
  if (!ids.every((id) => /^[A-Za-z0-9_-]{1,64}$/.test(id))) {
    return { ok: false, error: "That pilgrim reference is invalid." };
  }

  const extension = EXTENSION_BY_MIME[input.contentType];
  const fileName = `${input.kind}.${extension}`;
  const path = `${agencyId}/${input.departureGroupId}/${input.pilgrimId}/${fileName}`;

  const supabase = createClient(await cookies());
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUploadUrl(path, { upsert: true });

  if (error || !data) {
    return {
      ok: false,
      error: error?.message ?? "Could not start the upload. Try again.",
    };
  }

  return { ok: true, path: data.path, token: data.token, fileName };
}

/**
 * Issues a one-shot upload URL for a ticket whose pilgrim isn't known yet —
 * "Upload Tickets" accepts a whole batch at once and identifies each one by
 * reading the passenger name off it, so there is no pilgrim id to key the
 * path on at upload time. Staged under `_ticket-intake/`, never under a
 * pilgrim's own folder, and moved there only once matched (`finalizeStagedTicket`)
 * or deleted outright if nothing matches (`deleteStagedFile`) — a stray
 * unmatched file is never left looking like it belongs to someone.
 */
export async function createTicketStagingUploadUrl(input: {
  departureGroupId: string;
  contentType: string;
  sizeBytes: number;
}): Promise<SignedUploadResult> {
  await requireUser();

  const { role, agencyId } = await getCurrentStaffRole();
  const can = capabilitiesFor(role);
  if (!can.manageFlights || !can.viewSensitiveTravellerData) {
    return { ok: false, error: "Your role cannot upload flight tickets." };
  }
  if (!agencyId) {
    return { ok: false, error: "Your account is not linked to an agency." };
  }

  if (!ALLOWED_MIME.has(input.contentType)) {
    return {
      ok: false,
      error: "Upload a PDF or a photo (JPG, PNG, WEBP or HEIC).",
    };
  }
  if (!Number.isFinite(input.sizeBytes) || input.sizeBytes <= 0) {
    return { ok: false, error: "That file appears to be empty." };
  }
  if (input.sizeBytes > MAX_BYTES) {
    return { ok: false, error: "Files must be 10 MB or smaller." };
  }
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(input.departureGroupId)) {
    return { ok: false, error: "That departure group reference is invalid." };
  }

  const extension = EXTENSION_BY_MIME[input.contentType];
  const fileName = `${crypto.randomUUID()}.${extension}`;
  const path = `${agencyId}/${input.departureGroupId}/_ticket-intake/${fileName}`;

  const supabase = createClient(await cookies());
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUploadUrl(path, { upsert: true });

  if (error || !data) {
    return {
      ok: false,
      error: error?.message ?? "Could not start the upload. Try again.",
    };
  }

  return { ok: true, path: data.path, token: data.token, fileName };
}

export type SignedDownloadResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

/** Exchanges a stored object path for a short-lived link to view the file. */
export async function createDocumentDownloadUrl(
  path: string,
): Promise<SignedDownloadResult> {
  await requireUser();

  const { role } = await getCurrentStaffRole();
  if (!capabilitiesFor(role).viewSensitiveTravellerData) {
    return { ok: false, error: "Your role cannot view traveller documents." };
  }

  if (!path.trim() || path.includes("..")) {
    return { ok: false, error: "That document reference is invalid." };
  }

  const supabase = createClient(await cookies());
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, DOWNLOAD_TTL_SECONDS);

  if (error || !data) {
    return {
      ok: false,
      error: error?.message ?? "That document could not be opened.",
    };
  }

  return { ok: true, url: data.signedUrl };
}
