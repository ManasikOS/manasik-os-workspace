/**
 * Server-side handling of a staff file between "uploaded" and "sent" (F1): issuing the signed upload, and re-reading what was actually
 * stored before anything is queued. The browser uploads straight to the private bucket (so the file never passes through a serverless
 * request body, which is capped far below 10 MB), which means the server has to look at the stored bytes itself: what the browser
 * claimed about the file is never taken as proof.
 */

import "server-only";

import { createHash, randomUUID } from "node:crypto";

import type { Db } from "@/lib/ai/db";
import {
  channelAcceptsAttachment,
  findAllowedType,
  isStagedPathFor,
  sanitizeAttachmentFilename,
  stagedAttachmentPath,
  verifyStagedBytes,
  type StagedAttachmentRef,
} from "@/lib/inbox/attachments/staff-attachment";
import { inspectStagedFileContent } from "@/lib/inbox/attachments/file-inspection";

export const INBOX_ATTACHMENT_BUCKET = "inbox-attachments";

export type SignedUploadResult =
  | { ok: true; path: string; token: string; filename: string }
  | { ok: false; error: string };

/** Issues a one-file upload authorisation for a path the server names. The caller has already checked who may send in this conversation. */
export async function createStaffAttachmentUpload(
  admin: Db,
  input: { agencyId: string; conversationId: string; channel: string; filename: string; mimeType: string },
): Promise<SignedUploadResult> {
  const type = findAllowedType(input.mimeType);
  if (!type) return { ok: false, error: "This file type can't be sent." };
  if (!channelAcceptsAttachment(input.channel, type.kind)) {
    return { ok: false, error: input.channel === "INSTAGRAM" ? "Instagram can only carry photos. Send a photo instead." : "This channel can't carry files." };
  }
  const path = stagedAttachmentPath({ agencyId: input.agencyId, conversationId: input.conversationId, objectId: randomUUID(), type });
  const { data, error } = await admin.storage.from(INBOX_ATTACHMENT_BUCKET).createSignedUploadUrl(path);
  if (error || !data?.token) return { ok: false, error: "The upload could not be started. Please try again." };
  return { ok: true, path, token: data.token, filename: sanitizeAttachmentFilename(input.filename, type) };
}

/** The stored object's size in bytes from its record in the bucket, or "UNKNOWN" if the record cannot be found or read. */
async function storedObjectSize(admin: Db, path: string): Promise<number | "UNKNOWN"> {
  const slash = path.lastIndexOf("/");
  const folder = path.slice(0, slash);
  const name = path.slice(slash + 1);
  const { data, error } = await admin.storage.from(INBOX_ATTACHMENT_BUCKET).list(folder, { limit: 5, search: name });
  if (error) return "UNKNOWN";
  const size = (data ?? []).find((object) => object.name === name)?.metadata?.size;
  return typeof size === "number" && Number.isFinite(size) ? size : "UNKNOWN";
}

export type VerifiedStagedFile =
  | { ok: true; path: string; filename: string; mimeType: string; byteSize: number; checksumSha256: string }
  | { ok: false; error: string };

/**
 * Reads the stored object and decides from its bytes. The path must be exactly this agency's and this conversation's, the declared type
 * must be allowed on this channel, and the file must pass the signature, size, macro and script checks. The returned size and checksum
 * are the stored object's, not the browser's.
 */
export async function verifyStagedAttachment(
  admin: Db,
  input: { agencyId: string; conversationId: string; channel: string; ref: StagedAttachmentRef },
): Promise<VerifiedStagedFile> {
  const { ref } = input;
  if (!isStagedPathFor(ref.path, input.agencyId, input.conversationId)) return { ok: false, error: "That upload doesn't belong to this conversation. Attach the file again." };
  const type = findAllowedType(ref.mimeType);
  if (!type) return { ok: false, error: "This file type can't be sent." };
  if (!channelAcceptsAttachment(input.channel, type.kind)) {
    return { ok: false, error: input.channel === "INSTAGRAM" ? "Instagram can only carry photos. Send a photo instead." : "This channel can't carry files." };
  }
  // The size is read from the stored object's own record BEFORE it is downloaded. The bucket caps uploads (10 MB), but the whole file is then
  // loaded into this server's memory, so that cap is not left as the only thing between a misconfigured bucket and an enormous download.
  const storedSize = await storedObjectSize(admin, ref.path);
  if (storedSize === "UNKNOWN") return { ok: false, error: "The file wasn't uploaded. Attach it again." };
  if (storedSize > type.maxBytes) {
    await admin.storage.from(INBOX_ATTACHMENT_BUCKET).remove([ref.path]).catch(() => undefined);
    return { ok: false, error: `That file is too large. ${type.kind === "image" ? "Photos" : "Documents"} can be up to ${type.maxBytes / (1024 * 1024)} MB.` };
  }
  const stored = await admin.storage.from(INBOX_ATTACHMENT_BUCKET).download(ref.path);
  if (stored.error || !stored.data) return { ok: false, error: "The file wasn't uploaded. Attach it again." };
  const bytes = new Uint8Array(await stored.data.arrayBuffer());
  const basic = verifyStagedBytes({ mimeType: ref.mimeType, bytes });
  // The deeper look (hidden scripts in a PDF, a ZIP that is not really an Office file) only runs on a file that already has the right signature and size.
  const verdict = basic.ok ? inspectStagedFileContent({ mimeType: ref.mimeType, bytes }) : basic;
  if (!verdict.ok) {
    // A refused file is removed: it must not sit in the bucket waiting to be sent by a later request.
    await admin.storage.from(INBOX_ATTACHMENT_BUCKET).remove([ref.path]).catch(() => undefined);
    return { ok: false, error: verdict.error };
  }
  return {
    ok: true,
    path: ref.path,
    filename: sanitizeAttachmentFilename(ref.filename, type),
    mimeType: type.mimeType,
    byteSize: bytes.byteLength,
    checksumSha256: createHash("sha256").update(bytes).digest("hex"),
  };
}
