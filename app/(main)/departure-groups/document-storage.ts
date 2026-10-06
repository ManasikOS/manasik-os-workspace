"use server";

import { cookies } from "next/headers";

import { canRoleActOnGroup, type StaffRole } from "@/lib/access/departure-groups-access";
import { getCurrentDepartureCapabilities, getCurrentStaffRole } from "@/lib/data/departure-groups";
import { isUuid, parseTravellerFilePath } from "@/lib/data/departure-groups-upload-guard";
import { loadAssignedGroupIds } from "@/lib/data/team-repository";
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

type SupabaseSession = ReturnType<typeof createClient>;

/**
 * Whether this person may act on this group at all - the same rule the pages and
 * `mutate()` apply (a guide only on assigned groups, Marketing only on groups on
 * sale). Needed here because these actions reach storage without going through
 * `mutate()`. Returns an error message, or null when allowed.
 */
async function groupScopeError(
  supabase: SupabaseSession,
  role: StaffRole,
  staffId: string | null,
  groupId: string,
): Promise<string | null> {
  if (role !== "GUIDE" && role !== "MARKETING") return null;
  const { data: group } = await supabase
    .from("departure_groups")
    .select("id, sales_status")
    .eq("id", groupId)
    .maybeSingle();
  if (!group) return "That departure group could not be found.";
  const assigned =
    role === "GUIDE" && staffId ? await loadAssignedGroupIds(supabase, staffId) : [];
  return canRoleActOnGroup(group, role, assigned)
    ? null
    : "You do not have access to that departure group.";
}

/** A traveller must be on the group the upload is for - ids alone prove nothing. */
async function pilgrimIsOnGroup(
  supabase: SupabaseSession,
  groupId: string,
  pilgrimId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("departure_group_pilgrims")
    .select("id")
    .eq("id", pilgrimId)
    .eq("departure_group_id", groupId)
    .maybeSingle();
  return Boolean(data);
}

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

  const { role, agencyId, staffId } = await getCurrentStaffRole();
  const can = await getCurrentDepartureCapabilities();
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

  if (
    !isUuid(input.departureGroupId) ||
    !isUuid(input.pilgrimId) ||
    !/^[A-Za-z0-9_-]{1,64}$/.test(input.documentId)
  ) {
    return { ok: false, error: "That document reference is invalid." };
  }

  const supabase = createClient(await cookies());
  const scopeError = await groupScopeError(supabase, role, staffId, input.departureGroupId);
  if (scopeError) return { ok: false, error: scopeError };
  if (!(await pilgrimIsOnGroup(supabase, input.departureGroupId, input.pilgrimId))) {
    return { ok: false, error: "That traveller is not on this departure group." };
  }

  // A fresh name per upload, never overwritten: replacing a document must not
  // silently swap the file behind a record that was already verified.
  const extension = EXTENSION_BY_MIME[input.contentType];
  const fileName = `${input.documentId}-${crypto.randomUUID()}.${extension}`;
  const path = `${agencyId}/${input.departureGroupId}/${input.pilgrimId}/${fileName}`;

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUploadUrl(path, { upsert: false });

  if (error || !data) {
    console.error("createDocumentUploadUrl failed", error);
    return { ok: false, error: "Could not start the upload. Try again." };
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

  const { role, agencyId, staffId } = await getCurrentStaffRole();
  const can = await getCurrentDepartureCapabilities();
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

  if (!isUuid(input.departureGroupId) || !isUuid(input.pilgrimId)) {
    return { ok: false, error: "That pilgrim reference is invalid." };
  }

  const supabase = createClient(await cookies());
  const scopeError = await groupScopeError(supabase, role, staffId, input.departureGroupId);
  if (scopeError) return { ok: false, error: scopeError };
  if (!(await pilgrimIsOnGroup(supabase, input.departureGroupId, input.pilgrimId))) {
    return { ok: false, error: "That traveller is not on this departure group." };
  }

  const extension = EXTENSION_BY_MIME[input.contentType];
  const fileName = `${input.kind}-${crypto.randomUUID()}.${extension}`;
  const path = `${agencyId}/${input.departureGroupId}/${input.pilgrimId}/${fileName}`;

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUploadUrl(path, { upsert: false });

  if (error || !data) {
    console.error("createPilgrimFileUploadUrl failed", error);
    return { ok: false, error: "Could not start the upload. Try again." };
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

  const { role, agencyId, staffId } = await getCurrentStaffRole();
  const can = await getCurrentDepartureCapabilities();
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
  if (!isUuid(input.departureGroupId)) {
    return { ok: false, error: "That departure group reference is invalid." };
  }

  const supabase = createClient(await cookies());
  const scopeError = await groupScopeError(supabase, role, staffId, input.departureGroupId);
  if (scopeError) return { ok: false, error: scopeError };

  const extension = EXTENSION_BY_MIME[input.contentType];
  const fileName = `${crypto.randomUUID()}.${extension}`;
  const path = `${agencyId}/${input.departureGroupId}/_ticket-intake/${fileName}`;

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUploadUrl(path, { upsert: false });

  if (error || !data) {
    console.error("createTicketStagingUploadUrl failed", error);
    return { ok: false, error: "Could not start the upload. Try again." };
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
  const user = await requireUser();

  const { role, agencyId, staffId, name } = await getCurrentStaffRole();
  if (!(await getCurrentDepartureCapabilities()).viewSensitiveTravellerData) {
    return { ok: false, error: "Your role cannot view traveller documents." };
  }
  if (!agencyId) {
    return { ok: false, error: "Your account is not linked to an agency." };
  }

  // Only a path this module wrote, inside the caller's own agency. Cross-agency
  // reads are also blocked by storage RLS; this is the second layer.
  const objectPath = path.trim();
  const parsed = parseTravellerFilePath(objectPath, agencyId);
  if (!parsed.ok) {
    return { ok: false, error: "That document reference is invalid." };
  }

  const supabase = createClient(await cookies());
  const scopeError = await groupScopeError(supabase, role, staffId, parsed.groupId);
  if (scopeError) return { ok: false, error: scopeError };

  // Logged before the link is issued: a file that cannot be recorded as opened
  // is not opened.
  const { error: logError } = await supabase.from("departure_group_document_access_log").insert({
    agency_id: agencyId,
    staff_id: user.id,
    staff_name: name ?? "Staff",
    departure_group_id: parsed.groupId,
    pilgrim_id: parsed.pilgrimId,
    file_path: objectPath,
    action: "VIEW",
  });
  if (logError) {
    console.error("document access log failed", logError);
    return { ok: false, error: "That document could not be opened right now. Try again." };
  }

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(objectPath, DOWNLOAD_TTL_SECONDS);

  if (error || !data) {
    console.error("createDocumentDownloadUrl failed", error);
    return { ok: false, error: "That document could not be opened." };
  }

  return { ok: true, url: data.signedUrl };
}
